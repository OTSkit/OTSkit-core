// src/merkle.ts
import { Timestamp } from './timestamp.js';
import { OpAppend, OpPrepend, OpSHA256 } from './ops.js';
import { EmptyMerkleTreeError } from './errors.js';

/**
 * Une dos timestamps en un nodo de concatenación compartido y devuelve la punta
 * `SHA256(left.msg ++ right.msg)`.
 *
 * `left` y `right` se mutan in-place: ambos quedan apuntando al MISMO objeto de
 * concatenación (left con `OpAppend(right.msg)`, right con `OpPrepend(left.msg)`),
 * de modo que cualquier attestation sellada más arriba sea alcanzable desde ambas hojas.
 */
export function catSha256(left: Timestamp, right: Timestamp): Timestamp {
  if (!(left instanceof Timestamp) || !(right instanceof Timestamp)) {
    throw new TypeError('catSha256 requires two Timestamps');
  }
  // right gana OpPrepend(left.msg) → nodo de concatenación (msg = left.msg ++ right.msg)
  const concat = right.add(new OpPrepend(left.msg));
  // left gana OpAppend(right.msg) apuntando AL MISMO nodo concat (cross-link)
  left.addExisting(new OpAppend(right.msg), concat);
  // SHA256 sobre la concatenación; esta punta sube a la siguiente ronda del árbol
  return concat.add(new OpSHA256());
}

/**
 * Como `catSha256` pero con doble SHA256 (estilo Bitcoin):
 * `SHA256(SHA256(left.msg ++ right.msg))`. El segundo `add(OpSHA256)` deduplica por
 * clave canónica, así que repetir la llamada no crea nodos extra (arregla B2).
 */
export function catSha256d(left: Timestamp, right: Timestamp): Timestamp {
  const sha256Node = catSha256(left, right);
  return sha256Node.add(new OpSHA256());
}

/**
 * Construye un árbol de Merkle (Merkle-Mountain-Range) a partir de una lista de
 * timestamps y devuelve la raíz. Los timestamps de entrada se mutan in-place: al
 * sellar una attestation en la raíz, cada hoja queda con el camino completo hacia ella.
 *
 * El algoritmo de emparejamiento es consensus-critical: NO cambiarlo. Reproduce el MMR
 * del `merkle.js` original (cada ronda empareja elementos adyacentes; el sobrante impar
 * pasa intacto a la siguiente ronda).
 *
 * @throws {EmptyMerkleTreeError} si la lista está vacía.
 * @throws {TypeError} si algún elemento no es un Timestamp.
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
        next.push(round[i]!); // sobrante impar: pasa intacto a la siguiente ronda
      }
    }
    round = next;
  }
  return round[0]!;
}
