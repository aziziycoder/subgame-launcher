/**
 * SubGame Subtitle Encryptor Tool
 * Encrypts raw game subtitle files (e.g. tt01.pc) into AES-256 encrypted packs.
 * Usage: node tools/encrypt-pack.js <inputFile> <outputFile> <licenseKey> <hwid>
 */
const fs = require('fs');
const path = require('path');
const { encryptData } = require('../dist-electron/main/crypto.js');

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const licenseKey = process.argv[4];
const hwid = process.argv[5];

if (!inputFile || !outputFile || !licenseKey || !hwid) {
  console.log('Foydalanish:');
  console.log('node tools/encrypt-pack.js <inputFile> <outputFile> <licenseKey> <hwid>');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Kirish fayli topilmadi: ${inputFile}`);
  process.exit(1);
}

const inputBuffer = fs.readFileSync(inputFile);
console.log(`Fayl o'qildi: ${inputFile} (${(inputBuffer.length / 1024).toFixed(1)} KB)`);

const encrypted = encryptData(inputBuffer, licenseKey, hwid);
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, encrypted);

console.log(`Muvaffaqiyatli AES-256 shifrlandi: ${outputFile} (${(encrypted.length / 1024).toFixed(1)} KB)`);
console.log(`Bog'langan HWID: ${hwid}`);
console.log(`Bog'langan Kalit: ${licenseKey}`);
