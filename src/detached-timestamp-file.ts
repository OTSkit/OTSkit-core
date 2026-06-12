// src/detached-timestamp-file.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { Op, CryptOp, OpSHA1, OpRIPEMD160 } from './ops.js';
import { Timestamp } from './timestamp.js';
import { DeserializationError, UnsupportedVersionError, WeakHashError } from './errors.js';

function isWeakHashOp(op: CryptOp): boolean {
  return op instanceof OpSHA1 || op instanceof OpRIPEMD160;
}

/**
 * Magic header of the .ots format (31 bytes). Readable in a hexdump and recognized as
 * 'data' by the `file` command: \x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94
 */
const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73,
  0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

/** Only major version 1 is supported (no minor version, on purpose). */
const MAJOR_VERSION = 1;

/**
 * Detached `.ots` file: holds the timestamp proof of ANOTHER file.
 * Immutable: the hash op and the tree are fixed at construction.
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

  /** Digest of the sealed file (defensive copy: mutating it does not affect the object). */
  fileDigest(): Uint8Array {
    return this.timestamp.getDigest();
  }

  /** Writes the `.ots` file into the context: magic → version → op → digest → tree. */
  serialize(ctx: StreamSerializationContext): void {
    ctx.writeBytes(HEADER_MAGIC);
    ctx.writeVaruint(MAJOR_VERSION);
    this.fileHashOp.serialize(ctx);
    ctx.writeBytes(this.timestamp.msg);
    this.timestamp.serialize(ctx);
  }

  /** Serializes the whole `.ots` file to bytes. */
  serializeToBytes(): Uint8Array {
    const ctx = new StreamSerializationContext();
    this.serialize(ctx);
    return ctx.getOutput();
  }

  /**
   * Reads a `.ots` file from bytes. Single input type: `Uint8Array` (fail-closed;
   * drops the 4 input types of the original and the `Array.from(ArrayBuffer) → []` bug).
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

  /** Creates a new `.ots` by hashing the full content of a file. SHA-256 only. */
  static fromBytes(fileHashOp: CryptOp, fileContent: Uint8Array): DetachedTimestampFile {
    if (!(fileHashOp instanceof CryptOp)) {
      throw new TypeError('DetachedTimestampFile.fromBytes: fileHashOp must be a CryptOp');
    }
    if (isWeakHashOp(fileHashOp)) {
      throw new WeakHashError(
        `DetachedTimestampFile.fromBytes: ${fileHashOp.tagName} is not allowed for new timestamps; use fromBytesWithHashOp with allowWeakHashForLegacyInterop:true for legacy interop`,
      );
    }
    const digest = fileHashOp.hashFile(fileContent);
    return new DetachedTimestampFile(fileHashOp, new Timestamp(digest));
  }

  /**
   * Creates a new `.ots` by hashing the file with any op, including weak hashes.
   * Requires an explicit `{ allowWeakHashForLegacyInterop: true }` for SHA-1 or RIPEMD-160.
   */
  static fromBytesWithHashOp(
    fileHashOp: CryptOp,
    fileContent: Uint8Array,
    options?: { allowWeakHashForLegacyInterop?: boolean },
  ): DetachedTimestampFile {
    if (!(fileHashOp instanceof CryptOp)) {
      throw new TypeError('DetachedTimestampFile.fromBytesWithHashOp: fileHashOp must be a CryptOp');
    }
    if (isWeakHashOp(fileHashOp) && !options?.allowWeakHashForLegacyInterop) {
      throw new WeakHashError(
        `DetachedTimestampFile.fromBytesWithHashOp: ${fileHashOp.tagName} is not allowed; set allowWeakHashForLegacyInterop:true for legacy interop`,
      );
    }
    const digest = fileHashOp.hashFile(fileContent);
    return new DetachedTimestampFile(fileHashOp, new Timestamp(digest));
  }

  /** Creates a new `.ots` from an already-computed file digest. */
  static fromHash(fileHashOp: CryptOp, fileDigest: Uint8Array): DetachedTimestampFile {
    return new DetachedTimestampFile(fileHashOp, new Timestamp(fileDigest));
  }

  /** Structural equality with another `.ots` file. */
  equals(other: unknown): boolean {
    return (
      other instanceof DetachedTimestampFile &&
      this.fileHashOp.equals(other.fileHashOp) &&
      this.timestamp.equals(other.timestamp)
    );
  }
}
