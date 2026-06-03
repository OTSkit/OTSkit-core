// test/ops.test.ts
import { describe, it, expect } from 'vitest';
import {
  Op, OpAppend, OpPrepend, OpReverse, OpHexlify,
  OpSHA1, OpRIPEMD160, OpSHA256, CryptOp, buildTagTable,
} from '../src/ops.js';
import { ResultTooLongError, MessageTooLongError, UnknownOperationError, OversizedDataError, TruncatedStreamError } from '../src/errors.js';
import { StreamSerializationContext, StreamDeserializationContext } from '../src/context.js';
import { bytesToHex } from '../src/utils.js';

const out = (op: { serialize(c: StreamSerializationContext): void }) => {
  const c = new StreamSerializationContext();
  op.serialize(c);
  return Array.from(c.getOutput());
};

describe('OpAppend', () => {
  it('TAG y tagName', () => {
    expect(OpAppend.TAG).toBe(0xf0);
    expect(new OpAppend(new Uint8Array([1])).tagName).toBe('append');
  });
  it('call concatena el sufijo', () => {
    expect(Array.from(new OpAppend(new Uint8Array([3, 4])).call(new Uint8Array([1, 2])))).toEqual([1, 2, 3, 4]);
  });
  it('serialize → [tag, varbytes(arg)]', () => {
    expect(out(new OpAppend(new Uint8Array([0xde, 0xad])))).toEqual([0xf0, 0x02, 0xde, 0xad]);
  });
  it('equals compara por tipo y arg', () => {
    expect(new OpAppend(new Uint8Array([1])).equals(new OpAppend(new Uint8Array([1])))).toBe(true);
    expect(new OpAppend(new Uint8Array([1])).equals(new OpAppend(new Uint8Array([2])))).toBe(false);
    expect(new OpAppend(new Uint8Array([1])).equals(new OpPrepend(new Uint8Array([1])))).toBe(false);
  });
  it('rechaza arg que no es Uint8Array', () => {
    // @ts-expect-error arg inválido
    expect(() => new OpAppend([1, 2])).toThrow(/Uint8Array/);
  });
  it('mensaje demasiado largo lanza MessageTooLongError', () => {
    expect(() => new OpAppend(new Uint8Array([1])).call(new Uint8Array(4097))).toThrow(MessageTooLongError);
  });
  it('resultado demasiado largo lanza ResultTooLongError', () => {
    expect(() => new OpAppend(new Uint8Array(4000)).call(new Uint8Array(4000))).toThrow(ResultTooLongError);
  });
  it('copia defensiva: mutar el arg original no cambia la op', () => {
    const arg = new Uint8Array([0xde, 0xad]);
    const op = new OpAppend(arg);
    arg[0] = 0x00;
    expect(out(op)).toEqual([0xf0, 0x02, 0xde, 0xad]);
    expect(Array.from(op.call(new Uint8Array([1])))).toEqual([1, 0xde, 0xad]);
  });
});

describe('OpPrepend', () => {
  it('TAG', () => { expect(OpPrepend.TAG).toBe(0xf1); });
  it('call concatena el prefijo', () => {
    expect(Array.from(new OpPrepend(new Uint8Array([3, 4])).call(new Uint8Array([1, 2])))).toEqual([3, 4, 1, 2]);
  });
  it('serialize', () => {
    expect(out(new OpPrepend(new Uint8Array([0xaa, 0xbb])))).toEqual([0xf1, 0x02, 0xaa, 0xbb]);
  });
  it('equals compara por tipo y arg', () => {
    expect(new OpPrepend(new Uint8Array([1])).equals(new OpPrepend(new Uint8Array([1])))).toBe(true);
    expect(new OpPrepend(new Uint8Array([1])).equals(new OpPrepend(new Uint8Array([2])))).toBe(false);
    expect(new OpPrepend(new Uint8Array([1])).equals(new OpAppend(new Uint8Array([1])))).toBe(false);
  });
});

describe('OpReverse', () => {
  it('TAG y tagName', () => {
    expect(OpReverse.TAG).toBe(0xf2);
    expect(new OpReverse().tagName).toBe('reverse');
  });
  it('call invierte los bytes', () => {
    expect(Array.from(new OpReverse().call(new Uint8Array([1, 2, 3])))).toEqual([3, 2, 1]);
  });
  it('serialize → [tag]', () => {
    expect(out(new OpReverse())).toEqual([0xf2]);
  });
  it('equals solo por tipo', () => {
    expect(new OpReverse().equals(new OpReverse())).toBe(true);
    expect(new OpReverse().equals(new OpHexlify())).toBe(false);
  });
});

describe('OpHexlify', () => {
  it('TAG', () => { expect(OpHexlify.TAG).toBe(0xf3); });
  it('call produce la representación hex ASCII', () => {
    expect(Array.from(new OpHexlify().call(new Uint8Array([0xde, 0xad])))).toEqual([0x64, 0x65, 0x61, 0x64]);
  });
  it('serialize → [tag]', () => {
    expect(out(new OpHexlify())).toEqual([0xf3]);
  });
  it('rechaza mensaje > 2048 bytes (límite propio)', () => {
    expect(() => new OpHexlify().call(new Uint8Array(2049))).toThrow(/exceeds/);
  });
  it('equals por tipo', () => {
    expect(new OpHexlify().equals(new OpHexlify())).toBe(true);
    expect(new OpHexlify().equals(new OpReverse())).toBe(false);
  });
});

describe('CryptOps', () => {
  it('tags y digestLength', () => {
    expect(OpSHA1.TAG).toBe(0x02);
    expect(OpRIPEMD160.TAG).toBe(0x03);
    expect(OpSHA256.TAG).toBe(0x08);
    expect(new OpSHA1().digestLength).toBe(20);
    expect(new OpRIPEMD160().digestLength).toBe(20);
    expect(new OpSHA256().digestLength).toBe(32);
  });
  it('son CryptOp', () => {
    expect(new OpSHA256()).toBeInstanceOf(CryptOp);
  });
  it('sha256("") vector', () => {
    expect(bytesToHex(new OpSHA256().call(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('sha1("") vector', () => {
    expect(bytesToHex(new OpSHA1().call(new Uint8Array(0)))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
  it('ripemd160("") vector', () => {
    expect(bytesToHex(new OpRIPEMD160().call(new Uint8Array(0)))).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31');
  });
  it('serialize → [tag]', () => {
    expect(out(new OpSHA256())).toEqual([0x08]);
  });
  it('equals por tipo (SHA256)', () => {
    expect(new OpSHA256().equals(new OpSHA256())).toBe(true);
    expect(new OpSHA256().equals(new OpSHA1())).toBe(false);
  });
  it('equals por tipo (SHA1)', () => {
    expect(new OpSHA1().equals(new OpSHA1())).toBe(true);
    expect(new OpSHA1().equals(new OpSHA256())).toBe(false);
  });
  it('equals por tipo (RIPEMD160)', () => {
    expect(new OpRIPEMD160().equals(new OpRIPEMD160())).toBe(true);
    expect(new OpRIPEMD160().equals(new OpSHA256())).toBe(false);
  });
});

const de = (b: number[]) => new StreamDeserializationContext(new Uint8Array(b));

describe('Op.deserialize', () => {
  it('tag unario conocido → instancia correcta', () => {
    expect(Op.deserialize(de([0xf2]))).toBeInstanceOf(OpReverse);
  });
  it('tag binario conocido → lee el arg', () => {
    const op = Op.deserialize(de([0xf0, 0x02, 0xde, 0xad]));
    expect(op).toBeInstanceOf(OpAppend);
    expect(Array.from((op as OpAppend).arg)).toEqual([0xde, 0xad]);
  });
  it('tag cripto conocido', () => {
    expect(Op.deserialize(de([0x08]))).toBeInstanceOf(OpSHA256);
  });
  it('tag desconocido → UnknownOperationError', () => {
    expect(() => Op.deserialize(de([0x99]))).toThrow(UnknownOperationError);
  });
  it('binario con arg de longitud 0 → error', () => {
    expect(() => Op.deserialize(de([0xf0, 0x00]))).toThrow(OversizedDataError);
  });
  it('binario con arg que excede 4096 → error', () => {
    // varuint 4097 = [0x81, 0x20]
    expect(() => Op.deserialize(de([0xf0, 0x81, 0x20]))).toThrow(OversizedDataError);
  });
  it('stream truncado → error', () => {
    expect(() => Op.deserialize(de([]))).toThrow(TruncatedStreamError);
  });
  it('roundtrip serialize→deserialize (append)', () => {
    const original = new OpAppend(new Uint8Array([1, 2, 3]));
    const c = new StreamSerializationContext();
    original.serialize(c);
    const back = Op.deserialize(new StreamDeserializationContext(c.getOutput()));
    expect(original.equals(back)).toBe(true);
  });
});

it('buildTagTable rechaza tags duplicados', () => {
  const f = () => new OpReverse();
  expect(() => buildTagTable([[0x01, f], [0x01, f]])).toThrow(/duplicate/);
});

describe('Op.deserializeFromTag', () => {
  it('despacha con un tag ya leído (binaria)', () => {
    // 0xf0 = append; el ctx solo contiene el varbytes del arg: [0x02, 0xde, 0xad]
    const ctx = new StreamDeserializationContext(new Uint8Array([0x02, 0xde, 0xad]));
    const op = Op.deserializeFromTag(ctx, 0xf0);
    expect(op).toBeInstanceOf(OpAppend);
    expect(Array.from((op as OpAppend).arg)).toEqual([0xde, 0xad]);
  });

  it('tag desconocido lanza UnknownOperationError', () => {
    const ctx = new StreamDeserializationContext(new Uint8Array(0));
    expect(() => Op.deserializeFromTag(ctx, 0x99)).toThrow(UnknownOperationError);
  });
});

describe('CryptOp.hashFile', () => {
  it('hashea contenido mayor que MAX_MSG_LENGTH (call sí lo rechaza)', () => {
    const big = new Uint8Array(Op.MAX_MSG_LENGTH + 1000).fill(0x41);
    expect(() => new OpSHA256().call(big)).toThrow(MessageTooLongError);
    expect(new OpSHA256().hashFile(big).length).toBe(32);
  });

  it('hashFile coincide con call para mensajes pequeños', () => {
    const m = new Uint8Array([1, 2, 3]);
    expect(bytesToHex(new OpSHA256().hashFile(m))).toEqual(bytesToHex(new OpSHA256().call(m)));
  });

  it('rechaza entrada que no es Uint8Array', () => {
    // @ts-expect-error entrada inválida deliberada
    expect(() => new OpSHA256().hashFile([1, 2, 3])).toThrow(TypeError);
  });
});
