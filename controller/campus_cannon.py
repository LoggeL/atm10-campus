"""Narrow Create 6.0.10 controller bridge; no caller-supplied commands."""
import re
import json


def parse_snbt(text):
    """Bounded fail-closed Mojangson reader, no eval or untrusted deserialization."""
    if len(text) > 262144:
        raise ValueError('NBT zu groß.')
    i = 0

    def ws():
        nonlocal i
        while i < len(text) and text[i].isspace(): i += 1

    def token(key=False):
        nonlocal i
        ws()
        if i >= len(text): raise ValueError('Unvollständiges NBT.')
        if text[i] in '\"\'':
            quote = text[i]; i += 1; out = ''
            while i < len(text):
                ch = text[i]; i += 1
                if ch == quote: return out
                if ch == '\\':
                    if i >= len(text) or text[i] not in (quote, '\\'): raise ValueError('NBT Escape')
                    ch = text[i]; i += 1
                out += ch
            raise ValueError('NBT String')
        start = i
        while i < len(text) and text[i] not in (':,{}[]' if key else ',{}[]') and not text[i].isspace(): i += 1
        if i == start: raise ValueError('NBT Token')
        return text[start:i]

    def value(depth=0):
        nonlocal i
        ws()
        if depth > 40 or i >= len(text): raise ValueError('NBT Tiefe')
        ch = text[i]
        if ch == '{':
            i += 1; out = {}; ws()
            if i < len(text) and text[i] == '}': i += 1; return out
            while True:
                k = token(True); ws()
                if k in out or i >= len(text) or text[i] != ':': raise ValueError('NBT Schlüssel')
                i += 1; out[k] = value(depth+1); ws()
                if i < len(text) and text[i] == '}': i += 1; return out
                if i >= len(text) or text[i] != ',': raise ValueError('NBT Compound')
                i += 1
        if ch == '[':
            i += 1; out = []; ws()
            if text[i:i+2] in ('I;', 'B;', 'L;'): i += 2; ws()
            if i < len(text) and text[i] == ']': i += 1; return out
            while True:
                out.append(value(depth+1)); ws()
                if i < len(text) and text[i] == ']': i += 1; return out
                if i >= len(text) or text[i] != ',': raise ValueError('NBT Liste')
                i += 1
        quoted = ch in '\"\''
        t = token()
        if not quoted and re.fullmatch(r'[-+]?\d+[bBsSlL]?', t): return int(t[:-1] if t[-1].isalpha() else t)
        if not quoted and re.fullmatch(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[fFdD]?', t): return float(t[:-1] if t[-1] in 'fFdD' else t)
        return t
    result = value(); ws()
    if i != len(text): raise ValueError('NBT Restdaten')
    return result


def validate_binding(b):
    if not isinstance(b, dict) or set(b) != {'dimension', 'x', 'y', 'z', 'owner'}:
        raise ValueError('Dimension, x/y/z und Schematic-Owner erforderlich.')
    if b['dimension'] not in {'minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'}:
        raise ValueError('Nicht unterstützte Dimension.')
    if not isinstance(b['owner'], str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', b['owner']):
        raise ValueError('Ungültiger Schematic-Owner.')
    for k, lo, hi in [('x', -30000000, 30000000), ('y', -64, 319), ('z', -30000000, 30000000)]:
        if type(b[k]) is not int or not lo <= b[k] <= hi:
            raise ValueError('Ungültige Blockkoordinaten.')
    return dict(b)

from pathlib import Path
import hashlib
import secrets
import time
import threading
import os


class CannonBridge:
    def __init__(self, base, run):
        self.base = Path(base)
        self.run = run
        self.path = self.base / 'discord/cannon-registry.json'
        self.pending = {}
        self.lock = threading.Lock()

    def registry(self):
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def save_registry(self, registry):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name('.cannon-registry-' + secrets.token_hex(16) + '.tmp')
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f:
                json.dump(registry, f); f.flush(); os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            tmp.unlink(missing_ok=True)

    def prefix(self, b):
        return f"execute in {b['dimension']} run data get block {b['x']} {b['y']} {b['z']}"

    def inspect(self, b):
        from campus_probe import block_payload
        payload = block_payload(self.run(self.prefix(b)), b)
        try:
            n = parse_snbt(payload)
        except ValueError:
            # Long checklist/book/flight payloads can exceed RCON's response chunk.
            # Read only the fields needed by the interlock and verify their identity twice.
            from campus_probe import read_fields
            n = read_fields(self.run, b, parse_snbt)
        if not isinstance(n, dict) or n.get('id') != 'create:schematicannon':
            raise ValueError('Erwartet: create:schematicannon. Keine Änderung.')
        slots = [i for i in n.get('Inventory', {}).get('Items', []) if type(i.get('Slot')) is int and i['Slot'] == 0]
        item = slots[0] if len(slots) == 1 else {}
        components = item.get('components', {}) if item.get('id') == 'create:schematic' else {}
        printer = n.get('Printer')
        return {'state':n.get('State'), 'status':n.get('Status'), 'amountPlaced':n.get('AmountPlaced'),
                'amountToPlace':n.get('AmountToPlace'), 'printer':printer,
                'flyingBlocks':n.get('FlyingBlockCount', len(n['FlyingBlocks']) if isinstance(n.get('FlyingBlocks'),list) else None),
                'item':item.get('id'), 'components':components, 'options': ({'replace_mode':n['Options'].get('replace_mode'), 'skip_missing':bool(n['Options'].get('skip_missing')), 'replace_block_entities':bool(n['Options'].get('replace_block_entities'))} if isinstance(n.get('Options'),dict) else None), 'at':time.time(),
                'fileHash':self.file_hash(b['owner'], components.get('create:schematic_file'))}

    def file_hash(self, owner, filename):
        if not isinstance(filename, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,180}\.nbt', filename) or '..' in filename:
            return None
        root = (self.base / 'data/schematics/uploaded').resolve()
        path = root / owner / filename
        try:
            if path.is_symlink() or path.parent.is_symlink() or not path.resolve().is_relative_to(root): return None
            if path.stat().st_size > 16*1024*1024: return None
            return hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            return None

    def handle(self, action, obj):
        with self.lock:
            expected = {'probe':{'binding'}, 'bind':{'station','binding','nonce'}, 'discover':{'station','candidate'}, 'inspect':{'station'}, 'apply':{'station','desired'}, 'prepare':{'station','desired','nbtBase64','options','size'}, 'start':{'station','desired','options'}}
            if action not in expected or not isinstance(obj, dict) or set(obj) != expected[action]:
                raise ValueError('Ungültiger Bridge-Auftrag.')
            if action == 'probe':
                b = validate_binding(obj['binding']); observed = self.inspect(b)
                nonce = secrets.token_urlsafe(32)
                self.pending = {k:v for k,v in self.pending.items() if v[0] > time.time()}
                if len(self.pending) > 100: self.pending.clear()
                self.pending[nonce] = (time.time()+120, b)
                return {'binding':b, 'observed':observed, 'nonce':nonce}
            station = obj['station']
            if not isinstance(station, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', station):
                raise ValueError('Ungültiger Stationsname.')
            station = station.lower()
            registry = self.registry()
            if action == 'discover':
                from campus_discovery import discover
                return discover(self, station, obj['candidate'], registry)
            if action == 'bind':
                b = validate_binding(obj['binding'])
                entry = self.pending.pop(obj['nonce'], None)
                if not entry or entry[0] <= time.time() or entry[1] != b:
                    raise ValueError('Probe abgelaufen. Koordinaten erneut prüfen und bestätigen.')
                observed = self.inspect(b)
                if any(k != station and all(v.get(field) == b[field] for field in ('dimension','x','y','z')) for k,v in registry.items()):
                    raise ValueError('Block bereits einer anderen Station zugeordnet.')
                registry[station] = b
                self.save_registry(registry)
                return {'binding':b, 'observed':observed}
            if station not in registry: raise ValueError('Station nicht gebunden. Admin muss Block bestätigen.')
            b = validate_binding(registry[station]); observed = self.inspect(b)
            if action == 'inspect': return {'binding':b, 'observed':observed}
            if action == 'start':
                from campus_start import start
                return start(self, b, obj['desired'], obj['options'], observed)
            if action == 'prepare':
                from campus_schematic import prepare_schematic
                return prepare_schematic(self, b, obj['desired'], obj['nbtBase64'], obj['options'], obj['size'])
            return self.apply(b, obj['desired'], observed)

    def apply(self, b, d, o):
        fields = {'file','sha256','owner','anchor','rotation','mirror','blueprint','version'}
        if not isinstance(d, dict) or set(d) != fields:
            raise ValueError('Ungültige gewünschte Revision.')
        if not isinstance(d['file'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,180}\.nbt', d['file']) or '..' in d['file']:
            raise ValueError('Ungültiger Dateiname.')
        if not isinstance(d['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', d['sha256']): raise ValueError('Ungültiger SHA256.')
        if d['owner'] != b['owner'] or d['rotation'] != 'none' or d['mirror'] != 'none': raise ValueError('Owner/Rotation/Spiegelung stimmt nicht.')
        if type(d['version']) is not int or d['version'] < 1 or not isinstance(d['blueprint'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}', d['blueprint']): raise ValueError('Ungültige Bauplanrevision.')
        if not isinstance(d['anchor'], list) or len(d['anchor']) != 3 or any(type(v) is not int or abs(v)>30000000 for v in d['anchor']): raise ValueError('Ungültiger Anker.')
        if not -64 <= d['anchor'][1] <= 319: raise ValueError('Anker außerhalb der Bauhöhe.')
        c = o.get('components', {})
        if o.get('state') != 'STOPPED' or type(o.get('amountPlaced')) is not int or o['amountPlaced'] != 0 or o.get('amountToPlace') != 0:
            raise ValueError('Nur STOPPED, ungestartet, AmountPlaced=0 und AmountToPlace=0. Im Spiel stoppen und Schematic entnehmen/zurücksetzen; dann erneut versuchen. Kein automatischer Reset.')
        printer = o.get('printer')
        if not isinstance(printer, dict) or any(k in printer for k in ('Anchor','CurrentPos')) or printer.get('DeferredBlocks') != [] or printer.get('EntityProgress') != -1 or printer.get('PrintStage') != 'BLOCKS':
            raise ValueError('Printer enthält Cache oder unbekannten Zustand. Im Spiel zurücksetzen/Schematic entnehmen; kein automatischer Reset.')
        if o.get('item') != 'create:schematic' or c.get('create:schematic_file') != d['file'] or c.get('create:schematic_owner') != d['owner']:
            raise ValueError('Dateiname/Owner des eingelegten Schematic stimmt nicht.')
        if o.get('fileHash') != d['sha256'] or self.file_hash(d['owner'], d['file']) != d['sha256']:
            raise ValueError('Datei-/Revisionshash stimmt nicht. Exakte Campus-Version am Schematic Table hochladen.')
        x,y,z = b['x'],b['y'],b['z']; pos = f'{x} {y} {z}'
        q = lambda s: json.dumps(s, ensure_ascii=True)
        anchor = '[I;' + ','.join(map(str,d['anchor'])) + ']'
        # One server-thread command rechecks block, stopped state, zero counters,
        # uncached printer and exact input identity at the instant of the write.
        guard = '{State:"STOPPED",AmountPlaced:0,AmountToPlace:0,Inventory:{Items:[{Slot:0,id:"create:schematic",components:{"create:schematic_file":'+q(d['file'])+',"create:schematic_owner":'+q(d['owner'])+'}}]}}'
        components = '{"create:schematic_anchor":'+anchor+',"create:schematic_rotation":"none","create:schematic_mirror":"none","create:schematic_deployed":1b}'
        command = (f'execute in {b["dimension"]} if block {pos} create:schematicannon{guard} '
                   f'unless data block {pos} Printer.Anchor unless data block {pos} Printer.CurrentPos '
                   f'run data modify block {pos} Inventory.Items[{{Slot:0,id:"create:schematic"}}].components merge value {components}')
        self.run(command)
        observed = self.inspect(b)
        expected = {'create:schematic_file':d['file'], 'create:schematic_owner':d['owner'], 'create:schematic_anchor':d['anchor'], 'create:schematic_rotation':'none', 'create:schematic_mirror':'none','create:schematic_deployed':1}
        if observed.get('state') != 'STOPPED' or observed.get('amountPlaced') != 0 or observed.get('fileHash') != d['sha256'] or any(observed.get('components',{}).get(k) != v for k,v in expected.items()) or any(k in (observed.get('printer') or {}) for k in ('Anchor','CurrentPos')):
            raise ValueError('Apply-Readback nicht bestätigt; Materialfreigabe bleibt gesperrt. Kein Rollback in aktiven Printer.')
        return {'binding':b, 'observed':observed, 'applied':True}

import hmac


class RequestAuth:
    def __init__(self, secret):
        self.secret = secret
        self.seen = {}
        self.lock = threading.Lock()

    def verify(self, path, headers, body):
        if len(self.secret) < 32 or headers.get('Origin') is not None: return False
        stamp = headers.get('X-Campus-Time', '')
        nonce = headers.get('X-Campus-Nonce', '')
        signature = headers.get('X-Campus-Signature', '')
        if not re.fullmatch(r'[0-9]{10}', stamp) or abs(time.time()-int(stamp))>30 or not re.fullmatch(r'[A-Za-z0-9_-]{32,64}', nonce) or not re.fullmatch('[0-9a-f]{64}', signature): return False
        message = path.encode()+b'\n'+stamp.encode()+b'\n'+nonce.encode()+b'\n'+body
        if not hmac.compare_digest(hmac.new(self.secret.encode(), message, hashlib.sha256).hexdigest(), signature): return False
        with self.lock:
            self.seen = {k:v for k,v in self.seen.items() if v > time.time()}
            if nonce in self.seen or len(self.seen)>10000: return False
            self.seen[nonce] = time.time()+65
        return True


def serve_campus(handler, controller, bridge, auth):
    """Only POSTs here; original controller bearer grants no Campus authority."""
    if handler.path not in ('/campus/probe','/campus/bind','/campus/discover','/campus/inspect','/campus/apply','/campus/prepare','/campus/start'):
        return handler.reply(404, {'error':'Unbekannter Endpunkt.'})
    try:
        length = int(handler.headers.get('Content-Length','0'))
        limit = 24*1024*1024 if handler.path == '/campus/prepare' else 4096
        if not 0 < length <= limit or handler.headers.get('Transfer-Encoding'): raise ValueError('Ungültige Länge.')
        handler.connection.settimeout(5)
        raw = handler.rfile.read(length)
        if not auth.verify(handler.path, handler.headers, raw):
            return handler.reply(401, {'error':'Bridge-Authentifizierung fehlgeschlagen.'})
        def strict(pairs):
            out = {}
            for k,v in pairs:
                if k in out: raise ValueError('Doppelter JSON-Schlüssel.')
                out[k] = v
            return out
        obj = json.loads(raw, object_pairs_hook=strict)
        # Serializes against old controller stop/restart and chat jobs.
        with controller.lock:
            if (controller.base / 'data/.paused').exists(): raise ValueError('Minecraft schläft; kein automatisches Aufwecken.')
            result = bridge.handle(handler.path.rsplit('/',1)[1], obj)
        handler.reply(200, result)
    except (ValueError, TypeError, KeyError):
        import sys
        handler.reply(409, {'error':str(sys.exc_info()[1])})
    except Exception:
        handler.reply(503, {'error':'Live-Bridge offline oder Probe fehlgeschlagen; keine Freigabe.'})
