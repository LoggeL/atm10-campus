// Small invalidations over one authenticated stream. REST remains the source of
// truth; every reconnect requests a fresh snapshot rather than replaying history.
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { HttpError, requireActor, resolveActor } from './auth.js';

const TOPICS = ['blueprints', 'snapshots', 'cannons', 'stock', 'activity'];
const ONLINE_MS = 3 * 60_000;

export function registerRealtime(app, campus, { heartbeatMs = 15_000, batchMs = 100, maxClients = 128, maxPerUser = 8 } = {}) {
  const clients = new Set(), pending = new Set(), names = new Set(), presence = new Map();
  const epoch = randomUUID();
  let sequence = 0, batchTimer = null, heartbeatTimer = null, allCannons = false, closing = false;
  const frame = (event, data, id) => `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  function remove(client, abrupt = false) {
    if (!clients.delete(client)) return;
    if (abrupt) { client.stream.destroy(); client.reply.raw.destroy(); }
    else client.stream.end();
  }
  function write(client, event, data, id) {
    if (!clients.has(client)) return;
    const { stream, reply } = client;
    // Slow/disconnected tabs must not accumulate an unbounded server queue.
    if (stream.destroyed || reply.raw.destroyed || stream.readableLength + stream.writableLength + reply.raw.writableLength > 64 * 1024) {
      remove(client, true); return;
    }
    if (!stream.write(frame(event, data, id))) remove(client, true);
  }
  function authorized(client) {
    const actor = resolveActor(campus.db, client.req);
    if (actor && !actor.invalid && actor.user.id === client.userId) return true;
    write(client, 'auth', { reason: 'Anmeldung abgelaufen oder Zugriff widerrufen.' });
    remove(client);
    return false;
  }
  function revalidate() {
    for (const client of clients) authorized(client);
  }
  function flush() {
    batchTimer = null;
    if (closing || !pending.size) return;
    const topics = [...pending].sort();
    const data = { topics, ...(pending.has('cannons') && !allCannons ? { cannons: [...names].sort() } : {}) };
    pending.clear(); names.clear(); allCannons = false;
    const id = `${epoch}:${++sequence}`;
    for (const client of clients) if (authorized(client)) write(client, 'change', data, id);
  }
  function publish(topic, cannonName) {
    if (closing || !TOPICS.includes(topic)) return;
    pending.add(topic);
    if (topic === 'cannons') {
      if (typeof cannonName === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(cannonName) && names.size < 128) names.add(cannonName);
      else allCannons = true;
    }
    if (!batchTimer) { batchTimer = setTimeout(flush, batchMs); batchTimer.unref(); }
  }
  function campusChanged(topic) {
    publish(topic); publish('cannons'); publish('activity');
  }
  function checkPresence() {
    const seen = new Set();
    for (const row of campus.db.prepare('SELECT name, last_seen_at FROM cannons').all()) {
      const online = !!row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < ONLINE_MS;
      seen.add(row.name);
      if (presence.has(row.name) && presence.get(row.name) !== online) publish('cannons', row.name);
      presence.set(row.name, online);
    }
    for (const name of presence.keys()) if (!seen.has(name)) presence.delete(name);
  }
  app.decorate('updates', { publish });
  campus.events.on('change', campusChanged);

  app.get('/api/events', { exposeHeadRoute: false }, async (req, reply) => {
    const actor = requireActor(req, 'read');
    if (closing) throw new HttpError(503, 'Server wird neu gestartet.');
    if (clients.size >= maxClients || [...clients].filter(c => c.userId === actor.user.id).length >= maxPerUser) {
      reply.header('Retry-After', '15');
      throw new HttpError(429, 'Zu viele offene Live-Verbindungen.');
    }
    const stream = new PassThrough({ highWaterMark: 16 * 1024 });
    const client = { req, reply, stream, userId: actor.user.id };
    clients.add(client);
    reply.raw.once('close', () => remove(client));
    stream.once('error', () => remove(client, true));
    reply.type('text/event-stream; charset=utf-8')
      .header('Cache-Control', 'private, no-cache, no-store, no-transform')
      .header('X-Accel-Buffering', 'no')
      .header('Vary', 'Cookie, Authorization');
    stream.write('retry: 3000\n\n');
    write(client, 'sync', { topics: TOPICS }, `${epoch}:${sequence}`);
    return reply.send(stream);
  });

  // Computer reports and browser actions notify only after their response has
  // committed. Reading an updated card does not publish another invalidation.
  app.addHook('onResponse', async (req, reply) => {
    if (closing || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || reply.statusCode < 200 || reply.statusCode >= 300) return;
    const route = req.routeOptions.url || '';
    if (route.startsWith('/api/cannons/')) {
      if (route.endsWith('/alignment/probe')) return;
      const choicesChanged = route.endsWith('/transfer') || (route === '/api/cannons/:name' && (req.method === 'DELETE' || (req.method === 'PUT' && req.body?.blueprint !== undefined)));
      // Assigning/releasing a plan changes the available choices on every cannon.
      publish('cannons', choicesChanged ? undefined : req.params.name);
      if (route.endsWith('/transfer')) publish('cannons', req.body?.target);
      if (!route.endsWith('/status')) publish('activity');
    } else if (route === '/api/me/stock') publish('stock');
    else if (route.startsWith('/api/auth/') || route.startsWith('/api/tokens') || route.startsWith('/api/users') || route.startsWith('/api/invites')) {
      revalidate(); publish('activity');
    }
  });
  app.addHook('onReady', async () => {
    checkPresence();
    heartbeatTimer = setInterval(() => {
      if (closing) return;
      checkPresence();
      for (const client of clients) if (authorized(client)) write(client, 'heartbeat', { at: Date.now() });
    }, heartbeatMs);
    heartbeatTimer.unref();
  });
  // onClose runs after active requests finish, so streams must end in preClose.
  app.addHook('preClose', async () => {
    closing = true;
    clearInterval(heartbeatTimer); clearTimeout(batchTimer);
    campus.events.off('change', campusChanged);
    pending.clear(); names.clear(); presence.clear();
    for (const client of clients) remove(client);
  });
}
