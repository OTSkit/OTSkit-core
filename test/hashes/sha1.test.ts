// test/hashes/sha1.test.ts
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createHash } from 'node:crypto'; // test oracle ONLY; not a runtime dependency
import { sha1 } from '../../src/hashes/sha1.js';
import { bytesToHex, textToBytes } from '../../src/utils.js';

const hex = (s: string) => bytesToHex(sha1(textToBytes(s)));

describe('sha1', () => {
  it('empty string', () => {
    expect(hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
  it('"abc"', () => {
    expect(hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('mensaje de 448 bits (RFC 3174)', () => {
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });
  it('siempre devuelve 20 bytes', () => {
    expect(sha1(new Uint8Array([1, 2, 3])).length).toBe(20);
  });
  it.each([55, 56, 57, 63, 64, 65, 119, 120])('longitud frontera de bloque: %i bytes', (n) => {
    const msg = new Uint8Array(n).map((_, i) => (i * 7) & 0xff);
    expect(bytesToHex(sha1(msg))).toBe(createHash('sha1').update(msg).digest('hex'));
  });
  it('coincide con node:crypto para entradas aleatorias (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 260 }), (msg) => {
        expect(bytesToHex(sha1(msg))).toBe(createHash('sha1').update(msg).digest('hex'));
      }),
    );
  });
  it('no muta la entrada y devuelve un array nuevo cada vez', () => {
    const msg = new Uint8Array([1, 2, 3]);
    const copy = msg.slice();
    expect(sha1(msg)).not.toBe(sha1(msg));
    expect(Array.from(msg)).toEqual(Array.from(copy));
  });
});
