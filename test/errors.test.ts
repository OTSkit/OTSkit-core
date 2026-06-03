// test/errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  DeserializationError,
  BadMagicError,
  TruncatedStreamError,
  OversizedDataError,
  VaruintOverflowError,
  TrailingGarbageError,
} from '../src/errors.js';

describe('errors', () => {
  it('todas heredan de DeserializationError y de Error', () => {
    for (const Cls of [BadMagicError, TruncatedStreamError, OversizedDataError, VaruintOverflowError, TrailingGarbageError]) {
      const e = new Cls('boom');
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(DeserializationError);
      expect(e).toBeInstanceOf(Cls);
    }
  });

  it('preserva name y message', () => {
    const e = new BadMagicError('magic mismatch');
    expect(e.name).toBe('BadMagicError');
    expect(e.message).toBe('magic mismatch');
  });

  it('es capturable por su tipo concreto', () => {
    try {
      throw new TruncatedStreamError('eof');
    } catch (err) {
      expect(err).toBeInstanceOf(TruncatedStreamError);
    }
  });
});
