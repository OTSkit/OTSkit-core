// test/hashes/ripemd160.test.ts
import { describe, it, expect } from 'vitest';
import { ripemd160 } from '../../src/hashes/ripemd160.js';
import { bytesToHex, textToBytes } from '../../src/utils.js';

const hex = (s: string) => bytesToHex(ripemd160(textToBytes(s)));

describe('ripemd160', () => {
  it('cadena vacía', () => {
    expect(hex('')).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31');
  });
  it('"abc"', () => {
    expect(hex('abc')).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  });
  it('"message digest"', () => {
    expect(hex('message digest')).toBe('5d0689ef49d2fae572b881b123a85ffa21595f36');
  });
  it('alfabeto', () => {
    expect(hex('abcdefghijklmnopqrstuvwxyz')).toBe('f71c27109c692c1b56bbdceb5b9d2865b3708dbc');
  });
  it('"a" (vector oficial)', () => {
    expect(hex('a')).toBe('0bdc9d2d256b3ee9daae347be6f4dc835a467ffe');
  });
  it('mensaje de 56 bytes (frontera de bloque)', () => {
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '12a053384a9c0c88e405a06c27dcf49ada62eb2b',
    );
  });
  it('62 caracteres', () => {
    expect(hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'b0e20b6e3116640286ed3a87a5713079b21f5189',
    );
  });
  it('80 caracteres (multi-bloque)', () => {
    expect(hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe(
      '9b752e45573d4b39f4dbd3323cab82bf63326bfb',
    );
  });
  it('no muta la entrada y devuelve un array nuevo cada vez', () => {
    const msg = new Uint8Array([1, 2, 3]);
    const copy = msg.slice();
    expect(ripemd160(msg)).not.toBe(ripemd160(msg));
    expect(Array.from(msg)).toEqual(Array.from(copy));
  });
  it('siempre devuelve 20 bytes', () => {
    expect(ripemd160(new Uint8Array([1, 2, 3])).length).toBe(20);
  });
});
