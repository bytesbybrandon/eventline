'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { zip, exportFiles } = require('../site/app/zip.js');

// Walks the central directory, checks each CRC and size, returns [{ name, text }].
function readZip(bytes) {
  const b = Buffer.from(bytes);
  const eocd = b.length - 22;
  assert.equal(b.readUInt32LE(eocd), 0x06054b50);
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  assert.equal(b.readUInt32LE(eocd + 12), eocd - p);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    assert.equal(b.readUInt16LE(p + 8) & 0x800, 0x800);
    assert.equal(b.readUInt16LE(p + 10), 0);
    const crc = b.readUInt32LE(p + 16);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const skip = nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    assert.equal(b.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc);
    out.push({ name, text: data.toString('utf8') });
    p += 46 + skip;
  }
  return out;
}

test('the zip reads back with the exact text', () => {
  const files = [{ name: 'shop.dsl', text: 'system Shop {\n}\n// héllo ✓\n' }, { name: 'b.dsl', text: '' }];
  assert.deepEqual(readZip(zip(files, new Date(2026, 10, 18))), files);
});

test('colliding and unsafe names stay distinct and safe', () => {
  const names = exportFiles([{ name: 'Checkout', text: 'a' }, { name: 'checkout', text: 'b' }, { name: 'a/b:c', text: 'c' }, { name: '..', text: 'd' }, { name: '', text: 'e' }]).map((f) => f.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 5);
  for (const n of names) { assert.match(n, /\.dsl$/); assert.doesNotMatch(n, /[\\/:*?"<>|]|^\./); }
});

test('names that already end in .dsl are not doubled, and suffixes cannot collide', () => {
  const names = exportFiles([{ name: 'a.dsl', text: '' }, { name: 'a', text: '' }, { name: 'a-2', text: '' }]).map((f) => f.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 3);
  assert.ok(!names.some((n) => /\.dsl\.dsl$/.test(n)));
});
