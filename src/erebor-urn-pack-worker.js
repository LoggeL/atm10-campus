import {parentPort,workerData} from 'node:worker_threads';
import {groupUrns} from './erebor-urn-packs.js';

parentPort.postMessage(groupUrns(workerData.rows,workerData.slots));
