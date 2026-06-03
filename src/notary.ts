// src/notary.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { InvalidUriError, VerificationError } from './errors.js';
import { bytesEqual, compareBytes, textToBytes, hexToBytes } from './utils.js';

const TAG_SIZE = 8;
const MAX_PAYLOAD_SIZE = 8192;
const MAX_URI_LENGTH = 1000;

const ALLOWED_URI_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/:',
);

const PENDING_TAG = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const BITCOIN_TAG = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
const LITECOIN_TAG = new Uint8Array([0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7, 0x1b, 0x45]);

/** Commitment registrado en un calendario remoto; se guarda la URI para completarlo más tarde. */
export interface PendingAttestation {
  readonly kind: 'pending';
  readonly tag: Uint8Array;
  /** Vista ASCII validada de la URI. */
  readonly uri: string;
  /** Bytes originales de la URI (canónicos para serializar). */
  readonly uriBytes: Uint8Array;
}

/** El commitment es el merkleroot de la cabecera del bloque Bitcoin de esta altura. */
export interface BitcoinAttestation {
  readonly kind: 'bitcoin';
  readonly tag: Uint8Array;
  readonly height: number;
}

/** Igual que Bitcoin, sobre la cadena Litecoin. */
export interface LitecoinAttestation {
  readonly kind: 'litecoin';
  readonly tag: Uint8Array;
  readonly height: number;
}

/** Tag no reconocido; se preservan tag y payload opacos para round-trip exacto. */
export interface UnknownAttestation {
  readonly kind: 'unknown';
  readonly tag: Uint8Array;
  readonly payload: Uint8Array;
}

export type Attestation =
  | PendingAttestation
  | BitcoinAttestation
  | LitecoinAttestation
  | UnknownAttestation;

/** Valida y decodifica los bytes de una URI ASCII restringida. Lanza si vacía o con byte no permitido. */
function decodeAndValidateUri(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    throw new InvalidUriError('pending attestation URI is empty');
  }
  if (bytes.length > MAX_URI_LENGTH) {
    throw new InvalidUriError(`pending attestation URI exceeds ${MAX_URI_LENGTH} bytes`);
  }
  let uri = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    const char = String.fromCharCode(byte);
    if (!ALLOWED_URI_CHARS.has(char)) {
      throw new InvalidUriError(
        `pending attestation URI contains invalid byte 0x${byte.toString(16).padStart(2, '0')}`,
      );
    }
    uri += char;
  }
  return uri;
}

function checkHeight(height: number): void {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new RangeError(`block height must be a non-negative safe integer; got ${height}`);
  }
}

/** Crea una PendingAttestation validando la URI. `uriBytes` se derivan de `uri` (UTF-8/ASCII). */
export function makePending(uri: string): PendingAttestation {
  const uriBytes = textToBytes(uri);
  const validated = decodeAndValidateUri(uriBytes);
  return { kind: 'pending', tag: PENDING_TAG.slice(), uri: validated, uriBytes };
}

export function makeBitcoin(height: number): BitcoinAttestation {
  checkHeight(height);
  return { kind: 'bitcoin', tag: BITCOIN_TAG.slice(), height };
}

export function makeLitecoin(height: number): LitecoinAttestation {
  checkHeight(height);
  return { kind: 'litecoin', tag: LITECOIN_TAG.slice(), height };
}

export function makeUnknown(tag: Uint8Array, payload: Uint8Array): UnknownAttestation {
  if (!(tag instanceof Uint8Array) || tag.length !== TAG_SIZE) {
    throw new RangeError('unknown attestation tag must be exactly 8 bytes');
  }
  // Invariante que `compareAttestations` da por cierta: un tag conocido nunca pertenece
  // a un 'unknown'. Sin esta guarda, comparar un unknown-con-tag-conocido contra el tipo
  // conocido real entraría al case equivocado del switch y reventaría.
  if (bytesEqual(tag, PENDING_TAG) || bytesEqual(tag, BITCOIN_TAG) || bytesEqual(tag, LITECOIN_TAG)) {
    throw new RangeError('unknown attestation tag must not be a known attestation tag');
  }
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError('unknown attestation payload must be a Uint8Array');
  }
  return { kind: 'unknown', tag: tag.slice(), payload: payload.slice() };
}

/** Deserializa una atestación: `tag[8] + varbytes(payload)`, payload parseado en sub-contexto aislado. */
export function deserializeAttestation(ctx: StreamDeserializationContext): Attestation {
  const tag = ctx.read(TAG_SIZE).slice();
  const payload = ctx.readVarbytes(MAX_PAYLOAD_SIZE);
  const payloadCtx = new StreamDeserializationContext(payload);

  let attestation: Attestation;
  if (bytesEqual(tag, PENDING_TAG)) {
    const uriBytes = payloadCtx.readVarbytes(MAX_URI_LENGTH).slice();
    attestation = { kind: 'pending', tag, uri: decodeAndValidateUri(uriBytes), uriBytes };
  } else if (bytesEqual(tag, BITCOIN_TAG)) {
    attestation = { kind: 'bitcoin', tag, height: payloadCtx.readVaruint() };
  } else if (bytesEqual(tag, LITECOIN_TAG)) {
    attestation = { kind: 'litecoin', tag, height: payloadCtx.readVaruint() };
  } else {
    // Tag desconocido: el payload entero es opaco; no se parsea ni se exige formato interno.
    return { kind: 'unknown', tag, payload: payload.slice() };
  }

  // Tipos conocidos: ningún byte sobrante permitido en el sub-contexto (fail-closed).
  payloadCtx.assertEof();
  return attestation;
}

/** Escribe el payload interno (sin el tag ni el envoltorio varbytes externo). */
function serializePayload(ctx: StreamSerializationContext, att: Attestation): void {
  switch (att.kind) {
    case 'pending':
      ctx.writeVarbytes(att.uriBytes);
      return;
    case 'bitcoin':
    case 'litecoin':
      ctx.writeVaruint(att.height);
      return;
    case 'unknown':
      ctx.writeBytes(att.payload);
      return;
  }
}

/** Serializa una atestación: `tag[8] + varbytes(payload)`. */
export function serializeAttestation(ctx: StreamSerializationContext, att: Attestation): void {
  ctx.writeBytes(att.tag);
  const payloadCtx = new StreamSerializationContext();
  serializePayload(payloadCtx, att);
  ctx.writeVarbytes(payloadCtx.getOutput());
}

/**
 * Orden total de atestaciones: primero por bytes del tag; a igual tag, por contenido.
 * Un tag igual implica el mismo `kind` (los tags conocidos son reservados, así que un
 * `unknown` nunca coincide con un tag conocido), por lo que los accesos por kind son seguros.
 */
export function compareAttestations(a: Attestation, b: Attestation): number {
  const deltaTag = compareBytes(a.tag, b.tag);
  if (deltaTag !== 0) {
    return deltaTag;
  }
  switch (a.kind) {
    case 'pending':
      return compareBytes(a.uriBytes, (b as PendingAttestation).uriBytes);
    case 'bitcoin':
    case 'litecoin':
      return a.height - (b as BitcoinAttestation | LitecoinAttestation).height;
    case 'unknown':
      return compareBytes(a.payload, (b as UnknownAttestation).payload);
  }
}

/** Igualdad estructural: mismo `kind`, mismo tag y mismo contenido. */
export function attestationsEqual(a: Attestation, b: Attestation): boolean {
  if (a.kind !== b.kind || !bytesEqual(a.tag, b.tag)) {
    return false;
  }
  switch (a.kind) {
    case 'pending':
      return bytesEqual(a.uriBytes, (b as PendingAttestation).uriBytes);
    case 'bitcoin':
    case 'litecoin':
      return a.height === (b as BitcoinAttestation | LitecoinAttestation).height;
    case 'unknown':
      return bytesEqual(a.payload, (b as UnknownAttestation).payload);
  }
}

const MERKLEROOT_RE = /^[0-9a-fA-F]{64}$/;

/** Cabecera de bloque mínima necesaria para verificar una atestación. */
export interface BlockHeader {
  /** Merkleroot en hex de 64 caracteres (32 bytes). */
  readonly merkleroot: string;
  /** Marca de tiempo del bloque (entero positivo). */
  readonly time: number;
}

/**
 * Verifica un digest de 32 bytes contra el merkleroot de una cabecera de bloque.
 * Devuelve `block.time` en éxito; lanza `VerificationError` ante cualquier discrepancia.
 */
export function verifyAgainstBlockheader(digest: Uint8Array, block: BlockHeader): number {
  if (digest.length !== 32) {
    throw new VerificationError(`expected digest of 32 bytes; got ${digest.length}`);
  }
  if (typeof block.merkleroot !== 'string' || !MERKLEROOT_RE.test(block.merkleroot)) {
    throw new VerificationError('block merkleroot is not a 64-char hex string');
  }
  if (!Number.isInteger(block.time) || block.time <= 0) {
    throw new VerificationError('block time is not a positive integer');
  }
  if (!bytesEqual(digest, hexToBytes(block.merkleroot))) {
    throw new VerificationError('digest does not match block merkleroot');
  }
  return block.time;
}
