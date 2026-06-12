// src/utils.ts

const HEX_RE = /^[0-9a-fA-F]*$/;

/** Converts a hex string into bytes. Requires even length and hex digits only. */
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

/** Converts bytes into a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) {
    s += HEX_TABLE[byte];
  }
  return s;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Text → UTF-8 bytes. */
export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** UTF-8 bytes → text. Throws on invalid sequences (fatal). */
export function bytesToText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Byte equality in content-dependent time (not constant-time). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Lexicographic byte order: <0, 0, >0. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Cryptographically secure random bytes. Fail-closed: throws when no CSPRNG is available. */
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
