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

/** Proveedor de cabeceras de bloque crudas. El caller gestiona la red; `@otskit/core` no hace fetch. */
export interface BlockHeaderProvider {
  /** Devuelve los 80 bytes crudos del header del bloque a la altura indicada. */
  getBlockHeader(height: number): Promise<Uint8Array>;
}

/** Profundidad máxima del árbol al deserializar (defensa contra stack overflow). */
const MAX_TREE_DEPTH = 256;

/** Una rama del árbol: una operación y el sub-timestamp de su resultado. */
export interface Branch {
  readonly op: Op;
  readonly stamp: Timestamp;
}

/** Serialización binaria canónica de una op (tag [+ arg]). */
function opToBytes(op: Op): Uint8Array {
  const ctx = new StreamSerializationContext();
  op.serialize(ctx);
  return ctx.getOutput();
}

/** Clave canónica de una op para el mapa de ramas: hex de su serialización. */
function opKey(op: Op): string {
  return bytesToHex(opToBytes(op));
}

/**
 * Nodo del árbol de prueba: un mensaje (`msg`), sus attestations directas y sus ramas
 * (cada rama es una op que transforma `msg` y apunta a un sub-timestamp).
 */
export class Timestamp {
  /** Digest de este nodo (copia defensiva, no comparte memoria con la entrada). */
  readonly msg: Uint8Array;
  #attestations: Attestation[] = [];
  /** Ramas indexadas por la serialización canónica (hex) de su op. */
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

  /** Sellos directos sobre `msg`. Array de solo lectura; usar `addAttestation()` para añadir. */
  get attestations(): ReadonlyArray<Attestation> {
    return Object.freeze(this.#attestations.slice());
  }

  /** Añade una attestation validando que su `kind` es uno de los tipos conocidos. */
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

  /** El digest de este nodo (copia: mutar el resultado no afecta al árbol). */
  getDigest(): Uint8Array {
    return this.msg.slice();
  }

  /** Las ramas (op + sub-timestamp) de este nodo, como array de solo lectura. */
  get branches(): readonly Branch[] {
    return [...this.#ops.values()];
  }

  /**
   * Deserializa un Timestamp. El formato no incluye el mensaje sobre el que opera,
   * así que hay que aportarlo (`initialMsg`) para recalcular los resultados de las ops.
   * @param depth profundidad actual; protege contra árboles maliciosamente profundos.
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

  /** Serializa este nodo en orden canónico (determinista byte-a-byte). */
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
   * Añade una op a este nodo y devuelve el sub-timestamp de su resultado.
   * Si la op (por contenido) ya existe, devuelve la rama existente.
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
   * Vincula `op` a un sub-timestamp YA EXISTENTE, compartiendo el objeto (no crea uno nuevo).
   * A diferencia de `add`, hace que esta rama apunte al mismo `Timestamp` que otra rama
   * (de otro nodo) ya construyó, de modo que las attestations añadidas más arriba sean
   * alcanzables desde ambos caminos. Lo usa el árbol Merkle para el cross-link izquierda/derecha.
   * Falla (fail-closed) si `stamp` no es un Timestamp o si `op.call(this.msg)` no coincide con `stamp.msg`.
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

  /** Incorpora las attestations y ramas de `other` (mismo `msg`) en este timestamp. */
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

  /** Todas las attestations del árbol con el msg de su nodo (sin pérdida de datos). */
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

  /** Todas las attestations del árbol (sin el msg asociado). */
  getAttestations(): Attestation[] {
    return this.allAttestations().map((entry) => entry.attestation);
  }

  /** Verdadero si el árbol contiene al menos una attestation Bitcoin. Solo comprueba presencia, no criptografía. */
  hasBitcoinAttestation(): boolean {
    return this.allAttestations().some(({ attestation }) => attestation.kind === 'bitcoin');
  }

  /**
   * @deprecated Usa `hasBitcoinAttestation()` para comprobar presencia, o `verifyBitcoin(provider)`
   * para verificación criptográfica real. Esta función solo comprueba presencia de datos (no verifica).
   */
  isTimestampComplete(): boolean {
    return this.allAttestations().some(
      ({ attestation }) => attestation.kind === 'bitcoin' || attestation.kind === 'litecoin',
    );
  }

  /**
   * Verificación criptográfica real: localiza la primera attestation Bitcoin del árbol y comprueba
   * que el digest del nodo coincide con el merkle root del header a esa altura.
   * El caller aporta el provider; esta función no hace ningún fetch de red.
   * @returns block.time del bloque confirmador
   * @throws VerificationError si no hay attestation Bitcoin o la verificación falla
   */
  async verifyBitcoin(provider: BlockHeaderProvider): Promise<number> {
    for (const { msg, attestation } of this.allAttestations()) {
      if (attestation.kind === 'bitcoin') {
        const att = attestation as BitcoinAttestation;
        const rawHeader = await provider.getBlockHeader(att.height);
        return verifyBitcoinAttestation(msg, att, rawHeader, att.height);
      }
    }
    throw new VerificationError('no Bitcoin attestation found in timestamp tree');
  }

  /** Sub-timestamps que tienen attestations directas. */
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

  /** Los mensajes de las hojas del árbol (nodos sin ops). */
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
