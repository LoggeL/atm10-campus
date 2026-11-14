"""Build the shared coordinate list and the self-contained Homebox release."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets'
FLEET = ROOT / 'src/erebor-fleet'
KUBE_V2 = '6c0a4fc8f89df823fea8be1bb8cfd454162a7e1d6a7e4e193212f16c94b82b91'
SURVEY = json.loads((FLEET / 'stations.json').read_bytes())


def plan(row):
    x, y, z = row['cannon']
    occupied = {tuple(row[key]) for key in ('cannon', 'chest', 'computer', 'bridge', 'connector')}
    choices = []
    for dx in range(-6, 7):
        for dz in range(-6, 7):
            a = (x+dx, y, z+dz)
            b = (a[0]+1, y, a[2]+1)
            stone = (b[0], y, a[2])
            powder = (a[0], y, b[2])
            blocks = (a, b, stone, powder)
            if any(p[0]//16 != x//16 or p[2]//16 != z//16 for p in blocks):
                continue
            # Leave a walkway on all sides of the existing installation, including its cable.
            gap = min(abs(p[0]-q[0])+abs(p[2]-q[2]) for p in blocks for q in occupied)
            if gap < 3:
                continue
            choices.append((max(dx*dx+dz*dz, (dx+1)**2+(dz+1)**2), blocks))
    a,b,stone,powder = min(choices)[1]
    return dict(site=row['site'], main=row['cannon'], B=a, C=b, stone=stone, powder=powder)


def digest(raw):
    return hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest()


def build():
    rows = [plan(s) for s in SURVEY['sites']]
    layout = json.dumps(dict(version=SURVEY['version'], sites=rows), separators=(',', ':')).encode()
    (FLEET/'parallel.json').write_bytes(layout+b'\n')
    table = ['# Erebor · Zusatzkanonen', '', 'Alle Positionen in X / Y / Z. B und C stehen diagonal. Die beiden anderen Ecken sind EnderStorage-Kisten mit getrennten Frequenzen für Stein und Schießpulver.', '', '| Standort | Kanone B | Kanone C | Steinkiste | Pulverkiste |', '|---|---|---|---|---|']
    for row in rows:
        table.append('| '+' | '.join([row['site']]+[' / '.join(map(str,row[k])) for k in ('B','C','stone','powder')])+' |')
    (FLEET/'Zusatzkanonen.md').write_text('\n'.join(table)+'\n', encoding='utf-8')
    with ZipFile(ASSETS/'erebor-controller-material-v2.zip') as z:
        prior=json.loads(z.read('manifest.json'))
    files = {name:(ROOT/'controller'/name).read_bytes() for name in prior}
    files['erebor-target-chunks.js']=(ROOT/'controller/kubejs/erebor-target-chunks.js').read_bytes()
    files['erebor-parallel.json']=layout+b'\n'
    manifest={k:dict(new=digest(v),old=prior[k]['old']+[prior[k]['new']] if k in prior else []) for k,v in files.items()}
    manifest['erebor-target-chunks.js']['old']=[KUBE_V2]
    with ZipFile(ASSETS/'erebor-parallel-v3.zip','w',ZIP_DEFLATED) as z:
        for k,v in files.items():
            z.writestr(k,v)
        z.writestr('manifest.json',json.dumps(manifest))
        z.write(ROOT/'tools/install-erebor-parallel.py','install.py')
        z.write(FLEET/'Zusatzkanonen.md','Zusatzkanonen.md')
        z.write(FLEET/'Dreierbetrieb.md','Anleitung.md')


if __name__=='__main__':
    build()
