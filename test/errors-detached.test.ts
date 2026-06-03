import { describe, it, expect } from 'vitest';
import { DeserializationError, UnsupportedVersionError } from '../src/errors.js';

describe('errores de fichero detached', () => {
  it('UnsupportedVersionError es un DeserializationError con su nombre', () => {
    const e = new UnsupportedVersionError('version 2 not supported');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(DeserializationError);
    expect(e.name).toBe('UnsupportedVersionError');
  });
});
