// src/context.ts
import { bytesEqual } from './utils.js';
import {
  TruncatedStreamError,
  OversizedDataError,
  VaruintOverflowError,
  BadMagicError,
  TrailingGarbageError,
} from './errors.js';

/** Lector del formato binario OTS. Cursor privado, fail-closed. */
export class StreamDeserializationContext {
  readonly #buffer: Uint8Array;
  #counter = 0;

  constructor(stream: Uint8Array) {
    if (!(stream instanceof Uint8Array)) {
      throw new TypeError('StreamDeserializationContext expects a Uint8Array');
    }
    this.#buffer = stream;
  }

  get counter(): number {
    return this.#counter;
  }

  /** Lee `length` bytes. Lanza si el stream no tiene suficientes. */
  read(length: number): Uint8Array {
    if (length < 0) throw new RangeError('read length must be >= 0');
    if (this.#counter + length > this.#buffer.length) {
      throw new TruncatedStreamError(
        `attempted to read ${length} bytes at offset ${this.#counter}, only ${this.#buffer.length - this.#counter} available`,
      );
    }
    const slice = this.#buffer.subarray(this.#counter, this.#counter + length);
    this.#counter += length;
    return slice;
  }

  /** Lee un único byte. */
  readByte(): number {
    return this.read(1)[0]!;
  }

  /** Varuint LEB128: 7 bits por byte, bit 7 = continuación. */
  readVaruint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      if (shift > 56) {
        throw new VaruintOverflowError('varuint exceeds Number.MAX_SAFE_INTEGER');
      }
      byte = this.readByte();
      value += (byte & 0x7f) * 2 ** shift;
      if (!Number.isSafeInteger(value)) {
        throw new VaruintOverflowError('varuint exceeds Number.MAX_SAFE_INTEGER');
      }
      shift += 7;
    } while (byte & 0x80);
    return value;
  }

  /** Lee un bloque varbytes. `maxLen` es obligatorio (defensa DoS). */
  readVarbytes(maxLen: number, minLen = 0): Uint8Array {
    const length = this.readVaruint();
    if (length > maxLen) {
      throw new OversizedDataError(`varbytes length ${length} exceeds maxLen ${maxLen}`);
    }
    if (length < minLen) {
      throw new OversizedDataError(`varbytes length ${length} below minLen ${minLen}`);
    }
    return this.read(length);
  }

  /** Verifica el número mágico de cabecera. */
  assertMagic(expectedMagic: Uint8Array): void {
    const actual = this.read(expectedMagic.length);
    if (!bytesEqual(expectedMagic, actual)) {
      throw new BadMagicError('header magic mismatch');
    }
  }

  /** Exige que no queden bytes sin consumir. */
  assertEof(): void {
    if (this.#counter < this.#buffer.length) {
      throw new TrailingGarbageError('trailing garbage after end of deserialized data');
    }
  }
}

/** Escritor del formato binario OTS. Buffer con crecimiento ×2. */
export class StreamSerializationContext {
  #buffer = new Uint8Array(4096);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  getOutput(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  writeByte(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(`writeByte expects a byte 0..255; got ${value}`);
    }
    if (this.#length >= this.#buffer.length) {
      const grown = new Uint8Array(this.#buffer.length * 2);
      grown.set(this.#buffer, 0);
      this.#buffer = grown;
    }
    this.#buffer[this.#length] = value;
    this.#length += 1;
  }

  writeBytes(value: Uint8Array): void {
    for (let i = 0; i < value.length; i++) {
      this.writeByte(value[i]!);
    }
  }

  /** Codifica un varuint LEB128. */
  writeVaruint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`writeVaruint expects a safe non-negative integer; got ${value}`);
    }
    do {
      let byte = value % 128;
      value = Math.floor(value / 128);
      if (value > 0) byte |= 0x80;
      this.writeByte(byte);
    } while (value > 0);
  }

  writeVarbytes(value: Uint8Array): void {
    this.writeVaruint(value.length);
    this.writeBytes(value);
  }
}
