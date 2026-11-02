import { parentPort, workerData } from 'node:worker_threads';
import { surveyTerrain } from './terrain.js';
parentPort.postMessage(surveyTerrain(workerData.worldDir, workerData.options));
