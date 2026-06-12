// src/errors.ts

/** Base of all errors raised while deserializing the OTS binary format. */
export class DeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The header magic number does not match. */
export class BadMagicError extends DeserializationError {}

/** The stream ended before the expected bytes could be read. */
export class TruncatedStreamError extends DeserializationError {}

/** A field declares more bytes than allowed (DoS defense). */
export class OversizedDataError extends DeserializationError {}

/** A LEB128 varuint exceeds Number.MAX_SAFE_INTEGER. */
export class VaruintOverflowError extends DeserializationError {}

/** A LEB128 varuint uses more bytes than necessary (non-canonical/overlong encoding). */
export class NonCanonicalVaruintError extends DeserializationError {}

/** Bytes remain after deserializing everything expected. */
export class TrailingGarbageError extends DeserializationError {}

// --- Operation errors (Phase 2b) ---

/** Unrecognized operation tag while deserializing. */
export class UnknownOperationError extends DeserializationError {}

/** Base of the errors raised while applying an operation (call). */
export class OpExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The input message exceeds the maximum the operation allows. */
export class MessageTooLongError extends OpExecutionError {}

/** The operation result exceeds MAX_RESULT_LENGTH. */
export class ResultTooLongError extends OpExecutionError {}

// --- Attestation errors (Phase 3) ---

/** The URI of a PendingAttestation is empty or contains disallowed bytes. */
export class InvalidUriError extends DeserializationError {}

/** Failure verifying an attestation against a block header. Not a parsing error. */
export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Timestamp errors (Phase 4) ---

/** Attempted to serialize a timestamp with no attestations and no ops. */
export class EmptyTimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Merge of incompatible timestamps (different message, or the other is not a Timestamp). */
export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Merkle errors (Phase 5) ---

/** `makeMerkleTree` received an empty list of timestamps. */
export class EmptyMerkleTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Detached file error (Phase 6) ---

/** The .ots file declares an unsupported major version. */
export class UnsupportedVersionError extends DeserializationError {}

/** Attempted to create a new timestamp with a weak hash algorithm (SHA-1, RIPEMD-160). */
export class WeakHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
