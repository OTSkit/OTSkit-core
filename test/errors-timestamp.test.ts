// test/errors-timestamp.test.ts
import { describe, it, expect } from 'vitest';
import { EmptyTimestampError, MergeError } from '../src/errors.js';

describe('errores de timestamp', () => {
  it('EmptyTimestampError es un Error con su nombre', () => {
    const e = new EmptyTimestampError('empty');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(EmptyTimestampError);
    expect(e.name).toBe('EmptyTimestampError');
  });

  it('MergeError es un Error con su nombre', () => {
    const e = new MergeError('bad merge');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MergeError);
    expect(e.name).toBe('MergeError');
  });
});
