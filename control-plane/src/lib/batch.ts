import { Firestore, WriteBatch } from "firebase-admin/firestore";

// Firestore has no `updateMany`/bulk insert and caps a single WriteBatch at
// 500 operations. This chunks an arbitrary list of batch operations into
// batches of at most `chunkSize`, committing each in turn.
export async function runChunkedBatch(
  db: Firestore,
  ops: Array<(batch: WriteBatch) => void>,
  chunkSize = 500
): Promise<void> {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + chunkSize)) {
      op(batch);
    }
    await batch.commit();
  }
}
