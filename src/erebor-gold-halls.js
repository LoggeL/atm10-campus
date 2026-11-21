import {Design,stair} from './erebor-design.js';
import {compileErebor} from './erebor-tiles.js';
import {drawHillsideGroves} from './erebor-hillside-groves.js';

const glass='connectedglass:clear_glass_black';
const masonry='minecraft:polished_blackstone_bricks';
const trim='minecraft:chiseled_polished_blackstone';
const gold='minecraft:gold_block';
const candle={name:'minecraft:candle',props:{candles:'4',lit:'true',waterlogged:'false'}};
const rooms={
  E01:'Berghänge · drei lockere Baumgruppen',
  E07:'Thronsaal · Kerzenband vor dem Arkenstein',
  E10:'Schatzhalle · Glasboden und zwei Goldläufe',
  E12:'Große Schmiede · zwei Foundry-Stellplätze und Gussplätze',
  E19:'Königsgalerie · Thrór in der geöffneten Gussform',
};
export const finishId=id=>/^E(?:01|07|10|12|19)_9\d\d$/.test(id);
export const finishRoom=id=>id!=='E01'&&Object.hasOwn(rooms,id);

// y is the player's feet. All ten transparent courses share a level top.
function candleFloor(d,halfWidth,z,end,y,rim=1){
  d.box(-halfWidth-rim,y-12,z-rim,halfWidth+rim,y,end+rim,masonry);
  d.clear(-halfWidth,y-11,z,halfWidth,y-10,end);
  d.box(-halfWidth,y-10,z,halfWidth,y,end,glass);
  const rows=Math.floor((end-z)/8),inset=Math.floor(((end-z)-(rows-1)*8-1)/2);
  for(let row=0;row<rows;row++){
    const zz=z+inset+8*row;
    for(const x of [-halfWidth+1,halfWidth-2])d.p(x,y-11,zz,candle);
  }
}

const channelStart=-1056,basinStart=-940,channelEnd=-935;
const spouts=[-11,10];
function treasure(d){
  const y=-96;
  // The saved spawner and loot chest at world X -608 sit directly below the
  // outer glass here. A flush crosswalk carries the wide bays over their buffer.
  candleFloor(d,7,channelStart+2,-998,y);
  candleFloor(d,7,-985,channelEnd,y);
  d.box(-8,y-1,-998,8,y,-985,masonry);
  candleFloor(d,2,-999,-984,y,0);
  for(const x of spouts){
    // A visible lip by the gold piles falls into a covered, one-block-deep run.
    d.box(x-1,y-3,channelStart-1,x+2,y+1,channelStart+3,masonry);
    d.p(x,y,channelStart,trim);
    d.clear(x,y,channelStart+1,x+1,y+1,channelStart+3);
    d.box(x-1,y-3,channelStart+2,x+2,y,basinStart,masonry);
    d.clear(x,y-2,channelStart+2,x+1,y,basinStart);
    d.box(x,y-1,channelStart+3,x+1,y,basinStart,glass);
    // Close the side walls up to the lip, leaving only the front spillway open.
    for(const wall of [x-1,x+1])d.box(wall,y,channelStart,wall+1,y+2,channelStart+3,trim);
    d.box(x-1,y,channelStart-1,x+2,y+2,channelStart,trim);
    d.box(x-2,y-4,basinStart-1,x+3,y,channelEnd+1,masonry);
    d.clear(x,y-2,basinStart-1,x+1,y-1,basinStart);
    d.clear(x-1,y-3,basinStart,x+2,y-1,channelEnd);
    d.box(x-1,y-1,basinStart,x+2,y,channelEnd,glass);
    d.p(x,y-1,basinStart-1,glass);
    // A short gold-edged stair at the receiving basin, clear of the main aisle.
    const left=x<0?x-7:x+3;
    for(let i=0;i<3;i++){
      d.box(left,y-1,channelEnd-i,left+5,y+i,channelEnd-i+1,masonry);
      d.box(left,y+i,channelEnd-i,left+5,y+i+1,channelEnd-i+1,stair('minecraft:polished_blackstone_brick_stairs','north'));
    }
    d.box(left,y-1,channelEnd-5,left+5,y+3,channelEnd-2,masonry);
    d.box(left,y+2,channelEnd-5,left+5,y+3,channelEnd-4,gold);
  }
}

const forgeCenters=[-318,-295],forgeZ=-628,forgeY=-64;
const pipe='mekanism:basic_mechanical_pipe';
const kingX=-306,kingZ=-1036;
function forge(d){
  const y=forgeY,z=forgeZ;
  for(const [i,x] of forgeCenters.entries()){
    const side=i===0?-1:1;
    // 7 x 7 x 7 reserved, with a full 1-block inspection aisle on each side.
    d.box(x-5,y-1,z-5,x+6,y+1,z+6,masonry);
    d.box(x-3,y,z-3,x+4,y+1,z+4,'minecraft:polished_deepslate');
    for(const a of [x-5,x+5])for(const b of [z-5,z+5]){
      d.box(a,y+1,b,a+1,y+9,b+1,trim);
      d.p(a,y+7,b,'minecraft:shroomlight');
    }
    for(const b of [z-5,z+5])d.box(x-5,y+9,b,x+6,y+10,b+1,masonry);
    for(const a of [x-5,x+5])d.box(a,y+9,z-5,a+1,y+10,z+6,masonry);
    // Open casting apron at the same height as the machines; drain on front (+Z).
    d.box(x-4,y-1,z+6,x+5,y+1,z+9,masonry);
    d.box(x-3,y,z+6,x+4,y+1,z+9,'minecraft:polished_deepslate');
    d.box(x-3,y,z+9,x+4,y+1,z+10,stair('minecraft:polished_blackstone_brick_stairs','north'));
    // Underfloor access for fuel, fluid and item pipes. The front grates lift out.
    const a=Math.min(x,x+side*7),b=Math.max(x,x+side*7);
    d.box(a-1,y-4,z+3,b+2,y,z+6,masonry);
    d.clear(a,y-3,z+4,b+1,y,z+5);
    d.box(a,y,z+4,b+1,y+1,z+5,'minecraft:copper_grate');
    d.p(x+side*7,y-1,z+4,'minecraft:copper_grate');
  }
  // A dedicated intake at the rear wall of the first foundry. Rise between the
  // rooms, then pass below the gallery and above the ceiling of the royal vaults.
  const x=forgeCenters[0],rear=forgeZ-4;
  const route=[[x,forgeY+3,rear],[x,-72,rear],[x,-72,-804],[x,-13,-804],
    [kingX,-13,-804],[kingX,-13,kingZ-9],[kingX,2,kingZ-9]];
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i];
    d.box(...a.map((v,k)=>Math.min(v,b[k])),...a.map((v,k)=>Math.max(v,b[k])+1),pipe);
  }
}

function kingGallery(d){
  const box=(a,y,b,A,Y,B,block)=>d.box(kingX+a,y,kingZ+b,kingX+A,Y,kingZ+B,block);
  const raw='minecraft:raw_gold_block',clamp='minecraft:iron_block';
  box(-10,0,-6,10,2,6,masonry);box(-9,2,-5,9,3,6,trim);
  for(const side of [-1,1]){
    const wing=(a,y,b,A,Y,B,block)=>box(side<0?-A:a,y,b,side<0?-a:A,Y,B,block);
    wing(1,3,-3,6,9,4,gold);wing(1,3,2,7,5,6,gold);
    wing(5,12,-3,9,19,3,gold);wing(6,10,0,9,15,5,gold);
    wing(4,10,3,8,13,6,raw);
    // Stepped cast-iron jaws, stands and bands, opened away from the figure.
    wing(11,0,-6,14,23,-3,masonry);
    for(const y of [4,13,21]){
      wing(10,y,-7,15,y+1,-2,clamp);
      wing(12,y,-2,14,y+1,1,trim);
    }
    wing(2,21,3,4,22,4,'minecraft:gilded_blackstone');
  }
  box(-6,8,-3,6,18,3,gold);box(-7,15,-3,7,19,3,gold);
  box(-5,18,-3,5,24,3,gold);box(-1,20,3,1,23,5,gold);
  for(let i=0;i<5;i++)box(-5+i,17-i,3,5-i,20-i,4+(i%2),raw);
  box(-5,23,-3,5,25,4,gold);
  for(const dx of [-4,0,4])box(dx-1,25,-1,dx+1,dx===0?28:27,2,gold);
  // Open reflecting pool. The shoulder stream is contained on all four sides
  // until it reaches the inlet underneath the front rim of the pool.
  box(-12,-4,6,12,0,18,masonry);box(-11,-3,7,11,0,17,'minecraft:air');
  box(8,-3,4,11,19,7,masonry);box(9,-3,5,10,19,6,'minecraft:air');
  box(9,0,6,10,19,7,glass);box(9,-3,6,10,0,7,'minecraft:air');
  // Receiver pedestal behind the split mould. The line meets its bottom face.
  box(-2,0,-11,3,2,-7,trim);
  d.box(kingX,0,kingZ-9,kingX+1,3,kingZ-8,pipe);
}

export function drawGoldHalls(d){
  d.group='E07';candleFloor(d,2,-720,-630,0);
  d.group='E10';treasure(d);
  d.group='E12';forge(d);
  d.group='E19';kingGallery(d);
}

export function goldHallNotes(plan,group){
  const [ox,oy,oz]=plan.worldOrigin;
  const xyz=(x,y,z)=>[ox+z,oy+y,oz-x-1].join(' / ');
  const order='Innenausbau nach den regulären Raumplänen ausführen. Zuerst die Ausbau-AUSHUB-Dateien, danach die Ausbau-BAU-Dateien von unten nach oben. Koordinaten in X / Y / Z.';
  if(group==='E01')return ['Die drei Baumgruppen am unteren Berghang brauchen 16 Spruce Saplings und 1 Birch Sapling. Nach der Steinfüllung zuerst die Bodentaschen auffüllen, dann die Setzlinge platzieren. An der Kanone nur freie Stellen bebauen.'];
  if(group==='E07')return [order,'Vier Blöcke breites Mittelband aus zehn vollen Glaslagen. Viererkerzen unter dem Glas vor dem Verschließen anzünden, falls die Kanone sie unbeleuchtet setzt.'];
  const transfer='Die erste Foundry bekommt hinten einen zweiten Foundry Drain bei '+xyz(forgeCenters[0],forgeY+3,forgeZ-3)+'. Den angrenzenden Basic Mechanical Pipe mit dem Configurator auf Pull stellen. Einen für geschmolzenes Gold geeigneten Tank bei '+xyz(kingX,3,kingZ-9)+' hinter der Statue auf das Leitungsende setzen. Für den Transport die Leitungs-Chunks laden.';
  if(group==='E19')return [order,'Thrór mit Krone, gestuftem Bart und den zwei geöffneten Hälften der Gussform. Den sichtbaren Goldstrang mit einem Bucket of Molten Gold oben in den Schacht bei '+xyz(kingX+9,18,kingZ+5)+' setzen. Das Gold fällt bis zur Beckensohle. Zusätzliche Quellen im Becken nach Geschmack.',transfer,'Die statische Filmkulisse funktioniert unabhängig vom Produktionsanschluss. E12 und E19 zusammen bauen, um die Leitung zu vervollständigen.'];
  if(group==='E12')return [order,transfer,...forgeCenters.map((x,i)=>'Foundry '+(i+1)+': Mitte der Heizspulenebene '+xyz(x,forgeY+1,forgeZ)+', Stellfläche 7 × 7, bis 7 Blöcke hoch. Drain '+xyz(x,forgeY+3,forgeZ+3)+', Tap '+xyz(x,forgeY+3,forgeZ+4)+', Casting Basin oder Casting Table '+xyz(x,forgeY+2,forgeZ+4)+'.'), 'Heizspulen, Wände, Controller, Brennstofftank, Drain und Tap selbst einsetzen. Am Gussplatz ist Platz für die echte Metallausgabe. Kupfergitter über dem Technikkanal für Flüssigkeits- und Itemleitungen abnehmen. Die Dekorinnen in der Schatzhalle werden separat mit Eimern befüllt.'];
  const last=basinStart-2,first=channelStart+6;
  const sourceOffsets=[];for(let z=first;z<last;z+=5)sourceOffsets.push(ox+z);sourceOffsets.push(ox+last);
  return [order,'Viererkerzen und zehn Lagen Clear Black Stained Glass im Mittelgang. Die zwei Rinnen sind separat und haben jeweils eine Glasabdeckung.',
    'Erst die Einfassung fertigstellen. In jeder Rinne eine Goldquelle auf die Auslasslippe setzen: '+spouts.map(x=>xyz(x,-95,channelStart)).join(' und ')+'.',
    'Für durchgehenden Fluss die markierten Quellpositionen unter dem Glas mit Bucket of Molten Gold befüllen. Glas darüber kurz abnehmen und wieder einsetzen. Welt-X je Rinne: '+sourceOffsets.join(', ')+'; Y '+(oy-98)+'; Z '+spouts.map(x=>oz-x-1).join(' oder ')+'. In beiden Endbecken bei '+spouts.map(x=>xyz(x,-99,basinStart+2)).join(' und ')+' eine Quelle setzen.'];
}

export function finishingScene(plan,base){
  const d=new Design(plan);
  drawGoldHalls(d);
  drawHillsideGroves(d);
  for(const op of base.ops.filter(o=>o.g==='PROTECTED'))d.ops.push({...op,s:d.state('minecraft:structure_void')});
  const scene=compileErebor(plan,d);
  for(const p of scene.packages){
    p.id=p.group+'_'+(900+Number(p.id.split('_')[1]));
    p.title=rooms[p.group];p.finishing=true;p.notes=goldHallNotes(plan,p.group);
  }
  return scene;
}
