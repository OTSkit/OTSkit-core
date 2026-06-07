// src/index.ts
export * from './errors.js';
export * from './utils.js';
export { StreamDeserializationContext, StreamSerializationContext } from './context.js';
export {
  Op,
  OpBinary,
  OpUnary,
  CryptOp,
  OpAppend,
  OpPrepend,
  OpReverse,
  OpHexlify,
  OpSHA1,
  OpRIPEMD160,
  OpSHA256,
} from './ops.js';
export type {
  Attestation,
  PendingAttestation,
  BitcoinAttestation,
  LitecoinAttestation,
  UnknownAttestation,
  BlockHeader,
} from './notary.js';
export {
  makePending,
  makeBitcoin,
  makeLitecoin,
  makeUnknown,
  deserializeAttestation,
  serializeAttestation,
  compareAttestations,
  attestationsEqual,
  verifyAgainstBlockheader,
  verifyAgainstRawHeader,
  verifyBitcoinAttestation,
} from './notary.js';
export type { Branch, BlockHeaderProvider } from './timestamp.js';
export { Timestamp } from './timestamp.js';
export { makeMerkleTree } from './merkle.js';
export { DetachedTimestampFile } from './detached-timestamp-file.js';
