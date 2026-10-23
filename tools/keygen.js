/**
 * SubGame Admin License Key Generator
 * Usage: node tools/keygen.js [INNO|REQU|OUTW|LEGA] [count]
 */
const crypto = require('crypto');

const prefixes = {
  inno: 'SUB-INNO',
  requ: 'SUB-REQU',
  outw: 'SUB-OUTW',
  lega: 'SUB-LEGA',
  demo: 'SUB-DEMO',
};

const type = (process.argv[2] || 'inno').toLowerCase();
const count = parseInt(process.argv[3] || '1', 10);
const prefix = prefixes[type] || 'SUB-GAME';

function randomChars(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous 0, O, 1, I
  let str = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    str += chars[bytes[i] % chars.length];
  }
  return str;
}

console.log('='.repeat(55));
console.log(`  SubGame Rasmiy Litsenziya Kalitlari Generator`);
console.log(`  O'yin turi: ${prefix}`);
console.log(`  Soni: ${count} ta kalit`);
console.log('='.repeat(55));

for (let i = 1; i <= count; i++) {
  const part1 = randomChars(4);
  const part2 = randomChars(4);
  const key = `${prefix}-${part1}-${part2}`;
  console.log(`[${i}] ${key}`);
}
console.log('='.repeat(55));
