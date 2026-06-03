// src/ops.ts
import { StreamDeserializationContext, StreamSerializationContext } from './context.js';
import { MessageTooLongError, ResultTooLongError, UnknownOperationError } from './errors.js';
import { bytesEqual, bytesToHex, textToBytes } from './utils.js';
import { sha1, sha256, ripemd160 } from './hashes/index.js';

const MAX_RESULT_LENGTH = 4096;
const MAX_MSG_LENGTH = 4096;

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Operación: un paso del árbol de prueba. Toma un mensaje y produce un resultado. */
export abstract class Op {
  static readonly MAX_RESULT_LENGTH = MAX_RESULT_LENGTH;
  static readonly MAX_MSG_LENGTH = MAX_MSG_LENGTH;

  abstract readonly tag: number;
  abstract readonly tagName: string;

  /** Aplica la operación. Lanza si el mensaje o el resultado exceden los límites. */
  abstract call(msg: Uint8Array): Uint8Array;
  /** Escribe la operación en el formato binario OTS. */
  abstract serialize(ctx: StreamSerializationContext): void;
  /** Igualdad estructural con otra operación. */
  abstract equals(other: Op): boolean;

  /** Deserializa una operación leyendo su tag y despachando a la factoría correcta. */
  static deserialize(ctx: StreamDeserializationContext): Op {
    return Op.deserializeFromTag(ctx, ctx.readByte());
  }

  /** Igual que `deserialize`, pero con el tag ya leído del stream (lo usa el árbol Timestamp). */
  static deserializeFromTag(ctx: StreamDeserializationContext, tag: number): Op {
    const factory = OP_BY_TAG.get(tag);
    if (factory === undefined) {
      throw new UnknownOperationError(`unknown operation tag 0x${tag.toString(16).padStart(2, '0')}`);
    }
    return factory(ctx);
  }

  protected get maxMsgLength(): number {
    return MAX_MSG_LENGTH;
  }

  protected checkMsg(msg: Uint8Array): void {
    if (msg.length > this.maxMsgLength) {
      throw new MessageTooLongError(`message length ${msg.length} exceeds ${this.maxMsgLength}`);
    }
  }

  protected checkResult(result: Uint8Array): Uint8Array {
    if (result.length > MAX_RESULT_LENGTH) {
      throw new ResultTooLongError(`result length ${result.length} exceeds ${MAX_RESULT_LENGTH}`);
    }
    return result;
  }
}

/** Operaciones con un argumento (append/prepend). */
export abstract class OpBinary extends Op {
  readonly arg: Uint8Array;

  constructor(arg: Uint8Array) {
    super();
    if (!(arg instanceof Uint8Array)) {
      throw new TypeError('OpBinary arg must be a Uint8Array');
    }
    // Copia defensiva: el arg forma la clave canónica de la op en el árbol Timestamp;
    // si el caller mutara el buffer tras construir, la clave quedaría obsoleta.
    this.arg = arg.slice();
  }

  override serialize(ctx: StreamSerializationContext): void {
    ctx.writeByte(this.tag);
    ctx.writeVarbytes(this.arg);
  }
}

/** Concatena un sufijo (arg) al mensaje. */
export class OpAppend extends OpBinary {
  static readonly TAG = 0xf0;
  readonly tag = OpAppend.TAG;
  readonly tagName = 'append';

  override call(msg: Uint8Array): Uint8Array {
    this.checkMsg(msg);
    return this.checkResult(concatBytes(msg, this.arg));
  }

  override equals(other: Op): boolean {
    return other instanceof OpAppend && bytesEqual(this.arg, other.arg);
  }
}

/** Concatena un prefijo (arg) delante del mensaje. */
export class OpPrepend extends OpBinary {
  static readonly TAG = 0xf1;
  readonly tag = OpPrepend.TAG;
  readonly tagName = 'prepend';

  override call(msg: Uint8Array): Uint8Array {
    this.checkMsg(msg);
    return this.checkResult(concatBytes(this.arg, msg));
  }

  override equals(other: Op): boolean {
    return other instanceof OpPrepend && bytesEqual(this.arg, other.arg);
  }
}

/** Operaciones sin argumento. */
export abstract class OpUnary extends Op {
  override serialize(ctx: StreamSerializationContext): void {
    ctx.writeByte(this.tag);
  }
}

/** Invierte el orden de los bytes del mensaje. */
export class OpReverse extends OpUnary {
  static readonly TAG = 0xf2;
  readonly tag = OpReverse.TAG;
  readonly tagName = 'reverse';

  override call(msg: Uint8Array): Uint8Array {
    this.checkMsg(msg);
    const r = new Uint8Array(msg.length);
    for (let i = 0; i < msg.length; i++) r[i] = msg[msg.length - 1 - i]!;
    return this.checkResult(r);
  }

  override equals(other: Op): boolean {
    return other instanceof OpReverse;
  }
}

/** Convierte el mensaje en su representación hex ASCII. */
export class OpHexlify extends OpUnary {
  static readonly TAG = 0xf3;
  readonly tag = OpHexlify.TAG;
  readonly tagName = 'hexlify';

  // El resultado mide el doble que el mensaje; el límite de mensaje es la mitad.
  protected override get maxMsgLength(): number {
    return MAX_RESULT_LENGTH / 2;
  }

  override call(msg: Uint8Array): Uint8Array {
    this.checkMsg(msg);
    return this.checkResult(textToBytes(bytesToHex(msg)));
  }

  override equals(other: Op): boolean {
    return other instanceof OpHexlify;
  }
}

/** Operación criptográfica: salida de tamaño fijo, siempre <= MAX_RESULT_LENGTH. */
export abstract class CryptOp extends OpUnary {
  abstract readonly digestLength: number;
  protected abstract hash(msg: Uint8Array): Uint8Array;

  override call(msg: Uint8Array): Uint8Array {
    this.checkMsg(msg);
    return this.hash(msg);
  }

  /**
   * Hashea el contenido COMPLETO de un fichero (longitud arbitraria) con el algoritmo
   * de esta operación. A diferencia de `call`, NO aplica el límite `MAX_MSG_LENGTH`:
   * `call` transforma digests dentro del árbol de prueba (≤ 4096 bytes), mientras que
   * `hashFile` recibe el contenido íntegro del fichero a sellar, que puede ser de
   * cualquier tamaño. Lo usa `DetachedTimestampFile.fromBytes`.
   */
  hashFile(data: Uint8Array): Uint8Array {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('hashFile expects a Uint8Array');
    }
    return this.hash(data);
  }
}

export class OpSHA1 extends CryptOp {
  static readonly TAG = 0x02;
  readonly tag = OpSHA1.TAG;
  readonly tagName = 'sha1';
  readonly digestLength = 20;
  protected override hash(msg: Uint8Array): Uint8Array {
    return sha1(msg);
  }
  override equals(other: Op): boolean {
    return other instanceof OpSHA1;
  }
}

export class OpRIPEMD160 extends CryptOp {
  static readonly TAG = 0x03;
  readonly tag = OpRIPEMD160.TAG;
  readonly tagName = 'ripemd160';
  readonly digestLength = 20;
  protected override hash(msg: Uint8Array): Uint8Array {
    return ripemd160(msg);
  }
  override equals(other: Op): boolean {
    return other instanceof OpRIPEMD160;
  }
}

export class OpSHA256 extends CryptOp {
  static readonly TAG = 0x08;
  readonly tag = OpSHA256.TAG;
  readonly tagName = 'sha256';
  readonly digestLength = 32;
  protected override hash(msg: Uint8Array): Uint8Array {
    return sha256(msg);
  }
  override equals(other: Op): boolean {
    return other instanceof OpSHA256;
  }
}

type OpFactory = (ctx: StreamDeserializationContext) => Op;

const unary = (ctor: new () => Op): OpFactory => () => new ctor();
const binary = (ctor: new (arg: Uint8Array) => OpBinary): OpFactory => (ctx) =>
  new ctor(ctx.readVarbytes(MAX_RESULT_LENGTH, 1));

/** @internal — exportada solo para tests; NO forma parte de la API pública. */
export function buildTagTable(entries: ReadonlyArray<readonly [number, OpFactory]>): ReadonlyMap<number, OpFactory> {
  const map = new Map<number, OpFactory>();
  for (const [tag, factory] of entries) {
    if (map.has(tag)) {
      throw new Error(`duplicate operation tag 0x${tag.toString(16)}`);
    }
    map.set(tag, factory);
  }
  return map;
}

const OP_BY_TAG: ReadonlyMap<number, OpFactory> = buildTagTable([
  [OpAppend.TAG, binary(OpAppend)],
  [OpPrepend.TAG, binary(OpPrepend)],
  [OpReverse.TAG, unary(OpReverse)],
  [OpHexlify.TAG, unary(OpHexlify)],
  [OpSHA1.TAG, unary(OpSHA1)],
  [OpRIPEMD160.TAG, unary(OpRIPEMD160)],
  [OpSHA256.TAG, unary(OpSHA256)],
]);
