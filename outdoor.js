import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createCharacter,PRESETS} from './characters.js';
// City around the office: street grid with markings, crossings and traffic lights, cars that stop on red,
// lawns with houses and shops near the office, apartment blocks further out, trees, street lamps and passers-by.
// Pavement sits at y=GY just under the office slab (office.js floor spans x∈[-5.6,5.6], z∈[-4,4]).
const GY=-.46,PI=Math.PI,HALF=1.8,WALK=1.3,EDGE=48,LOOP=78;
// Roads running along z (at these x) and along x (at these z); the office block is the cell around the origin
const XR=[-30.5,-10.5,11.4,31.4],ZR=[-29.5,-9.5,9.4,29.4];
const rng=seed=>()=>(seed=seed*16807%2147483647)/2147483647;
const r=rng(20261102),pick=a=>a[r()*a.length|0],between=(a,b)=>a+r()*(b-a);
const geoCache=new Map(),matCache=new Map();
const geo=(k,make)=>{if(!geoCache.has(k))geoCache.set(k,make());return geoCache.get(k)};
const box=(w,h,d)=>geo(`b${w}_${h}_${d}`,()=>new THREE.BoxGeometry(w,h,d));
const cyl=(rt,rb,h,n=12)=>geo(`y${rt}_${rb}_${h}_${n}`,()=>new THREE.CylinderGeometry(rt,rb,h,n));
const ico=(rad,d=1)=>geo(`i${rad}_${d}`,()=>new THREE.IcosahedronGeometry(rad,d));
const flat=(w,h)=>geo(`f${w}_${h}`,()=>new THREE.PlaneGeometry(w,h).rotateX(-PI/2));
const mat=(c,rough=.8,extra)=>{const k=`${c}_${rough}_${extra?JSON.stringify(extra):''}`;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:0,...extra}));return matCache.get(k)};
let SHADOW=true;
function add(p,g,m,pos=[0,0,0],s=1,rot){const o=new THREE.Mesh(g,m);o.position.set(...pos);typeof s==='number'?o.scale.setScalar(s):o.scale.set(...s);if(rot)o.rotation.set(...rot);o.castShadow=SHADOW;o.receiveShadow=true;p.add(o);return o}
function grp(p,x=0,y=0,z=0,ry=0){const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=ry;p.add(g);return g}
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t}
// Merge every mesh of a detached group into one mesh per material (keeps draw calls low for the whole city)
function bake(src){
  src.updateMatrixWorld(true);const buckets=new Map();
  src.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone().applyMatrix4(o.matrixWorld);if(g.index)g=g.toNonIndexed();
    for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);
    const key=o.material.uuid+o.castShadow;if(!buckets.has(key))buckets.set(key,{m:o.material,cast:o.castShadow,list:[]});buckets.get(key).list.push(g)});
  const out=new THREE.Group();
  for(const {m,cast,list} of buckets.values()){const mesh=new THREE.Mesh(mergeGeometries(list),m);mesh.castShadow=cast;mesh.receiveShadow=true;out.add(mesh)}
  return out;
}

// ---------- shared materials (window/lamp glow is switched per scenery) ----------
const M={
  pave:mat(0xe2dfd8,.95),road:mat(0x5d6271,.9),paint:mat(0xf7f7f2,.6),lawn:mat(0x9dd283,.9),plinth:mat(0xd9d2c6,.85),
  trunk:mat(0x8a6446,.9),pole:mat(0x3b404c,.5),door:mat(0x7a5236,.7),trim:mat(0xf7f4ee,.6),dark:mat(0x2b2f3a,.5),
  hedge:mat(0x5fae5a,.85),bench:mat(0xc98e5a,.7),tire:mat(0x24262c,.8),cabin:mat(0x2e3f5c,.25),
  win:new THREE.MeshStandardMaterial({color:0x9cc8ec,roughness:.2,emissive:0xffcf80,emissiveIntensity:0}),
  lamp:new THREE.MeshStandardMaterial({color:0xfff6dc,roughness:.3,emissive:0xffe2a8,emissiveIntensity:.15}),
  head:new THREE.MeshStandardMaterial({color:0xfffbe8,roughness:.3,emissive:0xfff2c0,emissiveIntensity:.6}),
  tail:new THREE.MeshStandardMaterial({color:0xe04848,roughness:.3,emissive:0xff3030,emissiveIntensity:.6})
};
const signal=c=>new THREE.MeshStandardMaterial({color:c,roughness:.3,emissive:c,emissiveIntensity:0});
const SIG={xr:signal(0xff3b30),xg:signal(0x34d36b),zr:signal(0xff3b30),zg:signal(0x34d36b)};
const LEAVES=[0x5fae5a,0x4f9d50,0x78c167,0x8cc96e,0x5aa86a].map(c=>mat(c,.85));
const WALLS=[0xf6efe4,0xf3d9b8,0xdfe9f3,0xf7e1e1,0xe6efdc,0xfff4d6,0xe9e2f5];
const ROOFS=[0xc96a4f,0x8a5a44,0x5b6b85,0xd08a4f,0x6f7f6a];
const ACCENTS=['#e76f51','#2a9d8f','#5b8def','#f4a261','#a78bfa','#ef6f8f'];
const SHOPS=['CAFÉ','BAKERY','MART','PHỞ','BOOKS','FLOWERS','PHARMA','TEA'];
// Apartment facade: a 4×4 tile of windows (some lit at dusk), tiled across each block via its UVs
const FACADES=[['#eef1f6','#7fa7d6'],['#f3e7d7','#7d9cc4'],['#dfe6ee','#5f86b8'],['#f1ece4','#8cb4dc']].map(([wall,glass],i)=>{
  const lit=rng(31+i);
  const map=canvasTex(256,256,(x,W,H)=>{x.fillStyle=wall;x.fillRect(0,0,W,H);for(let a=0;a<4;a++)for(let b=0;b<4;b++){x.fillStyle=glass;x.fillRect(a*64+13,b*64+12,38,32);x.fillStyle='rgba(255,255,255,.35)';x.fillRect(a*64+13,b*64+12,38,6)}});
  const em=canvasTex(256,256,(x,W,H)=>{x.fillStyle='#000';x.fillRect(0,0,W,H);x.fillStyle='#ffd48a';for(let a=0;a<4;a++)for(let b=0;b<4;b++)if(lit()<.6)x.fillRect(a*64+13,b*64+12,38,32)});
  for(const t of[map,em])t.wrapS=t.wrapT=THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({map,emissiveMap:em,emissive:0xffffff,emissiveIntensity:0,roughness:.8});
});
const texMat=(k,draw,w=256,h=64)=>{if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({map:canvasTex(w,h,draw),roughness:.7}));return matCache.get(k)};

// ---------- street furniture & greenery ----------
function tree(p,x,z,s=1){
  const g=grp(p,x,GY,z,r()*PI);g.scale.setScalar(s);const leaf=pick(LEAVES);
  add(g,cyl(.08,.12,1.3,8),M.trunk,[0,.65,0]);
  add(g,ico(.62),leaf,[0,1.65,0],[1,.9,1]);add(g,ico(.42),leaf,[.32,1.4,.18]);add(g,ico(.38),leaf,[-.28,1.95,-.12]);
}
function pine(p,x,z,s=1){const g=grp(p,x,GY,z);g.scale.setScalar(s);add(g,cyl(.07,.1,.6,8),M.trunk,[0,.3,0]);const m=pick(LEAVES);[[.62,1.0,.85],[.48,.9,1.45],[.32,.75,1.95]].forEach(([rad,h,y])=>add(g,geo(`cone${rad}`,()=>new THREE.ConeGeometry(rad,h,8)),m,[0,y,0]))}
function bush(p,x,z,s=1){add(p,ico(.32),pick(LEAVES),[x,GY+.1+.22*s,z],[s*1.2,s*.8,s*1.2])}
function lamp(p,x,z,ry){const g=grp(p,x,GY,z,ry);add(g,cyl(.05,.07,3.1,8),M.pole,[0,1.55,0]);add(g,box(.62,.06,.06),M.pole,[.29,3.08,0]);add(g,box(.34,.1,.2),M.pole,[.6,3.04,0]);add(g,box(.28,.03,.15),M.lamp,[.6,2.98,0])}
function bench(p,x,z,ry){const g=grp(p,x,GY+.1,z,ry);add(g,box(1.2,.06,.36),M.bench,[0,.42,0]);add(g,box(1.2,.3,.05),M.bench,[0,.66,-.17]);for(const sx of[-.5,.5])add(g,box(.06,.42,.36),M.dark,[sx,.21,0])}
// Traffic light: one head for traffic along x, one for traffic along z (lamps on both faces of each head)
function trafficLight(p,x,z){
  const g=grp(p,x,GY,z);add(g,cyl(.05,.06,2.7,8),M.pole,[0,1.35,0]);
  const head=(y,ry,red,green)=>{const h=grp(g,0,y,0,ry);add(h,box(.12,.46,.22),M.dark);for(const s of[-1,1]){add(h,box(.02,.12,.12),red,[s*.07,.11,0]);add(h,box(.02,.12,.12),green,[s*.07,-.11,0])}};
  head(2.45,0,SIG.xr,SIG.xg);head(1.95,PI/2,SIG.zr,SIG.zg);
}

// ---------- buildings (built facing +z, origin at the ground centre) ----------
function house(p,x,z,ry,w,d,floors){
  const g=grp(p,x,GY+.1,z,ry),h=floors*1.7,wall=mat(pick(WALLS),.85),rh=1+r()*.5;
  add(g,box(w,h,d),wall,[0,h/2,0]);add(g,box(w+.1,.14,d+.1),M.trim,[0,.07,0]);
  add(g,geo('roof',()=>new THREE.ConeGeometry(1,1,4).rotateY(PI/4)),mat(pick(ROOFS),.7),[0,h+rh/2,0],[(w/2+.25)/.707,rh,(d/2+.25)/.707]);
  if(r()<.4)add(g,box(.32,.7,.32),M.trim,[w*.25,h+rh*.55,-d*.15]);
  add(g,box(.72,1.15,.06),M.door,[0,.6,d/2+.02]);add(g,box(1,.08,.5),M.trim,[0,.04,d/2+.25]);
  for(let f=0;f<floors;f++)for(const sx of f?[-.27,.27]:[-.3,.3]){const y=f*1.7+1;add(g,box(.74,.74,.04),M.trim,[w*sx,y,d/2+.01]);add(g,box(.62,.62,.06),M.win,[w*sx,y,d/2+.02])}
  for(let f=0;f<floors;f++)for(const s of[-1,1]){add(g,box(.04,.62,.62),M.win,[s*(w/2+.02),f*1.7+1,0])}
  bush(g,-w/2+.3,d/2+.5,.9);bush(g,w/2-.3,d/2+.5,.8);
}
function shop(p,x,z,ry,w,d){
  const g=grp(p,x,GY+.1,z,ry),h=2.5,accent=pick(ACCENTS),name=pick(SHOPS);
  add(g,box(w,h,d),mat(pick(WALLS),.85),[0,h/2,0]);add(g,box(w+.12,.22,d+.12),M.trim,[0,h+.11,0]);
  add(g,box(w*.82,1.35,.06),M.win,[0,.95,d/2+.02]);add(g,box(.06,1.35,.08),M.trim,[w*.15,.95,d/2+.04]);
  const aw=texMat('awn'+accent,(c,W,H)=>{for(let i=0;i<8;i++){c.fillStyle=i%2?'#fff':accent;c.fillRect(i*W/8,0,W/8,H)}});
  add(g,box(w*.9,.06,.8),aw,[0,1.85,d/2+.36],1,[.32,0,0]);
  const sign=texMat('sign'+name+accent,(c,W,H)=>{c.fillStyle=accent;c.fillRect(0,0,W,H);c.fillStyle='#fff';c.font=`bold ${H*.62}px Inter,Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(name,W/2,H*.55)});
  add(g,box(w*.62,.42,.06),sign,[0,2.2,d/2+.04]);
  bench(g,w*.32,d/2+1.05,0);
}
function apartment(p,x,z,ry,w,d,floors){
  const g=grp(p,x,GY+.1,z,ry),h=floors*1.6,fm=pick(FACADES),bg=new THREE.BoxGeometry(w,h,d),uv=bg.attributes.uv;
  // faces +x,-x,+y,-y,+z,-z: tile one 4×4 window texture per 4 floors × 6.4 m; roof/floor sample plain wall
  for(let f=0;f<6;f++)for(let i=0;i<4;i++){const k=f*4+i;if(f===2||f===3)uv.setXY(k,.01,.01);else uv.setXY(k,uv.getX(k)*(f<2?d:w)/6.4,uv.getY(k)*floors/4)}
  add(g,bg,fm,[0,h/2,0]);add(g,box(w+.14,.24,d+.14),M.trim,[0,h+.12,0]);add(g,box(w*.3,.6,d*.3),mat(0xcfd4dc,.7),[w*.18,h+.5,-d*.1]);
  add(g,box(1.4,1.3,.08),M.win,[0,.65,d/2+.04]);add(g,box(1.8,.08,.9),M.trim,[0,1.45,d/2+.4]);
}
// Pick a building for a lot by distance from the office: low near the camera orbit, taller far away
function building(p,x,z,ry,lotW,lotD){
  const dist=Math.hypot(x,z),k=r();
  if(dist<27){if(k<.62)house(p,x,z,ry,between(3.4,lotW-1.4),between(3.2,lotD-.8),1);else if(k<.9)shop(p,x,z,ry,between(3.8,lotW-1),between(3.2,lotD-.8));else tree(p,x,z,1.2)}
  else if(dist<37){if(k<.65)house(p,x,z,ry,between(3.6,lotW-1.2),between(3.4,lotD-.6),k<.3?1:2);else shop(p,x,z,ry,between(3.8,lotW-1),between(3.4,lotD-.6))}
  else apartment(p,x,z,ry,between(4.2,lotW-.6),between(4,lotD-.4),k<.6?4+(r()*4|0):8+(r()*6|0));
}
function fillCell(p,[x0,x1,z0,z1]){
  const LOT=5.8,D=5;
  const row=(a,b,place)=>{const n=Math.max(1,Math.floor((b-a)/LOT)),sp=(b-a)/n;for(let i=0;i<n;i++)place(a+sp*(i+.5),sp)};
  // lots face the road on each side of the cell that has one (outer edges of the map have none)
  if(z1<EDGE)row(x0,x1,(x,sp)=>building(p,x,z1-D/2-.4,0,sp,D));
  if(z0>-EDGE)row(x0,x1,(x,sp)=>building(p,x,z0+D/2+.4,PI,sp,D));
  if(x1-x0>0&&z1-z0>2*D+LOT){
    if(x1<EDGE)row(z0+D+.8,z1-D-.8,(z,sp)=>building(p,x1-D/2-.4,z,PI/2,sp,D));
    if(x0>-EDGE)row(z0+D+.8,z1-D-.8,(z,sp)=>building(p,x0+D/2+.4,z,-PI/2,sp,D));
  }
  // greenery in the middle of the block
  const ix0=x0+D+1.6,ix1=x1-D-1.6,iz0=z0+D+1.6,iz1=z1-D-1.6;
  for(let x=ix0;x<=ix1;x+=2.6)for(let z=iz0;z<=iz1;z+=2.6)if(r()<.7)(r()<.3?pine:tree)(p,x+between(-.4,.4),z+between(-.4,.4),between(.9,1.3));
}

// ---------- roads ----------
function roads(p){
  const L=2*LOOP+10;
  for(const x of XR)add(p,flat(HALF*2,L),M.road,[x,GY+.006,0]);
  for(const z of ZR)add(p,flat(L,HALF*2),M.road,[0,GY+.007,z]);
  const near=(v,list)=>list.some(c=>Math.abs(v-c)<HALF+.9);
  // dashed centre lines (skipping intersections)
  for(let s=-LOOP;s<=LOOP;s+=2.4){
    for(const x of XR)if(!near(s,ZR))add(p,flat(.12,1.1),M.paint,[x,GY+.012,s]);
    for(const z of ZR)if(!near(s,XR))add(p,flat(1.1,.12),M.paint,[s,GY+.012,z]);
  }
  // zebra crossings + stop lines on all four arms of every intersection
  for(const x of XR)for(const z of ZR){
    for(const sd of[-1,1]){
      for(let i=0;i<6;i++){const o=-HALF+.3+i*.6;
        add(p,flat(.34,1.3),M.paint,[x+o,GY+.013,z+sd*(HALF+.85)]);
        add(p,flat(1.3,.34),M.paint,[x+sd*(HALF+.85),GY+.013,z+o])}
      add(p,flat(HALF,.14),M.paint,[x-sd*HALF/2,GY+.013,z+sd*(HALF+1.7)]);
      add(p,flat(.14,HALF),M.paint,[x+sd*(HALF+1.7),GY+.013,z+sd*HALF/2]);
    }
    if(Math.abs(x)<20&&Math.abs(z)<20){trafficLight(p,x+HALF+.45,z+HALF+.45);trafficLight(p,x-HALF-.45,z-HALF-.45)}
  }
  // street lamps along both kerbs
  for(let s=-EDGE+4;s<EDGE-2;s+=9){
    for(const x of XR)if(!near(s,ZR))for(const sd of[-1,1])lamp(p,x+sd*(HALF+.35),s,sd>0?PI:0);
    for(const z of ZR)if(!near(s,XR))for(const sd of[-1,1])lamp(p,s,z+sd*(HALF+.35),sd>0?PI/2:-PI/2);
  }
}

// ---------- cars ----------
const CAR_COLORS=[0xe76f51,0x5b8def,0xf6f7fb,0xffc857,0x2a9d8f,0x8e7cc3,0xef8fa8,0x3b404c];
function makeCar(kind){
  const g=new THREE.Group();SHADOW=true;
  if(kind==='bus'){
    const c=mat(pick([0xffb703,0x2f80ed]),.6);
    add(g,box(3.6,1.15,1.15),c,[0,.82,0]);add(g,box(3.3,.42,1.17),M.cabin,[-.05,1.08,0]);add(g,box(.04,.6,1),M.cabin,[1.81,1.0,0]);
    add(g,box(3.62,.08,1.17),M.trim,[0,.42,0]);
    for(const sx of[-1.15,1.15])for(const sz of[-.5,.5])add(g,cyl(.24,.24,.2,14),M.tire,[sx,.24,sz],1,[PI/2,0,0]);
    for(const sz of[-.4,.4]){add(g,box(.04,.12,.18),M.head,[1.81,.55,sz]);add(g,box(.04,.12,.18),M.tail,[-1.81,.55,sz])}
  }else{
    const c=mat(pick(CAR_COLORS),.45);
    add(g,box(1.9,.42,.92),c,[0,.42,0]);add(g,box(1.05,.4,.84),M.cabin,[-.12,.82,0]);add(g,box(1.0,.07,.86),c,[-.12,1.04,0]);
    add(g,box(1.94,.1,.96),M.dark,[0,.24,0]);
    for(const sx of[-.6,.62])for(const sz of[-.44,.44])add(g,cyl(.2,.2,.16,14),M.tire,[sx,.2,sz],1,[PI/2,0,0]);
    for(const sz of[-.3,.3]){add(g,box(.04,.1,.18),M.head,[.96,.48,sz]);add(g,box(.04,.1,.18),M.tail,[-.96,.48,sz])}
  }
  const baked=bake(g);baked.userData.len=kind==='bus'?3.6:1.9;return baked;
}

// ---------- pedestrians walking loops around a block's sidewalk ----------
const LOOKS=[
  {...PRESETS.dev,top:0x2fae7a,hood:0xe8f5ee,cuff:0x2fae7a,band:0xe8f5ee,logo:'star',headphones:null,pose:'idle',seed:21},
  {...PRESETS.designer,top:0xff8fab,hood:0xff8fab,cuff:0xf27a98,band:0xf27a98,glasses:null,pose:'idle',seed:23},
  {...PRESETS.manager,top:0xdfe9ff,lanyard:null,pose:'idle',seed:25},
  {...PRESETS.student,robot:false,top:0xffb35c,hood:0xffd59a,cuff:0xf29c3c,band:0xf29c3c,headphones:null,pose:'idle',seed:27}
];
function sidewalkLoop(xi,zi){const x0=XR[xi]+HALF+.65,x1=XR[xi+1]-HALF-.65,z0=ZR[zi]+HALF+.65,z1=ZR[zi+1]-HALF-.65;return [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]}

export function createOutdoor(world){
  const stat=new THREE.Group();
  SHADOW=false;
  add(stat,flat(2*LOOP+60,2*LOOP+60),M.pave,[0,GY,0]);
  roads(stat);
  // city blocks: lawn inset from the kerbs, buildings along the roads
  const xs=[-EDGE,...XR.flatMap(x=>[x-HALF,x+HALF]),EDGE],zs=[-EDGE,...ZR.flatMap(z=>[z-HALF,z+HALF]),EDGE];
  for(let i=0;i<xs.length;i+=2)for(let j=0;j<zs.length;j+=2){
    const x0=xs[i]+(i?WALK:0),x1=xs[i+1]-(i+2<xs.length?WALK:0),z0=zs[j]+(j?WALK:0),z1=zs[j+1]-(j+2<zs.length?WALK:0);
    add(stat,box(x1-x0,.1,z1-z0),M.lawn,[(x0+x1)/2,GY+.05,(z0+z1)/2]);
    if(x0<0&&x1>0&&z0<0&&z1>0)continue;
    SHADOW=Math.max(Math.abs(x0+x1)/2,Math.abs(z0+z1)/2)<22;fillCell(stat,[x0,x1,z0,z1]);
  }
  // the office's own block: paved plinth with an entrance path, trees behind, low hedges in front
  SHADOW=true;
  add(stat,box(12.4,.16,9.4),M.plinth,[0,GY+.08,.1]);add(stat,box(2.2,.12,1.5),M.plinth,[0,GY+.06,5.5]);
  for(let x=-6.6;x<=7.6;x+=2.4)tree(stat,x,-5.55,1.1+r()*.2);
  for(let z=-3.6;z<=4.2;z+=2.6)tree(stat,-6.85,z,1);
  for(let x=-6.4;x<=7.8;x+=.75)if(Math.abs(x)>1.3)bush(stat,x,5.6,.75);
  for(let z=-4.2;z<=5.6;z+=.75)bush(stat,7.4,z,.7);
  bench(stat,-3.6,5.9,PI);bench(stat,3.6,5.9,PI);
  const city=bake(stat);world.add(city);

  // traffic: two lanes per road (right-hand traffic), cars stop at red lights and keep their distance
  const lanes=[];
  ZR.forEach((z,i)=>{const n=i===1||i===2?3:1;lanes.push({axis:'x',c:z+.9,dir:1,n},{axis:'x',c:z-.9,dir:-1,n})});
  XR.forEach((x,i)=>{const n=i===1||i===2?3:1;lanes.push({axis:'z',c:x-.9,dir:1,n},{axis:'z',c:x+.9,dir:-1,n})});
  const cars=[];
  for(const ln of lanes){ln.cars=[];for(let k=0;k<ln.n;k++){const m=makeCar(r()<.15?'bus':'car');world.add(m);
    const car={m,ln,len:m.userData.len,s:-LOOP+(k+r()*.6)*2*LOOP/ln.n,v:0,max:between(2.6,3.8)};
    m.rotation.y=ln.axis==='x'?(ln.dir>0?0:PI):(ln.dir>0?-PI/2:PI/2);ln.cars.push(car);cars.push(car)}}
  const crossings={x:XR,z:ZR};

  // passers-by
  const loops=[sidewalkLoop(1,1),sidewalkLoop(1,1),sidewalkLoop(1,2),sidewalkLoop(2,1)];
  const walkers=LOOKS.map((look,i)=>{
    const ch=createCharacter(look);world.add(ch.group);ch.setWalk(true);ch.group.position.y=GY+.01;
    const pts=loops[i],segs=pts.map((p,k)=>{const q=pts[(k+1)%pts.length];return {p,q,len:Math.hypot(q[0]-p[0],q[1]-p[1])}});
    const total=segs.reduce((a,s)=>a+s.len,0);
    return {ch,segs,total,d:total*i/LOOKS.length,dir:i%2?-1:1,speed:between(.75,.95)};
  });

  function update(t,dt){
    // signal cycle: 8 s green along x, 2 s all red, 8 s green along z, 2 s all red
    const c=(t/1000)%20,green=c<8?'x':c>=10&&c<18?'z':null;
    SIG.xg.emissiveIntensity=green==='x'?2.2:0;SIG.xr.emissiveIntensity=green==='x'?0:2.2;
    SIG.zg.emissiveIntensity=green==='z'?2.2:0;SIG.zr.emissiveIntensity=green==='z'?0:2.2;
    for(const car of cars){
      const {ln}=car;let v=car.max;
      if(green!==ln.axis)for(const cx of crossings[ln.axis]){const ds=(cx-ln.dir*(HALF+1.9+car.len/2)-car.s)*ln.dir;if(ds>-.05&&ds<8)v=Math.min(v,Math.max(0,ds)*1.2)}
      for(const o of ln.cars)if(o!==car){const gap=(o.s-car.s)*ln.dir;if(gap>0&&gap<10)v=Math.min(v,Math.max(0,gap-(o.len+car.len)/2-1)*1.2)}
      car.v+=Math.max(-7*dt,Math.min(2.5*dt,v-car.v));car.s+=car.v*dt*ln.dir;
      if(car.s*ln.dir>LOOP)car.s=-ln.dir*LOOP;
      if(ln.axis==='x')car.m.position.set(car.s,GY,ln.c);else car.m.position.set(ln.c,GY,car.s);
    }
    for(const w of walkers){
      w.d=((w.d+w.dir*w.speed*dt)%w.total+w.total)%w.total;
      let d=w.d,s=w.segs[0];for(s of w.segs){if(d<=s.len)break;d-=s.len}
      const k=d/s.len,dx=(s.q[0]-s.p[0])*w.dir,dz=(s.q[1]-s.p[1])*w.dir;
      w.ch.group.position.x=s.p[0]+(s.q[0]-s.p[0])*k;w.ch.group.position.z=s.p[1]+(s.q[1]-s.p[1])*k;
      w.ch.group.rotation.y=Math.atan2(dx,dz);w.ch.update(t);
    }
  }
  // Dusk turns on street lamps and lit windows; fog fades the far city into the sky colour
  function setScene(name){
    const dusk=name==='sunset';
    M.lamp.emissiveIntensity=dusk?2.6:.15;M.win.emissiveIntensity=dusk?.85:0;M.head.emissiveIntensity=dusk?2:.6;
    FACADES.forEach(f=>f.emissiveIntensity=dusk?.9:0);
    world.fog=new THREE.Fog(world.background?.getHex?.()??0xeef0fb,42,88);
  }
  return {update,setScene};
}
