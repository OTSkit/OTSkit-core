// src/merkle.ts
import { Timestamp } from './timestamp.js';
import { OpAppend, OpPrepend, OpSHA256 } from './ops.js';
import { EmptyMerkleTreeError } from './errors.js';

/**
 * Joins two timestamps into a shared concatenation node and returns the tip
 * `SHA256(left.msg ++ right.msg)`.
 *
 * `left` and `right` are mutated in-place: both end up pointing at the SAME
 * concatenation object (left via `OpAppend(right.msg)`, right via `OpPrepend(left.msg)`),
 * so any attestation sealed above it is reachable from both leaves.
 */
export function catSha256(left: Timestamp, right: Timestamp): Timestamp {
  if (!(left instanceof Timestamp) || !(right instanceof Timestamp)) {
    throw new TypeError('catSha256 requires two Timestamps');
  }
  // right gets OpPrepend(left.msg) → concatenation node (msg = left.msg ++ right.msg)
  const concat = right.add(new OpPrepend(left.msg));
  // left gets OpAppend(right.msg) pointing at the SAME concat node (cross-link)
  left.addExisting(new OpAppend(right.msg), concat);
  // SHA256 over the concatenation; this tip moves up to the next round of the tree
  return concat.add(new OpSHA256());
}

/**
 * Like `catSha256` but with double SHA256 (Bitcoin-style):
 * `SHA256(SHA256(left.msg ++ right.msg))`. The second `add(OpSHA256)` deduplicates by
 * canonical key, so repeating the call creates no extra nodes (fixes B2).
 */
export function catSha256d(left: Timestamp, right: Timestamp): Timestamp {
  const sha256Node = catSha256(left, right);
  return sha256Node.add(new OpSHA256());
}

/**
 * Builds a Merkle tree (Merkle-Mountain-Range) from a list of timestamps and
 * returns the root. The input timestamps are mutated in-place: once an
 * attestation is sealed at the root, every leaf holds the full path to it.
 *
 * The pairing algorithm is consensus-critical: do NOT change it. It reproduces
 * the MMR of the original `merkle.js` (each round pairs adjacent elements; an
 * odd leftover passes through untouched to the next round).
 *
 * @throws {EmptyMerkleTreeError} if the list is empty.
 * @throws {TypeError} if any element is not a Timestamp.
 */
export function makeMerkleTree(timestamps: readonly Timestamp[]): Timestamp {
  if (timestamps.length === 0) {
    throw new EmptyMerkleTreeError('makeMerkleTree requires at least one timestamp');
  }
  for (const stamp of timestamps) {
    if (!(stamp instanceof Timestamp)) {
      throw new TypeError('makeMerkleTree requires an array of Timestamps');
    }
  }

  let round: Timestamp[] = [...timestamps];
  while (round.length > 1) {
    const next: Timestamp[] = [];
    for (let i = 0; i < round.length; i += 2) {
      if (i + 1 < round.length) {
        next.push(catSha256(round[i]!, round[i + 1]!));
      } else {
        next.push(round[i]!); // odd leftover: passes through untouched to the next round
      }
    }
    round = next;
  }
  return round[0]!;
}
