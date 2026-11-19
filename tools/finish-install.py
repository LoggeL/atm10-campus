"""Install selected, physically verified Erebor expansion groups on the Homebox."""
import argparse
import ast
import fcntl
import json
import os
from pathlib import Path
import provision

HERE=Path(__file__).resolve().parent
CONFIG="finishing-groups.json"
TAG="# Campus: zusätzliche Schlussausbau-Gruppen"
TRACKER="// Campus: zusätzliche Schlussausbau-Gruppen"
HOOK="""
_before_finish_groups = handle
def handle(bridge, action, obj):
    key = obj.get('site') if isinstance(obj,dict) else None
    if isinstance(key,str) and key in _finish_keys:
        from campus_erebor_finishing import handle as finish_handle
        return finish_handle(bridge,action,obj,finishing=_finish_catalog)
    return _before_finish_groups(bridge,action,obj)
"""
TRACK="""
  var finishCatalog = JsonIO.read('kubejs/config/finishing-groups.json')
  if (finishCatalog && finishCatalog.version === survey.version) {
    finishCatalog.sites.forEach(function (s) {
      s.groups.forEach(function (g) {
        Object.keys(g.slots).forEach(function (slot) {
          stations.push({site:s.site+slot,pos:position(g.slots[slot]),chest:g.chest,
            feeder:g.computer,label:'erebor-'+g.name,active:false,lastError:-1200})
        })
      })
    })
  }
"""
PROBE="""
 var finishNetwork = JsonIO.read('kubejs/config/finishing-groups.json');
 if(finishNetwork && finishNetwork.version===survey.version)finishNetwork.sites.forEach(function(s){
   if(s.rise.length){var node=probe(s.bridge);s.groups.forEach(function(g){result.stations[g.name]=node;});}
 });
"""

def tracker_source(original):
    anchor="  // END campus expansion groups"
    network="survey.sites.forEach(function(s){result.stations[s.site]=probe(s.bridge);});"
    if TRACKER in original:
        if TRACK not in original or PROBE not in original:
            raise ValueError("Abweichender vorhandener Ausbau-Tracker.")
        return original
    if original.count(anchor)!=1 or original.count(network)!=1:
        raise ValueError("Installierter Neunerbetrieb oder ME-Netzprobe nicht erkannt.")
    return original.replace(anchor,anchor+"\n  "+TRACKER+TRACK).replace(network,network+PROBE)

def controller_source(original):
    suffix="\n\n"+TAG+"\nfrom pathlib import Path as _FinishPath\nimport json as _finish_json\n_finish_catalog=_finish_json.loads(_FinishPath(__file__).with_name('finishing-groups.json').read_text())\n_finish_keys={key for s in _finish_catalog['sites'] for g in s['groups'] for key in [g['name'],*(s['site']+slot for slot in g['slots'])]}\n"+HOOK
    if TAG in original:
        if original.count(suffix)!=1:raise ValueError("Abweichender Ausbau-Einstiegspunkt.")
        return original
    if provision.HOOK not in original or not any(isinstance(n,ast.FunctionDef) and n.name=="handle" for n in ast.parse(original).body):
        raise ValueError("Vorhandener Controller für den Neunerbetrieb fehlt.")
    return original+suffix

def prepare(args,base,layout,pairs):
    plan=provision.read_json(HERE/CONFIG)
    existing={s["site"]:s for s in layout["sites"]}
    catalog={s["site"]:s for s in plan["sites"]}
    wanted=set(args.sites.split(',')) if args.sites else set(catalog)
    if not wanted<=catalog.keys() or not wanted or plan["version"]!=layout["version"] or pairs["version"]!=layout["version"]:
        raise ValueError("Standortauswahl oder Projektversion ungültig.")
    host=base/"discord"
    kube=base/"data/kubejs"
    prior=set()
    for file in [host/CONFIG,kube/"config"/CONFIG]:
        if file.exists():
            old=provision.read_json(file)
            if old.get("version")!=plan["version"] or any(catalog.get(s["site"])!=s for s in old["sites"]):
                raise ValueError("Abweichende bereits installierte Standortkonfiguration.")
            prior.update(s["site"] for s in old["sites"])
    groups=[]
    for site in plan["sites"]:
        name=site["site"]
        if name not in wanted:continue
        if existing[name]["bridge"]!=site["baseBridge"]:raise ValueError(name+": bestehende ME-Bridge wurde versetzt.")
        for g in site["groups"]:
            if provision.distance(g["computer"],g["bridge"])!=1 or provision.distance(g["computer"],g["chest"])!=1 or any(provision.distance(p,g["chest"])!=1 for p in g["slots"].values()):
                raise ValueError(name+": Gruppe nicht direkt verbunden.")
            groups.append({**existing[name],**g,"site":g["name"],"parent":name,"cannon":next(iter(g["slots"].values())),"computerBlock":"computercraft:computer_advanced","inventoryBlock":"minecraft:chest"})
    wire=json.dumps({**plan,"sites":[s for s in plan["sites"] if s["site"] in prior|wanted]},ensure_ascii=False,sort_keys=True).encode()
    controller=host/"campus_erebor.py"
    script=kube/"server_scripts/campus/erebor-target-chunks.js"
    module=host/"campus_erebor_finishing.py"
    payload=(HERE/module.name).read_bytes()
    if module.exists() and module.read_bytes()!=payload:raise ValueError("Abweichender vorhandener Zusatzcontroller.")
    changes=[]
    for path,new in [(host/CONFIG,wire),(kube/"config"/CONFIG,wire),(module,payload),
                     (controller,controller_source(controller.read_text(encoding="utf8")).encode()),(script,tracker_source(script.read_text(encoding="utf8")).encode())]:
        if path.resolve()!=path or not path.parent.is_dir():raise ValueError("Unerwarteter Hostpfad.")
        old=path.read_bytes() if path.exists() else None
        if path.suffix==".py":compile(new,str(path),"exec")
        if new!=old:changes.append((path,old,new,path.stat().st_mode&0o777 if old is not None else 0o644))
    return groups,changes

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["check","install"])
    parser.add_argument("--sites",help="Kommagetrennte Standorte, z. B. K19,K25. Standard: alle acht.")
    parser.add_argument("--base",type=Path,default=Path.home()/"minecraft/atm10")
    parser.add_argument("--container")
    parser.add_argument("--wait",type=int,default=600)
    args=parser.parse_args()
    if args.wait<10:parser.error("--wait mindestens 10 Sekunden")
    root=args.base.resolve()
    lock=os.open(root/"discord",os.O_RDONLY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        provision.run(args,root,prepare)
    finally:os.close(lock)
