// src/errors.ts

/** Base de todos los errores al deserializar el formato binario OTS. */
export class DeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** El número mágico de cabecera no coincide. */
export class BadMagicError extends DeserializationError {}

/** El stream terminó antes de leer los bytes esperados. */
export class TruncatedStreamError extends DeserializationError {}

/** Un campo declara más bytes de los permitidos (defensa DoS). */
export class OversizedDataError extends DeserializationError {}

/** Un varuint LEB128 excede Number.MAX_SAFE_INTEGER. */
export class VaruintOverflowError extends DeserializationError {}

/** Un varuint LEB128 usa más bytes de los necesarios (encoding no canónico/overlong). */
export class NonCanonicalVaruintError extends DeserializationError {}

/** Quedan bytes tras terminar de deserializar lo esperado. */
export class TrailingGarbageError extends DeserializationError {}

// --- Errores de operación (Fase 2b) ---

/** Tag de operación no reconocido al deserializar. */
export class UnknownOperationError extends DeserializationError {}

/** Base de los errores que ocurren al aplicar una operación (call). */
export class OpExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** El mensaje de entrada supera el máximo permitido por la operación. */
export class MessageTooLongError extends OpExecutionError {}

/** El resultado de la operación supera MAX_RESULT_LENGTH. */
export class ResultTooLongError extends OpExecutionError {}

// --- Errores de atestación (Fase 3) ---

/** La URI de una PendingAttestation está vacía o contiene bytes no permitidos. */
export class InvalidUriError extends DeserializationError {}

/** Fallo al verificar una atestación contra una cabecera de bloque. No es un error de parseo. */
export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Errores de timestamp (Fase 4) ---

/** Se intentó serializar un timestamp sin attestations ni ops. */
export class EmptyTimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Fusión de timestamps incompatibles (distinto mensaje, o el otro no es un Timestamp). */
export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Errores de merkle (Fase 5) ---

/** `makeMerkleTree` recibió una lista vacía de timestamps. */
export class EmptyMerkleTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Error de fichero detached (Fase 6) ---

/** El fichero .ots declara una versión mayor no soportada. */
export class UnsupportedVersionError extends DeserializationError {}
