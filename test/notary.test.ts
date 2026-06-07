// test/notary.test.ts
import { describe, it, expect } from 'vitest';
import { bytesToHex, hexToBytes } from '../src/utils.js';
import { InvalidUriError, VerificationError } from '../src/errors.js';
import {
  makePending, makeBitcoin, makeLitecoin, makeUnknown,
  deserializeAttestation, serializeAttestation,
  compareAttestations, attestationsEqual,
  verifyAgainstBlockheader,
  verifyAgainstRawHeader,
  verifyBitcoinAttestation,
} from '../src/notary.js';
import { StreamDeserializationContext, StreamSerializationContext } from '../src/context.js';
import { TruncatedStreamError, OversizedDataError, TrailingGarbageError } from '../src/errors.js';
import type { Attestation } from '../src/notary.js';

describe('factorías', () => {
  it('makePending fija el tag correcto y conserva uri/uriBytes', () => {
    const att = makePending('https://a.pool.opentimestamps.org');
    expect(att.kind).toBe('pending');
    expect(bytesToHex(att.tag)).toBe('83dfe30d2ef90c8e');
    expect(att.uri).toBe('https://a.pool.opentimestamps.org');
    expect(Array.from(att.uriBytes)).toEqual(Array.from(new TextEncoder().encode(att.uri)));
  });

  it('makePending rechaza URI vacía', () => {
    expect(() => makePending('')).toThrow(InvalidUriError);
  });

  it.each(['has space', 'a\nb', 'a?b', 'a#b', 'a%b', 'a@b', 'a\\b', 'a"b', 'a\x00b', 'a\x7fb', 'a\x80b', 'a\xffb'])(
    'makePending rechaza URI con carácter inválido (%j)',
    (uri) => {
      expect(() => makePending(uri)).toThrow(InvalidUriError);
    },
  );

  it('makeBitcoin / makeLitecoin fijan tag y altura', () => {
    const b = makeBitcoin(500);
    expect(b.kind).toBe('bitcoin');
    expect(bytesToHex(b.tag)).toBe('0588960d73d71901');
    expect(b.height).toBe(500);
    const l = makeLitecoin(0);
    expect(l.kind).toBe('litecoin');
    expect(bytesToHex(l.tag)).toBe('06869a0d73d71b45');
    expect(l.height).toBe(0);
  });

  it('makeBitcoin rechaza alturas inválidas', () => {
    expect(() => makeBitcoin(-1)).toThrow(RangeError);
    expect(() => makeBitcoin(1.5)).toThrow(RangeError);
    expect(() => makeBitcoin(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('makeUnknown exige tag de 8 bytes', () => {
    const att = makeUnknown(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), new Uint8Array([9, 9]));
    expect(att.kind).toBe('unknown');
    expect(Array.from(att.payload)).toEqual([9, 9]);
    expect(() => makeUnknown(new Uint8Array(7), new Uint8Array(0))).toThrow(/8 bytes/);
  });

  it('makeUnknown rechaza los tags conocidos (mantiene la invariante de compareAttestations)', () => {
    const bitcoinTag = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
    const pendingTag = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
    expect(() => makeUnknown(bitcoinTag, new Uint8Array(0))).toThrow(/known/);
    expect(() => makeUnknown(pendingTag, new Uint8Array(0))).toThrow(/known/);
  });

  it('makeUnknown rechaza payload que no es Uint8Array', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => makeUnknown(new Uint8Array(8), 'not-a-uint8array' as any)).toThrow(TypeError);
  });

  it('makePending acepta URI de 1000 bytes y rechaza 1001 (InvalidUriError)', () => {
    const ok = 'a'.repeat(1000);
    expect(makePending(ok).uri).toBe(ok);
    expect(() => makePending('a'.repeat(1001))).toThrow(InvalidUriError);
  });
});

// ─── Task 3: deserializeAttestation ────────────────────────────────────────────

const PENDING_TAG_BYTES = [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];
const BITCOIN_TAG_BYTES = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
const LITECOIN_TAG_BYTES = [0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7, 0x1b, 0x45];

const de = (bytes: number[]) => new StreamDeserializationContext(new Uint8Array(bytes));

describe('deserializeAttestation', () => {
  it('pending: tag + varbytes(uri)', () => {
    // payload = varbytes("ab") = [0x02, 0x61, 0x62]; outer varbytes envuelve eso → [0x03, ...]
    const att = deserializeAttestation(de([...PENDING_TAG_BYTES, 0x03, 0x02, 0x61, 0x62]));
    expect(att.kind).toBe('pending');
    if (att.kind === 'pending') expect(att.uri).toBe('ab');
  });

  it('bitcoin: tag + varbytes(varuint(height))', () => {
    // payload = varuint(128) = [0x80, 0x01]; outer = [0x02, 0x80, 0x01]
    const att = deserializeAttestation(de([...BITCOIN_TAG_BYTES, 0x02, 0x80, 0x01]));
    expect(att.kind).toBe('bitcoin');
    if (att.kind === 'bitcoin') expect(att.height).toBe(128);
  });

  it('litecoin', () => {
    const att = deserializeAttestation(de([...LITECOIN_TAG_BYTES, 0x01, 0x05]));
    expect(att.kind).toBe('litecoin');
    if (att.kind === 'litecoin') expect(att.height).toBe(5);
  });

  it('tag desconocido → kind unknown con payload opaco', () => {
    const att = deserializeAttestation(de([1, 2, 3, 4, 5, 6, 7, 8, 0x02, 0xaa, 0xbb]));
    expect(att.kind).toBe('unknown');
    if (att.kind === 'unknown') {
      expect(Array.from(att.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(Array.from(att.payload)).toEqual([0xaa, 0xbb]);
    }
  });

  it('tag truncado (<8 bytes) → TruncatedStreamError', () => {
    expect(() => deserializeAttestation(de([1, 2, 3]))).toThrow(TruncatedStreamError);
  });

  it('longitud de payload (varuint) truncada → TruncatedStreamError', () => {
    expect(() => deserializeAttestation(de([...BITCOIN_TAG_BYTES, 0x80]))).toThrow(TruncatedStreamError);
  });

  it('varuint de longitud sin terminación → error, no bucle', () => {
    expect(() => deserializeAttestation(de([...BITCOIN_TAG_BYTES, 0x80, 0x80, 0x80]))).toThrow(
      TruncatedStreamError,
    );
  });

  it('payload que declara más bytes de los presentes → TruncatedStreamError', () => {
    expect(() => deserializeAttestation(de([...PENDING_TAG_BYTES, 0x05, 0x01, 0x02]))).toThrow(
      TruncatedStreamError,
    );
  });

  it('payload oversized (>8192) → OversizedDataError', () => {
    // outer length varuint = 8193 = [0x81, 0x40]
    expect(() => deserializeAttestation(de([1, 2, 3, 4, 5, 6, 7, 8, 0x81, 0x40]))).toThrow(
      OversizedDataError,
    );
  });

  it('tipo conocido con bytes extra al final del payload → TrailingGarbageError', () => {
    // payload bitcoin = varuint(1) + basura [0xff] → [0x01, 0xff], outer = [0x02, 0x01, 0xff]
    expect(() => deserializeAttestation(de([...BITCOIN_TAG_BYTES, 0x02, 0x01, 0xff]))).toThrow(
      TrailingGarbageError,
    );
  });

  it('URI inválida en pending → InvalidUriError (no undefined)', () => {
    // payload = varbytes(" ") = [0x01, 0x20] (espacio no permitido); outer = [0x02, 0x01, 0x20]
    expect(() => deserializeAttestation(de([...PENDING_TAG_BYTES, 0x02, 0x01, 0x20]))).toThrow(
      InvalidUriError,
    );
  });
});

// ─── Task 4: serializeAttestation / round-trip ─────────────────────────────────

function MAX_PAYLOAD_SIZE_FOR_TEST(): number {
  return 8192;
}

const roundtrip = (att: Attestation): Attestation => {
  const sc = new StreamSerializationContext();
  serializeAttestation(sc, att);
  return deserializeAttestation(new StreamDeserializationContext(sc.getOutput()));
};

describe('serializeAttestation / round-trip', () => {
  it('pending byte-exacto', () => {
    const sc = new StreamSerializationContext();
    serializeAttestation(sc, makePending('ab'));
    // tag(8) + outer varbytes([0x02,'a','b']) = [0x03, 0x02, 0x61, 0x62]
    expect(Array.from(sc.getOutput())).toEqual([...PENDING_TAG_BYTES, 0x03, 0x02, 0x61, 0x62]);
  });

  it('round-trip pending', () => {
    const back = roundtrip(makePending('https://b.pool.opentimestamps.org'));
    expect(back.kind).toBe('pending');
    if (back.kind === 'pending') expect(back.uri).toBe('https://b.pool.opentimestamps.org');
  });

  it.each([0, 1, 127, 128, 65535, 2 ** 32 - 1])('round-trip bitcoin altura %i', (h) => {
    const back = roundtrip(makeBitcoin(h));
    expect(back.kind).toBe('bitcoin');
    if (back.kind === 'bitcoin') expect(back.height).toBe(h);
  });

  it.each([0, 1, 127, 128, 65535, 2 ** 32 - 1])('round-trip litecoin altura %i', (h) => {
    const back = roundtrip(makeLitecoin(h));
    expect(back.kind).toBe('litecoin');
    if (back.kind === 'litecoin') expect(back.height).toBe(h);
  });

  it.each([0, 1, 100, MAX_PAYLOAD_SIZE_FOR_TEST()])('round-trip unknown payload de %i bytes', (n) => {
    const back = roundtrip(makeUnknown(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]), new Uint8Array(n)));
    expect(back.kind).toBe('unknown');
    if (back.kind === 'unknown') expect(back.payload.length).toBe(n);
  });

  it('unknown payload de 8193 bytes → OversizedDataError al deserializar', () => {
    expect(() => roundtrip(makeUnknown(new Uint8Array(8), new Uint8Array(8193)))).toThrow(
      OversizedDataError,
    );
  });
});

// ─── Task 5: compareAttestations + attestationsEqual ───────────────────────────

describe('compareAttestations', () => {
  it('ordena por tag entre tipos distintos', () => {
    // bitcoin tag (0x05...) < litecoin tag (0x06...) < pending tag (0x83...)
    expect(compareAttestations(makeBitcoin(9), makeLitecoin(0))).toBeLessThan(0);
    expect(compareAttestations(makePending('a'), makeBitcoin(0))).toBeGreaterThan(0);
  });

  it('a igual tag, bitcoin ordena por altura', () => {
    expect(compareAttestations(makeBitcoin(100), makeBitcoin(200))).toBeLessThan(0);
    expect(compareAttestations(makeBitcoin(200), makeBitcoin(100))).toBeGreaterThan(0);
    expect(compareAttestations(makeBitcoin(50), makeBitcoin(50))).toBe(0);
  });

  it('litecoin ordena por altura', () => {
    expect(compareAttestations(makeLitecoin(1), makeLitecoin(2))).toBeLessThan(0);
  });

  it('pending ordena por uriBytes', () => {
    expect(compareAttestations(makePending('a'), makePending('b'))).toBeLessThan(0);
    expect(compareAttestations(makePending('a'), makePending('a'))).toBe(0);
  });

  it('unknown ordena por payload a igual tag', () => {
    const tag = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      compareAttestations(makeUnknown(tag, new Uint8Array([1])), makeUnknown(tag, new Uint8Array([2]))),
    ).toBeLessThan(0);
  });
});

describe('attestationsEqual', () => {
  it('iguales por tipo y contenido', () => {
    expect(attestationsEqual(makeBitcoin(5), makeBitcoin(5))).toBe(true);
    expect(attestationsEqual(makeBitcoin(5), makeBitcoin(6))).toBe(false);
    expect(attestationsEqual(makePending('a'), makePending('a'))).toBe(true);
    expect(attestationsEqual(makePending('a'), makePending('b'))).toBe(false);
  });

  it('distinto kind → false', () => {
    expect(attestationsEqual(makeBitcoin(5), makeLitecoin(5))).toBe(false);
  });

  it('unknown iguales y distintos', () => {
    const tag = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(attestationsEqual(makeUnknown(tag, new Uint8Array([1])), makeUnknown(tag, new Uint8Array([1])))).toBe(true);
    expect(attestationsEqual(makeUnknown(tag, new Uint8Array([1])), makeUnknown(tag, new Uint8Array([2])))).toBe(false);
  });

  it('mismo kind pero tag distinto (unknown) → false', () => {
    const t1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const t2 = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(attestationsEqual(makeUnknown(t1, new Uint8Array(0)), makeUnknown(t2, new Uint8Array(0)))).toBe(false);
  });
});

// ─── M4: verifyAgainstRawHeader — endianness explícita ────────────────────────

// Cabecera del bloque génesis de Bitcoin (80 bytes):
//   versión:      01000000  (little-endian)
//   prev_hash:    0000...0000  (32 bytes ceros)
//   merkle_root:  3ba3edfd...e4a  (orden interno, 32 bytes)
//   time:         29ab5f49  (LE) = 1231006505
//   bits:         ffff001d
//   nonce:        1dac2b7c
const GENESIS_RAW_HEADER_HEX =
  '01000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
  '29ab5f49' +
  'ffff001d' +
  '1dac2b7c';

describe('verifyAgainstRawHeader (M4)', () => {
  it('bloque génesis: verifica con merkle root en orden interno', () => {
    const rawHeader = hexToBytes(GENESIS_RAW_HEADER_HEX);
    const merkleRootInternal = hexToBytes('3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a');
    expect(verifyAgainstRawHeader(merkleRootInternal, rawHeader)).toBe(1231006505);
  });

  it('falla con merkle root en orden de display (invertido) — detecta bug de endianness', () => {
    const rawHeader = hexToBytes(GENESIS_RAW_HEADER_HEX);
    // Orden de display = bytes invertidos respecto al orden interno
    const merkleRootDisplay = hexToBytes('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
    expect(() => verifyAgainstRawHeader(merkleRootDisplay, rawHeader)).toThrow(VerificationError);
  });

  it('header de longitud distinta a 80 → VerificationError', () => {
    expect(() => verifyAgainstRawHeader(new Uint8Array(32), new Uint8Array(79))).toThrow(VerificationError);
  });

  it('digest de longitud distinta a 32 → VerificationError', () => {
    expect(() => verifyAgainstRawHeader(new Uint8Array(31), new Uint8Array(80))).toThrow(VerificationError);
  });
});

// ─── Task 6: verifyAgainstBlockheader ──────────────────────────────────────────

const ROOT = 'a'.repeat(64);
const digestOk = hexToBytes(ROOT);

describe('verifyAgainstBlockheader', () => {
  it('todo correcto → devuelve block.time', () => {
    expect(verifyAgainstBlockheader(digestOk, { merkleroot: ROOT, time: 1700000000 })).toBe(1700000000);
  });

  it('digest de 31 bytes → VerificationError', () => {
    expect(() => verifyAgainstBlockheader(new Uint8Array(31), { merkleroot: ROOT, time: 1 })).toThrow(
      VerificationError,
    );
  });

  it('digest de 33 bytes → VerificationError', () => {
    expect(() => verifyAgainstBlockheader(new Uint8Array(33), { merkleroot: ROOT, time: 1 })).toThrow(
      VerificationError,
    );
  });

  it('merkleroot no es hex de 64 → VerificationError', () => {
    expect(() => verifyAgainstBlockheader(digestOk, { merkleroot: 'zz', time: 1 })).toThrow(VerificationError);
    expect(() => verifyAgainstBlockheader(digestOk, { merkleroot: 'a'.repeat(63), time: 1 })).toThrow(
      VerificationError,
    );
  });

  it('block.time no entero o no positivo → VerificationError', () => {
    expect(() => verifyAgainstBlockheader(digestOk, { merkleroot: ROOT, time: 1.5 })).toThrow(VerificationError);
    expect(() => verifyAgainstBlockheader(digestOk, { merkleroot: ROOT, time: 0 })).toThrow(VerificationError);
  });

  it('digest no coincide con merkleroot → VerificationError', () => {
    const other = hexToBytes('b'.repeat(64));
    expect(() => verifyAgainstBlockheader(other, { merkleroot: ROOT, time: 1 })).toThrow(VerificationError);
  });
});

// ─── M1: verifyBitcoinAttestation — vincular altura al header ─────────────────

describe('verifyBitcoinAttestation (M1)', () => {
  const genesisRawHeader = hexToBytes(GENESIS_RAW_HEADER_HEX);
  const genesisMerkleRootInternal = hexToBytes(
    '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a',
  );
  const GENESIS_TIME = 1231006505;

  it('headerHeight distinto de attestation.height → lanza VerificationError', () => {
    const att = makeBitcoin(500);
    expect(() =>
      verifyBitcoinAttestation(genesisMerkleRootInternal, att, genesisRawHeader, 501),
    ).toThrow(VerificationError);
  });

  it('headerHeight igual a attestation.height y digest correcto → devuelve block.time', () => {
    const att = makeBitcoin(0);
    expect(
      verifyBitcoinAttestation(genesisMerkleRootInternal, att, genesisRawHeader, 0),
    ).toBe(GENESIS_TIME);
  });
});
