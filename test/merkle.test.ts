import { describe, it, expect } from 'vitest';
import { catSha256, catSha256d, makeMerkleTree } from '../src/merkle.js';
import { EmptyMerkleTreeError } from '../src/errors.js';
import { Timestamp } from '../src/timestamp.js';
import { OpAppend, OpPrepend, OpSHA256 } from '../src/ops.js';
import { makeBitcoin } from '../src/notary.js';

describe('catSha256', () => {
  it('la punta es SHA256(left.msg ++ right.msg)', () => {
    const left = new Timestamp(new Uint8Array([0x01]));
    const right = new Timestamp(new Uint8Array([0x02]));
    const tip = catSha256(left, right);
    const expected = new OpSHA256().call(new Uint8Array([0x01, 0x02]));
    expect(Array.from(tip.msg)).toEqual(Array.from(expected));
  });

  it('left y right comparten el mismo nodo de concatenación', () => {
    const left = new Timestamp(new Uint8Array([0x01]));
    const right = new Timestamp(new Uint8Array([0x02]));
    catSha256(left, right);
    const leftConcat = left.branches[0]!.stamp;
    const rightConcat = right.branches[0]!.stamp;
    expect(leftConcat).toBe(rightConcat); // MISMO objeto (cross-link)
    expect(Array.from(leftConcat.msg)).toEqual([0x01, 0x02]);
  });

  it('left obtiene OpAppend(right.msg) y right obtiene OpPrepend(left.msg)', () => {
    const left = new Timestamp(new Uint8Array([0xaa]));
    const right = new Timestamp(new Uint8Array([0xbb]));
    catSha256(left, right);
    expect(left.branches[0]!.op).toBeInstanceOf(OpAppend);
    expect(Array.from((left.branches[0]!.op as OpAppend).arg)).toEqual([0xbb]);
    expect(right.branches[0]!.op).toBeInstanceOf(OpPrepend);
    expect(Array.from((right.branches[0]!.op as OpPrepend).arg)).toEqual([0xaa]);
  });

  it('una attestation en la punta completa ambas hojas', () => {
    const left = new Timestamp(new Uint8Array([0x01]));
    const right = new Timestamp(new Uint8Array([0x02]));
    const tip = catSha256(left, right);
    tip.addAttestation(makeBitcoin(5));
    expect(left.isTimestampComplete()).toBe(true);
    expect(right.isTimestampComplete()).toBe(true);
  });

  it('rechaza argumentos que no son Timestamp', () => {
    const t = new Timestamp(new Uint8Array([0x01]));
    // @ts-expect-error entrada inválida deliberada
    expect(() => catSha256(t, {})).toThrow(TypeError);
    // @ts-expect-error entrada inválida deliberada
    expect(() => catSha256({}, t)).toThrow(TypeError);
  });
});

describe('catSha256d', () => {
  it('la punta es SHA256(SHA256(left.msg ++ right.msg))', () => {
    const left = new Timestamp(new Uint8Array([0x01]));
    const right = new Timestamp(new Uint8Array([0x02]));
    const tip = catSha256d(left, right);
    const once = new OpSHA256().call(new Uint8Array([0x01, 0x02]));
    const twice = new OpSHA256().call(once);
    expect(Array.from(tip.msg)).toEqual(Array.from(twice));
  });

  it('no duplica ramas al llamarse dos veces sobre las mismas hojas (dedup, B2)', () => {
    const left = new Timestamp(new Uint8Array([0x01]));
    const right = new Timestamp(new Uint8Array([0x02]));
    const first = catSha256d(left, right);
    const second = catSha256d(left, right);
    expect(second).toBe(first); // mismo nodo doble, no uno nuevo
    expect(right.branches.length).toBe(1); // una sola rama OpPrepend
    expect(left.branches.length).toBe(1); // una sola rama OpAppend
  });
});

describe('makeMerkleTree', () => {
  it('un solo timestamp se devuelve a sí mismo sin modificar', () => {
    const a = new Timestamp(new Uint8Array([0x01]));
    const root = makeMerkleTree([a]);
    expect(root).toBe(a);
    expect(a.branches.length).toBe(0);
  });

  it('dos timestamps → la raíz es SHA256(a ++ b)', () => {
    const a = new Timestamp(new Uint8Array([0x01]));
    const b = new Timestamp(new Uint8Array([0x02]));
    const root = makeMerkleTree([a, b]);
    expect(Array.from(root.msg)).toEqual(
      Array.from(new OpSHA256().call(new Uint8Array([0x01, 0x02]))),
    );
  });

  it('estructura MMR para 3 hojas: raíz = SHA256(SHA256(a ++ b) ++ c)', () => {
    const a = new Timestamp(new Uint8Array([0x0a]));
    const b = new Timestamp(new Uint8Array([0x0b]));
    const c = new Timestamp(new Uint8Array([0x0c]));
    const root = makeMerkleTree([a, b, c]);
    const ab = new OpSHA256().call(new Uint8Array([0x0a, 0x0b]));
    const abc = new OpSHA256().call(new Uint8Array([...ab, 0x0c]));
    expect(Array.from(root.msg)).toEqual(Array.from(abc));
  });

  it('una attestation en la raíz completa TODAS las hojas (5 hojas, caso impar)', () => {
    const leaves = [0x01, 0x02, 0x03, 0x04, 0x05].map((b) => new Timestamp(new Uint8Array([b])));
    const root = makeMerkleTree(leaves);
    root.addAttestation(makeBitcoin(42));
    for (const leaf of leaves) {
      expect(leaf.isTimestampComplete()).toBe(true);
    }
  });

  it('lista vacía → EmptyMerkleTreeError (B4)', () => {
    expect(() => makeMerkleTree([])).toThrow(EmptyMerkleTreeError);
  });

  it('elemento que no es Timestamp → TypeError (B5)', () => {
    const ok = new Timestamp(new Uint8Array([1]));
    // @ts-expect-error entrada inválida deliberada
    expect(() => makeMerkleTree([ok, {}])).toThrow(TypeError);
  });

  it('no reemplaza ni reordena el array de entrada', () => {
    const a = new Timestamp(new Uint8Array([1]));
    const b = new Timestamp(new Uint8Array([2]));
    const arr = [a, b];
    makeMerkleTree(arr);
    expect(arr.length).toBe(2);
    expect(arr[0]).toBe(a);
    expect(arr[1]).toBe(b);
  });
});
