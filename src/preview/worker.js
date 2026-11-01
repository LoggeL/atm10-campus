import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { parseStructure } from '../nbt.js';
import { renderBlueprint } from './render.js';
try {
  const image = renderBlueprint(parseStructure(readFileSync(workerData.file)));
  parentPort.postMessage({image});
} catch(error) { parentPort.postMessage({error:error.message}); }
