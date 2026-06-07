// test/context.test.ts
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { StreamDeserializationContext, StreamSerializationContext } from '../src/context.js';
import { TruncatedStreamError, OversizedDataError, VaruintOverflowError, BadMagicError, TrailingGarbageError, NonCanonicalVaruintError } from '../src/errors.js';

const ser = () => new StreamSerializationContext();
const de = (b: Uint8Array) => new StreamDeserializationContext(b);

describe('readVaruint (LEB128)', () => {
  it.each([
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [16383, [0xff, 0x7f]],
  ])('decodifica %i', (value, bytes) => {
    expect(de(new Uint8Array(bytes)).readVaruint()).toBe(value);
  });

  it('roundtrip writeVaruint→readVaruint (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const s = ser();
        s.writeVaruint(n);
        expect(de(s.getOutput()).readVaruint()).toBe(n);
      }),
    );
  });

  it('lanza VaruintOverflowError si excede MAX_SAFE_INTEGER', () => {
    // 9 bytes de 0xff fuerzan un valor por encima del límite seguro
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => de(bytes).readVaruint()).toThrow(VaruintOverflowError);
  });

  it('lanza TruncatedStreamError si el varuint no termina', () => {
    expect(() => de(new Uint8Array([0x80])).readVaruint()).toThrow(TruncatedStreamError);
  });

  it('roundtrip exacto de MAX_SAFE_INTEGER', () => {
    const s = ser();
    s.writeVaruint(Number.MAX_SAFE_INTEGER);
    expect(de(s.getOutput()).readVaruint()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('writeVaruint rechaza MAX_SAFE_INTEGER + 1', () => {
    expect(() => ser().writeVaruint(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('read / readVarbytes', () => {
  it('read más allá del final lanza TruncatedStreamError', () => {
    expect(() => de(new Uint8Array([0x01])).read(2)).toThrow(TruncatedStreamError);
  });

  it('readVarbytes respeta maxLen', () => {
    const s = ser();
    s.writeVarbytes(new Uint8Array([1, 2, 3]));
    expect(de(s.getOutput()).readVarbytes(8)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('readVarbytes excediendo maxLen lanza OversizedDataError', () => {
    const s = ser();
    s.writeVaruint(100); // declara 100 bytes
    expect(() => de(s.getOutput()).readVarbytes(10)).toThrow(OversizedDataError);
  });

  it('readVarbytes(maxLen=0): longitud 0 OK, longitud 1 lanza OversizedDataError', () => {
    const s0 = ser();
    s0.writeVarbytes(new Uint8Array(0));
    expect(de(s0.getOutput()).readVarbytes(0)).toEqual(new Uint8Array(0));
    const s1 = ser();
    s1.writeVarbytes(new Uint8Array([1]));
    expect(() => de(s1.getOutput()).readVarbytes(0)).toThrow(OversizedDataError);
  });
});

describe('assertMagic / assertEof', () => {
  it('magic correcto no lanza', () => {
    const magic = new Uint8Array([0x4f, 0x54, 0x53]);
    expect(() => de(magic).assertMagic(magic)).not.toThrow();
  });

  it('magic incorrecto lanza BadMagicError', () => {
    expect(() => de(new Uint8Array([1, 2, 3])).assertMagic(new Uint8Array([9, 9, 9]))).toThrow(BadMagicError);
  });

  it('magic truncado lanza TruncatedStreamError', () => {
    expect(() => de(new Uint8Array([1])).assertMagic(new Uint8Array([1, 2, 3]))).toThrow(TruncatedStreamError);
  });

  it('assertEof lanza TrailingGarbageError si quedan bytes', () => {
    const ctx = de(new Uint8Array([1, 2]));
    ctx.read(1);
    expect(() => ctx.assertEof()).toThrow(TrailingGarbageError);
  });

  it('assertEof no lanza al final exacto', () => {
    const ctx = de(new Uint8Array([1]));
    ctx.read(1);
    expect(() => ctx.assertEof()).not.toThrow();
  });
});

describe('serialización de bytes', () => {
  it('rechaza entrada que no es Uint8Array', () => {
    // @ts-expect-error entrada inválida deliberada
    expect(() => new StreamDeserializationContext([1, 2, 3])).toThrow(/Uint8Array/);
  });

  it('writeVarbytes→readVarbytes roundtrip (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const s = ser();
        s.writeVarbytes(bytes);
        expect(de(s.getOutput()).readVarbytes(64)).toEqual(bytes);
      }),
    );
  });
});

describe('StreamSerializationContext extras', () => {
  it('getter length refleja los bytes escritos', () => {
    const s = ser();
    expect(s.length).toBe(0);
    s.writeByte(0x01);
    expect(s.length).toBe(1);
  });

  it('writeByte lanza RangeError con valor fuera de 0..255', () => {
    expect(() => ser().writeByte(-1)).toThrow(RangeError);
    expect(() => ser().writeByte(256)).toThrow(RangeError);
  });

  it('el buffer crece automáticamente al superar 4096 bytes', () => {
    const s = ser();
    for (let i = 0; i < 4097; i++) s.writeByte(0xaa);
    expect(s.length).toBe(4097);
    expect(s.getOutput()[4096]).toBe(0xaa);
  });
});

describe('readVaruint modo strict (L3)', () => {
  it('encoding overlong 0x80 0x00 acepta en modo lenient (default)', () => {
    expect(de(new Uint8Array([0x80, 0x00])).readVaruint()).toBe(0);
  });

  it('encoding overlong 0x80 0x00 lanza NonCanonicalVaruintError en modo strict', () => {
    expect(() => de(new Uint8Array([0x80, 0x00])).readVaruint({ strict: true })).toThrow(NonCanonicalVaruintError);
  });

  it('encoding canónico de 0 (0x00) pasa el modo strict', () => {
    expect(de(new Uint8Array([0x00])).readVaruint({ strict: true })).toBe(0);
  });

  it('encoding canónico de 128 (0x80 0x01) pasa el modo strict', () => {
    expect(de(new Uint8Array([0x80, 0x01])).readVaruint({ strict: true })).toBe(128);
  });

  it('overlong triple 0x80 0x80 0x00 lanza NonCanonicalVaruintError en strict', () => {
    expect(() => de(new Uint8Array([0x80, 0x80, 0x00])).readVaruint({ strict: true })).toThrow(NonCanonicalVaruintError);
  });
});

describe('read con length negativo', () => {
  it('lanza RangeError si length < 0', () => {
    expect(() => de(new Uint8Array([1])).read(-1)).toThrow(RangeError);
  });
});

describe('casos límite de cobertura', () => {
  it('counter refleja los bytes consumidos', () => {
    const ctx = de(new Uint8Array([1, 2, 3]));
    expect(ctx.counter).toBe(0);
    ctx.read(2);
    expect(ctx.counter).toBe(2);
  });

  it('readVaruint lanza VaruintOverflowError por shift > 56 (10 bytes de continuación)', () => {
    // 9 bytes con bit de continuación (0x80, valor 0) + 1 byte final: shift llega a 63 > 56
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]);
    expect(() => de(bytes).readVaruint()).toThrow(VaruintOverflowError);
  });

  it('readVarbytes lanza OversizedDataError si length < minLen', () => {
    const s = ser();
    s.writeVarbytes(new Uint8Array([1, 2])); // longitud declarada = 2
    expect(() => de(s.getOutput()).readVarbytes(10, 5)).toThrow(OversizedDataError);
  });
});
