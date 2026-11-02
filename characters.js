import * as THREE from 'three';
// Chibi AI-agent characters built from primitives. Character faces +z, feet at y=0.
const SKIN=0xffdcc8,R=.3,HEAD_Y=1.23,UP=new THREE.Vector3(0,1,0);
const geoCache=new Map(),matCache=new Map();
const geo=(k,make)=>{if(!geoCache.has(k))geoCache.set(k,make());return geoCache.get(k)};
const sph=(r,w=24,h=16)=>geo(`s${r}_${w}_${h}`,()=>new THREE.SphereGeometry(r,w,h));
const cap=(r,l)=>geo(`c${r}_${l}`,()=>new THREE.CapsuleGeometry(r,l,6,16));
const cyl=(rt,rb,h,n=20)=>geo(`y${rt}_${rb}_${h}_${n}`,()=>new THREE.CylinderGeometry(rt,rb,h,n));
const tor=(r,t,arc=Math.PI*2)=>geo(`t${r}_${t}_${arc}`,()=>new THREE.TorusGeometry(r,t,10,40,arc));
const box=(w,h,d)=>geo(`b${w}_${h}_${d}`,()=>new THREE.BoxGeometry(w,h,d));
const mat=(c,rough=.6,extra)=>{const k=`${c}_${rough}_${extra?JSON.stringify(extra):''}`;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:0,...extra}));return matCache.get(k)};
const shade=(c,f)=>new THREE.Color(c).multiplyScalar(f).getHex();
function add(p,g,m,pos=[0,0,0],s=1,r){const o=new THREE.Mesh(g,m);o.position.set(...pos);typeof s==='number'?o.scale.setScalar(s):o.scale.set(...s);if(r)o.rotation.set(...r);o.castShadow=o.receiveShadow=true;p.add(o);return o}
function rod(p,a,b,r,m){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),o=add(p,cyl(r,r,1,8),m);o.position.copy(A).add(B).multiplyScalar(.5);o.scale.set(1,A.distanceTo(B),1);o.quaternion.setFromUnitVectors(UP,B.sub(A).normalize());return o}
// Anchor on the head sphere: a = yaw from front, b = elevation; local +z points outward, +y up along the surface
function onHead(head,a,b,lift=0){const g=new THREE.Group(),r=R+lift;g.position.set(Math.sin(a)*Math.cos(b)*r,Math.sin(b)*r,Math.cos(a)*Math.cos(b)*r);g.rotation.set(-b,a,0,'YXZ');g.userData.detail=true;head.add(g);return g}
// Teardrop hair strand, pointed tip at -y
const strand=()=>geo('strand',()=>new THREE.LatheGeometry([[0,-1],[.3,-.72],[.68,-.2],[.95,.35],[.85,.75],[.45,.97],[0,1]].map(p=>new THREE.Vector2(...p)),14));
function tuft(head,m,a,b,{lift=.012,w=.06,l=.08,d=.035,dy=0,rz=0,out=0,flip=false}={}){const g=onHead(head,a,b,lift);add(g,strand(),m,[0,dy,0],[w,l,d],[out,0,rz+(flip?Math.PI:0)]);return g}
function lock(head,m,x,y,z,{w=.075,l=.14,d=.06,rz=0,rx=0}={}){return add(head,strand(),m,[x,y,z],[w,l,d],[rx,0,rz])}
const ICONS={
  code:(x,W,H)=>{x.fillStyle='#fff';x.font=`bold ${H*.62}px Consolas,monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText('</>',W/2,H/2)},
  api:(x,W,H)=>{x.fillStyle='#1e6fe8';x.font=`bold ${H*.62}px Consolas,monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText('{ }',W/2,H/2)},
  heart:(x,W,H)=>{const s=W*.32,cx=W/2,cy=H*.4;x.fillStyle='#ff6b8a';x.beginPath();x.moveTo(cx,cy+s*1.1);x.bezierCurveTo(cx-s*1.6,cy,cx-s*.7,cy-s*1.1,cx,cy-s*.3);x.bezierCurveTo(cx+s*.7,cy-s*1.1,cx+s*1.6,cy,cx,cy+s*1.1);x.fill()},
  chart:(x,W,H)=>{x.fillStyle='#fff';[.35,.6,.9].forEach((h,i)=>x.fillRect(W*(.16+i*.25),H*(.88-h*.72),W*.17,H*h*.72))},
  check:(x,W,H)=>{x.strokeStyle='#fff';x.lineWidth=W*.13;x.lineCap=x.lineJoin='round';x.beginPath();x.moveTo(W*.2,H*.52);x.lineTo(W*.42,H*.74);x.lineTo(W*.8,H*.28);x.stroke()},
  robot:(x,W,H)=>{x.strokeStyle=x.fillStyle='#fff';x.lineWidth=W*.06;x.beginPath();x.roundRect(W*.18,H*.3,W*.64,H*.5,W*.14);x.stroke();for(const ex of[.38,.62]){x.beginPath();x.arc(W*ex,H*.55,W*.06,0,7);x.fill()}x.fillRect(W*.47,H*.12,W*.06,H*.18)},
  star:(x,W,H)=>{x.fillStyle='#ffd166';x.beginPath();for(let i=0;i<10;i++){const r=i%2?W*.2:W*.46,t=-Math.PI/2+i*Math.PI/5;x.lineTo(W/2+Math.cos(t)*r,H/2+Math.sin(t)*r)}x.closePath();x.fill()}
};
function decal(icon,w,h){const c=document.createElement('canvas');c.width=256;c.height=Math.round(256*h/w);ICONS[icon](c.getContext('2d'),c.width,c.height);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:t,transparent:true,roughness:.6,polygonOffset:true,polygonOffsetFactor:-4}))}

export const PRESETS={
  // Nam 18–22 · lập trình viên năng động
  dev:{hair:'messy',hairColor:0x3a2a22,outfit:'hoodie',top:0x1e6fe8,sleeve:0xf2f3f7,hood:0xf2f3f7,cuff:0x1e6fe8,band:0xf2f3f7,pants:0x4a4f5c,shoeAccent:0x1e6fe8,logo:'code',headphones:{on:'neck',color:0xf4f5f8,accent:0x1e6fe8},pose:'fist',mouth:'smile',seed:3},
  // Nữ 18–22 · thiết kế / sáng tạo
  designer:{hair:'long',bun:true,scrunchie:0x1e6fe8,hairColor:0x5b3a2a,outfit:'hoodie',top:0xffd166,hood:0xffd166,cuff:0xf5c04f,band:0xf5c04f,pants:0x7f9cc9,cargo:false,shoeAccent:0xffb84d,logo:'heart',glasses:{shape:'round',color:0x6b4a3a},pose:'cheek',mouth:'smile',seed:5},
  // Nam 28–35 · quản lý / điều phối dự án
  manager:{hair:'neat',hairColor:0x2a201c,outfit:'shirt',top:0xf7f8fb,pants:0x3d4352,cargo:false,shoe:0x3a2f2a,sole:0x2a221e,glasses:{shape:'square',color:0x1b1b1f},lanyard:0x2f6fe0,watch:true,pose:'chin',mouth:'smile',seed:9},
  // Nữ 12–15 · học tập / hỗ trợ / nghiên cứu
  student:{hair:'buns',hairColor:0x3b271e,outfit:'hoodie',top:0xa78bfa,hood:0xc4b1ff,cuff:0x9a7cf5,band:0x9a7cf5,pants:0x5e5680,cargo:false,shoeAccent:0xa78bfa,headphones:{on:'head',color:0xb9a2ff,accent:0xf6f3ff,star:true},pose:'tablet',mouth:'open',robot:true,seed:11}
};
// Arm pose per side: x = forward swing (negative = forward), in = yaw toward body, out = raise sideways, e = elbow bend, ez = sideways elbow bend
const IDLE={x:.05,in:0,out:.12,e:-.25};
const POSES={
  idle:{L:IDLE,R:IDLE},
  chin:{L:{x:-.5,in:.9,out:0,e:-1.3},R:{x:-1.3,in:.6,out:0,e:-1.5}},
  cheek:{L:IDLE,R:{x:-1.6,in:.3,out:0,e:-1.4}},
  fist:{L:IDLE,R:{x:-.6,in:.1,out:.15,e:-2.0}},
  tablet:{L:{x:-.55,in:.35,out:0,e:-1.0},R:{x:-.55,in:.35,out:0,e:-1.0}},
  wave:{L:IDLE,R:{x:-.2,in:0,out:1.3,e:0,ez:1.6}}
};

function face(head,o){
  const skin=mat(SKIN,.55),eyes=[];
  add(head,sph(R,40,28),skin);
  if(o.hair==='messy'||o.hair==='neat')for(const s of[-1,1])add(head,sph(.06),skin,[s*.29,-.03,0],[.5,1,.8]);
  for(const s of[-1,1]){
    const e=onHead(head,s*.36,-.1,-.004);eyes.push(e);
    add(e,sph(.064),mat(0xfdfdff,.3),[0,0,0],[.82,1.05,.32]);
    add(e,sph(.056),mat(o.eyeColor??0x4a2a18,.25),[0,-.004,.008],[.8,1.02,.3]);
    add(e,sph(.032),mat(0x140b08,.2),[0,-.008,.016],[.8,1,.3]);
    add(e,sph(.017),mat(0xffffff,.1),[.016,.022,.026],[1,1,.4]);
    add(e,sph(.009),mat(0xffffff,.1),[-.016,-.024,.026],[1,1,.4]);
    add(e,tor(.056,.008,Math.PI),mat(0x24150f,.5),[0,0,.012],[.88,1.18,1]);
    add(onHead(head,s*.36,.2,.006),cap(.009,.06),mat(shade(o.hairColor,.9),.5),[0,0,0],1,[0,0,Math.PI/2-s*.12]);
    add(onHead(head,s*.6,-.3,-.002),sph(.055),mat(0xff9aa2,.6,{transparent:true,opacity:.45,depthWrite:false}),[0,0,0],[1,.62,.18]);
  }
  add(onHead(head,0,-.27,0),sph(.016),mat(0xf3b9a0,.5),[0,0,0],[1.2,.8,.6]);
  const mo=onHead(head,0,-.43,.004);
  if(o.mouth==='open'){add(mo,geo('mouth',()=>new THREE.CircleGeometry(.042,24,Math.PI,Math.PI)),mat(0x8e3b3b,.5),[0,.012,0]);add(mo,geo('tongue',()=>new THREE.CircleGeometry(.024,16,Math.PI,Math.PI)),mat(0xff8f8f,.5),[0,-.004,.001])}
  else add(mo,tor(o.mouth==='grin'?.04:.03,.0065,Math.PI),mat(0x8a3a32,.5),[0,.014,0],1,[0,0,Math.PI]);
  return eyes;
}

function hair(head,o){
  const hm=mat(o.hairColor,.5);let seed=o.seed||1;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
  const skull=(len,tilt)=>add(head,geo(`hair${len}`,()=>new THREE.SphereGeometry(R*1.07,40,24,0,Math.PI*2,0,len)),mat(o.hairColor,.5,{side:THREE.DoubleSide}),[0,0,0],1,[-tilt,0,0]);
  if(o.hair==='messy'){
    skull(1.95,.6);
    for(let i=0;i<8;i++){const a=-1+i*.285;tuft(head,hm,a,.4,{w:.07,l:.11,d:.04,rz:a*.35+(rnd()-.5)*.5,out:.12})}
    for(let i=0;i<16;i++)tuft(head,hm,rnd()*Math.PI*2,.5+rnd()*.9,{lift:.012,w:.095,l:.11,d:.045,rz:(rnd()-.5)*1.6,out:.28,flip:true});
    for(const s of[-1,1])tuft(head,hm,s*1.28,-.02,{w:.055,l:.1,d:.035,rz:s*.25});
    for(let i=0;i<4;i++)tuft(head,hm,Math.PI+(i-1.5)*.35,-.55,{w:.06,l:.08,d:.04,rz:(rnd()-.5)*.6,out:-.3});
    tuft(head,hm,.3,1.25,{lift:.03,w:.045,l:.12,d:.03,out:1,flip:true});
  }else if(o.hair==='neat'){
    skull(1.85,.5);
    for(let i=0;i<6;i++)tuft(head,hm,-.75+i*.28,.42,{w:.075,l:.13,d:.045,rz:.95+(rnd()-.5)*.25,out:.2});
    for(let i=0;i<6;i++)tuft(head,hm,-.8+i*.32,.85,{lift:.008,w:.11,l:.14,d:.045,rz:(rnd()-.5)*.5,out:.12,flip:true});
    for(const s of[-1,1])tuft(head,hm,s*1.2,.05,{w:.06,l:.08,d:.03,rz:s*.3});
  }else{
    // long / buns share a bob volume that covers the ears
    add(head,sph(R,32,20),hm,[0,-.05,-.06],[1.06,.95,.92]);
    if(o.hair==='long'){
      skull(1.95,.6);
      for(const s of[-1,1])for(let i=0;i<3;i++)tuft(head,hm,s*(.18+i*.27),.33,{w:.07,l:.1,d:.04,rz:s*(.35+i*.15),out:.15,dy:-.01});
      add(head,cap(.2,.38),hm,[0,-.33,-.15],[1.45,1,.6]);
      for(const s of[-1,1])for(const [x,z,n] of [[.27,-.08,4],[.28,.04,4],[.21,.13,3]])for(let i=0;i<n;i++)lock(head,hm,s*(x+(i%2)*.03+i*.006),-.12-i*.15,z+i*.015,{w:.062,l:.14,d:.055,rz:s*(i%2?-.14:.14)});
      if(o.bun){add(head,sph(.1),hm,[0,.27,-.2]);add(head,tor(.07,.022),mat(o.scrunchie??0x1e6fe8,.5),[0,.235,-.165],1,[.93,0,0])}
    }else{
      skull(1.9,.42);
      for(let i=0;i<9;i++){const a=-.88+i*.22;tuft(head,hm,a,.36,{w:.065,l:.1,d:.04,rz:a*.2,out:.1})}
      for(const s of[-1,1]){add(head,sph(.12),hm,[s*.2,.25,-.12]);add(head,sph(.05),hm,[s*.27,.33,-.1]);add(head,cap(.06,.16),hm,[s*.275,-.14,.06],1,[0,0,s*.08])}
    }
  }
}

// Each leg hangs from a hip pivot at y=HIP so it can swing when walking
const HIP=.45;
function body(g,o){
  const top=mat(o.top,.75),pants=mat(o.pants,.8),skin=mat(SKIN,.55),legs={};
  for(const s of[-1,1]){
    const l=new THREE.Group();l.position.y=HIP;g.add(l);legs[s>0?'L':'R']=l;
    add(l,cap(.07,.25),pants,[s*.085,.28-HIP,0]);
    add(l,cyl(.066,.07,.05),mat(shade(o.pants,.8),.8),[s*.085,.105-HIP,0]);
    if(o.cargo!==false)add(l,box(.035,.1,.09),mat(shade(o.pants,1.12),.8),[s*.15,.3-HIP,0]);
    add(l,sph(.082),mat(o.shoe??0xf7f8fb,.45),[s*.09,.06-HIP,.035],[1,.62,1.45]);
    add(l,cyl(.083,.083,.026),mat(o.sole??0xe2e6ee,.6),[s*.09,.016-HIP,.035],[1,1,1.45]);
    if(o.shoeAccent)add(l,box(.012,.028,.09),mat(o.shoeAccent,.5),[s*.168,.065-HIP,.03]);
  }
  add(g,sph(.17),pants,[0,.49,0],[1.02,.5,.8]);
  add(g,cyl(.19,.212,.38,28),top,[0,.665,0],[1.1,1,.8]);
  add(g,sph(.2,28,16),top,[0,.855,0],[1.12,.5,.8]);
  add(g,cyl(.05,.058,.14),skin,[0,.97,0]);
  if(o.outfit==='hoodie'){
    const hood=mat(o.hood??o.top,.75),str=mat(0xf4f4f6,.5);
    add(g,cyl(.222,.222,.055,28),mat(o.band??o.top,.75),[0,.48,0],[1.1,1,.8]);
    add(g,tor(.11,.045),hood,[0,.965,-.005],[1.25,1.1,1],[Math.PI/2,0,0]);
    add(g,sph(.17),hood,[0,.95,-.14],[1.25,.62,.7]);
    add(g,box(.22,.085,.012),mat(shade(o.top,.94),.75),[0,.57,.168]);
    for(const s of[-1,1]){rod(g,[s*.045,.93,.15],[s*.05,.76,.163],.007,str);add(g,sph(.012),str,[s*.05,.755,.164])}
    if(o.logo){const d=decal(o.logo,.11,.11);d.position.set(.085,.73,.163);g.add(d)}
  }else{
    add(g,cyl(.216,.216,.028,28),mat(0x2b2f3a,.5),[0,.485,0],[1.1,1,.8]);
    for(const s of[-1,1])add(g,box(.09,.05,.014),top,[s*.05,.965,.075],1,[-.5,0,s*.55]);
    for(const y of[.83,.74,.65,.56])add(g,sph(.01,8,6),mat(0xd5d9e2,.4),[0,y,.155+(.855-y)*.048]);
    if(o.lanyard){
      const lm=mat(o.lanyard,.5);
      for(const s of[-1,1]){rod(g,[s*.075,.975,.06],[s*.06,.9,.15],.008,lm);rod(g,[s*.06,.9,.15],[0,.7,.168],.008,lm)}
      add(g,box(.085,.115,.012),mat(0xffffff,.4),[0,.635,.175]);add(g,box(.085,.028,.013),lm,[0,.68,.176]);add(g,box(.045,.035,.014),mat(0x9fb6d8,.5),[0,.627,.178]);
    }
  }
  return legs;
}

function arm(g,s,o,p){
  const sleeve=mat(o.sleeve??o.top,.75);
  const sh=new THREE.Group();sh.position.set(s*.245,.86,0);sh.rotation.set(p.x,-s*p.in,s*p.out,'YXZ');sh.userData.s=s;sh.userData.p=p;g.add(sh);
  add(sh,sph(.07),sleeve);add(sh,cap(.064,.12),sleeve,[0,-.11,0]);
  const el=new THREE.Group();el.position.y=-.22;el.rotation.set(p.e,0,s*(p.ez||0));sh.add(el);
  add(el,cap(.06,.1),sleeve,[0,-.07,0]);
  add(el,cyl(.063,.063,.045),mat(o.cuff??o.sleeve??o.top,.75),[0,-.145,0]);
  if(o.watch&&s===1){add(el,cyl(.062,.062,.022),mat(0x1d1f26,.4),[0,-.172,0]);add(el,box(.036,.036,.01),mat(0x2b2e38,.3),[0,-.172,.06])}
  add(el,sph(.058),mat(SKIN,.55),[0,-.215,0],[.9,1,.9]);
  return {sh,el};
}

function glasses(head,gl){
  const fm=mat(gl.color,.35),sq=gl.shape==='square',t=sq?.011:.0065;
  for(const s of[-1,1]){
    add(onHead(head,s*.36,-.1,.035),tor(.072,t),fm,[0,0,0],sq?[1.12,.92,1]:1);
    rod(head,[s*.19,-.03,.287],[s*.3,-.025,.17],t*.9,fm);rod(head,[s*.3,-.025,.17],[s*.31,-.015,-.05],t*.9,fm);
  }
  rod(head,[-.05,-.028,.337],[.05,-.028,.337],t*.9,fm);
}

function headphones(p,h){
  const c=mat(h.color,.4),a=mat(h.accent,.45);
  if(h.on==='head'){
    add(p,tor(.348,.024,Math.PI),c,[0,0,-.01]);
    for(const s of[-1,1]){
      add(p,cyl(.088,.088,.075),c,[s*.335,-.03,0],1,[0,0,Math.PI/2]);
      add(p,cyl(.078,.078,.03),a,[s*.29,-.03,0],1,[0,0,Math.PI/2]);
      add(p,tor(.07,.012),a,[s*.374,-.03,0],1,[0,Math.PI/2,0]);
    }
    if(h.star){const d=decal('star',.08,.08);d.position.set(.3755,-.03,0);d.rotation.y=Math.PI/2;p.add(d)}
  }else{
    add(p,tor(.19,.02,Math.PI),c,[0,.955,0],1,[-Math.PI/2,0,0]);
    for(const s of[-1,1]){
      rod(p,[s*.19,.955,0],[s*.165,.905,.1],.016,c);
      const cg=new THREE.Group();cg.position.set(s*.16,.885,.13);cg.rotation.set(-.3,s*.5,0);p.add(cg);
      add(cg,cyl(.085,.085,.06),c,[0,0,0],1,[Math.PI/2,0,0]);add(cg,tor(.072,.014),a,[0,0,.031]);add(cg,cyl(.04,.04,.004),mat(0xc9ccd6,.4),[0,0,.031],1,[Math.PI/2,0,0]);add(cg,cyl(.07,.07,.02),a,[0,0,-.035],1,[Math.PI/2,0,0]);
    }
  }
}

function tablet(g){
  const t=new THREE.Group();t.position.set(0,.73,.33);t.rotation.x=-.35;g.add(t);
  add(t,box(.3,.22,.016),mat(0x8f96a3,.35));add(t,box(.27,.19,.004),mat(0x1d2433,.2),[0,0,-.008]);
  const d=decal('robot',.1,.1);d.position.z=.0085;t.add(d);
}

function robot(p,x,z){
  const g=new THREE.Group();g.position.set(x,0,z);p.add(g);
  const w=mat(0xf6f7fc,.3),glow=mat(0x8fe3ff,.3,{emissive:0x45c8ff,emissiveIntensity:1.6});
  add(g,sph(.1),w,[0,.17,0],[1.05,1,.95]);add(g,sph(.035),mat(0xb9a7ff,.4),[0,.18,.09],[1,1,.4]);
  for(const s of[-1,1]){add(g,sph(.04),w,[s*.115,.17,0],[.7,1.1,.7]);add(g,sph(.04),w,[s*.05,.05,.02],[1,.7,1.2])}
  const h=new THREE.Group();h.position.y=.37;g.add(h);
  add(h,sph(.15),w,[0,0,0],[1.15,.88,1]);add(h,sph(.12),mat(0x1c2340,.2),[0,-.01,.07],[1.1,.72,.78]);
  for(const s of[-1,1]){
    add(h,cap(.016,.018),glow,[s*.05,0,.162],[1,1,.5]);
    add(h,geo('ear',()=>new THREE.ConeGeometry(.05,.09,16)),w,[s*.1,.13,0],1,[0,0,-s*.35]);
    add(h,geo('earIn',()=>new THREE.ConeGeometry(.028,.05,12)),mat(0xc9b8ff,.5),[s*.1,.125,.025],1,[0,0,-s*.35]);
  }
  return g;
}

export function createCharacter(look){
  const o={...look},root=new THREE.Group(),b=new THREE.Group();b.position.y=-.055;root.add(b);
  const legs=body(b,o);
  const pose=POSES[o.pose]||POSES.idle,arms={L:arm(b,1,o,pose.L),R:arm(b,-1,o,pose.R)};
  const head=new THREE.Group();head.position.y=HEAD_Y;b.add(head);
  const eyes=face(head,o);hair(head,o);
  if(o.glasses)glasses(head,o.glasses);
  if(o.headphones)headphones(o.headphones.on==='head'?head:b,o.headphones);
  head.children.forEach(c=>{if(c.userData.detail)c.traverse(m=>m.castShadow=false)});
  if(o.pose==='tablet')tablet(b);
  const bot=o.robot?robot(root,-.5,.15):null,phase=Math.random()*6;
  let blinkAt=800+Math.random()*3000,walking=false,w=0,lastT=0;
  // Walk cycle blends in/out (w: 0 = posed, 1 = full stride); the tablet pose keeps its arms
  function swing(a,c){const {s,p}=a.sh.userData,keep=o.pose==='tablet'?1:1-w;
    a.sh.rotation.set(p.x*keep+c*.55*(1-keep),-s*p.in*keep,s*(p.out*keep+.08*(1-keep)));
    a.el.rotation.set(p.e*keep-.35*(1-keep),0,s*(p.ez||0)*keep)}
  function update(t){
    const dt=Math.min(.1,(t-lastT)/1000);lastT=t;
    w=walking?Math.min(1,w+dt*5):Math.max(0,w-dt*5);
    head.rotation.set(Math.sin(t*.0009+phase)*.05,Math.sin(t*.0006+phase)*.12*(1-w),Math.sin(t*.0011+phase)*.045);
    if(t>blinkAt+160)blinkAt=t+2200+Math.random()*3800;
    const k=t-blinkAt,sy=k>0&&k<160?Math.max(.08,Math.abs(k-80)/80):1;eyes.forEach(e=>e.scale.y=sy);
    const c=Math.sin(t*.0095+phase);
    legs.L.rotation.x=c*.6*w;legs.R.rotation.x=-c*.6*w;
    b.position.y=-.055+Math.abs(c)*.035*w;
    swing(arms.L,-c);swing(arms.R,c);
    if(o.pose==='wave'&&w<.5)arms.R.el.rotation.z=-(1.6+Math.sin(t*.008)*.35)*(1-w*2);
    if(bot)bot.position.y=.03+Math.sin(t*.003+phase)*.025;
  }
  return {group:root,update,setWalk:v=>{walking=v}};
}
