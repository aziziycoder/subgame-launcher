import fs from 'fs';
import crypto from 'crypto';

/**
 * Bayt-oraliq patchi (SGPATCH1).
 *
 * Katta arxivlar (masalan, The Last of Us Part I ning 6 GB lik core.psarc fayli) ichidagi matnni
 * butun faylni nusxalamasdan, faqat o'zgargan baytlarni joyida almashtirib yoqish uchun.
 *
 * Format (little-endian):
 *   'SGPATCH1' | u64 targetSize | u32 count |
 *   count x ( u64 offset | u32 length | 32 bayt sha256(almashtiriladigan ASL baytlar) | length bayt YANGI ma'lumot )
 *
 * Zaxira fayli ham xuddi shu formatda yoziladi: unda "yangi" ma'lumot o'rnida asl baytlar,
 * sha256 o'rnida esa patch qo'yilgandan keyingi baytlarning xeshi turadi. Shuning uchun
 * zaxirani qo'llash ham oddiy patch qo'llash bilan bir xil amal.
 */

const MAGIC = Buffer.from('SGPATCH1', 'ascii');

export interface RangePatchEntry {
  offset: number;
  sha256: Buffer;
  data: Buffer;
}

export interface RangePatch {
  targetSize: number;
  entries: RangePatchEntry[];
}

export function isRangePatch(buf: Buffer | null | undefined): boolean {
  return !!buf && buf.length >= 20 && buf.subarray(0, 8).equals(MAGIC);
}

export function parseRangePatch(buf: Buffer): RangePatch {
  if (!isRangePatch(buf)) throw new Error('Patch formati noto‘g‘ri (SGPATCH1 emas).');
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
  return { targetSize, entries };
}

export function serializeRangePatch(patch: RangePatch): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(20);
  MAGIC.copy(head, 0);
  head.writeBigUInt64LE(BigInt(patch.targetSize), 8);
  head.writeUInt32LE(patch.entries.length, 16);
  parts.push(head);
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
    done += fs.writeSync(fd, data, done, data.length - done, offset + done);
  }
}

function openForWrite(file: string): number {
  try {
    try { fs.chmodSync(file, 0o666); } catch {}
    return fs.openSync(file, 'r+');
  } catch (err: any) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') {
      throw new Error(
        `O'yin fayliga yozishga ruxsat yo'q (${err.code}). O'yin "Program Files" papkasida bo'lsa, SubGame Launcherni "Administrator sifatida ishga tushirish" orqali oching.`
      );
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
  if (st.size !== patch.targetSize) {
    throw new Error(
      "O'yin versiyasi o'zbekcha paketga mos emas. O'yinni yangilang yoki fayllarini Steam orqali tekshiring."
    );
  }

  const fd = openForWrite(targetFile);
  try {
    const backupEntries: RangePatchEntry[] = [];
    let alreadyPatched = 0;
    for (const e of patch.entries) {
      const cur = readAt(fd, e.offset, e.data.length);
      if (cur.equals(e.data)) {
        alreadyPatched++;
        continue;
      }
      if (!sha(cur).equals(e.sha256)) {
        throw new Error(
          "O'yin fayllari kutilgan holatda emas. O'yinning boshqa versiyasi o'rnatilgan bo'lishi mumkin; fayllarni Steam orqali tekshiring."
        );
      }
      backupEntries.push({ offset: e.offset, sha256: sha(e.data), data: cur });
    }

    if (alreadyPatched === patch.entries.length) return;
    if (alreadyPatched > 0 && !fs.existsSync(backupFile)) {
      throw new Error('O‘yin fayli qisman patchlangan va zaxira topilmadi. Steam orqali fayllarni tekshiring.');
    }

    if (backupEntries.length > 0 && !fs.existsSync(backupFile)) {
      // Zaxirani AVVAL diskka yozamiz, keyin o'yin fayliga tegamiz
      fs.writeFileSync(backupFile, serializeRangePatch({ targetSize: patch.targetSize, entries: backupEntries }));
    }

    for (const e of patch.entries) {
      writeAt(fd, e.offset, e.data);
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
  const fd = openForWrite(targetFile);
  try {
    for (const e of backup.entries) {
      writeAt(fd, e.offset, e.data);
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
  $n = [BitConverter]::ToUInt32($b, 16);
  $p = 20;
  $fs = [System.IO.File]::Open($dest, 'Open', 'ReadWrite', 'ReadWrite');
  try {
    for ($k = 0; $k -lt $n; $k++) {
      $off = [BitConverter]::ToInt64($b, $p);
      $len = [BitConverter]::ToInt32($b, $p + 8);
      $p += 44;
      [void]$fs.Seek($off, 'Begin');
      $fs.Write($b, $p, $len);
      $p += $len;
    }
    $fs.Flush();
  } finally { $fs.Close() };
  Remove-Item -LiteralPath $bak -Force;
`;
