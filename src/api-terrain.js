import { Worker } from 'node:worker_threads';
import { requireActor, HttpError } from './auth.js';
import { terrainQuery } from './terrain.js';

export function registerTerrainRoutes(app, campus) {
  let busy = false;
  app.get('/api/world/terrain', async (req, reply) => {
    requireActor(req, 'read');
    let options;
    try { options = terrainQuery(req.query); } catch (e) { throw new HttpError(400, e.message); }
    if (busy) throw new HttpError(429, 'Eine Geländeabfrage läuft bereits. Bitte später erneut versuchen.');
    const worldDir = campus.config.worldSources.live;
    if (!worldDir) throw new HttpError(503, 'Live-Welt nicht konfiguriert.');
    busy = true;
    try {
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { workerData: { worldDir, options }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
        const timer = setTimeout(() => { worker.terminate(); reject(new HttpError(503, 'Geländeabfrage dauerte zu lange; kleineren Bereich wählen.')); }, 60000);
        worker.once('message', value => { clearTimeout(timer); resolve(value); });
        worker.once('error', () => { clearTimeout(timer); reject(new HttpError(503, 'Geländedaten konnten nicht gelesen werden.')); });
        worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new HttpError(503, 'Geländeabfrage wurde abgebrochen.')); });
      });
      return reply.header('Cache-Control', 'no-store').send(result);
    } finally { busy = false; }
  });
}
