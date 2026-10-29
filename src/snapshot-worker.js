import { parentPort, workerData } from 'node:worker_threads';
import { captureSnapshot, writeSnapshotFiles } from './snapshot.js';

try {
  const { worldDir, origin, size, dir, info } = workerData;
  const { built, surfaces, durationMs } = captureSnapshot(worldDir, origin, size);
  const context = writeSnapshotFiles(dir, built, surfaces, info);
  parentPort.postMessage({ ok: true, context: { ...context, durationMs } });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
