// Erebor architecture, revision 3. Integer, half-open cuboids; local +Z faces east.
// Empty cells are excavation intent, NEVER implicitly part of a placement file.
import {gunzipSync} from 'node:zlib';
import {appendExpandedInterior,appendExpandedOps,addExpansion,interiorBasis} from './erebor-expansion.js';

import {balanceRooms,centeredStarts} from './erebor-symmetry.js';

export const DESIGN_REVISION=3;
export const M={stone:'minecraft:stone_bricks',smooth:'chipped:smooth_stone_bricks',pillar:'create:polished_cut_tuff',dark:'rechiseled:blackstone_tiles_connecting',jade:'rechiseled:dark_prismarine_large_tiles_connecting',green:'rechiseledcreate:veridium_cut_polished_connecting',rune:'chipped:runic_carved_dark_prismarine',gold:'rechiseled:gold_block_polished_connecting',light:'chipped:inlayed_glowstone',black:'create:polished_cut_deepslate',wood:'minecraft:spruce_planks',log:'minecraft:stripped_spruce_log',roof:'minecraft:deepslate_tiles',glass:'minecraft:light_gray_stained_glass',air:'minecraft:air'};
export const stair=(name='minecraft:stone_brick_stairs',facing='north')=>({name,props:{facing,half:'bottom',shape:'straight',waterlogged:'false'}});
export const slab=(name='minecraft:stone_brick_slab',type='bottom')=>({name,props:{type,waterlogged:'false'}});
export class Design {
 constructor(plan){this.plan=plan;this.ops=[];this.palette=[{name:'minecraft:air',props:{}}];this.states=new Map([['minecraft:air',0]]);this.group='E29';this.stairChecks=[];this.rooms=[];this.routes=[];this.features=[];}
 state(block){if(typeof block==='string')block={name:block,props:{}};const key=block.name+JSON.stringify(block.props||{});if(this.states.has(key))return this.states.get(key);const n=this.palette.length;this.states.set(key,n);this.palette.push(block);return n;}
 box(x,y,z,X,Y,Z,block){const a=[x,y,z],b=[X,Y,Z];if(a.some((v,i)=>!Number.isSafeInteger(v)||!Number.isSafeInteger(b[i])))throw Error('Non-integer design');if(a.some((v,i)=>v>=b[i]))return;this.ops.push({a,b,s:block===M.air?0:this.state(block),g:this.group});}
 p(x,y,z,b){this.box(x,y,z,x+1,y+1,z+1,b);}
 clear(...bounds){this.box(...bounds,M.air);}
 floor(x,z,X,Z,y,wood=false){this.box(x,y-3,z,X,y-1,Z,wood?M.log:M.dark);this.box(x,y-1,z,X,y,Z,wood?M.wood:M.stone);if(!wood){this.box(x+2,y-1,z+2,X-2,y,Z-2,M.dark);for(const a of centeredStarts(x+4,X-4,2,16))this.box(a,y-1,z+3,a+2,y,Z-3,M.pillar);for(const b of centeredStarts(z+4,Z-4,2,16))this.box(x+3,y-1,b,X-3,y,b+2,M.pillar);}}
 rail(x,z,X,Z,y,wood=false){this.box(x,y,z,X,y+2,Z,wood?M.log:M.dark);this.box(x,y+2,z,X,y+3,Z,wood?slab('minecraft:spruce_slab'):slab());}
 lamp(x,y,z,wood=false){this.box(x,y,z,x+1,y+3,z+1,wood?M.log:M.pillar);this.p(x,y+3,z,M.light);this.p(x,y+4,z,slab());}
 pillar(x,z,y,top,w=8,royal=false){const h=Math.floor(w/2);this.box(x-h-2,y,z-h-2,x+h+2,y+3,z+h+2,M.dark);this.box(x-h,y+3,z-h,x+h,top-4,z+h,royal?M.green:M.pillar);for(const k of [y+4,Math.floor((y+top)/2),top-8])this.box(x-h-1,k,z-h-1,x+h+1,k+2,z+h+1,M.gold);this.box(x-h-2,top-4,z-h-2,x+h+2,top,z+h+2,M.smooth);for(const sx of [-1,1])this.box(x+sx*h-(sx<0?1:0),y+8,z-1,x+sx*h+(sx>0?1:0),y+13,z+1,M.light);}
 // Faceted transverse ribs, with explicit 45-degree stepped haunches.
 rib(x,X,y,z,thick=3,royal=false){const span=X-x;this.box(x,y,z,X,y+3,z+thick,M.dark);this.box(x+2,y-1,z,X-2,y,z+thick,M.gold);for(let n=0;n<Math.min(14,Math.floor(span/4));n++){this.box(x+n,y-2-n,z,x+n+3,y+1-n,z+thick,royal?M.green:M.pillar);this.box(X-n-3,y-2-n,z,X-n,y+1-n,z+thick,royal?M.green:M.pillar);}}
 shell(zone,{floor=true,columns=true}={}){this.group=zone.id;const [[x,,z],[X,Y,Z]]=zone.bounds,y=zone.floors[0],royal=zone.style==='royal',wall=zone.style==='forge'?M.black:M.stone;this.box(x,y-4,z,X,Y,Z,wall);this.clear(x+4,y,z+4,X-4,Y-5,Z-4);if(floor)this.floor(x,z,X,Z,y);for(const h of [y+2,y+18,Y-10]){this.box(x+3,h,z+3,X-3,h+2,z+5,M.gold);this.box(x+3,h,Z-5,X-3,h+2,Z-3,M.gold);this.box(x+3,h,z+3,x+5,h+2,Z-3,M.gold);this.box(X-5,h,z+3,X-3,h+2,Z-3,M.gold);}
 for(const k of (zone.id==='E06'?[-356,-260]:/^E3[0-8]$/.test(zone.id)?[z+48,Z-48]:centeredStarts(z+20,Z-20,0,28)).map(v=>v-6)){for(const a of [x+3,X-5]){this.box(a,y+5,k,a+2,Y-12,k+12,royal?M.jade:M.smooth);this.box(a,y+7,k+4,a+2,y+13,k+8,M.light);}this.rib(x+4,X-4,Y-7,k+4,4,royal);}
 if(columns)for(const k of centeredStarts(z+20,Z-20,0,28))for(const a of [x+18,X-18])this.pillar(a,k,y,Y-7,8,royal);
 this.rooms.push({id:zone.id,title:zone.title,bounds:zone.bounds,floors:zone.floors});return {x,X,z,Z,y,Y,royal};}
 gallery(x,z,X,Z,y,w=8){this.floor(x,z,X,z+w,y);this.floor(x,Z-w,X,Z,y);this.floor(x,z+w,x+w,Z-w,y);this.floor(X-w,z+w,X,Z-w,y);this.rail(x+w,z+w,X-w,z+w+1,y);this.rail(x+w,Z-w-1,X-w,Z-w,y);this.rail(x+w,z+w+1,x+w+1,Z-w-1,y);this.rail(X-w-1,z+w+1,X-w,Z-w-1,y);}
 // A northbound straight run. Landing begins at (x, y, z), rises toward -Z.
 stairs(x,y,z,width,rise,mat='minecraft:deepslate_tile_stairs'){for(let i=0;i<rise;i++){this.stairChecks.push({g:this.group,a:[x,y+i,z-i-1],b:[x+width,y+i+1,z-i],s:this.state(stair(mat,'north'))});this.box(x,y+i-2,z-i-1,x+width,y+i,z-i,M.black);this.box(x,y+i,z-i-1,x+width,y+i+1,z-i,stair(mat,'north'));this.clear(x,y+i+1,z-i-1,x+width,y+i+6,z-i);}this.box(x,y+rise-1,z-rise-4,x+width,y+rise,z-rise,M.dark);}
 // Roofed connector. One block rise at most per step, with 6 blocks of headroom.
 path(points,width=8,{roof=true,wood=false,light=true,finalOnly=false}={}){if(!finalOnly)this.routes.push({group:this.group,points,width,roof,wood});const left=Math.floor(width/2),right=width-left,height=width>=18?24:6,sections=[];
  for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],dx=b[0]-a[0],dz=b[2]-a[2],n=Math.max(Math.abs(dx),Math.abs(dz));if(Math.abs(b[1]-a[1])>n)throw Error('Route too steep');for(let i=0;i<=n;i++){const t=n?i/n:0,x=Math.round(a[0]+dx*t),y=Math.round(a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,(i-left)/Math.max(1,n-width)))),z=Math.round(a[2]+dz*t),alongX=Math.abs(dx)>Math.abs(dz);sections.push({x,y,z,a:alongX?[x,y,z-left]:[x-left,y,z],b:alongX?[x+1,y,z+right]:[x+right,y,z+1],alongX,i,facing:alongX?(dx>0?'east':'west'):(dz>0?'south':'north')});}}
  if(!finalOnly)for(const q of sections){const {a,b,y,alongX}=q;this.box(a[0]-(alongX?0:1),y-3,a[2]-(alongX?1:0),b[0]+(alongX?0:1),y+(roof?height+2:3),b[2]+(alongX?1:0),wood?M.log:M.stone);}
  for(let qi=0;qi<sections.length;qi++){const q=sections[qi],{a,b,y}=q,up=qi>0&&y>sections[qi-1].y,down=qi+1<sections.length&&y>sections[qi+1].y,opposite={north:'south',south:'north',east:'west',west:'east'};this.clear(a[0],y,a[2],b[0],roof?y+height:Math.max(96,y+height),b[2]);this.box(a[0],y-1,a[2],b[0],y,b[2],up||down?stair(wood?'minecraft:spruce_stairs':'minecraft:stone_brick_stairs',up?q.facing:opposite[q.facing]):wood?M.wood:M.dark);}
  for(const [x,y,z]of points){this.clear(x-left,y,z-left,x+right,y+height,z+right);this.box(x-left,y-1,z-left,x+right,y,z+right,wood?M.wood:M.dark);}
  if(light&&!finalOnly)for(const {x,y,z,alongX,i}of sections)if(i%16===0){if(alongX){this.p(x,y+2,z-left-1,M.light);this.p(x,y+2,z+right,M.light);}else{this.p(x-left-1,y+2,z,M.light);this.p(x+right,y+2,z,M.light);}}
 }

 door(x,y,z,width=6,height=8,axis='z',depth=8){if(axis==='z')this.clear(x-Math.floor(width/2),y,z-depth/2,x+Math.ceil(width/2),y+height,z+depth/2);else this.clear(x-depth/2,y,z-Math.floor(width/2),x+depth/2,y+height,z+Math.ceil(width/2));}
 room(x,y,z,w,d,h=12,{wood=false,royal=false,kind='home'}={}){const X=x+w,Z=z+d;this.box(x,y-1,z,X,y+h,Z,wood?M.wood:M.stone);this.clear(x+1,y,z+1,X-1,y+h-1,Z-1);this.floor(x,z,X,Z,y,wood);for(const a of [x,X-2])for(const b of [z,Z-2])this.box(a,y,b,a+2,y+h,b+2,wood?M.log:M.pillar);for(const b of [z,Z-1])for(const a of centeredStarts(x+4,X-4,2,8))this.box(a,y+3,b,a+2,y+6,b+1,M.glass);this.door(Math.floor((x+X)/2),y,Z-1,4,4,'z',4);this.box(x+3,y,z+3,x+5,y+1,z+7,slab(wood?'minecraft:spruce_slab':'minecraft:stone_brick_slab','top'));this.box(x+3,y+1,z+3,x+5,y+2,z+4,wood?M.log:M.gold);this.box(X-6,y,z+3,X-3,y+1,z+6,slab('minecraft:spruce_slab','top'));this.p(X-4,y+1,z+4,'minecraft:lantern');this.box(x+3,y,Z-4,x+6,y+4,Z-3,kind==='home'?'minecraft:bookshelf':royal?M.gold:M.dark);this.p(x+1,y+h-2,z+1,M.light);this.p(X-2,y+h-2,Z-2,M.light);}
 house(x,y,z,w=22,d=28,{wood=false,kind='home',variant=0}={}){this.room(x,y,z,w,d,10,{wood,kind});const X=x+w,Z=z+d,roof=wood?'minecraft:dark_oak_stairs':'minecraft:deepslate_tile_stairs';for(let i=0;i<Math.ceil(w/2);i++){this.box(x+i,y+10+i,z-1,x+i+1,y+11+i,Z+1,stair(roof,'east'));this.box(X-i-1,y+10+i,z-1,X-i,y+11+i,Z+1,stair(roof,'west'));if(i>0){this.box(x+i,y+10+i,z,X-i,y+11+i,z+1,wood?M.log:M.stone);this.box(x+i,y+10+i,Z-1,X-i,y+11+i,Z,wood?M.log:M.stone);}}this.box(x+4,y+8,z+4,x+7,y+16+variant,z+7,M.dark);this.p(x+5,y+16+variant,z+5,'minecraft:campfire');this.lamp(x+w-3,y,z+d+1,true);}
}

function gate(d,p){const z=p.zones.find(z=>z.id==='E02');d.group='E02';d.box(-120,-4,-24,120,128,0,M.stone);d.clear(-15,0,-25,15,48,1);for(const s of [-1,1]){const a=s<0?-112:28,b=s<0?-28:112;d.box(a,6,-3,b,112,0,M.jade);d.clear(a+4,4,-22,b-4,78,1);d.box(a+4,5,-23,b-4,77,-22,M.jade);for(const x of [a,b-6])d.pillar(x+3,-4,0,122,6);for(let y=10;y<112;y+=24)for(const x of [a+2,b-4])d.box(x,y,-1,x+2,y+10,0,M.light);}
 for(const y of [3,82,112,122])d.box(-120,y,-3,120,y+2,1,M.gold);
 for(let k=0;k<16;k++){d.box(-18-k,46+k,-5,-15-k,49+k,-1,M.pillar);d.box(15+k,46+k,-5,18+k,49+k,-1,M.pillar);d.box(-16-k,48+k,-1,-14-k,50+k,0,M.gold);d.box(14+k,48+k,-1,16+k,50+k,0,M.gold);}
 d.box(-32,62,-4,32,65,0,M.gold);d.box(-16,48,-24,16,51,0,M.pillar);
 for(let y=85;y<108;y++){const x=108-y;d.box(-x-2,y,-2,-x,y+1,1,M.gold);d.box(x,y,-2,x+2,y+1,1,M.gold);}
 // Retain the accepted skin colours, axe and Issei gauntlet; move statues into niches.
 const model=JSON.parse(gunzipSync(Buffer.from(p.blockPreview.dataGzipBase64,'base64')));
 for(const [x,y,z,len,s]of model.runs){if(y<0||y>=61||z<1||z>=18)continue;for(const [lo,hi]of [[-80,-25],[25,80]]){const a=Math.max(lo,x),b=Math.min(hi,x+len);if(a>=b)continue;const name=model.palette[s];if(y>=4&&z<3&&y<46)continue;d.box(a,y,z-21,b,y+1,z-20,name);}}
 for(const x of [-46,46]){d.floor(x-11,-23,x+11,-2,0);d.box(x-11,0,-23,x+11,3,-1,M.dark);d.box(x-11,2,-23,x+11,3,-1,M.gold);}
 d.floor(-15,-24,15,1,0);d.door(0,0,-24,30,48,'z',4);d.rooms.push({id:z.id,title:z.title,bounds:z.bounds,floors:[0]});
}
function grandHalls(d,p){for(const id of ['E05','E06','E07','E09','E10','E12','E19']){const zone=p.zones.find(z=>z.id===id),q=d.shell(zone,{floor:id!=='E06',columns:!['E05','E06'].includes(id)}),{x,X,z,Z,y,Y}=q;
 if(id==='E05'){for(const zz of centeredStarts(z+20,Z-20,0,28))for(const xx of [-32,32])d.pillar(xx,zz,0,72);d.gallery(x+4,z+4,X-4,Z-4,32,8);d.stairs(-44,0,-64,5,32);d.stairs(39,0,-64,5,32);}
 if(id==='E06'){d.floor(x,z,X,Z,-80);for(const xx of [-64,64])for(const zz of [-260,-356])d.pillar(xx,zz,-80,97,12,true);for(const yy of [-64,32,64])d.gallery(x+4,z+4,X-4,Z-4,yy,8);for(const yy of [-64,0]){d.floor(-10,z,10,Z,yy);d.floor(x,-314,X,-294,yy);for(const xx of [-11,10])d.rail(xx,z,xx+1,Z,yy);for(const zz of [-315,-294])d.rail(x,zz,X,zz+1,yy);d.clear(-12,yy,-316,12,yy+5,-292);}for(let zz=z+12;zz<Z-8;zz+=24)for(const xx of [-10,9])d.lamp(xx,0,zz);}
 if(id==='E07'){for(let i=0;i<3;i++){const w=44-8*i,zz=-492-12*i,yy=4+4*i;d.box(-w/2,-1,zz-12,w/2,yy,zz,M.jade);d.stairs(-10,yy-4,zz+4,20,4);d.box(-w/2,yy-1,zz-12,w/2,yy,zz,M.gold);}d.box(-5,12,-529,5,15,-522,M.dark);d.box(-5,15,-530,5,29,-528,M.gold);d.box(-3,17,-528,3,26,-527,M.jade);d.box(-7,13,-528,-5,18,-521,M.gold);d.box(5,13,-528,7,18,-521,M.gold);d.box(-2,33,-532,2,37,-529,'minecraft:sea_lantern');d.box(-1,34,-529,1,36,-528,'minecraft:diamond_block');}
 if(id==='E09'){d.gallery(x+4,z+4,X-4,Z-4,24,8);for(const xx of [122,138,154,174,190,206]){d.box(xx,1,-160,xx+4,2,-108,slab('minecraft:spruce_slab','top'));for(let zz=-158;zz<-110;zz+=4){d.p(xx-1,0,zz,stair('minecraft:spruce_stairs','east'));d.p(xx+4,0,zz,stair('minecraft:spruce_stairs','west'));d.p(xx+1,2,zz,'minecraft:lantern');}}d.box(144,0,-186,184,2,-172,M.dark);d.box(148,3,-180,180,4,-176,slab('minecraft:spruce_slab','top'));d.stairs(110,0,-76,5,24);d.stairs(214,0,-76,5,24);}
 if(id==='E10'){d.gallery(x+4,z+4,X-4,Z-4,-64,8);for(const xx of [x+6,X-12])d.stairs(xx,-96,-576,6,32);for(let xx=-76;xx<80;xx+=32)for(let zz=-768;zz<-574;zz+=40){if(Math.abs(xx)<58&&zz>-704&&zz<-644)continue;const h=4+((xx+zz+3000)%13);for(let k=0;k<h;k++)d.box(xx-12+k/2|0,-96+k,zz-14+k/2|0,xx+12-(k/2|0),-95+k,zz+14-(k/2|0),'minecraft:gold_block');}d.features.push('Goldfelder 4–16 hoch, Hauptwege und Smaug-Reserve frei');}
 if(id==='E12'){d.gallery(x+4,z+4,X-4,Z-4,-32,8);for(const xx of [x+8,X-40])for(const zz of [-504,-452,-400,-348]){d.box(xx,-64,zz,xx+32,-40,zz+24,M.black);d.clear(xx+4,-64,zz+2,xx+28,-46,zz+20);d.box(xx+4,-64,zz+20,xx+28,-59,zz+21,'minecraft:magma_block');for(let a=xx+6;a<xx+28;a+=6)d.p(a,-64,zz+6,'minecraft:anvil');d.box(xx+2,-42,zz+2,xx+30,-40,zz+22,M.gold);}for(const zz of [-480,-400,-320]){d.box(x+12,-25,zz,X-12,-22,zz+3,'minecraft:iron_block');d.box(-206,-48,zz+1,-205,-22,zz+2,{name:'minecraft:chain',props:{axis:'y',waterlogged:'false'}});}d.stairs(x+6,-64,-304,6,32);}
 if(id==='E19'){d.gallery(x+4,z+4,X-4,Z-4,24,8);for(const xx of [-248,-160])for(let zz=-712;zz<=-592;zz+=24){d.box(xx-6,0,zz-6,xx+6,2,zz+6,M.gold);d.box(xx-4,2,zz-3,xx-1,8,zz+3,M.pillar);d.box(xx+1,2,zz-3,xx+4,8,zz+3,M.pillar);d.box(xx-4,8,zz-3,xx+4,14,zz+3,M.green);d.box(xx-3,14,zz-3,xx+3,20,zz+3,M.smooth);d.box(xx-4,18,zz-4,xx+4,20,zz+4,M.gold);}d.stairs(-276,0,-576,5,24);d.stairs(-137,0,-576,5,24);}
 }}

function residential(d,p){for(const id of ['E08','E11','E13','E16','E17','E18','E21A','E21B']){const zone=p.zones.find(z=>z.id===id),{x,X,z,Z,y,Y}=d.shell(zone,{columns:false});for(const f of zone.floors.slice(1))d.floor(x+4,z+4,X-4,Z-4,f);
 if(id==='E16'){for(const yy of [16,32])for(const zz of centeredStarts(z+12,Z-12,20,42))for(const xx of centeredStarts(x+12,X-12,16,36))d.room(xx,yy,zz,16,20,12);for(const zz of centeredStarts(z+12,Z-12,24,60))for(const xx of centeredStarts(x+12,X-12,20,36))d.room(xx,48,zz,20,24,12);for(let i=0;i<6;i++)d.room(x+22+(i%3)*44,0,z+20+Math.floor(i/3)*64,24,28,12,{kind:'shop'});d.room(x+8,0,Z-88,48,64,14,{kind:'inn'});d.features.push('64 möblierte Wohnungen, 6 Läden, zwei spiegelgleiche Herbergen und Markthalle');}
 if(id==='E13'){for(let row=0;row<4;row++)for(let col=0;col<3;col++){const xx=x+20+col*48,zz=z+12+row*42;d.room(xx,0,zz,24,24,12,{kind:'workshop'});d.p(xx+9,0,zz+8,(row+col)%2?'minecraft:anvil':'minecraft:crafting_table');if(col!==1)d.room(xx,16,zz,24,24,10,{kind:'store'});}}
 if(id==='E08'){for(const xx of [-88,12])for(const zz of [-644,-600])d.room(xx,32,zz,76,32,12,{royal:true,kind:'council'});for(let i=0;i<6;i++)d.room(-74+(i%3)*62,48,-640+Math.floor(i/3)*40,24,20,16,{royal:true});d.room(-80,48,-592,40,24,16,{royal:true,kind:'library'});}
 if(id==='E11'){for(const yy of [-96,-64])for(let row=0;row<2;row++)for(let col=0;col<2;col++){const xx=x+10+col*72,zz=z+16+row*80;d.room(xx,yy,zz,24,32,20,{royal:true,kind:'vault'});d.box(xx+4,yy,zz+4,xx+20,yy+4,zz+8,'minecraft:gold_block');}for(const yy of [-96,-64])for(const zz of [z+56,z+136])d.room(x+54,yy,zz,20,24,16,{royal:true,kind:'armoury'});}
 if(id==='E17'){for(const yy of [-48,-32])for(const xx of [x+8,x+64])for(const zz of [z+12,z+76]){d.room(xx,yy,zz,44,44,12,{kind:'kitchen'});for(let a=xx+4;a<xx+38;a+=4)d.p(a,yy,zz+5,yy===-32?'minecraft:smoker':'minecraft:barrel');d.box(xx+7,yy,zz+20,xx+37,yy+1,zz+24,slab('minecraft:spruce_slab','top'));}}
 if(id==='E18'){for(let i=0;i<4;i++)d.room(x+8+32*i,16,z+8,24,28,7,{kind:'home'});d.room(x+8,0,z+8,32,32,12,{kind:'armoury'});d.room(x+52,0,z+8,32,32,12,{kind:'guard'});for(let i=0;i<3;i++)d.room(X-44+i*12,0,z+8,10,20,12,{kind:'cell'});}
 if(id.startsWith('E21')){for(const yy of [-32,-16]){d.box(x+8,yy-3,z+28,X-8,yy-1,z+31,M.dark);d.clear(x+8,yy-2,z+29,X-8,yy-1,z+30);for(const xx of [x+8,X-20])for(const zz of [z+8,Z-20])d.box(xx,yy-1,zz,xx+12,yy,zz+12,M.smooth);}}
 // Local dogleg links, independent of later machinery. Stair shafts only at hall edges.
 for(let f=0;f<zone.floors.length-1;f++){const yy=zone.floors[f],rise=zone.floors[f+1]-yy;d.stairs(x+4,yy,Z-(id==='E16'?48:8),4,rise);}
 }}

function kernels(d,p){for(const zone of p.zones.filter(z=>z.id.startsWith('S'))){const {x,X,z,Z}=d.shell(zone,{columns:false});const low=zone.floors[0],high=zone.floors.at(-1);d.clear(x+2,low,z+2,X-2,high+6,Z-2);for(let yy=low;yy<high;yy+=16){d.box(x+2,yy-1,Z-4,X-2,yy,Z-2,M.dark);d.box(x+2,yy+7,z+2,X-2,yy+8,z+4,M.dark);for(let i=0;i<8;i++){d.box(x+2,yy+i,Z-5-i,x+5,yy+i+1,Z-4-i,stair());d.box(X-5,yy+8+i,z+4+i,X-2,yy+9+i,z+5+i,stair('minecraft:deepslate_tile_stairs','south'));d.box(x+5,yy+i,Z-5-i,x+6,yy+i+2,Z-4-i,M.dark);d.box(X-6,yy+8+i,z+4+i,X-5,yy+10+i,z+5+i,M.dark);}d.p(x+1,yy+6,z+2,M.light);d.p(X-2,yy+14,Z-3,M.light);}for(const yy of zone.floors){d.box(x+2,yy-1,Z-4,X-2,yy,Z-2,M.dark);d.door(x,yy,Z-3,3,5,'x',4);d.door(X,yy,Z-3,3,5,'x',4);d.door(Math.floor((x+X)/2),yy,Z,3,5,'z',8);}}
}
function stairsAndLinks(d,p){
 d.group='E29';const r=(points,w=8)=>d.path(points,w);
 r([[0,0,-200],[0,0,-220]],20);r([[0,0,-396],[0,0,-416]],20);
 r([[46,0,-132],[108,0,-132]],12);r([[-46,0,-48],[-144,0,-48]],8);
 r([[0,0,-208],[-112,0,-203]],8);
 for(const yy of [0,32,64]){r([[92,yy,-224],[100,yy,-219],[112,yy,-219]]);r([[-92,yy,-392],[-112,yy,-392],[-112,yy,-411]]);r([[92,yy,-392],[112,yy,-392],[112,yy,-531]]);}
 for(const yy of [0,16])r([[-112,yy,-203],[-128,yy,-203]]);
 for(const yy of [0,16,32,48]){r([[112,yy,-219],[176,yy,-219],[176,yy,-244]],12);r([[176,yy,-516],[176,yy,-531],[112,yy,-531]]);}
 for(const yy of [-32,-48])r([[112,yy,-219],[112,yy,-196]]);
 for(const xx of [112,216])r([[xx,-32,-184],[xx,0,-144]],6);
 r([[-112,-32,-411],[-128,-32,-411]]);
 r([[-112,0,-411],[-128,0,-411],[-128,0,-552],[-204,0,-552],[-204,0,-568]]);
 r([[112,32,-531],[100,32,-531],[100,32,-552],[96,32,-552],[96,32,-560]]);
 r([[-112,-64,-411],[0,-64,-411],[0,-64,-562]],12);
 r([[-92,-96,-680],[-132,-96,-680]],12);
 r([[92,-96,-680],[120,-96,-680],[144,-112,-680]],8);
 r([[-204,-64,-526],[-204,-64,-548],[204,-64,-548],[204,-112,-612]],8);
 r([[112,-32,-531],[128,-32,-531],[128,-32,-624],[172,-32,-624]],6);r([[128,-32,-624],[128,-32,-704],[172,-32,-704]],6);
 // Connecting every floor to its kernel must preserve the stair landing, not cut its runs.
 d.group='E15';r([[-400,-32,-660],[-300,-32,-660],[-300,-64,-568],[-112,-64,-568],[-112,-96,-620],[-92,-96,-620]],3);
 d.box(-416,-35,-676,-384,-32,-644,M.pillar);d.door(-400,-32,-660,3,4,'x',8);
}

function mines(d,p){d.group='E14';const z=p.zones.find(z=>z.id==='E14');d.rooms.push({id:z.id,title:z.title,bounds:z.bounds,floors:z.floors});d.path([[144,-112,-576],[220,-112,-576],[220,-112,-632],[204,-112,-632],[204,-112,-776]],8);for(const zz of [-600,-628,-656,-684,-712,-740]){d.path([[140,-112,zz],[276,-112,zz]],5);for(let x=144;x<278;x+=16){d.box(x,-112,zz-3,x+2,-106,zz-2,M.log);d.box(x,-112,zz+2,x+2,-106,zz+3,M.log);d.box(x,-107,zz-3,x+2,-106,zz+3,M.log);d.p(x+1,-110,zz-2,M.light);}}d.room(216,-112,-780,48,48,20,{kind:'sorting'});d.room(132,-112,-644,32,48,16,{kind:'station'});for(const xx of [164,252]){d.box(xx,-116,-594,xx+12,-64,-582,M.pillar);d.clear(xx+2,-112,-592,xx+10,-64,-584);for(let yy=-112;yy<-64;yy++)d.p(xx+2,yy,-590,{name:'minecraft:ladder',props:{facing:'east',waterlogged:'false'}});}}

function outside(d,p){
 d.group='E03';// Use the surveyed stepped footprint, not its rectangular reservation.
 const footprint=p.zones.find(z=>z.id==='E03').worldFootprint;
 const inside=(x,z)=>{let yes=false;for(let i=0,j=footprint.length-1;i<footprint.length;j=i++){const [a,b]=footprint[i],[c,e]=footprint[j];if((b>z)!==(e>z)&&x<(c-a)*(z-b)/(e-b)+a)yes=!yes;}return yes;};
 for(let z=0;z<108;z++)for(let x=-68;x<68;x++){const wx=p.worldOrigin[0]+z,wz=p.worldOrigin[2]-x;if(!inside(wx,wz))continue;const h=z<36?0:Math.min(24,1+Math.floor((z-36)/3));d.box(x,-12,z,x+1,h,z+1,M.stone);d.p(x,h-1,z,Math.abs(x)<12?M.dark:M.smooth);if(Math.abs(x)===12)d.p(x,h-1,z,M.gold);if(z>=36&&(z-36)%3===0&&Math.abs(x)<12)d.p(x,h-1,z,stair('minecraft:stone_brick_stairs','south'));}
 for(let z=0;z<108;z+=8)for(const x of [-16,16])d.lamp(x,z<36?0:Math.min(24,1+Math.floor((z-36)/3)),z);
 d.group='E22';d.floor(-12,108,12,184,24);for(const x of [-12,11])d.rail(x,108,x+1,184,24);for(let z=108;z<184;z+=20){d.box(-12,-16,z,12,22,z+4,M.pillar);for(let k=0;k<8;k++){d.box(-12,13-k,z+4+k,12,16-k,z+5+k,M.stone);d.box(-12,13-k,z+19-k,12,16-k,z+20-k,M.stone);}for(const x of [-11,10])d.lamp(x,24,z);}
 d.group='E20';for(let z=184;z<664;z++){const h=z<348?24:z<492?32:40;d.box(-234,-26,z,186,h,z+1,M.stone);d.clear(-230,h,z,182,96,z+1);d.box(-230,h-1,z,182,h,z+1,M.smooth);}const xs=[-218,-154,-90,-26,38,102],zs=Array.from({length:18},(_,i)=>204+i*24);
 // Six residential streets, with 108 houses. Central civic quarter replaces 12 plots.
 let houses=0;for(let ix=0;ix<xs.length;ix++)for(let iz=0;iz<zs.length;iz++){const x=xs[ix],z=zs[iz],yy=24+8*Math.floor(iz/6);if(ix===2&&iz>=6&&iz<12||ix===3&&iz>=6&&iz<12)continue;d.box(x-3,8,z-3,x+31,yy,z+22,M.stone);d.house(x,yy,z,28,18,{variant:(ix+iz)%3});houses++;}
 for(const xx of xs){const a=xx+34,b=a===-56?-114:a===8?30:a;d.path([[a,24,194],[a,24,332],[b,32,356],[b,32,476],[a,40,500],[a,40,650]],12,{roof:false});}
 for(const [zz,yy]of [[194,24],[326,24],[470,32],[650,40]])d.path([[-226,yy,zz],[174,yy,zz]],12,{roof:false});
 d.floor(-104,352,24,480,32);d.house(-100,32,356,64,64,{kind:'townhall'});d.house(-24,32,356,40,40,{kind:'inn'});for(let x=-96;x<16;x+=20)for(let z=438;z<476;z+=24){d.box(x,32,z,x+12,34,z+6,M.wood);d.box(x,37,z,x+12,38,z+8,'minecraft:red_wool');for(const a of [x,x+11])d.box(a,32,z,a+1,38,z+1,M.log);}
 for(const xx of [-234,182]){d.box(xx,8,184,xx+4,54,664,M.stone);for(let z=184;z<664;z+=8)d.box(xx,54,z,xx+4,56,z+4,M.stone);}for(const zz of [184,660]){d.box(-234,8,zz,186,54,zz+4,M.stone);for(let x=-234;x<186;x+=8)d.box(x,54,zz,x+4,56,zz+4,M.stone);}for(const [x,z,y]of [[0,184,24],[0,662,40],[-232,470,32],[184,326,24]]){d.door(x,y,z,16,14,z===184||z===662?'z':'x',8);for(const dx of [-18,14])d.room(x+dx,y,z-8,12,16,24,{kind:'watch'});}d.path([[0,24,172],[0,24,194]],18,{roof:false});d.features.push(`Dale: ${houses} Wohnhäuser, Rathaus, Herberge, Markt, vier Stadttore`);
 d.group='E25';d.clear(-894,-25,344,-534,96,824);const ey=-20;for(let ix=0;ix<8;ix++)for(let iz=0;iz<12;iz++){const x=-882+ix*42,z=360+iz*36;if(ix>=3&&ix<=4&&iz>=4&&iz<=7||iz===11&&ix<4)continue;d.floor(x-2,z-2,x+32,z+30,ey,true);for(const a of [x,x+28])for(const b of [z,z+26])d.box(a,-46,b,a+2,ey,b+2,M.log);d.house(x,ey,z,28,24,{wood:true,variant:(ix+iz)%3});}
 for(let ix=0;ix<8;ix++){const x=-882+ix*42+33;if(x===-723||x===-681){d.path([[x,ey,344],[x,ey,494]],8,{roof:false,wood:true});d.path([[x,ey,638],[x,ey,808]],8,{roof:false,wood:true});}else d.path([[x,ey,344],[x,ey,808]],8,{roof:false,wood:true});}for(const z of [350,494,638,810])d.path([[-890,ey,z],[-538,ey,z]],12,{roof:false,wood:true});
 d.floor(-758,500,-670,630,ey,true);d.house(-754,ey,504,56,40,{wood:true,kind:'master'});d.room(-696,ey,506,20,20,60,{wood:true,kind:'belltower'});for(let y=ey;y<40;y++)d.p(-695,y,508,{name:'minecraft:ladder',props:{facing:'east',waterlogged:'false'}});d.p(-686,38,516,'minecraft:gold_block');for(let x=-750;x<-680;x+=18)for(const z of [568,600]){d.box(x,ey,z,x+12,ey+2,z+6,M.wood);d.box(x,ey+5,z,x+12,ey+6,z+8,'minecraft:blue_wool');for(const a of [x,x+11])d.box(a,ey,z,a+1,ey+6,z+1,M.log);}
 // Warehouses, two slipways and a timber crane outside the main housing grid.
 for(const x of [-882,-798])d.house(x,ey,770,28,28,{wood:true,kind:'warehouse'});
 for(const x of [-660,-606]){for(let k=0;k<24;k++)d.box(x,ey-2-Math.floor(k/4),824+k,x+18,ey-1-Math.floor(k/4),825+k,M.log);d.box(x+20,ey,832,x+23,ey+26,835,M.log);d.box(x,ey+24,832,x+23,ey+27,835,M.log);d.box(x+2,ey+6,833,x+3,ey+24,834,'minecraft:chain');}d.features.push('Esgaroth: 84 Pfahlhäuser, Meisterhaus, Glockenturm, Markt, zwei Lagerhäuser und Werft');
 d.group='E26';d.path([[-702,-20,184],[-702,-20,240],[-702,-14,264],[-702,-14,288],[-702,-20,312],[-702,-20,350]],12,{roof:false,wood:true});for(let z=184;z<344;z+=12)for(const x of [-710,-695])d.box(x,-46,z,x+2,-20,z+2,M.log);d.room(-714,-20,328,24,16,22,{wood:true,kind:'gate'});d.door(-702,-20,336,12,10,'z',20);
 d.group='E28';d.path([[-232,32,482],[-280,16,482],[-314,0,420],[-360,-16,260],[-480,-20,184],[-702,-20,184]],12,{roof:false});for(let i=0;i<6;i++){const x=-320-i*32,z=332+(i%2)*84,y=-16;d.box(x,y-4,z,x+26,y,z+54,'minecraft:dirt');d.box(x,y-1,z,x+26,y,z+54,'minecraft:farmland');for(let a=x+2;a<x+24;a+=4)for(let b=z+2;b<z+52;b+=2)d.p(a,y,b,{name:'minecraft:wheat',props:{age:'7'}});d.house(x,y,z+60,20,22,{wood:true,kind:'farm'});}d.house(-328,-16,452,30,36,{wood:true,kind:'mill'});
 d.group='E27';d.path([[64,0,16],[140,24,16],[200,56,48],[260,72,120],[288,88,192]],6,{roof:false});for(const [x,z,y]of [[200,48,56],[260,120,72],[288,192,88]]){d.box(x-20,-12,z-20,x+20,y,z+20,M.stone);d.floor(x-20,z-20,x+20,z+20,y);d.room(x-12,y,z-12,24,24,14,{kind:'watch'});d.p(x,y+14,z,'minecraft:campfire');}
}

function landscape(d){
 // The river is an explicit lined channel, not its enormous rectangular reservation.
 d.group='E23';const route=[[16,-8,0],[0,-8,140],[-214,-18,184],[-384,-25,314],[-534,-25,464]];for(let k=1;k<route.length;k++){const a=route[k-1],b=route[k],n=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[2]-a[2]));for(let i=0;i<=n;i++){const t=i/n,x=Math.round(a[0]+(b[0]-a[0])*t),z=Math.round(a[2]+(b[2]-a[2])*t),y=Math.round(a[1]+(b[1]-a[1])*t);d.box(x-9,y-7,z-9,x+9,y-4,z+9,'minecraft:stone');d.clear(x-7,y-4,z-7,x+7,y+3,z+7);d.box(x-9,y-4,z-9,x-7,y+1,z+9,M.pillar);d.box(x+7,y-4,z-9,x+9,y+1,z+9,M.pillar);}}
 d.group='E24';// Irregular ellipse, defined shoreline at Y63, 8–20 blocks deep. No water placed.
 for(let z=84;z<1104;z+=4)for(let x=-1154;x<-334;x+=4){const dx=(x+744)/410,dz=(z-594)/510,r=Math.hypot(dx,dz),angle=Math.atan2(dz,dx),edge=1+.035*Math.sin(angle*5)+.025*Math.sin(angle*9);if(r>edge)continue;const depth=8+Math.floor(12*Math.max(0,1-r/edge)),y=-25-depth;d.box(x,y-2,z,x+4,y,z+4,r>edge-.08?'minecraft:gravel':'minecraft:stone');d.clear(x,y,z,x+4,-25,z+4);if(r>edge-.03){d.box(x,-26,z,x+4,-24,z+4,'minecraft:gravel');if((x+z)%20===0)d.box(x,-24,z,x+1,-21,z+1,'minecraft:sugar_cane');}}
}

function interior(d,p){grandHalls(d,p);residential(d,p);balanceRooms(d,p.zones);mines(d,p);stairsAndLinks(d,p);for(const r of [...d.routes]){d.group=r.group;d.path(r.points,r.width,{roof:r.roof,wood:r.wood,light:false,finalOnly:true});}kernels(d,p);}
export function buildEreborDesign(plan){
 if(plan.rotationDegrees!==90||!plan.blockPreview?.dataGzipBase64)throw Error('Erebor-Standort oder Skinmodell fehlt');
 const d=new Design(plan);landscape(d);outside(d,plan);gate(d,plan);
 d.group='E03';d.path([[100,0,16],[100,4,-10],[84,4,-10]],6,{roof:true});
 for(const r of [...d.routes]){d.group=r.group;d.path(r.points,r.width,{roof:r.roof,wood:r.wood,light:false,finalOnly:true});}
 if(plan.interiorExpansion){
  const basis=interiorBasis(plan),core=new Design(basis);interior(core,basis);appendExpandedInterior(d,core);balanceRooms(d,plan.zones.filter(z=>basis.zones.some(b=>b.id===z.id)));const added=addExpansion(d,plan,M);
  const merged=new Design(basis);for(const r of core.routes){merged.group=r.group;merged.path(r.points,r.width,{roof:r.roof,wood:r.wood,light:false,finalOnly:true});}appendExpandedOps(d,merged);
  for(const r of added){d.group=r.group;d.path(r.points,r.width,{roof:true,light:false,finalOnly:true});}
  const shafts=new Design(basis);kernels(shafts,basis);appendExpandedOps(d,shafts);
 }
 else interior(d,plan);
 d.group='E02';d.clear(-15,0,-30,15,48,1);
 // Hard exclusions remain last, after both the enlarged core and all new corridors.
 d.group='PROTECTED';for(const q of plan.site.protectedAreas.filter(q=>q.id!=='P-SEE')){const [a,b]=q.bounds,[ox,oy,oz]=plan.worldOrigin;const lo=[oz-b[2],a[1]-oy,a[0]-ox],hi=[oz-a[2],b[1]-oy,b[0]-ox];d.box(...lo,...hi,'minecraft:structure_void');}
 return d;
}
