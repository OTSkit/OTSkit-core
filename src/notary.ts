// src/notary.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { InvalidUriError, VerificationError } from './errors.js';
import { bytesEqual, compareBytes, textToBytes, hexToBytes } from './utils.js';
import { CALENDAR_ALLOWLIST } from './calendars.js';

const TAG_SIZE = 8;
const MAX_PAYLOAD_SIZE = 8192;
const MAX_URI_LENGTH = 1000;

const ALLOWED_URI_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/:',
);

// CALENDAR_ALLOWLIST now lives in ./calendars.ts (single source of truth) and is
// re-exported below to preserve the existing `@otskit/core` import surface.
// The consumer (@otskit/client) must also resolve DNS and reject
// private/loopback/link-local ranges before fetching.
export { CALENDAR_ALLOWLIST };

/**
 * Validates a calendar URI before using it in a network request.
 * Requires HTTPS, no credentials, no query string or fragment, and a host matching
 * the allowlist (defaults to `CALENDAR_ALLOWLIST`).
 * @throws InvalidUriError on any violation
 */
export function parseCalendarUri(
  uri: string,
  allowedHosts: ReadonlyArray<RegExp> = CALENDAR_ALLOWLIST,
): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new InvalidUriError(`calendar URI is not a valid URL: ${uri}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new InvalidUriError(`calendar URI must use HTTPS; got '${parsed.protocol}'`);
  }
  if (parsed.username || parsed.password) {
    throw new InvalidUriError('calendar URI must not contain credentials');
  }
  if (parsed.search) {
    throw new InvalidUriError('calendar URI must not contain a query string');
  }
  if (parsed.hash) {
    throw new InvalidUriError('calendar URI must not contain a fragment');
  }
  if (!allowedHosts.some((re) => re.test(parsed.hostname))) {
    throw new InvalidUriError(
      `calendar URI host '${parsed.hostname}' is not in the allowed calendar list`,
    );
  }
  return parsed.href;
}

const PENDING_TAG = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const BITCOIN_TAG = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
const LITECOIN_TAG = new Uint8Array([0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7, 0x1b, 0x45]);

/** Commitment registered on a remote calendar; the URI is kept to complete it later. */
export interface PendingAttestation {
  readonly kind: 'pending';
  readonly tag: Uint8Array;
  /** Validated ASCII view of the URI. */
  readonly uri: string;
  /** Original URI bytes (canonical for serialization). */
  readonly uriBytes: Uint8Array;
}

/** The commitment is the merkleroot of the Bitcoin block header at this height. */
export interface BitcoinAttestation {
  readonly kind: 'bitcoin';
  readonly tag: Uint8Array;
  readonly height: number;
}

/** Same as Bitcoin, on the Litecoin chain. */
export interface LitecoinAttestation {
  readonly kind: 'litecoin';
  readonly tag: Uint8Array;
  readonly height: number;
}

/** Unrecognized tag; tag and payload are preserved opaquely for exact round-trips. */
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

/** Validates and decodes the bytes of a restricted ASCII URI. Throws when empty or on a disallowed byte. */
function decodeAndValidateUri(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    throw new InvalidUriError('pending attestation URI is empty');
  }
  if (bytes.length > MAX_URI_LENGTH) {
    throw new InvalidUriError(`pending attestation URI exceeds ${MAX_URI_LENGTH} bytes`);
  }
  let uri = '';
  for (const byte of bytes) {
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

/** Creates a PendingAttestation, validating the URI. `uriBytes` derive from `uri` (UTF-8/ASCII). */
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
  // Invariant `compareAttestations` relies on: a known tag never belongs to an
  // 'unknown'. Without this guard, comparing an unknown-with-known-tag against the
  // real known type would enter the wrong switch case and blow up.
  if (bytesEqual(tag, PENDING_TAG) || bytesEqual(tag, BITCOIN_TAG) || bytesEqual(tag, LITECOIN_TAG)) {
    throw new RangeError('unknown attestation tag must not be a known attestation tag');
  }
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError('unknown attestation payload must be a Uint8Array');
  }
  return { kind: 'unknown', tag: tag.slice(), payload: payload.slice() };
}

/** Deserializes an attestation: `tag[8] + varbytes(payload)`, payload parsed in an isolated sub-context. */
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
    // Unknown tag: the whole payload is opaque; not parsed, no internal format required.
    return { kind: 'unknown', tag, payload: payload.slice() };
  }

  // Known types: no leftover bytes allowed in the sub-context (fail-closed).
  payloadCtx.assertEof();
  return attestation;
}

/** Writes the inner payload (without the tag or the outer varbytes wrapper). */
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

/** Serializes an attestation: `tag[8] + varbytes(payload)`. */
export function serializeAttestation(ctx: StreamSerializationContext, att: Attestation): void {
  ctx.writeBytes(att.tag);
  const payloadCtx = new StreamSerializationContext();
  serializePayload(payloadCtx, att);
  ctx.writeVarbytes(payloadCtx.getOutput());
}

/**
 * Total order of attestations: first by tag bytes; on equal tags, by content.
 * An equal tag implies the same `kind` (known tags are reserved, so an `unknown`
 * never matches a known tag), which makes the per-kind accesses safe.
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

/** Structural equality: same `kind`, same tag and same content. */
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

const BLOCK_HEADER_SIZE = 80;
const MERKLEROOT_OFFSET = 36;
const MERKLEROOT_SIZE = 32;
const TIME_OFFSET = 68;
const TIME_SIZE = 4;

const MERKLEROOT_RE = /^[0-9a-fA-F]{64}$/;

/** Minimal block header needed to verify an attestation. */
export interface BlockHeader {
  /** Merkleroot as a 64-char hex string (32 bytes). */
  readonly merkleroot: string;
  /** Block timestamp (positive integer). */
  readonly time: number;
}

/**
 * Verifies a 32-byte digest against the merkle root of a raw block header (80 bytes).
 * The merkle root is extracted from bytes 36..68 in Bitcoin's INTERNAL byte order (the
 * same one the OTS protocol uses internally), which is the REVERSE of the display order
 * of Bitcoin APIs (block explorers, `getblock` RPC). Returns the block timestamp on success.
 */
export function verifyAgainstRawHeader(digest: Uint8Array, rawHeader: Uint8Array): number {
  if (digest.length !== MERKLEROOT_SIZE) {
    throw new VerificationError(`expected digest of ${MERKLEROOT_SIZE} bytes; got ${digest.length}`);
  }
  if (!(rawHeader instanceof Uint8Array) || rawHeader.length !== BLOCK_HEADER_SIZE) {
    throw new VerificationError(
      `expected raw block header of ${BLOCK_HEADER_SIZE} bytes; got ${rawHeader instanceof Uint8Array ? rawHeader.length : 'non-Uint8Array'}`,
    );
  }
  const merkleRootInternal = rawHeader.subarray(MERKLEROOT_OFFSET, MERKLEROOT_OFFSET + MERKLEROOT_SIZE);
  if (!bytesEqual(digest, merkleRootInternal)) {
    throw new VerificationError('digest does not match block merkleroot (internal byte order)');
  }
  const t = rawHeader.subarray(TIME_OFFSET, TIME_OFFSET + TIME_SIZE);
  const time = ((t[0]!) | (t[1]! << 8) | (t[2]! << 16) | (t[3]! << 24)) >>> 0;
  if (time === 0) {
    throw new VerificationError('block time is zero');
  }
  return time;
}

/**
 * Verifies a digest against a raw block header, additionally requiring the header
 * height to match the attestation's. Prevents the backdating attack where verification
 * runs against a different block than the one the attestation declares.
 */
export function verifyBitcoinAttestation(
  digest: Uint8Array,
  attestation: BitcoinAttestation,
  rawHeader: Uint8Array,
  headerHeight: number,
): number {
  if (headerHeight !== attestation.height) {
    throw new VerificationError(
      `header height ${headerHeight} does not match attestation height ${attestation.height}`,
    );
  }
  return verifyAgainstRawHeader(digest, rawHeader);
}

/**
 * Verifies a 32-byte digest against the merkleroot of a block header.
 * Returns `block.time` on success; throws `VerificationError` on any mismatch.
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
