// test/hashes/sha256.test.ts
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createHash } from 'node:crypto'; // SOLO oráculo de test (built-in de Node); no es dependencia de runtime
import { sha256 } from '../../src/hashes/sha256.js';
import { bytesToHex, textToBytes } from '../../src/utils.js';

const hex = (s: string) => bytesToHex(sha256(textToBytes(s)));

describe('sha256', () => {
  it('cadena vacía', () => {
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('"abc"', () => {
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('mensaje de 448 bits (NIST)', () => {
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('un millón de "a"', () => {
    const msg = new Uint8Array(1_000_000).fill(0x61);
    expect(bytesToHex(sha256(msg))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('siempre devuelve 32 bytes', () => {
    expect(sha256(new Uint8Array([1, 2, 3])).length).toBe(32);
  });
  it.each([55, 56, 57, 63, 64, 65, 119, 120])('longitud frontera de bloque: %i bytes', (n) => {
    const msg = new Uint8Array(n).map((_, i) => (i * 7) & 0xff);
    expect(bytesToHex(sha256(msg))).toBe(createHash('sha256').update(msg).digest('hex'));
  });
  it('coincide con node:crypto para entradas aleatorias (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 260 }), (msg) => {
        expect(bytesToHex(sha256(msg))).toBe(createHash('sha256').update(msg).digest('hex'));
      }),
    );
  });
  it('no muta la entrada y devuelve un array nuevo cada vez', () => {
    const msg = new Uint8Array([1, 2, 3]);
    const copy = msg.slice();
    expect(sha256(msg)).not.toBe(sha256(msg));
    expect(Array.from(msg)).toEqual(Array.from(copy));
  });
});
