"""Fail-closed K12 DEF dispatch state, owned by the serialized signed controller.

All grants originate from the application after its persisted reservation checks.
Restart discards grants, challenges and evidence. No credential or CC-reported
count alone grants dispatch. Native identity/count readbacks are caller duties.
"""
import copy
import secrets
import time


def chest_count(bridge, position):
    """Exact native ordinary single-chest snapshot, never omission-as-zero.

    SophisticatedStorage is deliberately unsupported until its installed native
    inventory encoding is verified. Truncated/foreign RCON replies fail closed.
    """
    from campus_probe import block_payload
    from campus_cannon import parse_snbt
    binding = dict(zip('xyz',position))
    raw = bridge.run('execute in minecraft:overworld run data get block '+ ' '.join(map(str,position)))
    block = parse_snbt(block_payload(raw,binding))
    if not isinstance(block,dict) or block.get('id') != 'minecraft:chest' or not isinstance(block.get('Items'),list):
        raise ValueError('Nicht unterstütztes Lieferinventar.')
    count, slots = 0, set()
    for item in block['Items']:
        if (not isinstance(item,dict) or type(item.get('Slot')) is not int or not 0 <= item['Slot'] < 27
                or item['Slot'] in slots or type(item.get('count')) is not int or not 0 < item['count'] <= 64):
            raise ValueError('Ungültiger Inventar-Readback.')
        slots.add(item['Slot'])
        if item.get('id') == 'minecraft:stone':
            if item.get('components'):
                raise ValueError('Nicht kanonischer Cleanstone.')
            count += item['count']
    return count


class DispatchArbiter:
    def __init__(self, clock=lambda: int(time.time()*1000)):
        self.clock = clock
        self.grant_data = None
        self.challenge = None
        self.evidence = None
        self.lease = None

    def _binding(self, obj):
        return {k:obj[k] for k in ('site','group','version','computerId','chestSide')}

    def _current(self, binding=None):
        g = self.grant_data
        if not g or not 0 < g['expiresAt']-self.clock() <= 8000:
            raise ValueError('Pilotfreigabe abgelaufen.')
        if binding is not None and self._binding(binding) != self._binding(g):
            raise ValueError('Pilotbindung geändert.')
        return g

    def grant(self, obj):
        if (set(obj) != {'site','group','version','computerId','chestSide','jobs','expiresAt'}
                or obj['site'] != 'K12' or obj['group'] != 'DEF'
                or type(obj['version']) is not int or obj['version'] < 1
                or type(obj['computerId']) is not int or obj['computerId'] < 0
                or obj['chestSide'] not in ('front','back','left','right','top','bottom')
                or type(obj['expiresAt']) is not int or not 0 < obj['expiresAt']-self.clock() <= 8000
                or not isinstance(obj['jobs'],dict) or set(obj['jobs']) != {'K12'+s for s in 'DEF'}):
            raise ValueError('Ungültige vollständige Pilotfreigabe.')
        files = []
        for j in obj['jobs'].values():
            if not isinstance(j,dict) or set(j) != {'desired','size'} or not isinstance(j['desired'],dict):
                raise ValueError('Ungültiger Pilotauftrag.')
            files.append(j['desired'].get('file'))
        if any(not isinstance(f,str) or not f for f in files) or len(set(files)) != 3:
            raise ValueError('Doppelter Pilotauftrag.')
        old = self.grant_data
        if not old or any(old.get(k) != obj[k] for k in obj if k != 'expiresAt'):
            self.challenge = self.evidence = self.lease = None
        self.grant_data = copy.deepcopy(obj)
        return {'authorized':True,'expiresAt':obj['expiresAt']}

    def begin(self, binding, native_count, cap):
        self._current(binding)
        if type(native_count) is not int or native_count < 0 or type(cap) is not int or not 0 < cap <= 192 or native_count+cap > 192:
            raise ValueError('Ungültige Liefermenge.')
        if self.challenge and self.challenge['expiresAt'] > self.clock():
            raise ValueError('Lieferung bereits offen.')
        c = dict(id=secrets.token_hex(24),before=native_count,cap=cap,
                 expiresAt=min(self.clock()+8000,self.grant_data['expiresAt']))
        self.challenge = c
        return copy.deepcopy(c)

    def commit(self, binding, challenge, receipt, native_count):
        self._current(binding)
        c = self.challenge
        # Consume before evaluating: ambiguous or failed attempts never replay.
        self.challenge = None
        if (not c or not isinstance(challenge,str) or not secrets.compare_digest(c['id'],challenge)
                or self.clock() >= c['expiresAt'] or not isinstance(receipt,dict)
                or set(receipt) != {'before','after','exported'}
                or any(type(v) is not int for v in receipt.values())
                or receipt['before'] != c['before'] or receipt['after'] != native_count
                or not 0 < receipt['exported'] <= c['cap']
                or native_count-c['before'] != receipt['exported']):
            raise ValueError('Lieferung nicht nativ bestätigt.')
        self.evidence = dict(at=self.clock(),expiresAt=self.grant_data['expiresAt'])
        return {'verified':True,'at':self.clock()}

    def renew(self, lease):
        # Publication is independently validated by the native lease publisher.
        self.lease = copy.deepcopy(lease)

    def proof(self):
        g = self._current()
        jobs = {k:dict(file=j['desired']['file'],anchor=j['desired']['anchor'],size=j['size'],options=[2,False,False]) for k,j in g['jobs'].items()}
        if not self.evidence or not self.clock() < self.evidence['expiresAt']:
            return None
        return {'verified':True,'jobs':jobs,'at':self.evidence['at']}

    def authorize(self, action, obj):
        try:
            g = self._current()
            j = g['jobs'].get(obj.get('site'))
            if (obj.get('version') != g['version'] or not j
                    or j != {k:obj.get(k) for k in ('desired','size')}):
                return False
            if action == 'erebor-prepare':
                return True
            p = self.proof()
            return bool(action == 'erebor-start' and p and self.lease
                        and self.clock() < self.lease['expiresAt']
                        and self.lease['jobs'] == p['jobs'])
        except (ValueError,KeyError,TypeError):
            return False
