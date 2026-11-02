import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
// Chibi office environment (after "Isometric Modern Office Interior"): tiled floor on a wood-edged base, floor-to-ceiling
// city windows, a glass dev room, an open desk pod, lounge with wall TV, pantry and cafe table, switchable outdoor scenery.
// Room floor spans x∈[-5.6,5.6], z∈[-4,4]; back wall at z=-4, left wall at x=-5.52. Floor top is at y=FY.
// Layout (x right, z toward the camera): back-left open pod by the corner windows · glass room front-middle-left ·
// wooden desk by the small left window · cabinet/AC, TV + console, bookshelf on the back wall · lounge in front of the TV ·
// pantry counter, water dispenser and cafe table front-right. wander.js holds the matching aisle graph.
const FY=-.06,WALL_H=2.8,WIN=[.85,2.35],TALL=[FY+.05,2.62],PI=Math.PI;
const geoCache=new Map(),matCache=new Map();
const geo=(k,make)=>{if(!geoCache.has(k))geoCache.set(k,make());return geoCache.get(k)};
const rbox=(w,h,d,r=.03)=>geo(`r${w}_${h}_${d}_${r}`,()=>new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/2-.002,h/2-.002,d/2-.002)));
const box=(w,h,d)=>geo(`b${w}_${h}_${d}`,()=>new THREE.BoxGeometry(w,h,d));
const cyl=(rt,rb,h,n=20)=>geo(`y${rt}_${rb}_${h}_${n}`,()=>new THREE.CylinderGeometry(rt,rb,h,n));
const sph=(r,w=20,h=14)=>geo(`s${r}_${w}`,()=>new THREE.SphereGeometry(r,w,h));
const tor=(r,t,arc=PI*2)=>geo(`t${r}_${t}_${arc}`,()=>new THREE.TorusGeometry(r,t,10,40,arc));
const plane=(w,h)=>geo(`p${w}_${h}`,()=>new THREE.PlaneGeometry(w,h));
const leafGeo=()=>geo('leaf',()=>new THREE.LatheGeometry([[0,0],[.3,.12],[.5,.38],[.42,.68],[.18,.9],[0,1]].map(p=>new THREE.Vector2(...p)),10));
const mat=(c,rough=.6,extra)=>{const k=`${c}_${rough}_${extra?JSON.stringify(extra):''}`;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:0,...extra}));return matCache.get(k)};
const glow=(c,i=1.4)=>mat(c,.3,{emissive:c,emissiveIntensity:i});
const M={
  wall:mat(0xf6f3ee,.9),skirt:mat(0xd8b48a,.7),frame:mat(0x2a2e38,.45),white:mat(0xf8f7f4,.45),cream:mat(0xf2eadf,.6),
  dark:mat(0x2b2f3a,.4),metal:mat(0x9aa0aa,.35),wood:mat(0xd4a271,.6),woodDark:mat(0xb7844f,.6),
  glass:new THREE.MeshStandardMaterial({color:0xcfe9ff,transparent:true,opacity:.16,roughness:.05,depthWrite:false}),
  glassWall:new THREE.MeshStandardMaterial({color:0xd9eefa,transparent:true,opacity:.2,roughness:.05,depthWrite:false,side:THREE.DoubleSide}),
  lightWood:mat(0xe2c08f,.55),
  orange:mat(0xf6a15c,.6),chair:mat(0x5b6272,.85),chairMesh:mat(0x6f7787,.8),chairDark:mat(0x353a45,.5)
};
const rng=seed=>()=>(seed=seed*16807%2147483647)/2147483647;
function add(p,g,m,pos=[0,0,0],s=1,r,shadow=true){const o=new THREE.Mesh(g,m);o.position.set(...pos);typeof s==='number'?o.scale.setScalar(s):o.scale.set(...s);if(r)o.rotation.set(...r);o.castShadow=shadow;o.receiveShadow=true;p.add(o);return o}
function grp(p,x=0,y=0,z=0,ry=0){const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=ry;p.add(g);return g}
function freeze(o){o.traverse(c=>{if(c.userData.dynamic)return;c.updateMatrix();c.matrixAutoUpdate=false})}
function canvasTex(w,h,draw,repeat){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat)}return t}
const texCache=new Map();
const screenMat=(kind,w=512,h=320)=>{const k=`${kind}_${w}_${h}`;if(!texCache.has(k))texCache.set(k,new THREE.MeshBasicMaterial({map:canvasTex(w,h,SCREENS[kind]),toneMapped:false}));return texCache.get(k)};
function rr(x,X,Y,W,H,R){x.beginPath();x.roundRect(X,Y,W,H,R)}

// ---------- canvas art: screens, boards, clock ----------
const SCREENS={
  ai:(x,W,H)=>{const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#2f6bff');g.addColorStop(1,'#a06bff');x.fillStyle=g;x.fillRect(0,0,W,H);x.fillStyle='#fff';x.font=`bold ${H*.36}px Inter,Arial`;x.textAlign='center';x.textBaseline='middle';x.fillText('✦ AI',W/2,H/2)},
  code:(x,W,H)=>{x.fillStyle='#1f2433';x.fillRect(0,0,W,H);const r=rng(5),c=['#7aa2ff','#c792ea','#7fdba0','#ffcb6b','#f78c6c','#cfd6e4'];for(let i=0;i<13;i++){let cx=W*.06+(r()*4|0)*W*.04;const y=H*.08+i*H*.068;while(cx<W*.9&&r()>.2){const w=W*(.04+r()*.14);x.fillStyle=c[r()*c.length|0];rr(x,cx,y,w,H*.035,4);x.fill();cx+=w+W*.015}}},
  laptop:(x,W,H)=>{const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#3b6df0');g.addColorStop(1,'#7a5cf0');x.fillStyle=g;x.fillRect(0,0,W,H);x.fillStyle='#fff';x.font=`bold ${H*.34}px Consolas,monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText('</>',W/2,H/2)},
  chart:(x,W,H)=>{x.fillStyle='#f6f8ff';x.fillRect(0,0,W,H);x.fillStyle='#dfe6fb';x.fillRect(0,0,W,H*.14);const v=[.35,.55,.42,.7,.62,.85];v.forEach((h,i)=>{x.fillStyle=i%2?'#7c6cf2':'#2f6bff';rr(x,W*(.08+i*.14),H*(.9-h*.65),W*.09,H*h*.65,6);x.fill()});x.strokeStyle='#ff9a5c';x.lineWidth=H*.025;x.beginPath();v.forEach((h,i)=>x.lineTo(W*(.125+i*.14),H*(.82-h*.6)));x.stroke()},
  design:(x,W,H)=>{x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#eef0fb';x.fillRect(0,0,W*.18,H);['#ffd166','#ff8fab','#7c6cf2','#2f6bff','#5fd0a0'].forEach((c,i)=>{x.fillStyle=c;x.beginPath();x.arc(W*.09,H*(.14+i*.18),H*.06,0,7);x.fill()});x.fillStyle='#ffd166';rr(x,W*.28,H*.15,W*.3,H*.4,18);x.fill();x.fillStyle='#ff8fab';x.beginPath();x.arc(W*.72,H*.4,H*.2,0,7);x.fill();x.fillStyle='#7c6cf2';rr(x,W*.28,H*.65,W*.6,H*.18,12);x.fill()},
  dashboard:(x,W,H)=>{x.fillStyle='#ffffff';x.fillRect(0,0,W,H);x.fillStyle='#2f6bff';x.fillRect(0,0,W,H*.12);x.fillStyle='#fff';x.font=`bold ${H*.07}px Inter,Arial`;x.textBaseline='middle';x.fillText('AI Office · Dashboard',W*.04,H*.06);[.4,.6,.5,.8,.7,.95,.75].forEach((h,i)=>{x.fillStyle=['#2f6bff','#5b8def','#a78bfa'][i%3];rr(x,W*(.05+i*.075),H*(.92-h*.6),W*.05,H*h*.6,4);x.fill()});x.lineWidth=H*.08;[['#2f6bff',0,1.3],['#a78bfa',1.3,2.1],['#ffd166',2.1,2*PI]].forEach(([c,a,b])=>{x.strokeStyle=c;x.beginPath();x.arc(W*.8,H*.56,H*.22,a,b);x.stroke()})},
  board:(x,W,H)=>{x.fillStyle='#fdfdfd';x.fillRect(0,0,W,H);[['#ffe27a',.05,.1],['#ff9fb8',.05,.45],['#9fd8ff',.18,.27]].forEach(([c,a,b])=>{x.fillStyle=c;x.fillRect(W*a,H*b,W*.1,H*.17)});x.strokeStyle='#2f6bff';x.lineWidth=4;[[.38,.15],[.38,.5],[.58,.32]].forEach(([a,b])=>{rr(x,W*a,H*b,W*.13,H*.15,6);x.stroke()});x.beginPath();x.moveTo(W*.51,H*.22);x.lineTo(W*.58,H*.39);x.moveTo(W*.51,H*.57);x.lineTo(W*.58,H*.42);x.stroke();[.3,.5,.4,.75,.9].forEach((h,i)=>{x.fillStyle='#5b8def';x.fillRect(W*(.76+i*.04),H*(.85-h*.35),W*.025,H*h*.35)});x.fillStyle='#9aa3b5';for(let i=0;i<4;i++)x.fillRect(W*.76,H*(.15+i*.07),W*(.12+(i%2)*.06),H*.02)},
  ac:(x,W,H)=>{x.fillStyle='#1d2433';rr(x,0,0,W,H,H*.2);x.fill();x.fillStyle='#e9f6ff';x.font=`bold ${H*.6}px Inter,Arial`;x.textAlign='center';x.textBaseline='middle';x.fillText('26°',W/2,H*.55)},
  clock:(x,W,H)=>{x.fillStyle='#fbf6ec';x.fillRect(0,0,W,H);x.fillStyle='#2b2f3a';for(let i=0;i<12;i++){x.save();x.translate(W/2,H/2);x.rotate(i*PI/6);x.fillRect(-W*(i%3?.008:.016),-H*.44,W*(i%3?.016:.032),H*(i%3?.06:.1));x.restore()}},
  // big wall TV: report with blue bars and an orange highlight bar, like the reference
  tv:(x,W,H)=>{x.fillStyle='#ffffff';x.fillRect(0,0,W,H);x.fillStyle='#1d2a44';x.fillRect(0,0,W,H*.1);x.fillStyle='#fff';x.font=`bold ${H*.05}px Inter,Arial`;x.textBaseline='middle';x.fillText('Báo cáo hiệu suất · Q3',W*.03,H*.05);
    x.fillStyle='#9aa3b5';for(let i=0;i<3;i++)x.fillRect(W*.05,H*(.16+i*.04),W*(.2-i*.05),H*.015);x.strokeStyle='#e6e9f2';x.lineWidth=2;for(let i=0;i<5;i++){x.beginPath();x.moveTo(W*.05,H*(.35+i*.13));x.lineTo(W*.95,H*(.35+i*.13));x.stroke()}
    [.28,.38,.45,.55,.62,.75].forEach((h,i)=>{x.fillStyle=i===5?'#f59a4b':'#2f6bff';rr(x,W*(.1+i*.14),H*(.87-h*.75),W*.08,H*h*.75,6);x.fill()})},
  keys:(x,W,H)=>{x.fillStyle='#e3e6ee';x.fillRect(0,0,W,H);x.fillStyle='#ffffff';for(let r=0;r<4;r++)for(let c=0;c<14;c++){rr(x,c*W/14+3,r*H/4+3,W/14-6,H/4-6,4);x.fill()}}
};

// ---------- outdoor scenery painted on canvases behind the window openings ----------
function sky(x,W,H,stops){const g=x.createLinearGradient(0,0,0,H);stops.forEach(([p,c])=>g.addColorStop(p,c));x.fillStyle=g;x.fillRect(0,0,W,H)}
function clouds(x,W,H,r,color){x.fillStyle=color;for(let i=0;i<W/300;i++){const cx=r()*W,cy=H*(.12+r()*.22),s=H*(.04+r()*.04);for(let k=0;k<5;k++){x.beginPath();x.ellipse(cx+(k-2)*s*1.1,cy-(k%2)*s*.35,s*1.3,s*.8,0,0,7);x.fill()}}}
function skyline(x,W,H,r,{base,minH,maxH,color,glass,win,winOn=1,minW=.02,maxW=.05}){
  for(let cx=-10;cx<W;){const w=W*(minW+r()*(maxW-minW)),h=H*(minH+r()*(maxH-minH));
    x.fillStyle=color;x.fillRect(cx,base-h,w,h+2);if(glass){x.fillStyle=glass;x.fillRect(cx+w*.58,base-h,w*.42,h)}
    if(win){x.fillStyle=win;const cols=Math.max(2,w/10|0),rows=h/11|0;for(let i=0;i<cols;i++)for(let j=1;j<rows;j++)if(r()<winOn)x.fillRect(cx+3+i*(w-4)/cols,base-h+j*11,(w-4)/cols-3,4)}
    cx+=w+W*(.002+r()*.008)}
}
function treeRow(x,W,base,r,colors,size){for(let cx=-size;cx<W+size;cx+=size*(.8+r()*.6)){const s=size*(.7+r()*.5);x.fillStyle=colors[r()*colors.length|0];x.beginPath();x.arc(cx,base-s*.5,s,0,7);x.fill()}}
function tower(x,cx,base,w,h,color,accent){x.fillStyle=color;x.fillRect(cx-w/2,base-h,w,h);x.fillRect(cx-w*.3,base-h-h*.08,w*.6,h*.08);x.fillStyle=accent;x.fillRect(cx-1.5,base-h-h*.25,3,h*.18);x.fillRect(cx+w*.1,base-h,w*.4,h)}
const SCENERY={
  day:{label:'Thành phố ban ngày',swatch:'linear-gradient(135deg,#69b4f0,#e9f6ff)',bg:0xeef0fb,hemi:[0xeef5ff,0xcdb9a2,2.5],sun:[0xfff3e2,3.1],sunPos:[-4,12,7],exposure:1.38,
    draw:(x,W,H,seed)=>{const r=rng(seed);sky(x,W,H,[[0,'#69b4f0'],[.6,'#bfe3ff'],[1,'#e9f6ff']]);clouds(x,W,H,r,'rgba(255,255,255,.92)');
      skyline(x,W,H,r,{base:H*.86,minH:.2,maxH:.45,color:'#b9d2ea'});if(seed===1)tower(x,W*.5,H*.86,W*.022,H*.62,'#6f9bcf','#4a78b5');
      skyline(x,W,H,r,{base:H*.9,minH:.14,maxH:.36,color:'#7ea8d6',glass:'#94bde8',win:'rgba(232,246,255,.75)',winOn:.8});
      x.fillStyle='#86c873';x.fillRect(0,H*.88,W,H*.12);treeRow(x,W,H*.95,r,['#6cbf5e','#5aae55','#86cf6c'],H*.075);treeRow(x,W,H*1.02,r,['#4f9d50','#5fae5a','#78c167'],H*.09)}},
  sunset:{label:'Thành phố hoàng hôn',swatch:'linear-gradient(135deg,#6d5bb5,#f39bb0,#ffc98a)',bg:0xf6ebf1,hemi:[0xffe2e8,0x8f6f80,2.2],sun:[0xffb27e,3.1],sunPos:[-7,7,5],exposure:1.35,
    draw:(x,W,H,seed)=>{const r=rng(seed);sky(x,W,H,[[0,'#5a4ea8'],[.35,'#c873b0'],[.65,'#f8a38f'],[1,'#ffd08a']]);
      const sx=W*(seed===1?.64:.3),sy=H*.62,g=x.createRadialGradient(sx,sy,0,sx,sy,H*.45);g.addColorStop(0,'rgba(255,236,170,.95)');g.addColorStop(.25,'rgba(255,214,150,.55)');g.addColorStop(1,'rgba(255,190,150,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
      x.fillStyle='#ffe7a8';x.beginPath();x.arc(sx,sy,H*.09,0,7);x.fill();clouds(x,W,H,r,'rgba(255,205,215,.5)');
      skyline(x,W,H,r,{base:H*.86,minH:.2,maxH:.45,color:'#a27cb2'});if(seed===1)tower(x,W*.45,H*.86,W*.022,H*.62,'#5a467f','#3d2f5c');
      skyline(x,W,H,r,{base:H*.9,minH:.14,maxH:.36,color:'#4f3f7a',glass:'#5d4b8a',win:'#ffd37a',winOn:.35});
      x.fillStyle='#4a4a6a';x.fillRect(0,H*.9,W,H*.1);treeRow(x,W,H*.97,r,['#3d4f63','#465a6a','#354558'],H*.055)}},
  campus:{label:'Khu công nghệ',swatch:'linear-gradient(135deg,#7cc3f2,#8fd17a)',bg:0xedf5f0,hemi:[0xf0fbff,0xbccca8,2.5],sun:[0xfff6e6,3.1],sunPos:[4,12,8],exposure:1.38,
    draw:(x,W,H,seed)=>{const r=rng(seed);sky(x,W,H,[[0,'#7cc3f2'],[.7,'#d4efff'],[1,'#eef9ff']]);clouds(x,W,H,r,'rgba(255,255,255,.92)');
      treeRow(x,W,H*.8,r,['#9fd08f','#8cc78a'],H*.07);
      for(let i=0,cx=W*.04;i<4;i++){const w=W*(.16+r()*.08),h=H*(.28+r()*.16),b=H*.84;x.fillStyle='#f5f7fb';x.fillRect(cx,b-h,w,h);for(let k=0;k<4;k++){x.fillStyle='#6fa8e0';x.fillRect(cx+w*.04,b-h+h*(.12+k*.21),w*.92,h*.12);x.fillStyle='#a9cff3';x.fillRect(cx+w*.04,b-h+h*(.12+k*.21),w*.3,h*.05)}x.fillStyle='#dfe5ee';x.fillRect(cx-4,b-h-6,w+8,8);
        if(i===1&&seed===1){x.fillStyle='#2b6fd6';x.font=`bold ${H*.06}px Inter,Arial`;x.fillText('AI Tech Park',cx+w*.08,b-h-12)}cx+=w+W*(.06+r()*.06)}
      const g=x.createLinearGradient(0,H*.84,0,H);g.addColorStop(0,'#9ad986');g.addColorStop(1,'#78c167');x.fillStyle=g;x.fillRect(0,H*.84,W,H*.16);
      x.fillStyle='#efe2c4';x.beginPath();x.ellipse(W*.55,H*.97,W*.2,H*.04,0,0,7);x.fill();
      for(let cx=W*.03;cx<W;cx+=W*(.12+r()*.1)){const s=H*(.08+r()*.04);x.fillStyle='#8a6a4a';x.fillRect(cx-3,H*.9-s,6,s);x.fillStyle=r()>.5?'#5fb35a':'#4fa04e';x.beginPath();x.arc(cx,H*.9-s*1.3,s*.9,0,7);x.fill()}}}
};

// ---------- room shell ----------
// Window in [a,b] (local x) between heights y0..y1: thin dark frame, mullions about every metre, glass pane
function windowFrame(g,a,b,t,y0,y1){
  const w=b-a,cx=(a+b)/2,h=y1-y0,cy=(y0+y1)/2,tall=y0<.3;
  for(const y of[y0,y1])add(g,box(w,.05,t+.03),M.frame,[cx,y,0]);
  const n=Math.max(1,Math.round(w/(tall?.95:1.05)));
  for(let i=0;i<=n;i++)add(g,box(.045,h,t+.03),M.frame,[a+i*w/n,cy,0]);
  if(!tall){add(g,box(w,.035,t+.03),M.frame,[cx,y0+h*.72,0]);add(g,rbox(w+.12,.04,.16,.015),M.white,[cx,y0-.01,t/2+.05])}
  add(g,plane(w,h),M.glass,[cx,cy,0],1,null,false);
}
// Wall along local x from x0 to x1; interior side is local +z. Openings are [a,b] (standard window) or
// [a,b,y0,y1] (e.g. floor-to-ceiling). Returns the scenery plane behind it.
function wall(p,{x0,x1,t=.18,openings=[]},pos,ry){
  const g=grp(p,...pos,ry),base=FY,top=base+WALL_H;
  openings=openings.map(o=>[o[0],o[1],o[2]??WIN[0],o[3]??WIN[1]]).sort((a,b)=>a[0]-b[0]);
  let cur=x0;const solid=[];for(const [a,b] of openings){solid.push([cur,a]);cur=b}solid.push([cur,x1]);
  for(const [a,b] of solid)if(b>a)add(g,box(b-a,WALL_H,t),M.wall,[(a+b)/2,base+WALL_H/2,0]);
  for(const [a,b,y0,y1] of openings){
    if(y0-base>.02)add(g,box(b-a,y0-base,t),M.wall,[(a+b)/2,(base+y0)/2,0]);
    add(g,box(b-a,top-y1,t),M.wall,[(a+b)/2,(y1+top)/2,0]);
    windowFrame(g,a,b,t,y0,y1);
  }
  add(g,box(x1-x0,.1,.02),M.skirt,[(x0+x1)/2,base+.05,t/2+.01]);
  add(g,box(x1-x0,.04,t+.02),M.white,[(x0+x1)/2,top,0]);
  const view=add(g,plane(x1-x0,2.75),new THREE.MeshBasicMaterial({toneMapped:false}),[(x0+x1)/2,1.32,-t/2-.05],1,null,false);
  view.receiveShadow=false;
  return view;
}
// Large light-beige tiles with thin grout on a raised base wrapped in warm wood
function floorSlab(p){
  const tex=canvasTex(1024,1024,(x,W,H)=>{const r=rng(7),n=3,s=W/n;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){const v=r()*5-2.5,g=x.createLinearGradient(i*s,j*s,(i+1)*s,(j+1)*s);
      g.addColorStop(0,`hsl(32,${42+v}%,${80+v*.3}%)`);g.addColorStop(1,`hsl(30,${40+v}%,${76+v*.3}%)`);x.fillStyle=g;x.fillRect(i*s,j*s,s,s);
      x.fillStyle='rgba(255,255,255,.18)';x.fillRect(i*s+6,j*s+6,s*.5,4)}
    x.fillStyle='#bfa98e';for(let k=0;k<=n;k++){x.fillRect(k*s-3,0,6,H);x.fillRect(0,k*s-3,W,6)}},[5.6,4]);
  const top=new THREE.MeshStandardMaterial({map:tex,roughness:.5}),side=mat(0xd2a26c,.6);
  add(p,box(11.2,.3,8),[side,side,top,side,side,side],[0,FY-.15,0],1,null,false);
  // wood edge band around the base
  add(p,rbox(11.5,.2,8.3,.04),mat(0xc99a66,.55),[0,FY-.36,0],1,null,false);
  add(p,rbox(11.62,.06,8.42,.03),mat(0xb5844f,.6),[0,FY-.47,0],1,null,false);
}
// Glass wall along local x (0..len): thin dark frame and posts, clear glass; an optional door gap [a,b] gets a
// framed glass door with long bar handles
function glassPartition(p,len,pos,ry,{door}={}){
  const g=grp(p,...pos,ry),H=2.3,posts=Math.max(1,Math.round(len/1.1));
  for(const y of[FY+.03,FY+H])add(g,box(len,.05,.06),M.frame,[len/2,y,0]);
  for(let i=0;i<=posts;i++){const px=i*len/posts;if(door&&px>door[0]+.02&&px<door[1]-.02)continue;add(g,box(.045,H,.05),M.frame,[px,FY+H/2,0])}
  const segs=door?[[0,door[0]],[door[1],len]]:[[0,len]];
  for(const [a,b] of segs)if(b-a>.02)add(g,plane(b-a,H-.05),M.glassWall,[(a+b)/2,FY+H/2,0],1,null,false);
  if(door){const [a,b]=door,w=b-a;
    for(const px of[a,b])add(g,box(.05,H,.06),M.frame,[px,FY+H/2,0]);
    const d=grp(g,a+.03,0,.12,-.35);// door left slightly ajar
    add(d,box(w-.06,.05,.04),M.frame,[(w-.06)/2,FY+.06,0]);add(d,box(w-.06,.05,.04),M.frame,[(w-.06)/2,FY+H-.06,0]);
    add(d,box(.04,H-.1,.04),M.frame,[w-.08,FY+H/2,0]);add(d,plane(w-.1,H-.15),M.glassWall,[(w-.06)/2,FY+H/2,0],1,null,false);
    for(const s of[-1,1])add(d,cyl(.012,.012,.5,8),M.metal,[w-.16,FY+1.05,s*.035])}
}

// ---------- furniture ----------
// Ergonomic chair: 5-star base on casters, gas lift, padded seat, mesh back with lumbar pad, headrest, padded arms
const meshTex=()=>texCache.get('mesh')||(texCache.set('mesh',canvasTex(128,128,(x,W,H)=>{x.fillStyle='#454b5a';x.fillRect(0,0,W,H);x.strokeStyle='#30343f';x.lineWidth=2;for(let i=-W;i<W*2;i+=10){x.beginPath();x.moveTo(i,0);x.lineTo(i+H,H);x.stroke();x.beginPath();x.moveTo(i,H);x.lineTo(i+H,0);x.stroke()}},[3,3])),texCache.get('mesh'));
const curvedBack=()=>geo('chairBack',()=>{return new THREE.CylinderGeometry(.62,.62,1,24,1,true,Math.PI-.4,.8)});
function chair(p,x,z,ry,s=1){
  const g=grp(p,x,FY,z,ry);g.scale.setScalar(s);
  const meshM=M.chairMeshT||(M.chairMeshT=new THREE.MeshStandardMaterial({map:meshTex(),roughness:.85,side:THREE.DoubleSide}));
  for(let i=0;i<5;i++){const a=i*PI*2/5,leg=grp(g,0,.075,0,a);add(leg,rbox(.055,.045,.3,.018),M.chairDark,[0,0,.15],1,[.12,0,0]);
    add(g,cyl(.018,.018,.05,8),M.chairDark,[Math.sin(a)*.29,.06,Math.cos(a)*.29]);add(g,cyl(.032,.032,.034,14),mat(0x23262e,.5),[Math.sin(a)*.29,.032,Math.cos(a)*.29],1,[0,a,PI/2])}
  add(g,cyl(.05,.05,.04,16),M.chairDark,[0,.1,0]);add(g,cyl(.034,.04,.16,12),M.chairDark,[0,.18,0]);add(g,cyl(.022,.022,.2,12),M.metal,[0,.33,0]);
  add(g,rbox(.36,.05,.32,.02),M.chairDark,[0,.43,0]);
  add(g,rbox(.52,.09,.5,.04),mat(0x3c4150,.85),[0,.49,.01]);add(g,rbox(.48,.03,.44,.015),mat(0x484d5c,.9),[0,.54,.02],1,null,false);
  // back: dark curved frame + mesh panel, tilted slightly back
  const back=grp(g,0,.6,-.25);back.rotation.x=-.13;
  add(back,box(.05,.18,.035),M.chairDark,[0,.02,.02]);
  add(back,curvedBack(),meshM,[0,.33,.6],[1,.5,1]);
  for(const sx of[-1,1])add(back,rbox(.035,.52,.04,.015),M.chairDark,[sx*.245,.33,-.015],1,[0,-sx*.35,0]);
  add(back,tor(.25,.016,PI),M.chairDark,[0,.33+.2,-.02],[1,.25,1]);
  add(back,rbox(.3,.055,.025,.012),mat(0x4a505d,.7),[0,.2,.008]);
  // headrest
  add(back,box(.025,.14,.025),M.chairDark,[0,.66,-.03]);add(back,rbox(.32,.12,.06,.03),M.chairDark,[0,.76,-.02]);add(back,rbox(.28,.08,.012,.006),meshM,[0,.76,.013],1,null,false);
  // arms
  for(const sx of[-1,1]){add(g,rbox(.035,.2,.05,.012),M.chairDark,[sx*.27,.6,-.02]);add(g,rbox(.035,.03,.12,.012),M.chairDark,[sx*.27,.5,-.07]);add(g,rbox(.08,.035,.26,.016),mat(0x3a3f4b,.6),[sx*.27,.715,.01])}
  return g;
}
// Broad glossy leaf (pothos / rubber plant): pointed outline folded along the midrib and arched along its length
const leafTex=()=>texCache.get('leaf')||(texCache.set('leaf',canvasTex(128,256,(x,W,H)=>{const g=x.createLinearGradient(0,0,W,0);g.addColorStop(0,'#3f8f3f');g.addColorStop(.5,'#6cbf5a');g.addColorStop(1,'#4c9e45');x.fillStyle=g;x.fillRect(0,0,W,H);x.strokeStyle='rgba(220,245,190,.75)';x.lineWidth=3;x.beginPath();x.moveTo(W/2,H);x.lineTo(W/2,0);x.stroke();x.lineWidth=1.4;x.strokeStyle='rgba(210,240,180,.4)';for(let i=1;i<8;i++){const y=H-i*H/8;x.beginPath();x.moveTo(W/2,y+12);x.quadraticCurveTo(W*.3,y,W*.08,y-14);x.moveTo(W/2,y+12);x.quadraticCurveTo(W*.7,y,W*.92,y-14);x.stroke()}})),texCache.get('leaf'));
const broadLeaf=()=>geo('broadLeaf',()=>{
  const seg=12,cols=6,pos=[],uv=[],idx=[];
  for(let j=0;j<=seg;j++){const v=j/seg,half=Math.sin(Math.PI*Math.pow(v,.85))*.5*(1-v*.15);
    for(let i=0;i<=cols;i++){const u=i/cols,xx=(u-.5)*2*half;pos.push(xx,v,-Math.abs(xx)*.3+v*v*.32);uv.push(u,v)}}
  for(let j=0;j<seg;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;idx.push(a,b,a+1,a+1,b,b+1)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g});
const potGeo=()=>geo('pot',()=>new THREE.LatheGeometry([[0,0],[.13,0],[.15,.02],[.19,.12],[.205,.24],[.2,.33],[.21,.35],[.215,.37],[.2,.38],[.185,.36]].map(p=>new THREE.Vector2(...p)),28));
function plant(p,x,z,{s=1,pot=0xf3ede4,leaves=15,seed=1,tall=.6,y=FY}={}){
  const g=grp(p,x,y,z),r=rng(seed);g.scale.setScalar(s);
  const leafM=M.leaf||(M.leaf=new THREE.MeshStandardMaterial({map:leafTex(),roughness:.45,side:THREE.DoubleSide})),stemM=mat(0x4f8f3e,.7);
  add(g,potGeo(),mat(pot,.45));add(g,cyl(.185,.185,.02,24),mat(0x6b4a33,.95),[0,.35,0],1,null,false);
  const n=Math.max(6,Math.round(leaves*.8));
  for(let i=0;i<n;i++){
    // stem rises from the soil, leaning out; the leaf hangs off its tip
    const yaw=i/n*PI*2+r()*.5,lean=.15+r()*.75,len=tall*(.45+r()*.55),sg=grp(g,0,.35,0,yaw);
    const st=grp(sg);st.rotation.x=lean;add(st,cyl(.008,.011,len,6),stemM,[0,len/2,0],1,null,false);
    const lf=grp(st,0,len,0);lf.rotation.x=.25+r()*.5;const L=tall*(.42+r()*.3);add(lf,broadLeaf(),leafM,[0,0,0],[L*.62,L,L*.62]);
  }
  return g;
}
function monitor(p,x,z,kind,ry=0){
  const g=grp(p,x,.76,z,ry);
  // slim bezel on a rounded stand with an oval foot; thicker rear housing
  add(g,cyl(.1,.11,.014,28),M.dark,[0,.007,-.02],[1,1,.7]);add(g,rbox(.05,.24,.03,.012),mat(0x3a3f4b,.4),[0,.13,-.05],1,[-.08,0,0]);
  add(g,rbox(.64,.4,.03,.018),M.dark,[0,.33,-.01]);add(g,rbox(.4,.26,.04,.03),mat(0x3a3f4b,.4),[0,.32,-.035]);
  add(g,plane(.615,.375),screenMat(kind),[0,.335,.0055],1,null,false);add(g,sph(.006,8,6),glow(0x7fd8ff,1),[.27,.142,.008],1,null,false);
}
function laptop(p,x,z,ry=0,kind='laptop'){
  const g=grp(p,x,.76,z,ry);
  add(g,rbox(.36,.018,.25,.008),mat(0xc9ced8,.35),[0,.009,0]);add(g,plane(.3,.13),mat(0x8d94a3,.6),[0,.0185,.02],1,[-PI/2,0,0],false);
  const lid=grp(g,0,.018,-.12);lid.rotation.x=-.28;add(lid,rbox(.36,.24,.012,.006),mat(0xc9ced8,.35),[0,.12,0]);add(lid,plane(.32,.2),screenMat(kind),[0,.12,.0065],1,null,false);
}
const PROPS={
  // takeaway cup: white tapered cup, kraft sleeve with a bean mark, dark domed lid
  coffee:(g)=>{add(g,geo('cup',()=>new THREE.LatheGeometry([[0,0],[.032,0],[.034,.004],[.044,.11],[0,.11]].map(p=>new THREE.Vector2(...p)),20)),M.white);
    add(g,cyl(.0425,.038,.045,20),mat(0xc69466,.75),[0,.06,0]);add(g,sph(.012,10,8),mat(0x6e4529,.6),[0,.06,.04],[1,1.4,.4],null,false);
    add(g,cyl(.047,.047,.012,20),mat(0x3b2f2a,.5),[0,.115,0]);add(g,sph(.04,16,8),mat(0x3b2f2a,.5),[0,.12,0],[1,.25,1])},
  // spiral notebook: purple cover, page block, ring binding and an orange strap
  notebook:(g)=>{g.rotation.y=.3;add(g,rbox(.17,.012,.22,.005),mat(0x9a7cf0,.55),[0,.006,0]);add(g,box(.155,.012,.205),mat(0xfbf8f2,.8),[.005,.017,0]);add(g,rbox(.17,.012,.22,.005),mat(0xa78bfa,.55),[0,.028,0]);
    for(let i=0;i<8;i++)add(g,tor(.011,.0025),M.metal,[-.085,.018,-.09+i*.026],1,[0,PI/2,0],false);add(g,box(.02,.036,.05),mat(0xf4a261,.6),[.075,.018,0])},
  pens:(g)=>{add(g,geo('penCup',()=>new THREE.LatheGeometry([[0,0],[.036,0],[.04,.005],[.04,.1],[.036,.1],[.034,.008],[0,.008]].map(p=>new THREE.Vector2(...p)),20)),mat(0xe8eaf0,.45));
    [[0x2f6bff,.35,-.012],[0xffd166,-.25,.012],[0x2b2f3a,.08,0],[0x7bc47f,-.05,-.018]].forEach(([c,a,o],i)=>{const pg=grp(g,o,.02,(i%2-.5)*.02);pg.rotation.set(a*.3,0,a*.4);add(pg,cyl(.0055,.0055,.15,6),mat(c,.4),[0,.075,0],1,null,false);add(pg,cyl(.0065,.004,.03,6),mat(c,.3),[0,.16,0],1,null,false)})},
  plant:(g)=>plant(g,0,0,{s:.32,y:0,leaves:8,seed:4,tall:.5}),
  // coiled USB cable
  cable:(g)=>{g.rotation.y=.6;for(let i=0;i<3;i++)add(g,tor(.06-i*.004,.006),mat(0xe9ebf0,.4),[0,.007+i*.009,0],1,[PI/2,0,i*.4],false);for(const s of[-1,1]){add(g,rbox(.03,.014,.05,.005),mat(0xf2f3f6,.4),[s*.09,.008,s*.03],1,[0,s*.5,0]);add(g,box(.016,.008,.02),M.metal,[s*.1,.008,s*.06],1,[0,s*.5,0],false)}},
  // desk robot: white egg body, dark visor with glowing blue eyes, cat ears, blue ear pods and chest light
  robot:(g)=>{g.rotation.y=.4;const w=mat(0xf6f7fc,.25),blue=mat(0x5b8def,.35);add(g,sph(.055),w,[0,.06,0],[1,1.05,.95]);add(g,cyl(.016,.016,.006,12),glow(0x6fb6ff,1.4),[0,.07,.052],1,[PI/2,0,0],false);
    for(const s of[-1,1])add(g,sph(.02,10,8),w,[s*.062,.07,0],[.6,1.2,.8]);
    const h=grp(g,0,.16,0);add(h,sph(.075),w,[0,0,0],[1.2,.9,1]);add(h,sph(.06),mat(0x1c2340,.15),[0,-.004,.035],[1.1,.72,.75]);
    for(const s of[-1,1]){add(h,sph(.012,12,8),glow(0x7fd8ff,1.8),[s*.024,0,.083],[1,.8,.4],null,false);add(h,cyl(.03,.03,.02,16),blue,[s*.09,0,0],1,[0,0,PI/2]);
      const ear=add(h,geo('ear',()=>new THREE.ConeGeometry(.028,.05,14)),w,[s*.052,.068,0],1,[0,0,-s*.38]);add(h,geo('earIn',()=>new THREE.ConeGeometry(.016,.03,12)),mat(0xffb4c8,.5),[s*.054,.066,.012],1,[0,0,-s*.38],false)}}
};
// Office desk: white top on white panel ends, white drawer pedestal, dark PC tower underneath and a coloured
// fabric divider at the back (blue by default, pink/blue in the glass room)
function desk(p,x,z,ry,opt={}){
  const g=grp(p,x,FY,z,ry);
  add(g,rbox(1.46,.06,.7,.02),M.white,[0,.73,0]);
  for(const sx of[-.7,.7])add(g,rbox(.05,.7,.64,.02),mat(0xeeeef0,.45),[sx,.35,0]);
  add(g,rbox(1.32,.18,.02,.01),mat(0xe4e5ea,.5),[0,.58,-.3]);
  add(g,rbox(.4,.6,.6,.03),mat(0xf4f4f6,.45),[.42,.31,-.02]);
  for(let k=0;k<3;k++){add(g,rbox(.36,.17,.02,.008),mat(0xfbfbfc,.4),[.42,.12+k*.19,.285]);add(g,box(.12,.015,.015),M.dark,[.42,.17+k*.19,.3],1,null,false)}
  if(opt.tower!==false){add(g,rbox(.2,.44,.46,.02),mat(0x2f333d,.45),[-.4,.23,-.04]);add(g,box(.004,.3,.004),glow(0x6fb6ff,1),[-.3,.26,.19],1,null,false)}
  add(g,rbox(1.3,.32,.035,.015),mat(opt.divider??0x5b8def,.75),[0,.99,-.33]);for(const sx of[-.45,.45])add(g,box(.03,.08,.06),M.dark,[sx,.78,-.33]);
  if(opt.screen!==false)monitor(g,-.05,-.15,opt.screen||'ai');
  add(g,rbox(.42,.02,.13,.008),mat(0xf4f5f8,.5),[-.05,.77,.12]);add(g,plane(.4,.11),screenMat('keys',512,140),[-.05,.7805,.12],1,[-PI/2,0,0],false);
  add(g,sph(.035),mat(0xf4f5f8,.3),[.27,.77,.13],[.75,.45,1.1]);add(g,box(.004,.004,.025),glow(0x8fd3ff,1.2),[.27,.787,.115],1,null,false);
  const slots=[[.55,-.2],[-.56,-.18],[.53,.17],[-.53,.16]];
  if(opt.laptop){laptop(g,-.5,.05,.35,opt.laptop===true?'laptop':opt.laptop);slots.splice(3,1);slots.splice(1,1)}
  (opt.props||[]).forEach((name,i)=>{if(slots[i])PROPS[name](grp(g,slots[i][0],.76,slots[i][1]))});
  return g;
}
// Dark gray two-door storage cabinet (lower and upper doors) with boxes on top
function cabinet(p,x,z,ry){
  const g=grp(p,x,FY,z,ry),body=mat(0x5a5f6b,.5),door=mat(0x6b707c,.45);
  add(g,rbox(.9,1.3,.44,.03),body,[0,.66,0]);add(g,rbox(.86,.05,.4,.015),mat(0x40444f,.6),[0,.025,0]);
  for(const [cy,h] of[[.36,.52],[.96,.52]])for(const sx of[-1,1]){add(g,rbox(.41,h,.025,.012),door,[sx*.215,cy,.22]);add(g,rbox(.02,.12,.02,.008),mat(0xc9ced8,.3),[sx*.035,cy,.24],1,null,false)}
  add(g,rbox(.28,.22,.26,.015),mat(0xf3f1ec,.7),[-.2,1.42,0]);add(g,box(.29,.02,.27),mat(0xcfc8bb,.7),[-.2,1.5,0]);
  add(g,rbox(.24,.2,.22,.015),mat(0xe9dcc3,.7),[.18,1.41,.02]);add(g,box(.12,.06,.002),mat(0x5b8def,.5),[.18,1.42,.131],1,null,false);
}
function waterCooler(p,x,z,ry){
  // white dispenser body, red/blue taps over a drip tray, cup stack, upturned blue bottle with rings
  const g=grp(p,x,FY,z,ry),w=mat(0xf6f6f3,.35);add(g,rbox(.34,.95,.34,.05),w,[0,.475,0]);add(g,rbox(.36,.04,.36,.02),mat(0xe4e4e0,.4),[0,.97,0]);
  add(g,rbox(.24,.2,.04,.02),mat(0xe9e9e6,.4),[0,.68,.17]);add(g,rbox(.2,.025,.1,.01),M.dark,[0,.55,.17]);
  for(const [sx,c] of[[-.05,0xe85d5d],[.05,0x4f8ff0]]){add(g,rbox(.035,.05,.04,.01),mat(c,.35),[sx,.68,.2]);add(g,cyl(.008,.008,.03,8),mat(c,.35),[sx,.645,.21],1,null,false)}
  add(g,cyl(.05,.05,.05),mat(0x4f8ff0,.4),[0,1.01,0]);
  add(g,geo('bottle',()=>new THREE.LatheGeometry([[0,0],[.04,0],[.05,.04],[.14,.1],[.145,.18],[.14,.26],[.145,.34],[.14,.4],[.12,.44],[0,.45]].map(p=>new THREE.Vector2(...p)),24)),new THREE.MeshStandardMaterial({color:0x7fc0f5,transparent:true,opacity:.72,roughness:.08,metalness:.05}),[0,1.03,0]);
}
function trashBin(p,x,z){const g=grp(p,x,FY,z),gray=mat(0xb6bbc6,.45);
  add(g,geo('bin',()=>new THREE.LatheGeometry([[0,0],[.11,0],[.12,.01],[.142,.36],[.135,.37],[0,.37]].map(p=>new THREE.Vector2(...p)),26)),gray);
  add(g,cyl(.155,.15,.05,26),mat(0x5b6170,.45),[0,.39,0]);add(g,sph(.15,24,8),mat(0x5b6170,.45),[0,.41,0],[1,.15,1]);add(g,rbox(.08,.012,.02,.006),M.dark,[0,.395,.15],1,null,false)}
// Dome pendant lamp with a warm glowing underside
function domeLamp(p,x,z,y=2.25){const g=grp(p,x,0,z);add(g,cyl(.005,.005,WALL_H+FY-y,6),M.dark,[0,(y+WALL_H+FY)/2,0],1,null,false);
  add(g,cyl(.03,.03,.06,12),M.dark,[0,y+.2,0]);add(g,sph(.24,28,14,),mat(0xf3e9d2,.4),[0,y,0],[1,.85,1]);add(g,cyl(.235,.235,.01,28),glow(0xffe2a6,1.6),[0,y-.005,0],1,null,false);add(g,sph(.08,14,10),glow(0xfff1cc,2),[0,y-.03,0],[1,.6,1],null,false)}
// Small wall spotlight with a warm glow pool on the wall
function wallSpot(p,x,y,z,ry){const g=grp(p,x,y,z,ry);add(g,rbox(.36,.06,.1,.02),mat(0xf7f6f2,.4),[0,0,.05]);add(g,rbox(.24,.03,.08,.01),glow(0xffe6b0,1.4),[0,-.035,.06],1,null,false);
  add(g,plane(.9,.8),new THREE.MeshBasicMaterial({map:texCache.get('spotGlow')||(texCache.set('spotGlow',canvasTex(128,128,(x,W,H)=>{const r=x.createRadialGradient(W/2,0,0,W/2,0,H);r.addColorStop(0,'rgba(255,214,150,.45)');r.addColorStop(1,'rgba(255,214,150,0)');x.fillStyle=r;x.fillRect(0,0,W,H)})),texCache.get('spotGlow')),transparent:true,depthWrite:false}),[0,-.42,.003],1,null,false)}
function airCon(p,x,y,z,ry){const g=grp(p,x,y,z,ry);add(g,rbox(1.0,.3,.22,.08),mat(0xf6f4ef,.35));add(g,rbox(.96,.02,.05,.01),mat(0xe6e2da,.5),[0,.07,.1]);add(g,box(.86,.04,.02),mat(0xdedad2,.5),[0,-.09,.105]);
  for(let i=0;i<10;i++)add(g,box(.004,.03,.004),glow(0xbfe6ff,.8),[-.4+i*.09,-.165,.09],1,[.4,0,0],false);add(g,box(.8,.015,.02),glow(0x8fd3ff,1.5),[0,-.125,.1],1,null,false);add(g,plane(.14,.07),screenMat('ac',128,64),[.33,.05,.111],1,null,false)}
// Big wall TV above a light wood media console with sliding doors
function tvWall(p,x,z){
  const t=grp(p,x,1.55,z);add(t,rbox(2.1,1.2,.06,.025),mat(0x1e2129,.35));add(t,plane(2.02,1.12),screenMat('tv',1024,568),[0,0,.031],1,null,false);
  const c=grp(p,x,FY,z+.22);add(c,rbox(2.0,.5,.42,.03),M.lightWood,[0,.3,0]);for(const sx of[-.75,-.25,.25,.75]){add(c,rbox(.47,.4,.02,.01),mat(0xe9cc9f,.55),[sx,.3,.212]);add(c,box(.08,.012,.012),mat(0x8b6a48,.5),[sx,.42,.225],1,null,false)}
  for(const sx of[-.9,.9])add(c,cyl(.02,.015,.06,8),mat(0x8b6a48,.5),[sx,.03,.15]);
  PROPS.robot(grp(c,.75,.55,0));[[0xffffff,.05],[0x5b8def,.04],[0xffc857,.06]].forEach(([col,w],i)=>add(c,box(w,.22,.16),mat(col,.6),[-.7+i*.07,.66,0]));
}
function bookshelf(p,x,z,ry,{w=1,h=1.65,d=.36,seed=3}={}){
  const g=grp(p,x,FY,z,ry),r=rng(seed),lv=4,colors=[0xe76f6f,0x5b8def,0xffc857,0x7bc47f,0xa78bfa,0xf4a261,0x4fb6c9,0xf7f3ec];
  for(const sx of[-1,1])add(g,box(.04,h,d),M.wood,[sx*w/2,h/2,0]);add(g,box(w,h,.02),mat(0xead6bb,.8),[0,h/2,-d/2+.01]);
  for(let k=0;k<=lv;k++)add(g,box(w,.035,d),M.wood,[0,k*h/lv+.017,0]);
  for(let k=0;k<lv;k++){const y0=k*h/lv+.035;let cx=-w/2+.04;
    while(cx<w/2-.06){const bw=.035+r()*.035,bh=.22+r()*.12;add(g,box(bw,bh,d*.75),mat(colors[r()*colors.length|0],.65),[cx+bw/2,y0+bh/2,0],1,cx>.2&&r()>.8?[0,0,-.18]:null,false);cx+=bw+.006}
  }
  plant(g,-.25,0,{s:.5,y:h+.035,seed:seed+2,leaves:7});
  // trailing pothos vine down the front edge
  const leafM=M.leaf||(M.leaf=new THREE.MeshStandardMaterial({map:leafTex(),roughness:.45,side:THREE.DoubleSide}));
  for(let i=0;i<12;i++){const vy=h+.06-i*.12,vx=.32+Math.sin(i*1.3)*.06,lf=grp(g,vx,vy,d/2+.03,(i%2?.6:-.6));lf.rotation.x=PI*.8;add(lf,broadLeaf(),leafM,[0,0,0],[.08,.11,.08],null,false)}
  add(g,cyl(.004,.004,1.4,5),mat(0x4f8f3e,.7),[.32,h-.62,d/2+.025],1,null,false);
}
function clock(p,x,y,z,ry){
  const g=grp(p,x,y,z,ry);add(g,cyl(.26,.26,.05,40),mat(0xfbf6ec,.5),[0,0,0],1,[PI/2,0,0]);add(g,tor(.26,.028),M.dark,[0,0,.01]);
  add(g,geo('clockFace',()=>new THREE.CircleGeometry(.245,40)),screenMat('clock',256,256),[0,0,.026],1,null,false);
  const hand=(len,w,c)=>{const h=grp(g,0,0,.03);h.userData.dynamic=true;add(h,box(w,len,.01),mat(c,.4),[0,len/2-.03,0],1,null,false);return h};
  return {h:hand(.13,.022,0x2b2f3a),m:hand(.19,.016,0x2b2f3a),s:hand(.2,.006,0xf08a4b)};
}
// Light wooden chair (cafe / wooden desk): tapered legs, rounded seat, curved slat back
function woodChair(p,x,z,ry){
  const g=grp(p,x,FY,z,ry),w=M.lightWood;
  for(const sx of[-.17,.17])for(const sz of[-.17,.17])add(g,cyl(.018,.014,.46,8),w,[sx,.23,sz]);
  add(g,rbox(.44,.05,.42,.02),mat(0xf1eee8,.6),[0,.48,0]);
  for(const sx of[-.17,.17])add(g,cyl(.016,.016,.42,8),w,[sx,.7,-.19]);add(g,rbox(.42,.14,.035,.015),w,[0,.86,-.2]);
}
// Small light-wood desk with a laptop, lamp-free: used by the window
function woodDesk(p,x,z,ry,opt={}){
  const g=grp(p,x,FY,z,ry),w=M.lightWood;
  add(g,rbox(.95,.05,.6,.02),w,[0,.73,0]);for(const sx of[-.43,.43])add(g,rbox(.05,.7,.56,.02),w,[sx,.36,0]);add(g,rbox(.82,.22,.02,.01),mat(0xd8b382,.55),[0,.55,-.27]);
  laptop(g,-.05,-.05,0,opt.screen||'design');PROPS.plant(grp(g,.33,.76,-.15));PROPS.pens(grp(g,-.34,.76,-.16));
  return g;
}
// Lounge: blue sofa with yellow cushions on a light rug, white coffee table with books and a plant, blue pouf
function lounge(p,x,z){
  const g=grp(p,x,FY,z),sofa=mat(0x5f78b8,.85),sofaDark=mat(0x5169a8,.85);
  add(g,rbox(2.6,.012,1.9,.006),mat(0xf2e9da,.95),[0,.006,.75],1,null,false);
  add(g,rbox(1.9,.3,.82,.08),sofaDark,[0,.22,0]);add(g,rbox(1.9,.55,.26,.1),sofa,[0,.6,-.3]);
  for(const sx of[-1,1]){add(g,rbox(.22,.48,.82,.09),sofa,[sx*.95,.38,0]);add(g,rbox(.86,.14,.62,.07),sofa,[sx*.43,.44,.07])}
  for(const sx of[-1,1])for(const sz of[-.3,.3])add(g,cyl(.03,.02,.08,8),M.woodDark,[sx*.85,.04,sz]);
  for(const sx of[-1,1])add(g,rbox(.4,.38,.13,.09),mat(0xffc53d,.8),[sx*.52,.66,-.14],1,[-.22,-sx*.12,sx*.06]);
  const t=grp(g,0,0,1.15);add(t,rbox(1.0,.06,.6,.03),M.white,[0,.42,0]);for(const sx of[-.42,.42])for(const sz of[-.22,.22])add(t,cyl(.025,.018,.4,8),M.lightWood,[sx,.2,sz]);
  [[0x5b8def,0],[0xf7f3ec,.03],[0xa78bfa,.06]].forEach(([c,y],i)=>add(t,rbox(.3,.03,.22,.008),mat(c,.6),[.18,.465+y,0],1,[0,i*.15,0]));plant(t,-.25,0,{s:.3,y:.45,seed:14,leaves:7});
  add(g,cyl(.28,.3,.32,32),mat(0x6d86c4,.85),[1.2,.16,1.0]);add(g,sph(.28,24,12),mat(0x6d86c4,.85),[1.2,.32,1.0],[1,.2,1]);
}
// Pantry: wooden counter with coffee machine, jars and mugs
function pantry(p,x,z,ry){
  const g=grp(p,x,FY,z,ry),w=M.lightWood;
  add(g,rbox(1.6,.86,.56,.03),w,[0,.43,0]);add(g,rbox(1.66,.05,.6,.02),mat(0xf7f5f0,.4),[0,.885,0]);
  for(const sx of[-.4,.4]){add(g,rbox(.76,.7,.02,.01),mat(0xe9cc9f,.55),[sx,.43,.285]);add(g,box(.1,.012,.012),mat(0x8b6a48,.5),[sx+(sx<0?.3:-.3),.6,.3],1,null,false)}
  const t=grp(g,0,.91,0);
  add(t,rbox(.26,.36,.28,.03),mat(0x2b2f3a,.4),[-.5,.18,-.04]);add(t,rbox(.2,.06,.04,.01),mat(0x8b93a3,.3),[-.5,.26,.12]);add(t,cyl(.045,.04,.08,14),M.white,[-.5,.05,.08]);
  [[-.1,0x8b5a2b],[.06,0xd8b382],[.2,0xffffff]].forEach(([jx,c])=>{add(t,cyl(.05,.05,.15,16),mat(0xffffff,.1,{transparent:true,opacity:.55}),[jx,.075,-.1]);add(t,cyl(.045,.045,.09,16),mat(c,.7),[jx,.045,-.1]);add(t,cyl(.052,.052,.03,16),mat(0x2b2f3a,.5),[jx,.165,-.1])});
  for(const [mx,c] of[[.42,0xffd166],[.58,0x7bc47f]]){add(t,cyl(.04,.036,.09,16),mat(c,.45),[mx,.045,.1]);add(t,tor(.025,.007),mat(c,.45),[mx+.045,.05,.1],1,[0,0,PI/2],false)}
}
// Square cafe table with two light wooden chairs
function cafeTable(p,x,z){
  const g=grp(p,x,FY,z);add(g,rbox(.72,.04,.72,.015),M.white,[0,.74,0]);add(g,cyl(.03,.03,.7,10),mat(0x8a909c,.4),[0,.37,0]);add(g,cyl(.2,.22,.03,24),mat(0xb7bcc6,.4),[0,.015,0]);
  plant(g,.12,-.1,{s:.25,y:.76,seed:16,leaves:6});PROPS.coffee(grp(g,-.15,.76,.12));
  woodChair(p,x,z-.55,0);woodChair(p,x,z+.55,PI);
}

// ---------- public API ----------
// Desk slots in the open pod (back-left) and in the glass room; agents in src.js stand in front of these
export function createOffice(world,renderer){
  const office=grp(world);
  const hemi=new THREE.HemisphereLight(0xffffff,0xcccccc,2.6);world.add(hemi);
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});sun.shadow.bias=-.00025;sun.shadow.normalBias=.02;world.add(sun);
  floorSlab(office);
  // Walls: floor-to-ceiling glass around the back-left corner, a smaller window at the front of the left wall
  const views={
    back:wall(office,{x0:-5.6,x1:5.6,openings:[[-5.3,-1.6,...TALL]]},[0,0,-4],0),
    left:wall(office,{x0:-4,x1:4,t:.16,openings:[[.25,3.8,...TALL],[-3.35,-1.35]]},[-5.52,0,0],PI/2)
  };
  // Open pod by the windows: front row desks for agents (src.js), back-to-back row facing the windows
  for(const x of[-4.4,-2.9,-1.4]){desk(office,x,-2.95,PI,{screen:['code','chart','ai'][Math.round((x+4.4)/1.5)],props:['coffee']});chair(office,x+.15,-3.56,0,.95)}
  // Glass room: back-to-back desks facing the glass wall behind the dev desks
  glassPartition(office,3.95,[-3.45,0,.6],0,{door:[3.3,3.9]});
  glassPartition(office,3.4,[-3.45,0,.6],-PI/2);
  glassPartition(office,3.4,[.5,0,.6],-PI/2);
  desk(office,-2.5,1.3,PI,{screen:'design',divider:0xf28cb1,props:['notebook']});chair(office,-2.35,.92,0,.9);
  desk(office,-1.0,1.3,PI,{screen:'code',divider:0x5b8def,props:['pens']});chair(office,-.85,.92,0,.9);
  // Back wall: cabinet + AC by the corner, big TV over the console, bookshelf with trailing vine
  cabinet(office,-.2,-3.68,0);airCon(office,-.2,2.42,-3.8,0);
  tvWall(office,2.6,-3.88);bookshelf(office,4.75,-3.68,0,{w:1.05,h:1.75});
  const hands=clock(office,-5.43,2.15,-.05,PI/2);
  wallSpot(office,-5.42,2.55,-2.1,PI/2);wallSpot(office,-3.4,2.55,-3.9,0);wallSpot(office,2.6,2.6,-3.9,0);
  domeLamp(office,-2.9,-2.6);
  // Lounge in front of the TV, pantry and cafe table front-right
  lounge(office,3.0,-1.5);
  pantry(office,4.2,1.2,0);waterCooler(office,2.6,1.2,0);trashBin(office,2.15,1.0);
  cafeTable(office,3.9,2.9);
  // Greenery: white round pots around the room
  const pots={pot:0xfbfaf7};
  for(const [x,z,s,seed] of[[-5.1,-3.55,1.1,2],[-5.15,.45,.95,3],[-3.25,3.65,.85,5],[.95,3.6,1.05,8],[5.25,3.6,1.1,11],[.75,-3.6,.8,13],[-4.95,3.65,.8,19]])plant(office,x,z,{...pots,s,seed});
  freeze(office);

  function setScenery(name){
    const s=SCENERY[name]||SCENERY.day;
    for(const [k,view] of Object.entries(views)){
      const key=`${name}_${k}`;
      if(!texCache.has(key)){const W=2048,H=k==='back'?500:720;texCache.set(key,canvasTex(W,H,(x,w,h)=>s.draw(x,w,h,k==='back'?1:2)))}
      view.material.map=texCache.get(key);view.material.needsUpdate=true;
    }
    world.background=new THREE.Color(s.bg);
    hemi.color.set(s.hemi[0]);hemi.groundColor.set(s.hemi[1]);hemi.intensity=s.hemi[2];
    sun.color.set(s.sun[0]);sun.intensity=s.sun[1];sun.position.set(...s.sunPos);
    renderer.toneMappingExposure=s.exposure;
  }
  // Workstation for an agent standing at (x,z), desk behind the agent. opt.style 'wood' = small wooden desk with a
  // wooden chair on its left; otherwise an office desk (opt.divider colour) with an ergonomic chair on its right.
  function workstation(x,z,opt={}){
    const g=grp(office);
    if(opt.style==='wood'){woodDesk(g,x,z-.6,0,opt);woodChair(g,x-.6,z-.2,PI/2)}
    else{desk(g,x,z-.65,0,opt);chair(g,x+.72,z-.12,-.5)}
    freeze(g);
  }
  function update(){
    const d=new Date(),s=d.getSeconds()+d.getMilliseconds()/1000,m=d.getMinutes()+s/60,h=d.getHours()%12+m/60;
    hands.s.rotation.z=-s/60*PI*2;hands.m.rotation.z=-m/60*PI*2;hands.h.rotation.z=-h/12*PI*2;
  }
  return {group:office,setScenery,workstation,update,scenes:Object.fromEntries(Object.entries(SCENERY).map(([k,v])=>[k,{label:v.label,swatch:v.swatch}]))};
}
