"""Build the shared coordinate list and the self-contained Homebox release."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets'
FLEET = ROOT / 'src/erebor-fleet'
KUBE_V2 = '6c0a4fc8f89df823fea8be1bb8cfd454162a7e1d6a7e4e193212f16c94b82b91'
KUBE_V4 = '1f16317c21f9647daa1434cadfcbddcd56c20e9cb77a4deea0b3da5f9ec3c5cb'
SURVEY = json.loads((FLEET / 'stations.json').read_bytes())


def plan(row):
    x,y,z=row['chest']
    occupied={tuple(row[k]) for k in ('cannon','computer','bridge','connector')}
    positions=[]
    for dx,dy,dz in ((-1,0,0),(1,0,0),(0,0,-1),(0,0,1),(0,-1,0),(0,1,0)):
        p=(x+dx,y+dy,z+dz)
        if p not in occupied and (p[0]//16,p[2]//16)==(x//16,z//16):
            positions.append(p)
    return dict(site=row['site'],main=row['cannon'],B=positions[0],C=positions[1],chest=row['chest'])


def digest(raw):
    return hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest()


def build():
    rows = [plan(s) for s in SURVEY['sites']]
    layout = json.dumps(dict(version=SURVEY['version'], sites=rows), separators=(',', ':')).encode()
    (FLEET/'parallel.json').write_bytes(layout+b'\n')
    table = ['# Erebor · drei Kanonen an einer Kiste', '', 'Alle Positionen in X / Y / Z. A und die Kiste stehen bereits. Nur B und C aufstellen. Bei K09 steht C direkt unter der Kiste, damit sie im Stationschunk bleibt.', '', '| Standort | A (vorhanden) | B (neu) | C (neu) | Materialkiste (vorhanden) |', '|---|---|---|---|---|']
    for row in rows:
        table.append('| '+' | '.join([row['site']]+[' / '.join(map(str,row[k])) for k in ('main','B','C','chest')])+' |')
    (FLEET/'Zusatzkanonen.md').write_text('\n'.join(table)+'\n', encoding='utf-8')
    with ZipFile(ASSETS/'erebor-controller-material-v2.zip') as z:
        prior=json.loads(z.read('manifest.json'))
    files = {name:(ROOT/'controller'/name).read_bytes() for name in prior}
    files['erebor-target-chunks.js']=(ROOT/'controller/kubejs/erebor-target-chunks.js').read_bytes()
    files['erebor-parallel.json']=layout+b'\n'
    manifest={k:dict(new=digest(v),old=prior[k]['old']+[prior[k]['new']] if k in prior else []) for k,v in files.items()}
    manifest['erebor-target-chunks.js']['old']=[KUBE_V2,KUBE_V4]
    with ZipFile(ASSETS/'erebor-parallel-v3.zip') as z:
        v3=json.loads(z.read('manifest.json'))
    for name,spec in manifest.items():
        spec['old']=sorted(set(spec['old']+[v3[name]['new']]))
    with ZipFile(ASSETS/'erebor-shared-v4.zip') as z:
        previous=json.loads(z.read('manifest.json'))
    for name,spec in manifest.items():
        spec['old']=sorted(set(spec['old']+previous[name]['old']+[previous[name]['new']]))
    with ZipFile(ASSETS/'erebor-shared-v5.zip','w',ZIP_DEFLATED) as z:
        for k,v in files.items():
            z.writestr(k,v)
        z.writestr('manifest.json',json.dumps(manifest))
        z.write(ROOT/'tools/install-erebor-parallel.py','install.py')
        z.write(FLEET/'Zusatzkanonen.md','Zusatzkanonen.md')
        z.write(FLEET/'Dreierbetrieb.md','Anleitung.md')


if __name__=='__main__':
    build()
