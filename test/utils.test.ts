// test/utils.test.ts
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hexToBytes, bytesToHex, textToBytes, bytesToText, bytesEqual, compareBytes, randBytes } from '../src/utils.js';

describe('hexToBytes / bytesToHex', () => {
  it('empty hex → empty array', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });

  it('parses valid hex', () => {
    expect(hexToBytes('00ff10')).toEqual(new Uint8Array([0x00, 0xff, 0x10]));
  });

  it('rechaza longitud impar', () => {
    expect(() => hexToBytes('abc')).toThrow(/length/i);
  });

  it('rechaza caracteres no-hex', () => {
    expect(() => hexToBytes('zz')).toThrow(/hex/i);
  });

  it('roundtrip hex (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
      }),
    );
  });

  it('bytesToHex uses the value, not the index', () => {
    // regression for the bytesToChars bug in the original
    expect(bytesToHex(new Uint8Array([0xde, 0xad]))).toBe('dead');
  });
});

describe('texto', () => {
  it('roundtrip UTF-8', () => {
    expect(bytesToText(textToBytes('áé你好'))).toBe('áé你好');
  });
});

describe('comparison', () => {
  it('bytesEqual', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('compareBytes orders lexicographically', () => {
    expect(compareBytes(new Uint8Array([1]), new Uint8Array([2]))).toBeLessThan(0);
    expect(compareBytes(new Uint8Array([1, 2]), new Uint8Array([1]))).toBeGreaterThan(0);
    expect(compareBytes(new Uint8Array([5]), new Uint8Array([5]))).toBe(0);
  });
});

describe('randBytes', () => {
  it('devuelve Uint8Array de la longitud pedida', () => {
    const r = randBytes(16);
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r.length).toBe(16);
  });

  it('n=0 → empty Uint8Array', () => {
    expect(randBytes(0)).toEqual(new Uint8Array(0));
  });

  it('throws when crypto is unavailable (fail-closed, never Math.random)', () => {
    const original = globalThis.crypto;
    // @ts-expect-error forzamos ausencia de crypto
    delete (globalThis as { crypto?: Crypto }).crypto;
    try {
      expect(() => randBytes(8)).toThrow(/crypto/i);
    } finally {
      (globalThis as { crypto?: Crypto }).crypto = original;
    }
  });

  it('lanza si n < 0', () => {
    expect(() => randBytes(-1)).toThrow(/n must be/i);
  });
});
