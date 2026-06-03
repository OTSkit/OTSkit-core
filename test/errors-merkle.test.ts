import { describe, it, expect } from 'vitest';
import { EmptyMerkleTreeError } from '../src/errors.js';

describe('errores de merkle', () => {
  it('EmptyMerkleTreeError es un Error con su nombre', () => {
    const e = new EmptyMerkleTreeError('empty');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(EmptyMerkleTreeError);
    expect(e.name).toBe('EmptyMerkleTreeError');
  });
});
