from hashlib import sha256
from html import escape
import json
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'public/assets'
CONFIG='src/erebor-fleet/finishing-groups.json'
NAME='erebor-schlussausbau.zip'

def build():
    plan=json.loads((ROOT/CONFIG).read_text(encoding='utf8'))
    source=lambda path:(ROOT/path).read_text(encoding='utf8')
    lua=source('public/cc/campus.lua').replace('-- EMBED_EREBOR_ME_WORKER',source('public/assets/erebor-chisel-order.lua')).replace('-- EMBED_EREBOR_POWDER',source('public/cc/erebor-powder.lua'))
    files={'install.py':source('tools/finish-install.py'),'provision.py':source('tools/expansion-install.py'),
           'fleet.py':source('src/erebor-fleet/install.py'),'campus_erebor_finishing.py':source('controller/campus_erebor.py'),
           'campus.lua':lua,'finishing-groups.json':source(CONFIG)}
    coord=lambda p:' / '.join(map(str,p))
    coordinates=['Standort;Gruppe;Block;X;Y;Z']
    for s in plan['sites']:
        for obj,point in [('Bestehende ME-Bridge',s['baseBridge']),('Vorhandenes ME-Kabel',s['cable']),('Gruppen-Bridge',s['bridge']),*[('Neues ME-Kabel',p) for p in s['rise']]]:
            coordinates.append(';'.join([s['site'],'',obj,*map(str,point)]))
        for g in s['groups']:
            for obj,point in [('Advanced Computer',g['computer']),('Einzelkiste',g['chest']),*g['slots'].items()]:
                coordinates.append(';'.join([s['site'],g['name'],obj,*map(str,point)]))
    files['KOORDINATEN.csv']='\n'.join(coordinates)+'\n'
    files['ANLEITUNG.txt']='X / Y / Z. Erst alle Blöcke der gewählten Standorte aufstellen. K12, K24, K27 und K29: vier zusätzliche ME-Glaskabel senkrecht über das vorhandene ME-Kabel setzen und eine zweite ME-Bridge daneben auf +4 anschließen; freier AE2-Kanal erforderlich. Pro Rechner eine separate Einzelkiste (Holzkiste oder Oak Netherite Chest) und drei Kanonen an den angegebenen Kistenseiten. Bestehende Funkverbindungen weiterbenutzen. Auf der Homebox nach dem physischen Aufbau: python3 install.py check --sites K19,K25 && python3 install.py install --sites K19,K25. Ohne --sites werden alle acht ausgewählt. Der Installer aktualisiert den Benutzerdienst, lädt den KubeJS-Tracker neu und prüft pro Kanone zwei Bauzähler.\n'
    with ZipFile(ASSETS/NAME,'w') as z:
        for name,content in sorted(files.items()):
            entry=ZipInfo(name,(2026,11,19,0,0,0));entry.external_attr=0o100644<<16;entry.create_system=3
            z.writestr(entry,content.encode(),compress_type=ZIP_DEFLATED)
    digest=sha256((ASSETS/NAME).read_bytes()).hexdigest()
    command=f"""set -eu
ausbau_dir="$(mktemp -d)"
cd "$ausbau_dir"
curl -fsSLo {NAME} https://campus.logge.top/assets/{NAME}
echo '{digest}  {NAME}' | sha256sum -c -
unzip -q {NAME}
python3 install.py check --sites K19,K25
python3 install.py install --sites K19,K25"""
    title='Erebor · Zusätzliche Dreiergruppen'
    page=[f'<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><link rel="stylesheet" href="/assets/app.css"><main><a href="/app?project=erebor#overview">Zurück zu Erebor</a><h1>{title}</h1>',
      '<p>36 geplante Kanonen, 12 neue Stationscomputer und 12 einzelne Materialkisten. Beginne mit K19 und K25. Die vier erhöhten Gruppenstandorte brauchen jeweils eine zusätzliche ME-Bridge und vier ME-Glaskabel. Alle Koordinaten stehen in der Reihenfolge X / Y / Z.</p>',
      f'<p>Restarbeit laut Campus am {escape(plan["capturedAt"][:10])} um {escape(plan["capturedAt"][11:16])} UTC. Die Blockzahl umfasst die vollständige Größe der noch offenen und laufenden automatisch baubaren Massivpläne. Nachbarstandorte können freie Aufträge übernehmen. <a href="/erebor/dashboard">Aktuellen Baufortschritt öffnen</a></p>',
      '<p>Der Computer berührt die Bridge und die eigene Kiste. Alle drei Kanonen berühren dieselbe Kiste. Eine zusätzliche Bridge sitzt vier Blöcke über der vorhandenen. Das Glaskabel steigt von der vorhandenen Kabelseite auf. Jeder zusätzlichen Bridge einen freien AE2-Kanal geben.</p>']
    for s in plan['sites']:
        num=len(s['groups'])*3
        page.append(f'<details><summary><strong>{s["site"]}</strong> · {s["existing"]} → {s["existing"]+num} Kanonen · {s["parts"]} Pläne · {s["gross"]:,} Blöcke</summary><p>Bestehende Bridge {coord(s["baseBridge"])} · vorhandenes Kabel {coord(s["cable"])}.</p>'.replace(',','.'))
        if s['rise']:page.append('<p>Neue Bridge <b>'+coord(s['bridge'])+'</b>. Neue Kabel von '+coord(s['rise'][0])+' bis '+coord(s['rise'][-1])+'.</p>')
        page.append('<div class="table-wrap"><table><thead><tr><th>Gruppe</th><th>Advanced Computer</th><th>Einzelkiste</th><th>Kanonen</th></tr></thead><tbody>')
        for g in s['groups']:
            slots='<br>'.join(f'{s["site"]}{k} · {coord(v)}' for k,v in g['slots'].items())
            page.append(f'<tr><th>{g["name"]}</th><td>{coord(g["computer"])}</td><td>{coord(g["chest"])}</td><td>{slots}</td></tr>')
        page.append('</tbody></table></div></details>')
    page+=['<h2>Homebox-Installation für Logge</h2>',f'<p><a download href="{NAME}">Sammelinstaller mit Koordinatenliste (ZIP)</a>. Auf der Homebox als Besitzer des Benutzerdienstes ausführen, sobald die ausgewählten Standorte aufgebaut sind. Für andere Standorte beide <code>--sites</code>-Listen anpassen. Für alle acht Standorte <code>--sites K19,K25</code> in beiden Befehlen weglassen.</p><pre>'+escape(command)+'</pre></main></html>']
    (ASSETS/'erebor-ausbau-final.html').write_text('\n'.join(page),encoding='utf8')

if __name__=='__main__':build()
