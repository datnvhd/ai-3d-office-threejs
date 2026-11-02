import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
// Chibi office environment: room shell with real window openings, furniture/props and switchable outdoor scenery.
// Room floor spans x∈[-5.6,5.6], z∈[-4,4]; back wall at z=-4, left wall at x=-5.52. Floor top is at y=FY.
const FY=-.06,WALL_H=2.8,WIN=[.85,2.35],PI=Math.PI;
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
      x.fillStyle='#86c873';x.fillRect(0,H*.9,W,H*.1);treeRow(x,W,H*.97,r,['#5fae5a','#4f9d50','#78c167'],H*.055)}},
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
function windowFrame(g,a,b,t){
  const w=b-a,cx=(a+b)/2,h=WIN[1]-WIN[0],cy=(WIN[0]+WIN[1])/2;
  for(const y of[WIN[0],WIN[1]])add(g,box(w,.06,t+.03),M.frame,[cx,y,0]);
  const n=Math.max(1,Math.round(w/1.05));
  for(let i=0;i<=n;i++)add(g,box(.05,h,t+.03),M.frame,[a+i*w/n,cy,0]);
  add(g,box(w,.04,t+.03),M.frame,[cx,WIN[0]+h*.72,0]);
  add(g,rbox(w+.12,.04,.16,.015),M.white,[cx,WIN[0]-.01,t/2+.05]);
  add(g,plane(w,h),M.glass,[cx,cy,0],1,null,false);
}
// Wall along local x from x0 to x1; interior side is local +z. Returns the scenery plane behind it.
function wall(p,{x0,x1,t=.18,openings=[]},pos,ry){
  const g=grp(p,...pos,ry),base=FY;
  let cur=x0;const solid=[];for(const [a,b] of openings){solid.push([cur,a]);cur=b}solid.push([cur,x1]);
  for(const [a,b] of solid)if(b>a)add(g,box(b-a,WALL_H,t),M.wall,[(a+b)/2,base+WALL_H/2,0]);
  for(const [a,b] of openings){
    add(g,box(b-a,WIN[0]-base,t),M.wall,[(a+b)/2,(base+WIN[0])/2,0]);
    add(g,box(b-a,base+WALL_H-WIN[1],t),M.wall,[(a+b)/2,(WIN[1]+base+WALL_H)/2,0]);
    windowFrame(g,a,b,t);
  }
  add(g,box(x1-x0,.1,.02),M.skirt,[(x0+x1)/2,base+.05,t/2+.01]);
  add(g,box(x1-x0,.04,t+.02),M.white,[(x0+x1)/2,base+WALL_H,0]);
  const view=add(g,plane(x1-x0,1.8),new THREE.MeshBasicMaterial({toneMapped:false}),[(x0+x1)/2,1.6,-t/2-.05],1,null,false);
  view.receiveShadow=false;
  return view;
}
function floorSlab(p){
  const tex=canvasTex(1024,1024,(x,W,H)=>{const r=rng(7);x.fillStyle='#e3cba8';x.fillRect(0,0,W,H);
    for(let i=0;i<8;i++){const y=i*H/8,off=i%2?W/4:0;for(let k=-1;k<3;k++){const v=r()*10-5;x.fillStyle=`hsl(32,${50+v}%,${77+v*.6}%)`;x.fillRect(off+k*W/2,y,W/2,H/8);x.fillStyle='rgba(150,110,70,.06)';for(let s=0;s<4;s++)x.fillRect(off+k*W/2+r()*W/2,y+r()*H/8,W*.12,1.5);x.fillStyle='#c9a77c';x.fillRect(off+k*W/2,y,3,H/8)}x.fillStyle='#c9a77c';x.fillRect(0,y,W,3)}},[5.6,4]);
  const top=new THREE.MeshStandardMaterial({map:tex,roughness:.75}),side=mat(0xdcc29c,.7);
  add(p,box(11.2,.36,8),[side,side,top,side,side,side],[0,FY-.18,0],1,null,false);
}
function glassPartition(p,len,pos,ry,{door}={}){
  const g=grp(p,...pos,ry),posts=Math.max(1,Math.round(len/1.3));
  for(const y of[FY+.03,FY+2.1])add(g,box(len,.05,.06),M.frame,[len/2,y,0]);
  for(let i=0;i<=posts;i++)add(g,box(.045,2.1,.05),M.frame,[i*len/posts,FY+1.05,0]);
  const segs=door?[[0,door[0]],[door[1],len]]:[[0,len]];
  for(const [a,b] of segs)add(g,plane(b-a,2.05),M.glass,[(a+b)/2,FY+1.06,0],1,null,false).material.side=THREE.DoubleSide;
}

// ---------- furniture ----------
function chair(p,x,z,ry,s=1){
  const g=grp(p,x,FY,z,ry);g.scale.setScalar(s);
  for(let i=0;i<5;i++){const a=i*PI*2/5;add(g,box(.05,.035,.3),M.chairDark,[Math.sin(a)*.15,.06,Math.cos(a)*.15],1,[0,a,0]);add(g,sph(.032),M.chairDark,[Math.sin(a)*.29,.032,Math.cos(a)*.29])}
  add(g,cyl(.03,.03,.36),M.metal,[0,.26,0]);
  add(g,rbox(.5,.08,.48,.035),M.chair,[0,.48,0]);
  add(g,box(.05,.32,.04),M.chairDark,[0,.62,-.24]);
  add(g,rbox(.46,.5,.05,.025),M.chairMesh,[0,.88,-.25],1,[-.12,0,0]);
  add(g,box(.03,.14,.03),M.chairDark,[0,1.17,-.29]);
  add(g,rbox(.3,.12,.05,.02),M.chairMesh,[0,1.27,-.3],1,[-.12,0,0]);
  for(const sx of[-1,1]){add(g,box(.03,.18,.03),M.chairDark,[sx*.27,.6,0]);add(g,rbox(.07,.03,.26,.012),M.chairDark,[sx*.27,.7,0])}
  return g;
}
function plant(p,x,z,{s=1,pot=0xf3ede4,leaves=15,seed=1,tall=.6,y=FY}={}){
  const g=grp(p,x,y,z),r=rng(seed);g.scale.setScalar(s);
  add(g,cyl(.2,.15,.36,24),mat(pot,.55),[0,.18,0]);add(g,tor(.19,.022),mat(pot,.55),[0,.36,0],1,[PI/2,0,0]);add(g,cyl(.18,.18,.02,20),mat(0x6b4a33,.9),[0,.35,0],1,null,false);
  for(let i=0;i<leaves;i++){
    const lg=new THREE.Group();lg.position.set(0,.34,0);lg.rotation.set(.2+r()*.9,i/leaves*PI*2+r()*.4,0,'YXZ');g.add(lg);
    const L=tall*(.65+r()*.5);add(lg,leafGeo(),mat(r()>.5?0x5fae55:0x7cc464,.6,{side:THREE.DoubleSide}),[0,0,0],[L*.5,L,.03]);
  }
  return g;
}
function monitor(p,x,z,kind,ry=0){
  const g=grp(p,x,.76,z,ry);
  add(g,rbox(.22,.016,.15,.006),M.dark,[0,.008,0]);add(g,box(.04,.22,.03),M.dark,[0,.12,-.03]);
  add(g,rbox(.64,.4,.035,.015),M.dark,[0,.33,-.01]);add(g,plane(.6,.36),screenMat(kind),[0,.33,.0085],1,null,false);
}
function laptop(p,x,z,ry=0,kind='laptop'){
  const g=grp(p,x,.76,z,ry);
  add(g,rbox(.36,.018,.25,.008),mat(0xc9ced8,.35),[0,.009,0]);add(g,plane(.3,.13),mat(0x8d94a3,.6),[0,.0185,.02],1,[-PI/2,0,0],false);
  const lid=grp(g,0,.018,-.12);lid.rotation.x=-.28;add(lid,rbox(.36,.24,.012,.006),mat(0xc9ced8,.35),[0,.12,0]);add(lid,plane(.32,.2),screenMat(kind),[0,.12,.0065],1,null,false);
}
const PROPS={
  coffee:(g)=>{add(g,cyl(.042,.034,.11),M.white,[0,.055,0]);add(g,cyl(.044,.04,.045),mat(0xb07a4f,.7),[0,.055,0]);add(g,cyl(.046,.046,.016),M.dark,[0,.118,0])},
  notebook:(g)=>{g.rotation.y=.3;add(g,rbox(.17,.024,.22,.006),mat(0xa78bfa,.6),[0,.012,0]);add(g,box(.022,.026,.22),mat(0xf4b860,.6),[.055,.013,0])},
  pens:(g)=>{add(g,cyl(.038,.038,.1),mat(0xe8eaf0,.5),[0,.05,0]);[[0x2f6bff,.3],[0xffd166,-.2],[0x2b2f3a,.05]].forEach(([c,a],i)=>add(g,cyl(.006,.006,.16,6),mat(c,.4),[(i-1)*.012,.12,0],1,[0,0,a*.4]))},
  plant:(g)=>plant(g,0,0,{s:.32,y:0,leaves:8,seed:4,tall:.5}),
  robot:(g)=>{g.rotation.y=.4;const w=mat(0xf6f7fc,.3);add(g,sph(.055),w,[0,.06,0],[1,1.05,.95]);const h=grp(g,0,.16,0);add(h,sph(.075),w,[0,0,0],[1.2,.9,1]);add(h,sph(.06),mat(0x1c2340,.2),[0,-.004,.035],[1.1,.72,.75]);for(const s of[-1,1]){add(h,cyl(.007,.007,.012,8),glow(0x7fd8ff,1.6),[s*.022,0,.08],1,[PI/2,0,0],false);add(h,geo('ear',()=>new THREE.ConeGeometry(.025,.045,12)),w,[s*.05,.065,0],1,[0,0,-s*.35])}}
};
function desk(p,x,z,ry,opt={}){
  const g=grp(p,x,FY,z,ry);
  add(g,rbox(1.46,.06,.7,.02),M.white,[0,.73,0]);
  for(const sx of[-.66,.66]){for(const sz of[-.28,.28])add(g,box(.045,.7,.045),M.frame,[sx,.35,sz]);add(g,box(.05,.04,.66),M.frame,[sx,.02,0]);add(g,box(.04,.04,.6),M.frame,[sx,.68,0])}
  add(g,rbox(.4,.6,.6,.03),M.cream,[.4,.31,-.02]);
  for(let k=0;k<3;k++){add(g,rbox(.36,.17,.02,.008),mat(0xf8f2e9,.55),[.4,.12+k*.19,.285]);add(g,box(.12,.015,.015),M.dark,[.4,.17+k*.19,.3],1,null,false)}
  add(g,rbox(1.2,.3,.035,.015),M.orange,[0,.97,-.33]);for(const sx of[-.45,.45])add(g,box(.03,.08,.06),M.dark,[sx,.78,-.33]);
  if(opt.screen!==false)monitor(g,-.05,-.15,opt.screen||'ai');
  add(g,rbox(.42,.02,.13,.008),mat(0xf4f5f8,.5),[-.05,.77,.12]);add(g,plane(.4,.11),screenMat('keys',512,140),[-.05,.7805,.12],1,[-PI/2,0,0],false);
  add(g,sph(.035),mat(0xf4f5f8,.4),[.27,.77,.13],[.75,.45,1.1]);
  const slots=[[.55,-.2],[-.56,-.18],[.53,.17],[-.53,.16]];
  if(opt.laptop){laptop(g,-.5,.05,.35,opt.laptop===true?'laptop':opt.laptop);slots.splice(3,1);slots.splice(1,1)}
  (opt.props||[]).forEach((name,i)=>{if(slots[i])PROPS[name](grp(g,slots[i][0],.76,slots[i][1]))});
  return g;
}
function lockers(p,x,z,ry){
  const g=grp(p,x,FY,z,ry);add(g,rbox(.76,1.5,.42,.03),mat(0x5b6170,.55),[0,.75,0]);
  for(let i=0;i<2;i++)for(let j=0;j<2;j++){add(g,rbox(.33,.68,.02,.01),mat(0xefe7db,.6),[-.175+i*.35,.4+j*.72,.21]);add(g,box(.02,.12,.02),M.dark,[-.04+i*.08,.42+j*.72,.225],1,null,false)}
}
function waterCooler(p,x,z,ry){
  const g=grp(p,x,FY,z,ry);add(g,rbox(.34,.95,.34,.05),mat(0xf6f6f3,.4),[0,.475,0]);add(g,rbox(.2,.04,.1,.01),M.dark,[0,.58,.17]);
  add(g,box(.03,.05,.03),mat(0xe85d5d,.4),[-.05,.72,.18]);add(g,box(.03,.05,.03),mat(0x4f8ff0,.4),[.05,.72,.18]);
  add(g,cyl(.135,.135,.38,24),new THREE.MeshStandardMaterial({color:0x8fcaf6,transparent:true,opacity:.75,roughness:.1}),[0,1.15,0]);add(g,cyl(.05,.05,.05),mat(0x4f8ff0,.4),[0,.97,0]);
}
function trashBin(p,x,z){const g=grp(p,x,FY,z);add(g,cyl(.14,.11,.38,24),mat(0xb3b8c3,.5),[0,.19,0]);add(g,cyl(.15,.15,.05,24),mat(0x5b6170,.5),[0,.4,0])}
function pendant(p,x,z,y=2.45){const g=grp(p,x,0,z);for(const sx of[-.2,.2])add(g,cyl(.004,.004,.7,6),M.dark,[sx,y+.38,0],1,null,false);add(g,tor(.3,.035),mat(0x2c313c,.4),[0,y,0],1,[PI/2,0,0]);add(g,cyl(.3,.3,.012,40),glow(0xfff1d0,1.3),[0,y-.01,0],1,null,false)}
function airCon(p,x,y,z,ry){const g=grp(p,x,y,z,ry);add(g,rbox(1.0,.3,.22,.08),mat(0xf6f4ef,.4));add(g,box(.86,.04,.02),mat(0xdedad2,.5),[0,-.09,.105]);add(g,box(.8,.015,.02),glow(0x8fd3ff,1.5),[0,-.125,.1],1,null,false);add(g,plane(.14,.07),screenMat('ac',128,64),[.33,.05,.111],1,null,false)}
function tv(p,x,y,z,ry){const g=grp(p,x,y,z,ry);add(g,rbox(1.3,.78,.05,.02),M.dark);add(g,plane(1.24,.72),screenMat('dashboard',768,448),[0,0,.026],1,null,false)}
function credenza(p,x,z,ry){const g=grp(p,x,FY,z,ry);add(g,rbox(1.2,.55,.4,.03),mat(0xefe5d6,.6),[0,.275,0]);add(g,box(1.2,.02,.4),M.wood,[0,.56,0]);for(const sx of[-.3,.3])add(g,box(.08,.015,.015),M.dark,[sx,.35,.205],1,null,false);
  plant(g,-.38,0,{s:.45,y:.57,seed:9,leaves:9});[[0xe76f6f,.06],[0x5b8def,.05],[0xffc857,.07]].forEach(([c,w],i)=>add(g,box(w,.24,.18),mat(c,.6),[.2+i*.075,.69,0]));PROPS.robot(grp(g,.45,.57,.02))}
function bookshelf(p,x,z,ry,{w=1,h=1.65,d=.36,seed=3}={}){
  const g=grp(p,x,FY,z,ry),r=rng(seed),lv=4,colors=[0xe76f6f,0x5b8def,0xffc857,0x7bc47f,0xa78bfa,0xf4a261,0x4fb6c9];
  for(const sx of[-1,1])add(g,box(.04,h,d),M.wood,[sx*w/2,h/2,0]);add(g,box(w,h,.02),mat(0xead6bb,.8),[0,h/2,-d/2+.01]);
  for(let k=0;k<=lv;k++)add(g,box(w,.035,d),M.wood,[0,k*h/lv+.017,0]);
  for(let k=0;k<lv;k++){const y0=k*h/lv+.035;let cx=-w/2+.04;
    if(k===1||k===3){add(g,rbox(.3,.2,.28,.02),mat(k===1?0xf7f3ec:0xf3d9b1,.6),[w/2-.2,y0+.1,0]);}
    while(cx<(k===1||k===3?w/2-.4:w/2-.06)){const bw=.035+r()*.035,bh=.22+r()*.12;add(g,box(bw,bh,d*.75),mat(colors[r()*colors.length|0],.65),[cx+bw/2,y0+bh/2,0],1,cx>.2&&r()>.8?[0,0,-.18]:null,false);cx+=bw+.006}
  }
  plant(g,-.25,0,{s:.5,y:h+.035,seed:seed+2,leaves:7});
  const vine=mat(0x6cbf5f,.6);for(let i=0;i<7;i++)add(g,sph(.04,10,8),vine,[-.08+i*.01,h+.12-i*.13,d/2+.02],[1,1,.6],null,false);
}
function whiteboard(p,x,z,ry){
  const g=grp(p,x,FY,z,ry);
  for(const sx of[-.68,.68]){add(g,box(.04,1.55,.04),M.frame,[sx,.78,0]);add(g,box(.05,.04,.5),M.frame,[sx,.05,0]);for(const sz of[-.22,.22])add(g,sph(.035),M.dark,[sx,.035,sz])}
  add(g,rbox(1.32,.86,.04,.02),mat(0xc9ccd4,.4),[0,1.15,0]);add(g,plane(1.26,.8),screenMat('board',768,488),[0,1.15,.0205],1,null,false);
  add(g,box(.9,.03,.07),mat(0xc9ccd4,.4),[0,.71,.04]);
}
function clock(p,x,y,z,ry){
  const g=grp(p,x,y,z,ry);add(g,cyl(.26,.26,.05,40),mat(0xfbf6ec,.5),[0,0,0],1,[PI/2,0,0]);add(g,tor(.26,.028),M.dark,[0,0,.01]);
  add(g,geo('clockFace',()=>new THREE.CircleGeometry(.245,40)),screenMat('clock',256,256),[0,0,.026],1,null,false);
  const hand=(len,w,c)=>{const h=grp(g,0,0,.03);h.userData.dynamic=true;add(h,box(w,len,.01),mat(c,.4),[0,len/2-.03,0],1,null,false);return h};
  return {h:hand(.13,.022,0x2b2f3a),m:hand(.19,.016,0x2b2f3a),s:hand(.2,.006,0xf08a4b)};
}
function fan(p,x,z,ry){
  const g=grp(p,x,FY,z,ry),w=mat(0xf5f3ee,.4);
  add(g,cyl(.2,.22,.04,32),w,[0,.02,0]);add(g,cyl(.025,.025,.95),w,[0,.5,0]);add(g,rbox(.12,.14,.18,.05),w,[0,1.02,-.06]);
  const head=grp(g,0,1.05,.08);add(head,tor(.27,.016),w);
  for(let i=0;i<8;i++)add(head,box(.006,.54,.006),w,[0,0,.03],1,[0,0,i*PI/8],false);
  const rotor=grp(head,0,0,0);rotor.userData.dynamic=true;add(rotor,cyl(.05,.05,.04,16),w,[0,0,0],1,[PI/2,0,0]);
  for(let i=0;i<3;i++){const b=grp(rotor);b.rotation.z=i*PI*2/3;add(b,sph(.1,14,10),mat(0x9cc5ef,.4),[0,.13,0],[.55,1,.08])}
  return rotor;
}
function meetingTable(p,x,z){
  const g=grp(p,x,FY,z);add(g,rbox(2.1,.06,1,.03),M.white,[0,.73,0]);for(const sx of[-.65,.65])add(g,rbox(.14,.7,.6,.03),M.dark,[sx,.35,0]);
  plant(g,0,0,{s:.3,y:.76,seed:6,leaves:8});laptop(g,-.55,.18,.2,'chart');PROPS.notebook(grp(g,.5,.76,.2));PROPS.coffee(grp(g,.75,.76,-.25));
}
function partition(p,len,pos,ry){
  const g=grp(p,...pos,ry),n=3,pw=len/n;
  for(let i=0;i<=n;i++){add(g,box(.045,1.55,.045),M.frame,[-len/2+i*pw,FY+.82,0]);add(g,box(.04,.03,.3),M.frame,[-len/2+i*pw,FY+.04,0]);for(const sz of[-.13,.13])add(g,sph(.03),M.dark,[-len/2+i*pw,FY+.03,sz])}
  for(let i=0;i<n;i++){const cx=-len/2+(i+.5)*pw;add(g,box(pw-.05,.5,.03),mat(0xefe6da,.7),[cx,FY+.35,0]);add(g,plane(pw-.05,.95),M.glass,[cx,FY+1.08,0],1,null,false).material.side=THREE.DoubleSide}
  add(g,box(len,.04,.05),M.frame,[0,FY+1.58,0]);
}
function lounge(p,x,z,ry){
  const g=grp(p,x,FY,z,ry),sofa=mat(0x63759a,.85),sofaDark=mat(0x55668a,.85);
  add(g,geo('rug',()=>new THREE.CircleGeometry(1.35,48)),mat(0xf3e7d3,.95),[0,.006,.95],1,[-PI/2,0,0],false);
  add(g,geo('rugEdge',()=>new THREE.RingGeometry(1.25,1.35,48)),mat(0xe6d3b0,.95),[0,.008,.95],1,[-PI/2,0,0],false);
  add(g,rbox(1.9,.32,.82,.06),sofaDark,[0,.24,0]);add(g,rbox(1.9,.55,.24,.08),sofa,[0,.6,-.31]);
  for(const sx of[-1,1]){add(g,rbox(.22,.5,.82,.08),sofa,[sx*.95,.4,0]);add(g,rbox(.86,.14,.62,.06),sofa,[sx*.43,.46,.07])}
  for(const sx of[-1,1])for(const sz of[-.3,.3])add(g,cyl(.03,.02,.08,8),M.woodDark,[sx*.85,.04,sz]);
  add(g,rbox(.42,.38,.12,.08),mat(0xffc94d,.8),[-.55,.66,-.15],1,[-.2,.15,.08]);add(g,rbox(.42,.38,.12,.08),mat(0xf59a5b,.8),[.55,.66,-.15],1,[-.2,-.15,-.08]);
  const t=grp(g,0,0,1.05);add(t,cyl(.45,.45,.05,40),M.wood,[0,.42,0]);for(let i=0;i<3;i++){const a=i*PI*2/3;add(t,cyl(.025,.025,.4,8),M.woodDark,[Math.sin(a)*.3,.2,Math.cos(a)*.3])}
  PROPS.coffee(grp(t,.12,.445,.05));PROPS.notebook(grp(t,-.15,.445,-.05));
  add(g,cyl(.28,.28,.34,32),mat(0xffcf5a,.85),[.95,.17,1.35]);add(g,sph(.28,24,12),mat(0xffcf5a,.85),[.95,.34,1.35],[1,.18,1]);
  const lamp=grp(g,-1.3,0,-.15);add(lamp,cyl(.16,.16,.03,24),M.dark,[0,.015,0]);add(lamp,cyl(.015,.015,1.7,8),M.dark,[0,.85,0]);
  add(lamp,tor(.4,.015,PI),M.dark,[.4,1.7,0]);add(lamp,sph(.17,20,12),mat(0xfaf3e6,.5),[.82,1.62,0],[1,.7,1]);add(lamp,sph(.1),glow(0xfff1d0,1.2),[.82,1.55,0],[1,.4,1],null,false);
  plant(g,1.3,-.15,{s:1.05,seed:12});
}

// ---------- public API ----------
export function createOffice(world,renderer){
  const office=grp(world);
  const hemi=new THREE.HemisphereLight(0xffffff,0xcccccc,2.6);world.add(hemi);
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});sun.shadow.bias=-.00025;sun.shadow.normalBias=.02;world.add(sun);
  floorSlab(office);
  add(office,plane(4.15,2.3),mat(0xe4e7f2,.95),[-3.38,FY+.004,-2.75],1,[-PI/2,0,0],false);
  const views={
    back:wall(office,{x0:-5.6,x1:5.6,openings:[[-4.9,-2.5],[1.9,4.95]]},[0,0,-4],0),
    left:wall(office,{x0:-4,x1:4,t:.16,openings:[[1.95,3.5],[-3.6,-.9]]},[-5.52,0,0],PI/2)
  };
  // Meeting room (back-left) behind glass
  glassPartition(office,4.15,[-5.45,0,-1.6],0,{door:[3.1,3.95]});
  glassPartition(office,2.3,[-1.3,0,-3.9],-PI/2);
  meetingTable(office,-3.4,-2.75);
  for(const cx of[-4.05,-3.4,-2.75])chair(office,cx,-2.05,PI,.92);
  for(const cx of[-4.05,-3.4])chair(office,cx,-3.45,0,.92);
  whiteboard(office,-2.0,-3.3,-.45);
  pendant(office,-3.9,-2.75);pendant(office,-2.9,-2.75);
  // Pantry wall: lockers, dashboard TV, credenza, water cooler
  lockers(office,-.85,-3.68,0);tv(office,.2,1.78,-3.885,0);credenza(office,.2,-3.68,0);waterCooler(office,1.2,-3.7,0);trashBin(office,1.6,-3.7);
  airCon(office,3.42,2.5,-3.8,0);
  partition(office,2.4,[3.45,0,-1.45],0);
  // Left wall: bookshelf, clock, lounge corner
  bookshelf(office,-5.24,-.6,PI/2);
  const hands=clock(office,-5.43,2.2,-.6,PI/2);
  lounge(office,-4.95,2.25,PI/2);pendant(office,-3.95,2.25);
  // Greenery, fan, bins
  plant(office,-5.05,-3.5,{s:1,seed:2});plant(office,5.3,-3.65,{s:.8,seed:5});plant(office,5.1,3.45,{s:1.2,seed:8});plant(office,1.9,3.6,{s:.8,seed:11});
  const rotor=fan(office,5.0,1.55,-.9);trashBin(office,2.45,-.5);
  freeze(office);

  function setScenery(name){
    const s=SCENERY[name]||SCENERY.day;
    for(const [k,view] of Object.entries(views)){
      const key=`${name}_${k}`;
      if(!texCache.has(key)){const W=2048,H=k==='back'?330:460;texCache.set(key,canvasTex(W,H,(x,w,h)=>s.draw(x,w,h,k==='back'?1:2)))}
      view.material.map=texCache.get(key);view.material.needsUpdate=true;
    }
    world.background=new THREE.Color(s.bg);
    hemi.color.set(s.hemi[0]);hemi.groundColor.set(s.hemi[1]);hemi.intensity=s.hemi[2];
    sun.color.set(s.sun[0]);sun.intensity=s.sun[1];sun.position.set(...s.sunPos);
    renderer.toneMappingExposure=s.exposure;
  }
  // Desk + ergonomic chair for an agent standing at (x,z); the desk sits behind the agent
  function workstation(x,z,opt){const g=grp(office);desk(g,x,z-.65,0,opt);chair(g,x+.72,z-.12,-.5);freeze(g)}
  function update(t){
    rotor.rotation.z=t*.012;
    const d=new Date(),s=d.getSeconds()+d.getMilliseconds()/1000,m=d.getMinutes()+s/60,h=d.getHours()%12+m/60;
    hands.s.rotation.z=-s/60*PI*2;hands.m.rotation.z=-m/60*PI*2;hands.h.rotation.z=-h/12*PI*2;
  }
  return {group:office,setScenery,workstation,update,scenes:Object.fromEntries(Object.entries(SCENERY).map(([k,v])=>[k,{label:v.label,swatch:v.swatch}]))};
}
