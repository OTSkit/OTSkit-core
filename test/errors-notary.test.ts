// test/errors-notary.test.ts
import { describe, it, expect } from 'vitest';
import { DeserializationError, InvalidUriError, VerificationError } from '../src/errors.js';

describe('errores de atestación', () => {
  it('InvalidUriError es un DeserializationError', () => {
    const e = new InvalidUriError('bad uri');
    expect(e).toBeInstanceOf(DeserializationError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('InvalidUriError');
    expect(e.message).toBe('bad uri');
  });

  it('VerificationError es un Error pero NO un DeserializationError', () => {
    const e = new VerificationError('mismatch');
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(DeserializationError);
    expect(e.name).toBe('VerificationError');
  });
});
