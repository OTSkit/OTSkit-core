// src/detached-timestamp-file.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { Op, CryptOp } from './ops.js';
import { Timestamp } from './timestamp.js';
import { DeserializationError, UnsupportedVersionError } from './errors.js';

/**
 * Cabecera mágica del formato .ots (31 bytes). Legible en un hexdump y reconocida como
 * 'data' por el comando `file`: \x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94
 */
const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73,
  0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

/** Solo se soporta la versión mayor 1 (sin versión menor, a propósito). */
const MAJOR_VERSION = 1;

/**
 * Fichero `.ots` desacoplado: contiene la prueba de timestamp de OTRO fichero.
 * Inmutable: el op de hash y el árbol se fijan en construcción.
 */
export class DetachedTimestampFile {
  readonly fileHashOp: CryptOp;
  readonly timestamp: Timestamp;

  constructor(fileHashOp: CryptOp, timestamp: Timestamp) {
    if (!(fileHashOp instanceof CryptOp)) {
      throw new TypeError('DetachedTimestampFile: fileHashOp must be a CryptOp');
    }
    if (!(timestamp instanceof Timestamp)) {
      throw new TypeError('DetachedTimestampFile: timestamp must be a Timestamp');
    }
    if (timestamp.msg.length !== fileHashOp.digestLength) {
      throw new TypeError(
        `DetachedTimestampFile: timestamp message length ${timestamp.msg.length} does not match ${fileHashOp.tagName} digest length ${fileHashOp.digestLength}`,
      );
    }
    this.fileHashOp = fileHashOp;
    this.timestamp = timestamp;
  }

  /** Digest del fichero sellado (copia defensiva: mutarla no afecta al objeto). */
  fileDigest(): Uint8Array {
    return this.timestamp.getDigest();
  }

  /** Escribe el fichero `.ots` en el contexto: magic → versión → op → digest → árbol. */
  serialize(ctx: StreamSerializationContext): void {
    ctx.writeBytes(HEADER_MAGIC);
    ctx.writeVaruint(MAJOR_VERSION);
    this.fileHashOp.serialize(ctx);
    ctx.writeBytes(this.timestamp.msg);
    this.timestamp.serialize(ctx);
  }

  /** Serializa el fichero `.ots` completo a bytes. */
  serializeToBytes(): Uint8Array {
    const ctx = new StreamSerializationContext();
    this.serialize(ctx);
    return ctx.getOutput();
  }

  /**
   * Lee un fichero `.ots` desde bytes. Único tipo de entrada: `Uint8Array` (fail-closed;
   * elimina los 4 tipos del original y el bug `Array.from(ArrayBuffer) → []`).
   */
  static deserialize(input: Uint8Array): DetachedTimestampFile {
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('DetachedTimestampFile.deserialize expects a Uint8Array');
    }
    const ctx = new StreamDeserializationContext(input);
    ctx.assertMagic(HEADER_MAGIC);
    const major = ctx.readVaruint();
    if (major !== MAJOR_VERSION) {
      throw new UnsupportedVersionError(`unsupported .ots major version ${major}`);
    }
    const op = Op.deserialize(ctx);
    if (!(op instanceof CryptOp)) {
      throw new DeserializationError('file hash operation must be a cryptographic hash');
    }
    const fileHash = ctx.read(op.digestLength);
    const timestamp = Timestamp.deserialize(ctx, fileHash);
    ctx.assertEof();
    return new DetachedTimestampFile(op, timestamp);
  }

  /** Crea un `.ots` nuevo hasheando el contenido completo de un fichero. */
  static fromBytes(fileHashOp: CryptOp, fileContent: Uint8Array): DetachedTimestampFile {
    if (!(fileHashOp instanceof CryptOp)) {
      throw new TypeError('DetachedTimestampFile.fromBytes: fileHashOp must be a CryptOp');
    }
    const digest = fileHashOp.hashFile(fileContent);
    return new DetachedTimestampFile(fileHashOp, new Timestamp(digest));
  }

  /** Crea un `.ots` nuevo a partir de un digest ya calculado del fichero. */
  static fromHash(fileHashOp: CryptOp, fileDigest: Uint8Array): DetachedTimestampFile {
    return new DetachedTimestampFile(fileHashOp, new Timestamp(fileDigest));
  }

  /** Igualdad estructural con otro fichero `.ots`. */
  equals(other: unknown): boolean {
    return (
      other instanceof DetachedTimestampFile &&
      this.fileHashOp.equals(other.fileHashOp) &&
      this.timestamp.equals(other.timestamp)
    );
  }
}
