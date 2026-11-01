// Small, coalescing work queue. A change received during a request remains pending;
// blocked editors are retried without replacing their draft or starting another read.
export function createRefreshQueue({run, canRun = () => true, onError = () => {}, delay = 120, retryDelay = 1000, failureDelay = 60_000, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const pending = new Set();
  let timer = null, running = false, closed = false;
  function schedule(wait = delay) {
    if (closed || running || timer !== null || !pending.size) return;
    timer = setTimer(drain, wait);
  }
  async function drain() {
    timer = null;
    if (closed || running) return;
    const key = [...pending].find(canRun);
    if (key === undefined) { schedule(retryDelay); return; }
    pending.delete(key); running = true;
    let retry = false, failed = false;
    try { retry = await run(key) === false; }
    catch (error) { retry = true; failed = true; onError(error, key); }
    finally {
      running = false;
      if (retry && !closed) pending.add(key);
      schedule(failed ? failureDelay : retry ? retryDelay : delay);
    }
  }
  return {
    request(key) { if (!closed) { pending.add(key); schedule(); } },
    resume() { if (timer !== null) { clearTimer(timer); timer = null; } schedule(0); },
    close() { closed = true; pending.clear(); if (timer !== null) clearTimer(timer); timer = null; },
  };
}

// EventSource handles ordinary reconnects. A silent stream is reopened after missed
// heartbeats; the sync event then reloads current state, including events missed offline.
export function connectLiveUpdates({onChange, onSync, onState = () => {}, onAuth = () => {}, EventSourceImpl = globalThis.EventSource,
  documentImpl = globalThis.document, windowImpl = globalThis.window, now = Date.now,
  setTicker = setInterval, clearTicker = clearInterval, fallbackMs = 60_000, staleMs = 45_000}) {
  let source = null, connected = false, stopped = false, suspended = false, lastMessage = now(), lastFallback = now();
  const visible = () => !documentImpl?.hidden;
  const state = value => { if (connected !== value) { connected = value; onState(value); } };
  function received() { lastMessage = now(); state(true); }
  function open() {
    if (stopped || !EventSourceImpl) return;
    const connection = source = new EventSourceImpl('/api/events');
    const listen = (type, fn) => connection.addEventListener(type, event => { if (!stopped && source === connection) fn(event); });
    listen('sync', () => { received(); if (visible()) onSync(); });
    listen('heartbeat', received);
    listen('change', event => {
      received();
      try { onChange(JSON.parse(event.data)); } catch { onSync(); }
    });
    const expired = () => { close(); onAuth(); };
    listen('auth', expired);
    listen('auth-expired', expired);
    listen('error', () => state(false));
  }
  function recover() {
    if (stopped || !visible()) return;
    if (!source || now() - lastMessage > staleMs) { source?.close(); state(false); lastMessage = now(); suspended = false; open(); }
    lastFallback = now(); onSync();
  }
  const ticker = setTicker(() => {
    if (stopped || suspended || !visible()) return;
    if (now() - lastMessage > staleMs) { source?.close(); state(false); lastMessage = now(); open(); }
    if (!connected && now() - lastFallback >= fallbackMs) { lastFallback = now(); onSync(); }
  }, 5000);
  function close() {
    if (stopped) return;
    stopped = true; source?.close(); clearTicker(ticker); state(false);
    documentImpl?.removeEventListener('visibilitychange', recover);
    windowImpl?.removeEventListener('online', recover);
    windowImpl?.removeEventListener('pagehide', pause);
    windowImpl?.removeEventListener('pageshow', recover);
  }
  function pause() { suspended = true; source?.close(); source = null; state(false); }
  documentImpl?.addEventListener('visibilitychange', recover);
  windowImpl?.addEventListener('online', recover);
  windowImpl?.addEventListener('pagehide', pause);
  windowImpl?.addEventListener('pageshow', recover);
  open();
  return {close, get connected() { return connected; }};
}
