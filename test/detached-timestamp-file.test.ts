import { describe, it, expect } from 'vitest';
import { DetachedTimestampFile } from '../src/detached-timestamp-file.js';
import { OpSHA256, OpSHA1, OpRIPEMD160, OpReverse } from '../src/ops.js';
import { Timestamp } from '../src/timestamp.js';
import { makePending, makeBitcoin } from '../src/notary.js';
import { hexToBytes, bytesToHex } from '../src/utils.js';
import { sha256 } from '../src/hashes/index.js';
import {
  BadMagicError,
  UnsupportedVersionError,
  TrailingGarbageError,
  TruncatedStreamError,
  DeserializationError,
  WeakHashError,
} from '../src/errors.js';

// --- Vector .ots CANÓNICO (121 bytes), derivado del formato real (NO de esta librería) ---
// notary.js serialize: tag[8] + writeVarbytes(payload); payload pending = writeVarbytes(uri).
// timestamp.js serialize: un único elemento '00 <attestation>' (1 sola attestation, sin 0xff).
// Desglose byte a byte:
//   004f...e89294            (31)  cabecera mágica
//   01                       ( 1)  versión mayor = 1
//   08                       ( 1)  op tag = SHA256
//   aa × 32                  (32)  digest del fichero (0xaa repetido)
//   00                       ( 1)  marcador de attestation
//   83dfe30d2ef90c8e         ( 8)  tag pending
//   2e                       ( 1)  varbytes(payload): longitud 46
//   2d                       ( 1)  varbytes(uri): longitud 45
//   687474...6f7267          (45)  "https://alice.btc.calendar.opentimestamps.org"
const URI = 'https://alice.btc.calendar.opentimestamps.org';
const CANONICAL_OTS_HEX =
  '004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e892940108' +
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
  '0083dfe30d2ef90c8e2e2d' +
  '68747470733a2f2f616c6963652e6274632e63616c656e6461722e6f70656e74696d657374616d70732e6f7267';

const canonicalDtf = (): DetachedTimestampFile => {
  const ts = new Timestamp(new Uint8Array(32).fill(0xaa));
  ts.addAttestation(makePending(URI));
  return new DetachedTimestampFile(new OpSHA256(), ts);
};

describe('DetachedTimestampFile — constructor', () => {
  it('acepta CryptOp + Timestamp con longitudes coherentes', () => {
    const ts = new Timestamp(new Uint8Array(32));
    const dtf = new DetachedTimestampFile(new OpSHA256(), ts);
    expect(dtf.fileHashOp).toBeInstanceOf(OpSHA256);
    expect(dtf.timestamp).toBe(ts);
  });

  it('rechaza fileHashOp que no es CryptOp', () => {
    // @ts-expect-error OpReverse no es CryptOp
    expect(() => new DetachedTimestampFile(new OpReverse(), new Timestamp(new Uint8Array(32)))).toThrow(TypeError);
  });

  it('rechaza timestamp que no es Timestamp', () => {
    // @ts-expect-error entrada inválida deliberada
    expect(() => new DetachedTimestampFile(new OpSHA256(), {})).toThrow(TypeError);
  });

  it('rechaza longitud de digest que no casa con el op (SHA256 → 32, dado 20)', () => {
    expect(() => new DetachedTimestampFile(new OpSHA256(), new Timestamp(new Uint8Array(20)))).toThrow(TypeError);
  });

  it('fileDigest devuelve una copia (mutarla no afecta al objeto, B3)', () => {
    const dtf = new DetachedTimestampFile(new OpSHA256(), new Timestamp(new Uint8Array(32)));
    const d = dtf.fileDigest();
    d[0] = 0xff;
    expect(dtf.fileDigest()[0]).toBe(0);
  });
});

describe('DetachedTimestampFile — serialize', () => {
  it('serializeToBytes reproduce el vector canónico byte a byte', () => {
    expect(bytesToHex(canonicalDtf().serializeToBytes())).toBe(CANONICAL_OTS_HEX);
  });
});

describe('DetachedTimestampFile — deserialize / compatibilidad', () => {
  it('deserializa el vector canónico y reproduce sus bytes (round-trip byte-exacto)', () => {
    const bytes = hexToBytes(CANONICAL_OTS_HEX);
    const dtf = DetachedTimestampFile.deserialize(bytes);
    expect(dtf.fileHashOp).toBeInstanceOf(OpSHA256);
    expect(bytesToHex(dtf.fileDigest())).toBe('aa'.repeat(32));
    expect(dtf.timestamp.attestations.length).toBe(1);
    const att = dtf.timestamp.attestations[0]!;
    expect(att.kind).toBe('pending');
    if (att.kind === 'pending') {
      expect(att.uri).toBe(URI);
    }
    expect(bytesToHex(dtf.serializeToBytes())).toBe(CANONICAL_OTS_HEX);
  });

  it('round-trip semántico: deserialize(serialize(x)).equals(x)', () => {
    const dtf = canonicalDtf();
    const back = DetachedTimestampFile.deserialize(dtf.serializeToBytes());
    expect(back.equals(dtf)).toBe(true);
  });

  it('rechaza entrada que no es Uint8Array', () => {
    // @ts-expect-error entrada inválida deliberada
    expect(() => DetachedTimestampFile.deserialize([1, 2, 3])).toThrow(TypeError);
  });

  it('cabecera mágica incorrecta → BadMagicError', () => {
    const bad = hexToBytes('ff' + CANONICAL_OTS_HEX.slice(2));
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(BadMagicError);
  });

  it('versión mayor ≠ 1 → UnsupportedVersionError', () => {
    // el byte de versión es el char 62-63 del hex (tras los 31 bytes de magic)
    const bad = hexToBytes(CANONICAL_OTS_HEX.slice(0, 62) + '02' + CANONICAL_OTS_HEX.slice(64));
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(UnsupportedVersionError);
  });

  it('op del fichero que no es CryptOp → DeserializationError', () => {
    // magic + versión 01 + 0xf2 (OpReverse, unaria, sin arg) → no es CryptOp
    const bad = hexToBytes(CANONICAL_OTS_HEX.slice(0, 64) + 'f2');
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(DeserializationError);
  });

  it('bytes extra al final → TrailingGarbageError', () => {
    const bad = hexToBytes(CANONICAL_OTS_HEX + '00');
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(TrailingGarbageError);
  });

  it('fichero truncado (URI incompleta) → TruncatedStreamError', () => {
    const bad = hexToBytes(CANONICAL_OTS_HEX.slice(0, -4));
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(TruncatedStreamError);
  });

  it('digest truncado → TruncatedStreamError', () => {
    // magic + 01 + 08 (SHA256) + solo 4 bytes de digest en vez de 32
    const bad = hexToBytes(CANONICAL_OTS_HEX.slice(0, 66) + 'aaaaaaaa');
    expect(() => DetachedTimestampFile.deserialize(bad)).toThrow(TruncatedStreamError);
  });
});

describe('DetachedTimestampFile — fromBytes / fromHash', () => {
  it('fromBytes hashea el contenido completo (mayor que 4096) con el digest correcto', () => {
    const big = new Uint8Array(10000).fill(0x41);
    const dtf = DetachedTimestampFile.fromBytes(new OpSHA256(), big);
    expect(dtf.fileDigest().length).toBe(32);
    expect(bytesToHex(dtf.fileDigest())).toBe(bytesToHex(sha256(big)));
  });

  it('fromBytes rechaza fileHashOp que no es CryptOp', () => {
    // @ts-expect-error OpReverse no es CryptOp
    expect(() => DetachedTimestampFile.fromBytes(new OpReverse(), new Uint8Array(4))).toThrow(TypeError);
  });

  it('fromBytes no acepta ArrayBuffer (evita hashear vacío silenciosamente)', () => {
    // @ts-expect-error ArrayBuffer no es Uint8Array
    expect(() => DetachedTimestampFile.fromBytes(new OpSHA256(), new ArrayBuffer(8))).toThrow(TypeError);
  });

  it('fromHash construye desde un digest ya calculado', () => {
    const dtf = DetachedTimestampFile.fromHash(new OpSHA256(), new Uint8Array(32).fill(0x11));
    expect(bytesToHex(dtf.fileDigest())).toBe('11'.repeat(32));
  });

  it('fromHash valida la longitud del digest contra el op', () => {
    expect(() => DetachedTimestampFile.fromHash(new OpSHA256(), new Uint8Array(20))).toThrow(TypeError);
  });
});

describe('DetachedTimestampFile — bloqueo SHA-1/RIPEMD-160 en creación (M3)', () => {
  it('fromBytes con OpSHA1 lanza WeakHashError', () => {
    expect(() => DetachedTimestampFile.fromBytes(new OpSHA1(), new Uint8Array(10))).toThrow(WeakHashError);
  });

  it('fromBytes con OpRIPEMD160 lanza WeakHashError', () => {
    expect(() => DetachedTimestampFile.fromBytes(new OpRIPEMD160(), new Uint8Array(10))).toThrow(WeakHashError);
  });

  it('fromBytesWithHashOp con OpSHA1 sin flag lanza WeakHashError', () => {
    expect(() => DetachedTimestampFile.fromBytesWithHashOp(new OpSHA1(), new Uint8Array(10))).toThrow(WeakHashError);
  });

  it('fromBytesWithHashOp con no-CryptOp lanza TypeError (línea 116)', () => {
    // @ts-expect-error argumento inválido deliberado
    expect(() => DetachedTimestampFile.fromBytesWithHashOp({}, new Uint8Array(10))).toThrow(TypeError);
  });

  it('fromBytesWithHashOp con OpSHA1 y allowWeakHashForLegacyInterop:true permite crear', () => {
    const dtf = DetachedTimestampFile.fromBytesWithHashOp(new OpSHA1(), new Uint8Array(10), { allowWeakHashForLegacyInterop: true });
    expect(dtf.fileHashOp).toBeInstanceOf(OpSHA1);
    expect(dtf.fileDigest().length).toBe(20);
  });

  it('fromBytesWithHashOp con OpRIPEMD160 y allowWeakHashForLegacyInterop:true permite crear', () => {
    const dtf = DetachedTimestampFile.fromBytesWithHashOp(new OpRIPEMD160(), new Uint8Array(10), { allowWeakHashForLegacyInterop: true });
    expect(dtf.fileHashOp).toBeInstanceOf(OpRIPEMD160);
  });

  it('deserializar un proof SHA-1 existente funciona (ruta legacy read)', () => {
    const sha1Ts = new Timestamp(new Uint8Array(20).fill(0xaa));
    sha1Ts.addAttestation(makePending('https://alice.btc.calendar.opentimestamps.org'));
    const sha1Dtf = new DetachedTimestampFile(new OpSHA1(), sha1Ts);
    const bytes = sha1Dtf.serializeToBytes();
    const loaded = DetachedTimestampFile.deserialize(bytes);
    expect(loaded.fileHashOp).toBeInstanceOf(OpSHA1);
    expect(loaded.fileDigest()).toEqual(new Uint8Array(20).fill(0xaa));
  });

  it('fromBytes con OpSHA256 sigue funcionando (hash fuerte)', () => {
    const dtf = DetachedTimestampFile.fromBytes(new OpSHA256(), new Uint8Array(32));
    expect(dtf.fileHashOp).toBeInstanceOf(OpSHA256);
  });
});

describe('DetachedTimestampFile — equals', () => {
  it('ficheros iguales → true', () => {
    const mk = () => {
      const t = new Timestamp(new Uint8Array(32).fill(0x07));
      t.addAttestation(makeBitcoin(1));
      return new DetachedTimestampFile(new OpSHA256(), t);
    };
    expect(mk().equals(mk())).toBe(true);
  });

  it('distinto fileHashOp → false (SHA1 vs RIPEMD160, ambos digest 20)', () => {
    const mk = (op: OpSHA1 | OpRIPEMD160) => {
      const t = new Timestamp(new Uint8Array(20));
      t.addAttestation(makePending('https://a.org'));
      return new DetachedTimestampFile(op, t);
    };
    expect(mk(new OpSHA1()).equals(mk(new OpRIPEMD160()))).toBe(false);
  });

  it('distinto timestamp → false', () => {
    const a = new DetachedTimestampFile(new OpSHA256(), new Timestamp(new Uint8Array(32).fill(1)));
    const b = new DetachedTimestampFile(new OpSHA256(), new Timestamp(new Uint8Array(32).fill(2)));
    expect(a.equals(b)).toBe(false);
  });

  it('algo que no es DetachedTimestampFile → false', () => {
    const a = new DetachedTimestampFile(new OpSHA256(), new Timestamp(new Uint8Array(32)));
    expect(a.equals({})).toBe(false);
  });
});
