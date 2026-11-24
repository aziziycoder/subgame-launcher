import fs from 'fs';
import crypto from 'crypto';

/**
 * Bayt-oraliq patchi (SGPATCH1 va SGPATCH2).
 *
 * Katta arxivlar (masalan, The Last of Us Part I/II ning ko'p GB lik core.psarc fayli) ichidagi matnni
 * butun faylni nusxalamasdan, faqat o'zgargan baytlarni joyida almashtirib yoqish uchun.
 *
 * SGPATCH1 (fayl hajmi o'zgarmaganda):
 *   'SGPATCH1' | u64 targetSize | u32 count |
 *   count x ( u64 offset | u32 length | 32 bayt sha256(asl baytlar) | length bayt YANGI ma'lumot )
 *
 * SGPATCH2 (fayl ichidagi bloklar surilib, fayl hajmi o'zgarganda):
 *   'SGPATCH2' | u64 origSize | u64 newSize | u32 moveCount | u32 writeCount |
 *   moveCount  x ( u64 srcOffset | u64 dstOffset | u64 length ) |
 *   writeCount x ( u64 offset | u32 length | 32 bayt sha256(asl baytlar) | length bayt YANGI ma'lumot )
 */

const MAGIC_V1 = Buffer.from('SGPATCH1', 'ascii');
const MAGIC_V2 = Buffer.from('SGPATCH2', 'ascii');

export interface RangePatchEntry {
  offset: number;
  sha256: Buffer;
  data: Buffer;
}

export interface RangeMoveEntry {
  srcOffset: number;
  dstOffset: number;
  length: number;
}

export interface RangePatch {
  version: 1 | 2;
  targetSize: number;
  newSize: number;
  moves: RangeMoveEntry[];
  entries: RangePatchEntry[];
}

export function isRangePatch(buf: Buffer | null | undefined): boolean {
  return (
    !!buf &&
    buf.length >= 20 &&
    (buf.subarray(0, 8).equals(MAGIC_V1) || (buf.length >= 32 && buf.subarray(0, 8).equals(MAGIC_V2)))
  );
}

export function parseRangePatch(buf: Buffer): RangePatch {
  if (!isRangePatch(buf)) throw new Error('Patch formati noto‘g‘ri (SGPATCH1/SGPATCH2 emas).');

  if (buf.subarray(0, 8).equals(MAGIC_V1)) {
    const targetSize = Number(buf.readBigUInt64LE(8));
    const count = buf.readUInt32LE(16);
    const entries: RangePatchEntry[] = [];
    let pos = 20;
    for (let i = 0; i < count; i++) {
      if (pos + 44 > buf.length) throw new Error('Patch fayli buzilgan (qisqa).');
      const offset = Number(buf.readBigUInt64LE(pos));
      const length = buf.readUInt32LE(pos + 8);
      const sha256 = buf.subarray(pos + 12, pos + 44);
      pos += 44;
      if (pos + length > buf.length) throw new Error('Patch fayli buzilgan (qisqa ma’lumot).');
      entries.push({ offset, sha256, data: buf.subarray(pos, pos + length) });
      pos += length;
    }
    return { version: 1, targetSize, newSize: targetSize, moves: [], entries };
  }

  // SGPATCH2
  const targetSize = Number(buf.readBigUInt64LE(8));
  const newSize = Number(buf.readBigUInt64LE(16));
  const moveCount = buf.readUInt32LE(24);
  const writeCount = buf.readUInt32LE(28);
  let pos = 32;
  const moves: RangeMoveEntry[] = [];
  for (let i = 0; i < moveCount; i++) {
    if (pos + 24 > buf.length) throw new Error('Patch fayli buzilgan (move qisqa).');
    const srcOffset = Number(buf.readBigUInt64LE(pos));
    const dstOffset = Number(buf.readBigUInt64LE(pos + 8));
    const length = Number(buf.readBigUInt64LE(pos + 16));
    pos += 24;
    moves.push({ srcOffset, dstOffset, length });
  }
  const entries: RangePatchEntry[] = [];
  for (let i = 0; i < writeCount; i++) {
    if (pos + 44 > buf.length) throw new Error('Patch fayli buzilgan (write qisqa).');
    const offset = Number(buf.readBigUInt64LE(pos));
    const length = buf.readUInt32LE(pos + 8);
    const sha256 = buf.subarray(pos + 12, pos + 44);
    pos += 44;
    if (pos + length > buf.length) throw new Error('Patch fayli buzilgan (qisqa ma’lumot).');
    entries.push({ offset, sha256, data: buf.subarray(pos, pos + length) });
    pos += length;
  }
  return { version: 2, targetSize, newSize, moves, entries };
}

export function serializeRangePatch(patch: {
  version?: 1 | 2;
  targetSize: number;
  newSize?: number;
  moves?: RangeMoveEntry[];
  entries: RangePatchEntry[];
}): Buffer {
  const version = patch.version ?? (patch.moves?.length || (patch.newSize && patch.newSize !== patch.targetSize) ? 2 : 1);
  const parts: Buffer[] = [];
  if (version === 1) {
    const head = Buffer.alloc(20);
    MAGIC_V1.copy(head, 0);
    head.writeBigUInt64LE(BigInt(patch.targetSize), 8);
    head.writeUInt32LE(patch.entries.length, 16);
    parts.push(head);
  } else {
    const moves = patch.moves ?? [];
    const head = Buffer.alloc(32);
    MAGIC_V2.copy(head, 0);
    head.writeBigUInt64LE(BigInt(patch.targetSize), 8);
    head.writeBigUInt64LE(BigInt(patch.newSize ?? patch.targetSize), 16);
    head.writeUInt32LE(moves.length, 24);
    head.writeUInt32LE(patch.entries.length, 28);
    parts.push(head);
    for (const m of moves) {
      const mh = Buffer.alloc(24);
      mh.writeBigUInt64LE(BigInt(m.srcOffset), 0);
      mh.writeBigUInt64LE(BigInt(m.dstOffset), 8);
      mh.writeBigUInt64LE(BigInt(m.length), 16);
      parts.push(mh);
    }
  }
  for (const e of patch.entries) {
    const h = Buffer.alloc(12);
    h.writeBigUInt64LE(BigInt(e.offset), 0);
    h.writeUInt32LE(e.data.length, 8);
    parts.push(h, e.sha256, e.data);
  }
  return Buffer.concat(parts);
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest();

function readAt(fd: number, offset: number, length: number): Buffer {
  const b = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, b, done, length - done, offset + done);
    if (n <= 0) throw new Error('Faylni o‘qib bo‘lmadi (kutilmagan oxir).');
    done += n;
  }
  return b;
}

function writeAt(fd: number, offset: number, data: Buffer): void {
  let done = 0;
  while (done < data.length) {
    const n = fs.writeSync(fd, data, done, data.length - done, offset + done);
    if (n <= 0) throw new Error('Faylga yozib bo‘lmadi.');
    done += n;
  }
}

function openForWrite(targetFile: string): number {
  try {
    return fs.openSync(targetFile, 'r+');
  } catch (err: any) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      try {
        fs.chmodSync(targetFile, 0o666);
        return fs.openSync(targetFile, 'r+');
      } catch {}
    }
    throw err;
  }
}

/**
 * Patchni qo'llaydi va asl baytlarni zaxira fayliga yozadi.
 * - Fayl allaqachon shu patch bilan patchlangan bo'lsa, hech narsa yozmaydi.
 * - Asl baytlar ham, patchlangan baytlar ham mos kelmasa (o'yinning boshqa versiyasi), xato qaytaradi
 *   va faylga tegmaydi.
 */
export function applyRangePatch(targetFile: string, patchBuf: Buffer, backupFile: string): void {
  const patch = parseRangePatch(patchBuf);
  const st = fs.statSync(targetFile);

  if (st.size !== patch.targetSize && st.size !== patch.newSize) {
    throw new Error(
      "O'yin versiyasi o'zbekcha paketga mos emas. O'yinni yangilang yoki fayllarini Steam orqali tekshiring."
    );
  }

  const fd = openForWrite(targetFile);
  try {
    // Check if already patched (size == newSize and all writes match)
    if (st.size === patch.newSize) {
      let alreadyPatched = 0;
      for (const e of patch.entries) {
        if (e.offset + e.data.length <= st.size) {
          const cur = readAt(fd, e.offset, e.data.length);
          if (cur.equals(e.data)) alreadyPatched++;
        }
      }
      if (alreadyPatched === patch.entries.length) return;
      if (alreadyPatched > 0 && st.size !== patch.targetSize && !fs.existsSync(backupFile)) {
        throw new Error('O‘yin fayli qisman patchlangan va zaxira topilmadi. Steam orqali fayllarni tekshiring.');
      }
    }

    if (st.size !== patch.targetSize) {
      throw new Error(
        "O'yin versiyasi o'zbekcha paketga mos emas. O'yinni yangilang yoki fayllarini Steam orqali tekshiring."
      );
    }

    const backupEntries: RangePatchEntry[] = [];
    let alreadyPatched = 0;
    for (const e of patch.entries) {
      const cur = readAt(fd, e.offset, e.data.length);
      if (sha(cur).equals(e.sha256)) {
        backupEntries.push({ offset: e.offset, sha256: sha(e.data), data: cur });
        continue;
      }
      if (cur.equals(e.data)) {
        alreadyPatched++;
        continue;
      }
      throw new Error(
        "O'yin fayllari kutilgan holatda emas. O'yinning boshqa versiyasi o'rnatilgan bo'lishi mumkin; fayllarni Steam orqali tekshiring."
      );
    }

    if (alreadyPatched === patch.entries.length && patch.moves.length === 0 && st.size === patch.newSize) return;
    if (alreadyPatched > 0 && !fs.existsSync(backupFile)) {
      throw new Error('O‘yin fayli qisman patchlangan va zaxira topilmadi. Steam orqali fayllarni tekshiring.');
    }

    if (!fs.existsSync(backupFile)) {
      const reverseMoves: RangeMoveEntry[] = patch.moves
        .slice()
        .reverse()
        .map((m) => ({ srcOffset: m.dstOffset, dstOffset: m.srcOffset, length: m.length }));

      fs.writeFileSync(
        backupFile,
        serializeRangePatch({
          version: patch.version,
          targetSize: patch.newSize,
          newSize: patch.targetSize,
          moves: reverseMoves,
          entries: backupEntries,
        })
      );
    }

    // Read all move buffers BEFORE overwriting any moved/written regions
    const movedBuffers = patch.moves.map((m) => ({
      dstOffset: m.dstOffset,
      data: readAt(fd, m.srcOffset, m.length),
    }));

    if (patch.newSize > st.size) {
      fs.ftruncateSync(fd, patch.newSize);
    }

    for (const mv of movedBuffers) {
      writeAt(fd, mv.dstOffset, mv.data);
    }
    for (const e of patch.entries) {
      writeAt(fd, e.offset, e.data);
    }

    if (patch.newSize < st.size) {
      fs.ftruncateSync(fd, patch.newSize);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Zaxira faylidan asl baytlarni qaytaradi va zaxirani o'chiradi.
 * Fayl allaqachon asl holatda bo'lsa ham xavfsiz.
 */
export function restoreRangePatch(targetFile: string, backupFile: string): boolean {
  if (!fs.existsSync(backupFile)) return false;
  const backup = parseRangePatch(fs.readFileSync(backupFile));
  if (!fs.existsSync(targetFile)) return false;
  const st = fs.statSync(targetFile);
  const fd = openForWrite(targetFile);
  try {
    const movedBuffers = backup.moves.map((m) => ({
      dstOffset: m.dstOffset,
      data: readAt(fd, m.srcOffset, m.length),
    }));

    if (backup.newSize > st.size) {
      fs.ftruncateSync(fd, backup.newSize);
    }

    for (const mv of movedBuffers) {
      writeAt(fd, mv.dstOffset, mv.data);
    }
    for (const e of backup.entries) {
      writeAt(fd, e.offset, e.data);
    }

    if (backup.newSize < st.size) {
      fs.ftruncateSync(fd, backup.newSize);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try { fs.unlinkSync(backupFile); } catch {}
  return true;
}

/**
 * PowerShell skripti uchun: launcher yopilgan bo'lsa ham, mustaqil kuzatuvchi zaxirani qo'llay olsin.
 * $dest va $bak o'zgaruvchilari oldindan berilgan bo'lishi kerak.
 */
export const POWERSHELL_RANGE_RESTORE = `
  $b = [System.IO.File]::ReadAllBytes($bak);
  $magic = [System.Text.Encoding]::ASCII.GetString($b, 0, 8);
  $fs = [System.IO.File]::Open($dest, 'Open', 'ReadWrite', 'ReadWrite');
  try {
    if ($magic -eq 'SGPATCH1') {
      $n = [BitConverter]::ToUInt32($b, 16);
      $p = 20;
      for ($k = 0; $k -lt $n; $k++) {
        $off = [BitConverter]::ToInt64($b, $p);
        $len = [BitConverter]::ToInt32($b, $p + 8);
        $p += 44;
        [void]$fs.Seek($off, 'Begin');
        $fs.Write($b, $p, $len);
        $p += $len;
      }
    } elseif ($magic -eq 'SGPATCH2') {
      $newSz = [BitConverter]::ToInt64($b, 16);
      $mCnt = [BitConverter]::ToUInt32($b, 24);
      $wCnt = [BitConverter]::ToUInt32($b, 28);
      $p = 32;
      $mvList = @();
      for ($i = 0; $i -lt $mCnt; $i++) {
        $src = [BitConverter]::ToInt64($b, $p);
        $dst = [BitConverter]::ToInt64($b, $p + 8);
        $mlen = [BitConverter]::ToInt64($b, $p + 16);
        $p += 24;
        $buf = New-Object byte[] $mlen;
        [void]$fs.Seek($src, 'Begin');
        $read = 0;
        while ($read -lt $mlen) { $read += $fs.Read($buf, $read, $mlen - $read); }
        $mvList += ,@($dst, $buf);
      }
      if ($newSz -gt $fs.Length) { $fs.SetLength($newSz); }
      foreach ($mv in $mvList) {
        [void]$fs.Seek($mv[0], 'Begin');
        $fs.Write($mv[1], 0, $mv[1].Length);
      }
      for ($k = 0; $k -lt $wCnt; $k++) {
        $off = [BitConverter]::ToInt64($b, $p);
        $len = [BitConverter]::ToInt32($b, $p + 8);
        $p += 44;
        [void]$fs.Seek($off, 'Begin');
        $fs.Write($b, $p, $len);
        $p += $len;
      }
      if ($newSz -lt $fs.Length) { $fs.SetLength($newSz); }
    }
    $fs.Flush();
  } finally { $fs.Close() };
  Remove-Item -LiteralPath $bak -Force;
`;
