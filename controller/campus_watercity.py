"""Optional read-only Watercity snapshot on the existing authenticated report.

No RCON, registry access, leases, tickets or Minecraft/SQLite writes. Installed
watercity-runtime.js remains the only owner of its native observation files.
"""
import json
import time

SLOTS = frozenset(('P01A', 'P01B', 'P01C', 'P03A', 'P03B', 'P03C'))


def _read(path):
    if path.stat().st_size > 131072:
        raise ValueError('oversized watercity snapshot')
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError('invalid watercity snapshot')
    return data


def with_watercity(original, *, clock=lambda: time.time() * 1000):
    def handle(bridge, action, obj, **kwargs):
        result = original(bridge, action, obj, **kwargs)
        if action != 'erebor-live':
            return result
        try:
            folder = bridge.base / 'data/kubejs/config'
            manifest = _read(folder / 'watercity-active.json')
            live = _read(folder / 'watercity-live.json')
            if manifest.get('version') != obj.get('version'):
                raise ValueError('watercity project version differs')
            at = live.get('at')
            if not isinstance(at, (int, float)) or not 0 <= clock() - at < 45000:
                raise ValueError('watercity snapshot is stale')
            if live.get('batch') not in (None, manifest.get('id')):
                raise ValueError('watercity batch differs')
            stations = live.get('stations', {})
            jobs = manifest.get('jobs', [])
            groups = live.get('groups', {})
            if not isinstance(stations, dict) or not isinstance(groups, dict) or not isinstance(jobs, list) or len(jobs) > 6:
                raise ValueError('invalid watercity slots')
            snapshot = {'schema': 1, 'version': manifest['version'], 'at': at,
                        'batch': manifest.get('id'), 'expires': manifest.get('expires'),
                        'state': 'observed', 'error': live.get('error'),
                        'jobs': [j for j in jobs if isinstance(j, dict) and j.get('key') in SLOTS],
                        'stations': {k: v for k, v in stations.items() if k in SLOTS},
                        'groups': live.get('groups', {}), 'supply': {}}
            for site, computer in (('P01', 92), ('P03', 93)):
                try:
                    disk = bridge.base / 'data/world/computercraft/computer' / str(computer)
                    report = _read(disk / '.watercity-supply-report.json')
                    if report.get('computerId') == computer:
                        snapshot['supply'][site] = report
                except (OSError, ValueError, TypeError):
                    pass  # Missing CC observations remain unknown, never zero.
            return {**result, 'watercity': snapshot}
        except (OSError, ValueError, TypeError, KeyError):
            return {**result, 'watercity': {'schema': 1, 'state': 'unavailable'}}
    return handle
