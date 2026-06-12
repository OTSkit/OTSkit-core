// src/utils.ts

const HEX_RE = /^[0-9a-fA-F]*$/;

/** Convierte una cadena hex en bytes. Exige longitud par y solo dígitos hex. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hex string must have even length; got ${hex.length}`);
  }
  if (!HEX_RE.test(hex)) {
    throw new Error('hex string contains non-hex characters');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const HEX_TABLE = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

/** Convierte bytes en cadena hex en minúsculas. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) {
    s += HEX_TABLE[byte];
  }
  return s;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Texto → bytes UTF-8. */
export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Bytes UTF-8 → texto. Lanza si la secuencia es inválida (fatal). */
export function bytesToText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Igualdad de bytes en tiempo dependiente del contenido (no constante). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Orden lexicográfico de bytes: <0, 0, >0. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Bytes aleatorios cripto-seguros. Fail-closed: lanza si no hay CSPRNG. */
export function randBytes(n: number): Uint8Array {
  if (n < 0) throw new Error('randBytes: n must be >= 0');
  const out = new Uint8Array(n);
  if (n === 0) return out;
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('randBytes: secure crypto.getRandomValues is unavailable');
  }
  c.getRandomValues(out);
  return out;
}
