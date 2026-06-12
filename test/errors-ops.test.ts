// test/errors-ops.test.ts
import { describe, it, expect } from 'vitest';
import { DeserializationError, UnknownOperationError, OpExecutionError, MessageTooLongError, ResultTooLongError } from '../src/errors.js';

describe('operation errors', () => {
  it('UnknownOperationError es un DeserializationError', () => {
    const e = new UnknownOperationError('0x99');
    expect(e).toBeInstanceOf(DeserializationError);
    expect(e.name).toBe('UnknownOperationError');
  });
  it('MessageTooLongError y ResultTooLongError son OpExecutionError', () => {
    expect(new MessageTooLongError('x')).toBeInstanceOf(OpExecutionError);
    expect(new ResultTooLongError('x')).toBeInstanceOf(OpExecutionError);
    expect(new MessageTooLongError('x')).toBeInstanceOf(Error);
  });
});
