// src/timestamp.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { Op } from './ops.js';
import {
  type Attestation,
  type BitcoinAttestation,
  deserializeAttestation,
  serializeAttestation,
  compareAttestations,
  attestationsEqual,
  verifyBitcoinAttestation,
} from './notary.js';
import { bytesEqual, bytesToHex, compareBytes } from './utils.js';
import {
  OversizedDataError,
  DeserializationError,
  EmptyTimestampError,
  MergeError,
  VerificationError,
} from './errors.js';

/** Provider of raw block headers. The caller manages the network; `@otskit/core` does no fetching. */
export interface BlockHeaderProvider {
  /** Returns the 80 raw bytes of the block header at the given height. */
  getBlockHeader(height: number): Promise<Uint8Array>;
}

/** Maximum tree depth while deserializing (stack-overflow defense). */
const MAX_TREE_DEPTH = 256;

/** A branch of the tree: one operation and the sub-timestamp of its result. */
export interface Branch {
  readonly op: Op;
  readonly stamp: Timestamp;
}

/** Canonical binary serialization of an op (tag [+ arg]). */
function opToBytes(op: Op): Uint8Array {
  const ctx = new StreamSerializationContext();
  op.serialize(ctx);
  return ctx.getOutput();
}

/** Canonical key of an op for the branch map: hex of its serialization. */
function opKey(op: Op): string {
  return bytesToHex(opToBytes(op));
}

/**
 * Proof tree node: a message (`msg`), its direct attestations and its branches
 * (each branch is an op that transforms `msg` and points at a sub-timestamp).
 */
export class Timestamp {
  /** Digest of this node (defensive copy, shares no memory with the input). */
  readonly msg: Uint8Array;
  readonly #attestations: Attestation[] = [];
  /** Branches indexed by the canonical (hex) serialization of their op. */
  readonly #ops = new Map<string, Branch>();

  constructor(msg: Uint8Array) {
    if (!(msg instanceof Uint8Array)) {
      throw new TypeError('Timestamp msg must be a Uint8Array');
    }
    if (msg.length > Op.MAX_MSG_LENGTH) {
      throw new TypeError(`Timestamp msg length ${msg.length} exceeds ${Op.MAX_MSG_LENGTH}`);
    }
    this.msg = msg.slice();
  }

  /** Direct seals over `msg`. Read-only array; use `addAttestation()` to add. */
  get attestations(): ReadonlyArray<Attestation> {
    return Object.freeze(this.#attestations.slice());
  }

  /** Adds an attestation, validating that its `kind` is one of the known types. */
  addAttestation(att: Attestation): void {
    if (att == null || typeof att !== 'object') {
      throw new TypeError('addAttestation requires a valid Attestation object');
    }
    const kind = (att as { kind?: unknown }).kind;
    if (kind !== 'pending' && kind !== 'bitcoin' && kind !== 'litecoin' && kind !== 'unknown') {
      throw new TypeError(`addAttestation: unknown kind '${String(kind)}'`);
    }
    this.#attestations.push(att);
  }

  /** The digest of this node (a copy: mutating the result does not affect the tree). */
  getDigest(): Uint8Array {
    return this.msg.slice();
  }

  /** Las ramas (op + sub-timestamp) de este nodo, como array de solo lectura. */
  get branches(): readonly Branch[] {
    return [...this.#ops.values()];
  }

  /**
   * Deserializes a Timestamp. The format does not include the message it operates
   * on, so it must be supplied (`initialMsg`) to recompute the op results.
   * @param depth current depth; protects against maliciously deep trees.
   */
  static deserialize(
    ctx: StreamDeserializationContext,
    initialMsg: Uint8Array,
    depth = 0,
  ): Timestamp {
    if (depth > MAX_TREE_DEPTH) {
      throw new OversizedDataError(`timestamp tree exceeds max depth ${MAX_TREE_DEPTH}`);
    }
    const self = new Timestamp(initialMsg);
    let tag = ctx.readByte();
    while (tag === 0xff) {
      self.#deserializeElement(ctx, ctx.readByte(), depth);
      tag = ctx.readByte();
    }
    self.#deserializeElement(ctx, tag, depth);
    return self;
  }

  #deserializeElement(ctx: StreamDeserializationContext, tag: number, depth: number): void {
    if (tag === 0x00) {
      this.#attestations.push(deserializeAttestation(ctx));
      return;
    }
    const op = Op.deserializeFromTag(ctx, tag);
    let result: Uint8Array;
    try {
      result = op.call(this.msg);
    } catch (err) {
      throw new DeserializationError(
        `operation failed during deserialization: ${(err as Error).message}`,
      );
    }
    const stamp = Timestamp.deserialize(ctx, result, depth + 1);
    this.#ops.set(opKey(op), { op, stamp });
  }

  /** Serializes this node in canonical order (byte-for-byte deterministic). */
  serialize(ctx: StreamSerializationContext): void {
    const attestations = [...this.#attestations].sort(compareAttestations);
    const branches = [...this.#ops.values()].sort((a, b) =>
      compareBytes(opToBytes(a.op), opToBytes(b.op)),
    );
    const total = attestations.length + branches.length;
    if (total === 0) {
      throw new EmptyTimestampError('an empty timestamp cannot be serialized');
    }
    let index = 0;
    for (const attestation of attestations) {
      if (index < total - 1) ctx.writeByte(0xff);
      ctx.writeByte(0x00);
      serializeAttestation(ctx, attestation);
      index++;
    }
    for (const { op, stamp } of branches) {
      if (index < total - 1) ctx.writeByte(0xff);
      op.serialize(ctx);
      stamp.serialize(ctx);
      index++;
    }
  }

  /**
   * Adds an op to this node and returns the sub-timestamp of its result.
   * If the op (by content) already exists, returns the existing branch.
   */
  add(op: Op): Timestamp {
    const key = opKey(op);
    const existing = this.#ops.get(key);
    if (existing !== undefined) {
      return existing.stamp;
    }
    const stamp = new Timestamp(op.call(this.msg));
    this.#ops.set(key, { op, stamp });
    return stamp;
  }

  /**
   * Links `op` to an ALREADY EXISTING sub-timestamp, sharing the object (creates no new one).
   * Unlike `add`, it makes this branch point at the same `Timestamp` another branch
   * (of another node) already built, so attestations added higher up are reachable
   * from both paths. Used by the Merkle tree for the left/right cross-link.
   * Fails (fail-closed) if `stamp` is not a Timestamp or `op.call(this.msg)` does not match `stamp.msg`.
   */
  addExisting(op: Op, stamp: Timestamp): Timestamp {
    if (!(stamp instanceof Timestamp)) {
      throw new TypeError('addExisting requires a Timestamp');
    }
    if (!bytesEqual(op.call(this.msg), stamp.msg)) {
      throw new MergeError('operation result does not match the existing timestamp message');
    }
    this.#ops.set(opKey(op), { op, stamp });
    return stamp;
  }

  /** Absorbs the attestations and branches of `other` (same `msg`) into this timestamp. */
  merge(other: Timestamp): void {
    if (!(other instanceof Timestamp)) {
      throw new MergeError('can only merge Timestamps together');
    }
    if (!bytesEqual(this.msg, other.msg)) {
      throw new MergeError('cannot merge timestamps for different messages');
    }
    for (const attestation of other.#attestations) {
      if (!this.#attestations.some((existing) => attestationsEqual(existing, attestation))) {
        this.#attestations.push(attestation);
      }
    }
    for (const { op, stamp } of other.#ops.values()) {
      const key = opKey(op);
      let branch = this.#ops.get(key);
      if (branch === undefined) {
        branch = { op, stamp: new Timestamp(op.call(this.msg)) };
        this.#ops.set(key, branch);
      }
      branch.stamp.merge(stamp);
    }
  }

  /** All attestations in the tree with their node's msg (no data loss). */
  allAttestations(): Array<{ msg: Uint8Array; attestation: Attestation }> {
    const result: Array<{ msg: Uint8Array; attestation: Attestation }> = [];
    for (const attestation of this.#attestations) {
      result.push({ msg: this.msg.slice(), attestation });
    }
    for (const { stamp } of this.#ops.values()) {
      result.push(...stamp.allAttestations());
    }
    return result;
  }

  /** All attestations in the tree (without the associated msg). */
  getAttestations(): Attestation[] {
    return this.allAttestations().map((entry) => entry.attestation);
  }

  /** True if the tree holds at least one Bitcoin attestation. Checks presence only, not cryptography. */
  hasBitcoinAttestation(): boolean {
    return this.allAttestations().some(({ attestation }) => attestation.kind === 'bitcoin');
  }

  /**
   * @deprecated Use `hasBitcoinAttestation()` to check presence, or `verifyBitcoin(provider)`
   * for real cryptographic verification. This function only checks data presence (it does not verify).
   */
  isTimestampComplete(): boolean {
    return this.allAttestations().some(
      ({ attestation }) => attestation.kind === 'bitcoin' || attestation.kind === 'litecoin',
    );
  }

  /**
   * Real cryptographic verification: finds the first Bitcoin attestation in the tree and checks
   * that the node digest matches the merkle root of the header at that height.
   * The caller supplies the provider; this function performs no network fetches.
   * @returns block.time of the confirming block
   * @throws VerificationError when there is no Bitcoin attestation or verification fails
   */
  async verifyBitcoin(provider: BlockHeaderProvider): Promise<number> {
    for (const { msg, attestation } of this.allAttestations()) {
      if (attestation.kind === 'bitcoin') {
        const rawHeader = await provider.getBlockHeader(attestation.height);
        return verifyBitcoinAttestation(msg, attestation, rawHeader, attestation.height);
      }
    }
    throw new VerificationError('no Bitcoin attestation found in timestamp tree');
  }

  /** Sub-timestamps that hold direct attestations. */
  directlyVerified(): Timestamp[] {
    if (this.attestations.length > 0) {
      return [this];
    }
    const result: Timestamp[] = [];
    for (const { stamp } of this.#ops.values()) {
      result.push(...stamp.directlyVerified());
    }
    return result;
  }

  /** The messages of the tree's leaves (nodes with no ops). */
  allTips(): Uint8Array[] {
    if (this.#ops.size === 0) {
      return [this.msg.slice()];
    }
    const result: Uint8Array[] = [];
    for (const { stamp } of this.#ops.values()) {
      result.push(...stamp.allTips());
    }
    return result;
  }

  /** Igualdad estructural recursiva con otro timestamp. */
  equals(other: unknown): boolean {
    if (!(other instanceof Timestamp)) {
      return false;
    }
    if (!bytesEqual(this.msg, other.msg)) {
      return false;
    }
    if (this.#attestations.length !== other.#attestations.length) {
      return false;
    }
    const ours = [...this.#attestations].sort(compareAttestations);
    const theirs = [...other.#attestations].sort(compareAttestations);
    for (let i = 0; i < ours.length; i++) {
      if (!attestationsEqual(ours[i]!, theirs[i]!)) {
        return false;
      }
    }
    if (this.#ops.size !== other.#ops.size) {
      return false;
    }
    for (const [key, branch] of this.#ops) {
      const otherBranch = other.#ops.get(key);
      if (otherBranch === undefined) {
        return false;
      }
      if (!branch.stamp.equals(otherBranch.stamp)) {
        return false;
      }
    }
    return true;
  }
}
