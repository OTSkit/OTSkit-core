// test/timestamp.test.ts
import { describe, it, expect } from 'vitest';
import { Timestamp } from '../src/timestamp.js';
import type { BlockHeaderProvider } from '../src/timestamp.js';
import { Op, OpSHA256, OpSHA1, OpAppend, OpPrepend, OpReverse } from '../src/ops.js';
import { StreamDeserializationContext, StreamSerializationContext } from '../src/context.js';
import { makePending, makeBitcoin, makeLitecoin, makeUnknown, serializeAttestation } from '../src/notary.js';
import type { Attestation } from '../src/notary.js';
import { hexToBytes } from '../src/utils.js';
import {
  TruncatedStreamError,
  OversizedDataError,
  DeserializationError,
  EmptyTimestampError,
  MergeError,
  VerificationError,
} from '../src/errors.js';

// ─── helpers de test ───────────────────────────────────────────────────────────

const MSG32 = new Uint8Array(32);

const de = (bytes: number[] | Uint8Array) =>
  new StreamDeserializationContext(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

const reserialize = (ts: Timestamp): number[] => {
  const sc = new StreamSerializationContext();
  ts.serialize(sc);
  return Array.from(sc.getOutput());
};

const pendingBytes = (uri: string): number[] => {
  const sc = new StreamSerializationContext();
  serializeAttestation(sc, makePending(uri));
  return Array.from(sc.getOutput());
};

// ─── L2: addAttestation / attestations inmutables ────────────────────────────

describe('Timestamp — addAttestation / attestations inmutables (L2)', () => {
  it('addAttestation adds a valid attestation, visible through the getter', () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makeBitcoin(100));
    expect(ts.attestations.length).toBe(1);
    expect(ts.attestations[0]?.kind).toBe('bitcoin');
  });

  it('addAttestation with an empty object throws TypeError', () => {
    // @ts-expect-error invalid attestation deliberada
    expect(() => new Timestamp(new Uint8Array(32)).addAttestation({})).toThrow(TypeError);
  });

  it('addAttestation with null throws TypeError (line 78)', () => {
    // @ts-expect-error null deliberado
    expect(() => new Timestamp(new Uint8Array(32)).addAttestation(null)).toThrow(TypeError);
  });

  it('attestations no muta: push() sobre el getter lanza TypeError en runtime', () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makeBitcoin(1));
    expect(() => (ts.attestations as Attestation[]).push(makeBitcoin(2))).toThrow(TypeError);
    expect(ts.attestations.length).toBe(1);
  });
});

// ─── Task 3: constructor ───────────────────────────────────────────────────────

describe('Timestamp — constructor', () => {
  it('acepta un Uint8Array y expone el digest (copia defensiva)', () => {
    const msg = new Uint8Array([1, 2, 3]);
    const ts = new Timestamp(msg);
    expect(Array.from(ts.getDigest())).toEqual([1, 2, 3]);
    msg[0] = 0xff; // mutar el original no afecta al timestamp
    expect(ts.getDigest()[0]).toBe(1);
  });

  it('rechaza un Array plano con TypeError (S4)', () => {
    // @ts-expect-error deliberately invalid input
    expect(() => new Timestamp([1, 2, 3])).toThrow(TypeError);
  });

  it('an empty msg is valid', () => {
    expect(() => new Timestamp(new Uint8Array(0))).not.toThrow();
  });

  it('rechaza msg mayor que MAX_MSG_LENGTH', () => {
    expect(() => new Timestamp(new Uint8Array(Op.MAX_MSG_LENGTH + 1))).toThrow(TypeError);
  });

  it('a freshly created timestamp has no branches and no attestations', () => {
    const ts = new Timestamp(new Uint8Array([1]));
    expect(ts.branches).toEqual([]);
    expect(ts.attestations).toEqual([]);
  });

  it('getDigest() devuelve una copia: mutar el resultado no afecta al nodo', () => {
    const ts = new Timestamp(new Uint8Array([1, 2, 3]));
    const digest = ts.getDigest();
    digest[0] = 0xff;
    expect(ts.getDigest()[0]).toBe(1);
  });
});

// ─── Task 4: serialize / deserialize ──────────────────────────────────────────

describe('Timestamp — serialize / deserialize', () => {
  it('an empty timestamp cannot be serialized', () => {
    expect(() => new Timestamp(MSG32).serialize(new StreamSerializationContext())).toThrow(
      EmptyTimestampError,
    );
  });

  it('round-trip: una sola attestation', () => {
    const ts = new Timestamp(MSG32);
    ts.addAttestation(makeBitcoin(123));
    const back = Timestamp.deserialize(de(new Uint8Array(reserialize(ts))), MSG32);
    expect(reserialize(back)).toEqual(reserialize(ts));
  });

  it('round-trip: una sola rama (op) con attestation en la hoja', () => {
    const ts = new Timestamp(MSG32);
    const sub = ts.add(new OpSHA256());
    sub.addAttestation(makePending('https://a.pool.opentimestamps.org'));
    const back = Timestamp.deserialize(de(new Uint8Array(reserialize(ts))), MSG32);
    expect(reserialize(back)).toEqual(reserialize(ts));
  });

  it('round-trip: multiple branches (0xff fork) + attestation on the node', () => {
    const ts = new Timestamp(MSG32);
    ts.addAttestation(makeBitcoin(1));
    ts.add(new OpReverse()).addAttestation(makeBitcoin(2));
    ts.add(new OpSHA256()).addAttestation(makeBitcoin(3));
    const back = Timestamp.deserialize(de(new Uint8Array(reserialize(ts))), MSG32);
    expect(reserialize(back)).toEqual(reserialize(ts));
  });

  it('canonical order: op insertion order does not change the bytes (B3)', () => {
    const build = (order: 'ab' | 'ba'): Timestamp => {
      const t = new Timestamp(MSG32);
      const addRev = () => t.add(new OpReverse()).addAttestation(makeBitcoin(1));
      const addSha = () => t.add(new OpSHA256()).addAttestation(makeBitcoin(2));
      if (order === 'ab') {
        addRev();
        addSha();
      } else {
        addSha();
        addRev();
      }
      return t;
    };
    expect(reserialize(build('ab'))).toEqual(reserialize(build('ba')));
  });

  it('canonical order: attestation order does not change the bytes either', () => {
    const build = (order: 'ab' | 'ba'): Timestamp => {
      const t = new Timestamp(MSG32);
      if (order === 'ab') {
        t.addAttestation(makeBitcoin(1));
        t.addAttestation(makeBitcoin(2));
      } else {
        t.addAttestation(makeBitcoin(2));
        t.addAttestation(makeBitcoin(1));
      }
      return t;
    };
    expect(reserialize(build('ab'))).toEqual(reserialize(build('ba')));
  });

  it('depth under the limit (256) → OK', () => {
    const bytes = new Uint8Array([...new Array(256).fill(0xf2), 0x00, ...pendingBytes('https://x.org')]);
    expect(() => Timestamp.deserialize(de(bytes), MSG32)).not.toThrow();
  });

  it('depth over the limit (257) → OversizedDataError (S1)', () => {
    const bytes = new Uint8Array([...new Array(257).fill(0xf2), 0x00, ...pendingBytes('https://x.org')]);
    expect(() => Timestamp.deserialize(de(bytes), MSG32)).toThrow(OversizedDataError);
  });

  it('empty stream → TruncatedStreamError (B6)', () => {
    expect(() => Timestamp.deserialize(de([]), MSG32)).toThrow(TruncatedStreamError);
  });

  it('0xff as the last byte → TruncatedStreamError', () => {
    expect(() => Timestamp.deserialize(de([0xff]), MSG32)).toThrow(TruncatedStreamError);
  });

  it('0xff 0xff consecutivos → DeserializationError', () => {
    expect(() => Timestamp.deserialize(de([0xff, 0xff]), MSG32)).toThrow(DeserializationError);
  });

  it('attestation truncada → TruncatedStreamError', () => {
    expect(() => Timestamp.deserialize(de([0x00, 1, 2, 3]), MSG32)).toThrow(TruncatedStreamError);
  });

  it('op binaria truncada (arg incompleto) → TruncatedStreamError', () => {
    // 0xf0 = append; declara 5 bytes de arg pero no llegan
    expect(() => Timestamp.deserialize(de([0xf0, 0x05]), MSG32)).toThrow(TruncatedStreamError);
  });

  it('operation overflowing during deserialize → DeserializationError', () => {
    // 0xf0 append con arg de 4096 bytes → result 32+4096 > MAX_RESULT_LENGTH
    const arg = new Array(4096).fill(0x00);
    const bytes = new Uint8Array([0xf0, 0x80, 0x20, ...arg]);
    expect(() => Timestamp.deserialize(de(bytes), MSG32)).toThrow(DeserializationError);
  });
});

// ─── Task 5: merge / add ───────────────────────────────────────────────────────

describe('Timestamp — merge / add', () => {
  it('merge adds the other timestamp attestations without duplicating', () => {
    const m = new Uint8Array([9, 9]);
    const a = new Timestamp(m);
    a.addAttestation(makeBitcoin(1));
    const b = new Timestamp(m);
    b.addAttestation(makeBitcoin(1)); // duplicate → not added
    b.addAttestation(makeBitcoin(2)); // new → added
    a.merge(b);
    expect(a.attestations.length).toBe(2);
  });

  it('merge fusiona ops equivalentes con objetos distintos (B5)', () => {
    const m = new Uint8Array([1, 2, 3, 4]);
    const a = new Timestamp(m);
    a.add(new OpSHA256()).addAttestation(makeBitcoin(1));
    const b = new Timestamp(m);
    b.add(new OpSHA256()).addAttestation(makeBitcoin(2));
    a.merge(b);
    expect(a.branches.length).toBe(1); // una sola rama, no dos
    expect(a.branches[0]!.stamp.attestations.length).toBe(2);
  });

  it('merge creates the branch when it did not exist locally', () => {
    const m = new Uint8Array([1, 2, 3, 4]);
    const a = new Timestamp(m);
    const b = new Timestamp(m);
    b.add(new OpSHA256()).addAttestation(makeBitcoin(7));
    a.merge(b);
    expect(a.branches.length).toBe(1);
    expect(a.branches[0]!.stamp.attestations[0]).toEqual(makeBitcoin(7));
  });

  it('merge rechaza mensajes distintos', () => {
    expect(() => new Timestamp(new Uint8Array([1])).merge(new Timestamp(new Uint8Array([2])))).toThrow(
      MergeError,
    );
  });

  it('merge rechaza algo que no es Timestamp', () => {
    // @ts-expect-error deliberately invalid type
    expect(() => new Timestamp(new Uint8Array([1])).merge({})).toThrow(MergeError);
  });

  it('add devuelve la misma sub-rama para una op equivalente', () => {
    const a = new Timestamp(new Uint8Array([5, 5]));
    const s1 = a.add(new OpSHA256());
    const s2 = a.add(new OpSHA256());
    expect(s1).toBe(s2);
    expect(a.branches.length).toBe(1);
  });
});

// ─── Task 6: tree traversals ──────────────────────────────────────────────────

describe('Timestamp — recorridos', () => {
  it('allAttestations conserva varias attestations del mismo nodo (B2)', () => {
    const t = new Timestamp(new Uint8Array([1]));
    t.addAttestation(makeBitcoin(1));
    t.addAttestation(makePending('https://a.org'));
    expect(t.allAttestations().length).toBe(2);
  });

  it('allAttestations traverses the sub-trees', () => {
    const t = new Timestamp(MSG32);
    t.add(new OpSHA256()).addAttestation(makeBitcoin(9));
    const entries = t.allAttestations();
    expect(entries.length).toBe(1);
    expect(entries[0]!.attestation.kind).toBe('bitcoin');
    expect(entries[0]!.msg.length).toBe(32); // el msg del sub-nodo
  });

  it('getAttestations returns every attestation in the tree', () => {
    const t = new Timestamp(new Uint8Array([1]));
    t.addAttestation(makeBitcoin(1));
    t.addAttestation(makeBitcoin(2));
    expect(t.getAttestations().length).toBe(2);
  });

  it('isTimestampComplete: solo Bitcoin/Litecoin → true (S3)', () => {
    const withAtt = (att: ReturnType<typeof makeBitcoin>) => {
      const t = new Timestamp(new Uint8Array([1]));
      t.addAttestation(att);
      return t;
    };
    expect(withAtt(makeBitcoin(1)).isTimestampComplete()).toBe(true);
    expect(withAtt(makeLitecoin(1)).isTimestampComplete()).toBe(true);

    const pending = new Timestamp(new Uint8Array([1]));
    pending.addAttestation(makePending('https://a.org'));
    expect(pending.isTimestampComplete()).toBe(false);

    const unknown = new Timestamp(new Uint8Array([1]));
    unknown.addAttestation(makeUnknown(new Uint8Array(8), new Uint8Array(0)));
    expect(unknown.isTimestampComplete()).toBe(false);
  });

  it('directlyVerified devuelve los nodos que tienen attestations', () => {
    const t = new Timestamp(MSG32);
    const sub = t.add(new OpSHA256());
    sub.addAttestation(makeBitcoin(1));
    const dv = t.directlyVerified();
    expect(dv).toEqual([sub]);
  });

  it('directlyVerified: a node holding an attestation returns itself', () => {
    const t = new Timestamp(new Uint8Array([1]));
    t.addAttestation(makeBitcoin(1));
    expect(t.directlyVerified()).toEqual([t]);
  });

  it('allTips: el msg de cada hoja sin ops', () => {
    const t = new Timestamp(MSG32);
    const sub = t.add(new OpSHA256());
    const tips = t.allTips();
    expect(tips.length).toBe(1);
    expect(Array.from(tips[0]!)).toEqual(Array.from(sub.msg));
  });

  it('allTips: un nodo sin ops es su propia punta', () => {
    const t = new Timestamp(new Uint8Array([1, 2]));
    expect(t.allTips().map((x) => Array.from(x))).toEqual([[1, 2]]);
  });
});

// ─── Task 7: equals ───────────────────────────────────────────────────────────

describe('Timestamp — equals', () => {
  const buildSha = (height: number): Timestamp => {
    const t = new Timestamp(new Uint8Array([1, 2, 3, 4]));
    t.add(new OpSHA256()).addAttestation(makeBitcoin(height));
    return t;
  };

  it('identical trees → true', () => {
    expect(buildSha(1).equals(buildSha(1))).toBe(true);
  });

  it('different ops with the same size → false (B1)', () => {
    const m = new Uint8Array([1, 2, 3, 4]);
    const a = new Timestamp(m);
    a.add(new OpSHA256()).addAttestation(makeBitcoin(1));
    const b = new Timestamp(m);
    b.add(new OpSHA1()).addAttestation(makeBitcoin(1));
    expect(a.equals(b)).toBe(false);
  });

  it('no-Timestamp → false', () => {
    expect(new Timestamp(new Uint8Array([1])).equals({})).toBe(false);
  });

  it('msg distinto → false', () => {
    expect(new Timestamp(new Uint8Array([1])).equals(new Timestamp(new Uint8Array([2])))).toBe(false);
  });

  it('different number of attestations → false', () => {
    const a = new Timestamp(new Uint8Array([1]));
    a.addAttestation(makeBitcoin(1));
    expect(a.equals(new Timestamp(new Uint8Array([1])))).toBe(false);
  });

  it('attestations distintas → false', () => {
    const a = new Timestamp(new Uint8Array([1]));
    a.addAttestation(makeBitcoin(1));
    const b = new Timestamp(new Uint8Array([1]));
    b.addAttestation(makeBitcoin(2));
    expect(a.equals(b)).toBe(false);
  });

  it('different number of ops → false', () => {
    const m = new Uint8Array([1, 2, 3, 4]);
    const a = new Timestamp(m);
    a.add(new OpSHA256());
    expect(a.equals(new Timestamp(m))).toBe(false);
  });

  it('sub-timestamp distinto → false', () => {
    expect(buildSha(1).equals(buildSha(2))).toBe(false);
  });
});

// ─── Task 8 (Fase 5): addExisting — cross-link Merkle ────────────────────────

describe('Timestamp — addExisting (cross-link Merkle)', () => {
  it('vincula una op a un sub-timestamp existente compartiendo el objeto', () => {
    const left = new Timestamp(new Uint8Array([0x11])); // L
    const right = new Timestamp(new Uint8Array([0x22])); // R
    // concat: prepend L a R → L ++ R
    const concat = right.add(new OpPrepend(left.msg));
    expect(Array.from(concat.msg)).toEqual([0x11, 0x22]);
    // left: append R → debe apuntar AL MISMO objeto concat
    const linked = left.addExisting(new OpAppend(right.msg), concat);
    expect(linked).toBe(concat);
    expect(left.branches.length).toBe(1);
    expect(left.branches[0]!.stamp).toBe(concat);
    // una attestation en concat es visible desde ambas hojas
    concat.addAttestation(makeBitcoin(1));
    expect(left.getAttestations().length).toBe(1);
    expect(right.getAttestations().length).toBe(1);
  });

  it('rechaza si el resultado de la op no coincide con el msg del stamp', () => {
    const left = new Timestamp(new Uint8Array([0x11]));
    const wrong = new Timestamp(new Uint8Array([0x99, 0x99])); // no es L ++ R
    expect(() => left.addExisting(new OpAppend(new Uint8Array([0x22])), wrong)).toThrow(MergeError);
  });

  it('rechaza un stamp que no es Timestamp', () => {
    const left = new Timestamp(new Uint8Array([0x11]));
    // @ts-expect-error deliberately invalid type
    expect(() => left.addExisting(new OpAppend(new Uint8Array([0x22])), {})).toThrow(TypeError);
  });
});

// ─── M2: hasBitcoinAttestation / verifyBitcoin ────────────────────────────────

// Bitcoin genesis block (80 bytes, same vector as in notary.test.ts)
const GENESIS_RAW_HEADER_HEX_TS =
  '01000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
  '29ab5f49' +
  'ffff001d' +
  '1dac2b7c';
const GENESIS_RAW_HEADER = hexToBytes(GENESIS_RAW_HEADER_HEX_TS);
const GENESIS_MERKLE_ROOT_INTERNAL = hexToBytes(
  '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a',
);
const GENESIS_TIME = 1231006505;

describe('Timestamp — hasBitcoinAttestation (M2)', () => {
  it('returns true when the tree holds a Bitcoin attestation', () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makeBitcoin(100));
    expect(ts.hasBitcoinAttestation()).toBe(true);
  });

  it('devuelve false si solo hay attestations pending', () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makePending('https://a.pool.opentimestamps.org'));
    expect(ts.hasBitcoinAttestation()).toBe(false);
  });

  it('isTimestampComplete() sigue funcionando igual (backward compat)', () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makeBitcoin(1));
    expect(ts.isTimestampComplete()).toBe(true);
    const pending = new Timestamp(new Uint8Array(32));
    pending.addAttestation(makePending('https://a.pool.opentimestamps.org'));
    expect(pending.isTimestampComplete()).toBe(false);
  });
});

describe('Timestamp — verifyBitcoin (M2)', () => {
  it('devuelve block.time cuando el provider devuelve el header correcto', async () => {
    const ts = new Timestamp(GENESIS_MERKLE_ROOT_INTERNAL);
    ts.addAttestation(makeBitcoin(0));
    const provider: BlockHeaderProvider = {
      getBlockHeader: async (_height: number) => GENESIS_RAW_HEADER,
    };
    await expect(ts.verifyBitcoin(provider)).resolves.toBe(GENESIS_TIME);
  });

  it('throws VerificationError when the provider returns a wrong header', async () => {
    const ts = new Timestamp(GENESIS_MERKLE_ROOT_INTERNAL);
    ts.addAttestation(makeBitcoin(0));
    const wrongHeader = new Uint8Array(80); // todo ceros → merkle root y time no coinciden
    const provider: BlockHeaderProvider = {
      getBlockHeader: async (_height: number) => wrongHeader,
    };
    await expect(ts.verifyBitcoin(provider)).rejects.toThrow(VerificationError);
  });

  it('throws VerificationError when the tree holds no Bitcoin attestation', async () => {
    const ts = new Timestamp(new Uint8Array(32));
    ts.addAttestation(makePending('https://a.pool.opentimestamps.org'));
    const provider: BlockHeaderProvider = {
      getBlockHeader: async () => new Uint8Array(80),
    };
    await expect(ts.verifyBitcoin(provider)).rejects.toThrow(VerificationError);
  });
});
