#!/usr/bin/env python3
"""Install only the read wrapper, preserving all existing controller variants.

This never restarts Minecraft, touches world state or changes permissions.
Restart only the existing user controller after installing and verify a signed
erebor-live report. A missing/malformed watercity file leaves legacy data intact.
"""
import argparse
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

HOOK = b'\n\n# Optional observation only; no new dispatch or material permissions.\nfrom campus_watercity import with_watercity as _with_watercity\nhandle = _with_watercity(handle)\n'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data, mode):
    handle, name = tempfile.mkstemp(prefix='.watercity-read-', dir=path.parent)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controller-dir', required=True, type=Path)
    parser.add_argument('--expected-erebor-sha256', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    target = args.controller_dir / 'campus_erebor.py'
    module = args.controller_dir / 'campus_watercity.py'
    original = target.read_bytes()
    if digest(original) != args.expected_erebor_sha256:
        parser.error('installed controller differs; no write performed')
    if b'from campus_watercity import' in original or module.exists():
        parser.error('watercity module/hook already exists; reconcile before changing it')
    source = Path(__file__).resolve().parents[1] / 'controller/campus_watercity.py'
    payload = source.read_bytes()
    changed = original + HOOK
    compile(changed, str(target), 'exec')
    compile(payload, str(module), 'exec')
    result = {'dryRun': not args.apply, 'oldEreborSha256': digest(original),
              'newEreborSha256': digest(changed), 'moduleSha256': digest(payload),
              'restartUserControllerOnly': True}
    if args.apply:
        if target.stat().st_uid != os.getuid():
            parser.error('run as the existing controller owner; no ownership changes')
        backup = target.with_name('campus_erebor.py.before-watercity-read-' + str(time.time_ns()))
        shutil.copy2(target, backup)
        if target.read_bytes() != original or backup.read_bytes() != original:
            parser.error('concurrent controller change; no replacement performed')
        atomic(module, payload, 0o644)
        atomic(target, changed, target.stat().st_mode & 0o777)
        result['backup'] = str(backup)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
