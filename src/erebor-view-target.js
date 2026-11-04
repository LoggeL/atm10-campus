// Room envelopes and individual corridor segments share the blueprint coordinate system.
export function ereborViewTarget(plan, id) {
  const zone = plan.zones.find(z => z.id === id);
  if (zone) return zone;
  const match = /^G([1-9]\d*)-([1-9]\d*)$/.exec(id || '');
  if (!match) return null;
  const route = plan.interiorExpansion?.routes?.[Number(match[1]) - 1];
  const segment = Number(match[2]), a = route?.points[segment - 1], b = route?.points[segment];
  if (!a || !b) return null;
  const w = Math.floor(route.width / 2) + 2;
  return {id, title:`Verbindung ${match[1]} · Abschnitt ${segment}`, floors:[a[1]], bounds:[
    [Math.min(a[0],b[0])-w,Math.min(a[1],b[1])-2,Math.min(a[2],b[2])-w],
    [Math.max(a[0],b[0])+w+1,Math.max(a[1],b[1])+9,Math.max(a[2],b[2])+w+1],
  ]};
}

export function navigationCells(data, size, origin, palette, floors) {
  const index=(x,y,z)=>(y*size[2]+z)*size[0]+x;
  const blocks=palette.map(p=>!/(?:^minecraft:(?:air|cave_air|void_air|water|lava|structure_void)$|torch|candle|grass|flower|rail)/.test(p.name));
  const bits=Buffer.alloc(Math.ceil(data.length/8));
  for(let i=0;i<data.length;i++)if(data[i]>0&&blocks[data[i]])bits[i>>3]|=1<<(i&7);
  const solid=(x,y,z)=>x>=0&&y>=0&&z>=0&&x<size[0]&&y<size[1]&&z<size[2]&&!!(bits[index(x,y,z)>>3]&(1<<(index(x,y,z)&7)));
  const spawns=[];
  for(const floor of floors){
    const y=floor-origin[1];if(y<1||y+2>=size[1])continue;
    let best=null,score=Infinity;
    for(let z=2;z<size[2]-2;z++)for(let x=2;x<size[0]-2;x++){
      const d=Math.abs(x-(size[0]-10))+Math.abs(z-size[2]/2);
      if(d>=score)continue;
      let free=true;
      for(let dz=-1;dz<=1&&free;dz++)for(let dx=-1;dx<=1;dx++)if(!solid(x+dx,y-1,z+dz)||solid(x+dx,y,z+dz)||solid(x+dx,y+1,z+dz)){free=false;break;}
      if(free){score=d;best=[origin[0]+x+.5,floor+1.62,origin[2]+z+.5];}
    }
    if(best)spawns.push({floor,position:best,target:[best[0]-30,best[1]+2,best[2]]});
  }
  return {lo:origin,size,bits:bits.toString('base64'),spawns,closedBounds:true};
}
