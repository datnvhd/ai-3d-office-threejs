import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
// AI-agent characters after the reference sheets in /character: stylised 3D-animation teens/adults (head ≈ 1/4 of
// height) with large glossy eyes, soft clumpy hair, hoodie / open varsity jacket / shirt, baggy cargo joggers and
// chunky sneakers. Built from primitives, then merged per animated part (head, eyes, arms, legs…) so each character
// costs only a few draw calls. Character faces +z, feet at y=0, about 1.65 tall.
// The face and hair are modelled on a head of radius R and the whole head group is scaled by HEAD_K.
const SKIN=0xffd3b5,HAND=0xffdcc6,R=.31,HEAD_K=.7,HEAD_Y=1.45,UP=new THREE.Vector3(0,1,0);
const geoCache=new Map(),matCache=new Map();
const geo=(k,make)=>{if(!geoCache.has(k))geoCache.set(k,make());return geoCache.get(k)};
const sph=(r,w=24,h=16)=>geo(`s${r}_${w}_${h}`,()=>new THREE.SphereGeometry(r,w,h));
const cap=(r,l)=>geo(`c${r}_${l}`,()=>new THREE.CapsuleGeometry(r,l,6,16));
const cyl=(rt,rb,h,n=20)=>geo(`y${rt}_${rb}_${h}_${n}`,()=>new THREE.CylinderGeometry(rt,rb,h,n));
const tor=(r,t,arc=Math.PI*2)=>geo(`t${r}_${t}_${arc}`,()=>new THREE.TorusGeometry(r,t,10,40,arc));
const box=(w,h,d)=>geo(`b${w}_${h}_${d}`,()=>new THREE.BoxGeometry(w,h,d));
const rbox=(w,h,d)=>geo(`r${w}_${h}_${d}`,()=>new RoundedBoxGeometry(w,h,d,3,Math.min(w,h,d)*.45));
const mat=(c,rough=.6,extra)=>{const k=`${c}_${rough}_${extra?JSON.stringify(extra):''}`;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:0,...extra}));return matCache.get(k)};
const shade=(c,f)=>{const o=new THREE.Color(c);return o.setRGB(Math.min(1,o.r*f),Math.min(1,o.g*f),Math.min(1,o.b*f)).getHex()};
function add(p,g,m,pos=[0,0,0],s=1,r){const o=new THREE.Mesh(g,m);o.position.set(...pos);typeof s==='number'?o.scale.setScalar(s):o.scale.set(...s);if(r)o.rotation.set(...r);p.add(o);return o}
function rod(p,a,b,r,m){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),o=add(p,cyl(r,r,1,8),m);o.position.copy(A).add(B).multiplyScalar(.5);o.scale.set(1,A.distanceTo(B),1);o.quaternion.setFromUnitVectors(UP,B.sub(A).normalize());return o}
const pivot=g=>{g.userData.pivot=true;return g};
// Anchor on the head sphere: a = yaw from front, b = elevation; local +z points outward, +y up along the surface
function onHead(head,a,b,lift=0){const g=new THREE.Group(),r=R+lift;g.position.set(Math.sin(a)*Math.cos(b)*r,Math.sin(b)*r,Math.cos(a)*Math.cos(b)*r);g.rotation.set(-b,a,0,'YXZ');head.add(g);return g}

// Soft hair clump: rounded top, tapering tip at -y, bent along z (bend > 0 flicks the tip outward, < 0 hugs the head)
const clump=bend=>geo(`clump${bend}`,()=>{
  const g=new THREE.LatheGeometry([[0,-1],[.16,-.93],[.42,-.72],[.7,-.4],[.9,-.05],[1,.3],[.96,.6],[.78,.84],[.45,.98],[0,1]].map(p=>new THREE.Vector2(...p)),28);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const t=(1-p.getY(i))/2;p.setZ(i,p.getZ(i)+bend*t*t)}
  g.computeVertexNormals();return g});
const B=v=>Math.round(v*10)/10;// bends are cached in .1 steps
function tuft(head,m,a,b,{lift=.01,w=.12,l=.17,d=.065,dy=-.05,rz=0,out=0,bend=.2,flip=false}={}){const g=onHead(head,a,b,lift);add(g,clump(B(bend)),m,[0,flip?-dy:dy,0],[w,l,d],[out,0,rz+(flip?Math.PI:0)]);return g}
function lock(p,m,x,y,z,{w=.08,l=.16,d=.065,rz=0,rx=0,ry=0,bend=0}={}){return add(p,clump(B(bend)),m,[x,y,z],[w,l,d],[rx,ry,rz])}

// Logos are drawn white and tinted by the decal material (except the coloured heart / star)
const text=(s,k=.62)=>(x,W,H)=>{x.fillStyle='#fff';x.font=`bold ${H*k}px Consolas,monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText(s,W/2,H/2)};
const ICONS={
  code:text('</>'),
  api:text('{ }'),
  code2:(x,W,H)=>{x.fillStyle='#fff';x.font=`bold ${H*.3}px Consolas,monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText('</>',W*.25,H/2);x.fillText('</>',W*.75,H/2)},
  heart:(x,W,H)=>{const s=W*.32,cx=W/2,cy=H*.4;x.fillStyle='#ff6b8a';x.beginPath();x.moveTo(cx,cy+s*1.1);x.bezierCurveTo(cx-s*1.6,cy,cx-s*.7,cy-s*1.1,cx,cy-s*.3);x.bezierCurveTo(cx+s*.7,cy-s*1.1,cx+s*1.6,cy,cx,cy+s*1.1);x.fill()},
  chart:(x,W,H)=>{x.fillStyle='#fff';[.35,.6,.9].forEach((h,i)=>x.fillRect(W*(.16+i*.25),H*(.88-h*.72),W*.17,H*h*.72))},
  check:(x,W,H)=>{x.strokeStyle='#fff';x.lineWidth=W*.13;x.lineCap=x.lineJoin='round';x.beginPath();x.moveTo(W*.2,H*.52);x.lineTo(W*.42,H*.74);x.lineTo(W*.8,H*.28);x.stroke()},
  robot:(x,W,H)=>{x.strokeStyle=x.fillStyle='#fff';x.lineWidth=W*.06;x.beginPath();x.roundRect(W*.18,H*.3,W*.64,H*.5,W*.14);x.stroke();for(const ex of[.38,.62]){x.beginPath();x.arc(W*ex,H*.55,W*.06,0,7);x.fill()}x.fillRect(W*.47,H*.12,W*.06,H*.18)},
  star:(x,W,H)=>{x.fillStyle='#ffd166';x.beginPath();for(let i=0;i<10;i++){const r=i%2?W*.2:W*.46,t=-Math.PI/2+i*Math.PI/5;x.lineTo(W/2+Math.cos(t)*r,H/2+Math.sin(t)*r)}x.closePath();x.fill()}
};
const decalMats=new Map();
const texs=new Map();
function decal(icon,w,h,tint=0xffffff){
  const k=icon+tint;
  if(!decalMats.has(k)){
    if(!texs.has(icon)){const c=document.createElement('canvas');c.width=256;c.height=256;ICONS[icon](c.getContext('2d'),256,256);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;texs.set(icon,t)}
    decalMats.set(k,new THREE.MeshStandardMaterial({map:texs.get(icon),color:tint,transparent:true,roughness:.6,polygonOffset:true,polygonOffsetFactor:-4}))}
  return new THREE.Mesh(geo(`plane${w}_${h}`,()=>new THREE.PlaneGeometry(w,h)),decalMats.get(k));
}
// Dark ink on light fabric, white ink on dark fabric
const ink=bg=>{const c=new THREE.Color(bg);return c.r*.3+c.g*.59+c.b*.11>.72?0x1e6fe8:0xffffff};

export const PRESETS={
  // Nam 18–22 · lập trình viên: áo khoác varsity xanh MỞ (tay trắng, bo sọc) ngoài hoodie trắng in "</>",
  // tai nghe quàng cổ, quần jogger túi hộp than chì, giày cổ cao trắng phối xanh, tóc nâu đậm bồng xoăn
  dev:{hair:'messy',hairColor:0x3a2820,outfit:'varsity',top:0x1e6fe8,sleeve:0xf5f7ff,hood:0xf5f7ff,cuff:0x1e6fe8,band:0x1e6fe8,stripe:0xf5f7ff,pants:0x2f3645,shoe:0xf7f8fb,shoeAccent:0x1e6fe8,logo:'code',headphones:{on:'neck',color:0xf4f5f8,accent:0x1e6fe8},pose:'fist',mouth:'smile',seed:3},
  // Nữ 18–22 · thiết kế / sáng tạo: hoodie vàng logo "</>" nhỏ, jogger túi hộp than chì, giày trắng phối vàng,
  // tóc nâu dài gợn sóng có búi trên đỉnh + buộc tóc xanh tím, mái gợn, kính tròn gọng mảnh
  designer:{hair:'long',bun:true,scrunchie:0x5b6cf0,hairColor:0x5a3626,outfit:'hoodie',top:0xffd166,hood:0xffd166,cuff:0xf5c04f,band:0xf5c04f,pants:0x3d4352,shoeAccent:0xffd166,logo:'code2',glasses:{shape:'round',color:0x4a3a34},pose:'cheek',mouth:'smile',seed:5},
  // Nam 28–35 · quản lý / điều phối dự án: sơ mi trắng xắn tay, quần âu than chì + thắt lưng, dây đeo thẻ xanh,
  // đồng hồ đen, kính đen chữ nhật, tóc nâu đậm gợn vuốt, giày trắng
  manager:{hair:'neat',hairColor:0x2e211c,outfit:'shirt',rolled:true,top:0xf7f8fb,pants:0x2f3645,slacks:true,shoe:0xf7f8fb,glasses:{shape:'square',color:0x1b1b1f},lanyard:0x2f6fe0,watch:true,pose:'pockets',mouth:'smile',seed:9},
  // Nữ 12–15 · học tập / nghiên cứu: hoodie tím lavender logo robot, quần túi hộp xám nhạt quai tím, giày tím–trắng,
  // hai búi tóc, mái bằng, tai nghe tím có ngôi sao vàng, robot mèo trợ lý
  student:{hair:'buns',hairColor:0x3b271e,outfit:'hoodie',top:0xa78bfa,hood:0xb9a2fc,cuff:0x9a7cf5,band:0x9a7cf5,pants:0xe5e7eb,strap:0xa78bfa,shoe:0xc4b5fd,shoeAccent:0xffffff,sole:0xffffff,logo:'robot',headphones:{on:'head',color:0xc4b5fd,accent:0xf6f3ff,star:true},pose:'tablet',mouth:'open',robot:true,scale:.9,seed:11}
};
// Arm pose per side: x = forward swing (negative = forward), in = yaw toward body, out = raise sideways, e = elbow bend, ez = sideways elbow bend
const IDLE={x:.04,in:0,out:.17,e:-.2};
const POSES={
  idle:{L:IDLE,R:IDLE},
  chin:{L:{x:-.45,in:.9,out:0,e:-1.5},R:{x:-.75,in:.55,out:0,e:-2.2}},
  pockets:{L:{x:-.02,in:.25,out:.12,e:-.5},R:{x:-.02,in:.25,out:.12,e:-.5}},
  cross:{L:{x:-.55,in:.95,out:0,e:-1.85},R:{x:-.45,in:.95,out:0,e:-1.9}},
  cheek:{L:IDLE,R:{x:-.7,in:.5,out:0,e:-2.25}},
  fist:{L:IDLE,R:{x:-.35,in:.1,out:.12,e:-2.1}},
  tablet:{L:{x:-.45,in:.35,out:0,e:-1.15},R:{x:-.45,in:.35,out:0,e:-1.15}},
  wave:{L:IDLE,R:{x:-.15,in:0,out:1.2,e:0,ez:1.7}}
};

function face(head,o){
  const skin=mat(SKIN,.6),eyes=[],girl=o.hair==='long'||o.hair==='buns',lash=mat(0x24160f,.45);
  // soft rounded head: cranium + slightly full cheeks and a small rounded chin
  add(head,sph(R,48,32),skin);
  // slightly fuller lower face so the jaw reads round from the side
  add(head,sph(R*.92,40,24),skin,[0,-.035,.025],[1,1,1]);
  for(const s of[-1,1]){add(head,sph(.07),skin,[s*.3,-.05,-.01],[.42,.85,.65]);add(head,sph(.04),mat(shade(SKIN,.92),.6),[s*.322,-.05,0],[.3,.65,.5])}
  const white=mat(0xfdfdff,.3),iris=mat(o.eyeColor??0x6b4026,.35),ring=mat(0x3a2418,.35),pupil=mat(0x120a06,.3),glow=mat(0xa8774e,.4),
    shine=mat(0xffffff,.1,{emissive:0xffffff,emissiveIntensity:.7});
  for(const s of[-1,1]){
    // glossy sheet eyes: white, chocolate iris with a darker ring, pupil, warm lower glow, two bright highlights, upper lash
    const e=pivot(onHead(head,s*.33,-.1,-.012));eyes.push(e);
    const k=new THREE.Group();k.scale.setScalar(.86);e.add(k);
    add(k,sph(.088),white,[0,0,0],[.8,1.06,.3]);
    add(k,sph(.075),ring,[0,-.008,.01],[.8,1.04,.3]);
    add(k,sph(.064),iris,[0,-.006,.013],[.8,1.02,.3]);
    add(k,sph(.032),pupil,[0,0,.021],[.85,1,.3]);
    add(k,sph(.03),glow,[0,-.046,.02],[1.35,.55,.2]);
    add(k,sph(.026),shine,[s*-.022,.032,.03],[1,1.1,.4]);
    add(k,sph(.012),shine,[s*.026,-.03,.03],[1,1,.4]);
    add(k,tor(.073,.012,Math.PI*.92),lash,[0,0,.018],[.98,1.14,1],[0,0,Math.PI*.04]);
    if(girl)add(k,cap(.009,.04),lash,[s*.072,.03,.016],1,[0,0,s*-1.15]);
    add(onHead(head,s*.32,.17,.008),cap(.011,.06),mat(shade(o.hairColor,1.05),.5),[0,0,0],1,[0,0,Math.PI/2-s*.18]);
    add(onHead(head,s*.55,-.3,.02),sph(.055),mat(0xff8e9b,.6,{transparent:true,opacity:.42,depthWrite:false}),[0,0,0],[1,.6,.16]);
  }
  add(onHead(head,0,-.25,.004),sph(.015),mat(0xf0a88c,.5),[0,0,0],[1.2,.8,.6]);
  const mo=onHead(head,0,-.4,.012);
  if(o.mouth==='open'){add(mo,geo('mouth',()=>new THREE.CircleGeometry(.04,24,Math.PI,Math.PI)),mat(0x8e3b3b,.5),[0,.014,0]);add(mo,geo('tongue',()=>new THREE.CircleGeometry(.023,16,Math.PI,Math.PI)),mat(0xff8f8f,.5),[0,-.004,.001])}
  else add(mo,tor(o.mouth==='grin'?.038:.03,.007,Math.PI),mat(0x8a3a32,.5),[0,.016,0],1,[0,0,Math.PI]);
  return eyes;
}

// Hair: a smooth scalp shell plus a few large overlapping rounded locks (one main colour, few highlights)
function hair(head,o){
  const hm=mat(o.hairColor,.55),hl=mat(shade(o.hairColor,1.12),.5);let seed=o.seed||1;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
  const shell=(r,len,tilt)=>add(head,geo(`shell${r}_${len}`,()=>new THREE.SphereGeometry(R*r,48,32,0,Math.PI*2,0,len)),hm,[0,0,0],1,[-tilt,0,0]);
  if(o.hair==='messy'){
    shell(1.08,1.95,.6);
    // fluffy fringe falling over the forehead
    for(let i=0;i<5;i++){const a=-.7+i*.35;tuft(head,i===2?hl:hm,a,.7,{w:.17,l:.17,d:.1,rz:a*.45+(rnd()-.5)*.25,bend:-.15,dy:-.02,out:.1})}
    // full wavy crown
    for(let i=0;i<11;i++){const a=(i/11)*Math.PI*2+rnd()*.4,b=.75+rnd()*.65;tuft(head,i%4===0?hl:hm,a,b,{lift:.05,w:.19,l:.21,d:.11,rz:(rnd()-.5)*1.1,bend:.55,out:.35})}
    for(const s of[-1,1])for(const [a,b] of [[1.35,.42],[1.9,.3]])tuft(head,hm,s*a,b,{w:.14,l:.15,d:.08,rz:s*(.35+rnd()*.2),bend:.5,out:.15});
    for(let i=0;i<4;i++)tuft(head,hm,Math.PI+(i-1.5)*.5,-.1,{w:.16,l:.18,d:.09,rz:(rnd()-.5)*.5,bend:.5});
    tuft(head,hl,.1,1.2,{lift:.035,w:.09,l:.16,d:.06,rz:.4,bend:.8,flip:true});
  }else if(o.hair==='neat'){
    shell(1.05,1.85,.72);add(head,sph(R,32,20),hm,[0,.0,-.07],[1.0,.9,.96]);
    // side-parted fringe swept across, wavy top
    for(let i=0;i<4;i++){const a=-.5+i*.35;tuft(head,i===1?hl:hm,a,.63,{w:.17,l:.21,d:.1,rz:1.0+(rnd()-.5)*.2,bend:-.3,dy:-.02})}
    for(let i=0;i<6;i++)tuft(head,i===2?hl:hm,-.9+i*.36,.95+rnd()*.15,{lift:.04,w:.19,l:.21,d:.11,rz:.6+(rnd()-.5)*.3,bend:.45,out:.3,flip:true});
    for(let i=0;i<4;i++)tuft(head,hm,Math.PI+(i-1.5)*.55,.3,{w:.17,l:.2,d:.09,rz:(rnd()-.5)*.4,bend:-.1});
    for(const s of[-1,1])tuft(head,hm,s*1.3,.55,{w:.12,l:.12,d:.07,rz:s*.25,bend:-.2});
  }else{
    // long / buns share a soft bob volume behind the ears
    add(head,sph(R,40,24),hm,[0,-.03,-.07],[1.08,.98,.94]);
    if(o.hair==='long'){
      shell(1.08,1.95,.58);
      // centre-parted wavy bangs
      for(const s of[-1,1])for(let i=0;i<2;i++)tuft(head,i?hm:hl,s*(.2+i*.38),.6,{w:.16,l:.2,d:.1,rz:s*(.45+i*.3),bend:-.3,dy:-.02});
      // smooth back curtain + a few long wavy strands over the shoulders
      add(head,cap(.24,.72),hm,[0,-.42,-.17],[1.5,1,.68]);
      const wave=(x,z,ry,n,w)=>{let y=-.08;for(let k=0;k<n;k++){const flare=1+k*.08;lock(head,k===1?hl:hm,x*flare+(k%2?.015:-.015)*Math.sign(x||1),y,z,{w:w*flare,l:.27,d:.11,ry,rz:(k%2?.12:-.12)*Math.sign(x||1),bend:k%2?.22:-.22});y-=.18}};
      for(const s of[-1,1]){wave(s*.29,.02,s*.5,4,.12);wave(s*.27,-.16,s*1.1,4,.13)}
      for(const x of[-.13,.13])wave(x,-.32,0,4,.14);
      if(o.bun){add(head,sph(.14,32,20),hm,[0,.38,-.08],[1,.9,1]);for(let i=0;i<4;i++)lock(head,i===1?hl:hm,Math.cos(i*1.57)*.08,.42+Math.sin(i*1.57)*.06,-.08,{w:.09,l:.11,d:.07,rz:i*1.57+.3,bend:.3});
        add(head,tor(.085,.032),mat(o.scrunchie??0x5b6cf0,.6),[0,.3,-.06],1,[Math.PI/2-.25,0,0])}
    }else{
      shell(1.08,1.9,.42);
      // blunt bangs
      for(let i=0;i<5;i++){const a=-.72+i*.36;tuft(head,i===2?hl:hm,a,.58,{w:.15,l:.17,d:.09,rz:a*.12,bend:-.3,dy:-.02})}
      for(const s of[-1,1]){
        add(head,sph(.14,32,20),hm,[s*.2,.27,-.12]);for(let i=0;i<3;i++)lock(head,i?hm:hl,s*.2+Math.cos(i*2.1)*.08,.3+Math.sin(i*2.1)*.07,-.06,{w:.09,l:.11,d:.07,rz:i*2.1+.4,bend:.3});
        lock(head,hm,s*.29,-.12,.04,{w:.1,l:.22,d:.08,rz:s*.1,bend:.25});lock(head,hm,s*.27,-.14,-.09,{w:.11,l:.22,d:.08,rz:s*.15,bend:.3});
      }
    }
  }
}

// ---------- body ----------
// Heights (feet at 0): ankle .17, hip pivot .8, hoodie hem .74, shoulders 1.13, neck 1.17–1.3, head centre 1.43
const HIP=.8,SH_Y=1.1,SH_X=.2,NECK=1.2,ZS=.72;
// Lathe profile (radius by height) squashed front-to-back; phi0/phiLen leave a front opening (open jacket)
const torsoGeo=(k,prof,phi0=0,len=Math.PI*2)=>geo(k,()=>{const g=new THREE.LatheGeometry(prof.map(([r,y])=>new THREE.Vector2(r,y)),36,phi0,len);g.scale(1,1,ZS);return g});
const legGeo=(k,prof)=>geo(k,()=>new THREE.LatheGeometry(prof.map(([r,y])=>new THREE.Vector2(r,y)),20));
const HOODIE=[[0,.72],[.19,.725],[.198,.8],[.204,.92],[.2,1.03],[.186,1.1],[.15,1.16],[.085,1.2],[0,1.205]];
const JACKET=HOODIE.map(([r,y])=>[r?r+.016:0,y+(y<.73?-.005:0)]);
const SHIRT=[[0,.74],[.172,.745],[.18,.82],[.19,.94],[.188,1.04],[.174,1.11],[.14,1.165],[.075,1.2],[0,1.205]];
const GAP=.44;// half-width (radians) of the open jacket front

// Point on the torso surface at angle a (0 = front) and height y, for placing decals/patches
function onTorso(prof,a,y){let r=prof[1][0];for(let i=1;i<prof.length;i++)if(prof[i][1]>=y){const [r0,y0]=prof[i-1],[r1,y1]=prof[i];r=r0+(r1-r0)*(y-y0)/((y1-y0)||1);break}
  return [Math.sin(a)*r,y,Math.cos(a)*r*ZS]}

function shoes(l,s,o){
  const up=mat(o.shoe??0xf7f8fb,.5),sole=mat(o.sole??0xe6e9f0,.6),x=s*.085;
  add(l,rbox(.125,.045,.215),sole,[x,.023-HIP,.035]);
  add(l,sph(.072),up,[x,.075-HIP,.065],[.92,.68,1.35]);// toe box
  add(l,sph(.07),up,[x,.09-HIP,-.03],[.95,.95,1.05]);// heel
  add(l,cyl(.066,.072,.09,18),up,[x,.14-HIP,-.012]);// high-top collar
  add(l,tor(.058,.012),mat(shade(o.shoe??0xf7f8fb,.92),.5),[x,.185-HIP,-.012],1,[Math.PI/2,0,0]);
  if(o.shoeAccent){const a=mat(o.shoeAccent,.5);
    for(const side of[-1,1])add(l,rbox(.012,.05,.13),a,[x+side*.064,.085-HIP,.0],1,[0,0,side*-.1]);
    add(l,rbox(.05,.06,.014),a,[x,.13-HIP,-.088]);// heel tab
    add(l,rbox(.06,.012,.05),a,[x,.112-HIP,.075],1,[-.5,0,0])}// tongue/laces patch
  for(const z of[.04,.075])add(l,box(.05,.008,.01),mat(0xdfe3ea,.5),[x,.115-HIP+(z-.04)*-.3,z],1,[-.45,0,0]);
}

function legs(g,o){
  const pants=mat(o.pants,.85),dark=mat(shade(o.pants,.85),.85),out={};
  for(const s of[-1,1]){
    const l=pivot(new THREE.Group());l.position.y=HIP;g.add(l);out[s>0?'L':'R']=l;const x=s*.085;
    if(o.slacks){
      // straight trousers falling over the shoe collar
      add(l,legGeo('slack',[[0,0],[.062,0],[.064,.1],[.068,.32],[.078,.5],[.085,.62],[0,.64]]),pants,[x,.16-HIP,0]);
    }else{
      // baggy joggers gathered into a ribbed ankle cuff
      add(l,legGeo('jog',[[0,0],[.06,0],[.072,.05],[.084,.2],[.09,.38],[.092,.52],[.09,.62],[0,.64]]),pants,[x,.2-HIP,0]);
      add(l,cyl(.058,.062,.06,16),dark,[x,.19-HIP,0]);
      for(const k of[0,1])add(l,tor(.06,.006),dark,[x,.175-HIP+k*.025,0],1,[Math.PI/2,0,0]);
      add(l,tor(.082,.007),dark,[x,.43-HIP,0],[1,1,1],[Math.PI/2,0,0]);// knee crease
      if(o.cargo!==false){
        const pk=mat(shade(o.pants,1.06),.85),fl=mat(shade(o.pants,.9),.85),sx=s*.172;
        add(l,rbox(.034,.13,.12),pk,[x+s*.082,.5-HIP,0]);add(l,rbox(.04,.035,.125),fl,[x+s*.087,.575-HIP,0]);
        if(o.strap)for(const dz of[-.035,.035])add(l,rbox(.012,.075,.016),mat(o.strap,.6),[x+s*.1,.52-HIP,dz]);
        void sx;
      }
    }
    shoes(l,s,o);
  }
  // pelvis / seat
  add(g,sph(.17),mat(o.pants,.85),[0,.8,0],[1.12,.5,.82]);
  if(o.outfit==='shirt'){add(g,cyl(.183,.183,.035,32),mat(0x1d1f26,.45),[0,.76,0],[1,1,ZS+.05]);add(g,rbox(.05,.032,.014),mat(0xc9ced8,.25),[0,.76,.137])}
  return out;
}

function hoodie(g,o,prof){
  const top=mat(o.outfit==='varsity'?o.hood??0xf5f7ff:o.top,.8),hem=mat(o.outfit==='varsity'?o.hood??0xf5f7ff:o.band??o.top,.8);
  add(g,torsoGeo('hoodie',prof),top);
  add(g,cyl(.196,.192,.05,32),hem,[0,.745,0],[1,1,ZS]);
  // hood lying on the back + collar ring, drawstrings
  const hm=mat(o.hood??o.top,.8),str=mat(0xf4f4f6,.5);
  add(g,tor(.085,.042),hm,[0,NECK,-.01],[1.25,1.1,1],[Math.PI/2,0,0]);
  add(g,sph(.13),hm,[0,1.16,-.13],[1.15,.78,.62]);
  for(const s of[-1,1]){rod(g,[s*.04,1.19,.1],[s*.045,1.03,.14],.006,str);add(g,cap(.009,.018),str,[s*.045,1.02,.141])}
  if(o.outfit!=='varsity'){
    add(g,rbox(.2,.085,.02),mat(shade(o.top,.94),.8),[0,.84,.142]);// kangaroo pocket
    if(o.logo){const d=decal(o.logo,.13,.13,o.logo==='heart'?0xffffff:ink(o.top));d.position.set(0,1.0,.149);g.add(d)}
  }
}

// Open varsity jacket over the hoodie: body with a front opening, ribbed striped hem, snaps and patches
function varsity(g,o){
  hoodie(g,o,HOODIE);
  const jm=mat(o.top,.7,{side:THREE.DoubleSide});
  add(g,torsoGeo('jacket',JACKET,GAP,Math.PI*2-GAP*2),jm);
  const band=mat(o.band??o.top,.75),stripe=mat(o.stripe??0xffffff,.7);
  add(g,geo('jhem',()=>new THREE.CylinderGeometry(.218,.214,.055,36,1,true,GAP,Math.PI*2-GAP*2)),mat(o.band??o.top,.75,{side:THREE.DoubleSide}),[0,.745,0],[1,1,ZS]);
  for(const y of[.758,.738])add(g,geo('jstr',()=>new THREE.CylinderGeometry(.221,.221,.006,36,1,true,GAP,Math.PI*2-GAP*2)),mat(o.stripe??0xffffff,.7,{side:THREE.DoubleSide}),[0,y,0],[1,1,ZS]);
  // front edges with snaps, standing knit collar
  for(const s of[-1,1]){
    const a=s*GAP;
    for(let k=0;k<4;k++){const p=onTorso(JACKET,a,.8+k*.1);add(g,cyl(.011,.011,.008,10),mat(0xdfe4ee,.3),[p[0],p[1],p[2]+.004],1,[Math.PI/2,0,0])}
    const c=onTorso(JACKET,s*.9,1.16);add(g,rbox(.13,.05,.03),band,[c[0]*.92,1.175,c[2]*.92],1,[-.3,s*.9,s*.35]);
  }
  void stripe;
  // chest patch "</>" on the jacket and print on the hoodie underneath
  if(o.logo){
    const p=onTorso(JACKET,-.85,1.02),d=decal(o.logo,.075,.075,ink(o.top));d.position.set(p[0]*1.02,p[1],p[2]*1.02+.004);d.rotation.y=-.85;g.add(d);
    const q=decal(o.logo,.11,.11,ink(o.hood??0xffffff));q.position.set(0,.98,.151);g.add(q);
  }
}

function shirt(g,o){
  const top=mat(o.top,.7);
  add(g,torsoGeo('shirt',SHIRT),top);
  // collar points, placket and buttons
  for(const s of[-1,1])add(g,rbox(.085,.05,.014),top,[s*.045,1.195,.085],1,[-.55,0,s*.62]);
  add(g,cyl(.06,.064,.035,20),top,[0,1.2,0]);
  rod(g,[0,1.16,.115],[0,.76,.132],.005,mat(0xe6e9f0,.6));
  for(const y of[1.1,1.0,.9,.8])add(g,sph(.008,8,6),mat(0xd0d5df,.4),[0,y,onTorso(SHIRT,0,y)[2]+.003]);
  // pocket
  add(g,rbox(.065,.07,.008),mat(shade(o.top,.97),.7),[-.08,1.0,onTorso(SHIRT,-.42,1.0)[2]+.002],1,[0,-.42,0]);
  if(o.lanyard){
    const lm=mat(o.lanyard,.5);
    for(const s of[-1,1]){rod(g,[s*.065,1.215,.03],[s*.07,1.15,.11],.008,lm);rod(g,[s*.07,1.15,.11],[0,.98,.14],.008,lm)}
    add(g,rbox(.075,.1,.01),mat(0xffffff,.4),[0,.91,.143]);add(g,box(.075,.024,.011),lm,[0,.95,.144]);add(g,box(.04,.032,.012),mat(0x9fb6d8,.5),[0,.9,.146]);
    add(g,cyl(.008,.008,.02,8),mat(0xb8bfcc,.3),[0,.97,.142]);
  }
}

function body(g,o){
  const lg=legs(g,o);
  add(g,cyl(.044,.05,.16,16),mat(SKIN,.6),[0,1.27,0]);
  if(o.outfit==='shirt')shirt(g,o);else if(o.outfit==='varsity')varsity(g,o);else hoodie(g,o,HOODIE);
  return lg;
}

// Upper arm from a shoulder pivot, forearm from an elbow pivot; sleeves: hoodie (to wrist, ribbed cuff),
// varsity (white sleeve, striped cuff), shirt (rolled up above the elbow, bare forearm)
function arm(g,s,o,p){
  const sleeveCol=o.outfit==='varsity'?o.sleeve??0xf5f7ff:o.sleeve??o.top,sleeve=mat(sleeveCol,.75),skin=mat(SKIN,.55);
  const sh=pivot(new THREE.Group());sh.position.set(s*SH_X,SH_Y,0);sh.rotation.set(p.x,-s*p.in,s*p.out,'YXZ');sh.userData.s=s;sh.userData.p=p;g.add(sh);
  add(sh,sph(.062),sleeve,[0,-.005,0],[1,1,.95]);add(sh,cap(.054,.15),sleeve,[0,-.12,0]);
  const el=pivot(new THREE.Group());el.position.y=-.25;el.rotation.set(p.e,0,s*(p.ez||0));sh.add(el);
  if(o.rolled){
    add(el,cyl(.064,.062,.06,16),sleeve,[0,.0,0]);for(const y of[.02,-.015])add(el,tor(.062,.012),sleeve,[0,y,0],1,[Math.PI/2,0,0]);
    add(el,cap(.044,.15),skin,[0,-.11,0]);
  }else{
    add(el,cap(.05,.13),sleeve,[0,-.08,0]);
    const cuff=o.outfit==='varsity'?o.cuff??o.top:o.cuff??o.top;
    add(el,cyl(.05,.053,.06,16),mat(cuff,.8),[0,-.185,0]);
    if(o.stripe&&o.outfit==='varsity')for(const y of[-.175,-.195])add(el,cyl(.054,.054,.006,16),mat(o.stripe,.7),[0,y,0]);
  }
  if(o.watch&&s===1){add(el,cyl(.047,.047,.022,16),mat(0x1d1f26,.4),[0,-.185,0]);add(el,rbox(.038,.042,.012),mat(0x2b2e38,.25),[0,-.185,.046])}
  // mitten hand with thumb
  const hand=mat(HAND,.5);add(el,sph(.04),hand,[0,-.245,0],[.9,1.15,.8]);add(el,sph(.016),hand,[-s*.027,-.232,.02]);
  return {sh,el};
}

function glasses(head,gl){
  const fm=mat(gl.color,.35),sq=gl.shape==='square',t=sq?.014:.0055;
  for(const s of[-1,1]){
    add(onHead(head,s*.34,-.11,.035),tor(.085,t),fm,[0,0,0],sq?[1.12,.88,1]:1);
    rod(head,[s*.2,-.025,.3],[s*.315,-.015,.16],t*.9,fm);rod(head,[s*.315,-.015,.16],[s*.32,-.01,-.05],t*.9,fm);
  }
  rod(head,[-.035,-.03,.342],[.035,-.03,.342],t*.9,fm);
}

function headphones(p,h){
  const c=mat(h.color,.4),a=mat(h.accent,.45);
  if(h.on==='head'){
    add(p,tor(.36,.026,Math.PI),c,[0,0,-.01]);
    for(const s of[-1,1]){
      add(p,cyl(.092,.092,.08),c,[s*.345,-.03,0],1,[0,0,Math.PI/2]);
      add(p,cyl(.08,.08,.03),a,[s*.3,-.03,0],1,[0,0,Math.PI/2]);
      add(p,tor(.073,.013),a,[s*.387,-.03,0],1,[0,Math.PI/2,0]);
    }
    if(h.star){const d=decal('star',.085,.085);d.position.set(.3885,-.03,0);d.rotation.y=Math.PI/2;p.add(d)}
  }else{
    // around the neck, resting on the collar
    const n=new THREE.Group();n.position.set(0,NECK-.01,0);p.add(n);
    add(n,tor(.1,.014,Math.PI),c,[0,.01,-.01],1,[-Math.PI/2-.35,0,0]);
    for(const s of[-1,1]){
      const cg=new THREE.Group();cg.position.set(s*.1,-.035,.07);cg.rotation.set(-.25,s*.4,0);n.add(cg);
      add(cg,cyl(.062,.062,.045,20),c,[0,0,0],1,[Math.PI/2,0,0]);add(cg,tor(.052,.011),a,[0,0,.023]);add(cg,cyl(.032,.032,.004,16),mat(0xc9ccd6,.4),[0,0,.024],1,[Math.PI/2,0,0]);add(cg,cyl(.05,.05,.014,16),a,[0,0,-.026],1,[Math.PI/2,0,0]);
    }
  }
}

function tablet(g){
  const t=new THREE.Group();t.position.set(0,.95,.27);t.rotation.x=-.45;g.add(t);
  add(t,rbox(.26,.19,.014),mat(0x8f96a3,.35));add(t,box(.235,.165,.004),mat(0x1d2433,.2),[0,0,-.008]);
  const d=decal('robot',.09,.09);d.position.z=.008;t.add(d);
}

function robot(p,x,z){
  const g=pivot(new THREE.Group());g.position.set(x,0,z);p.add(g);
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

// Merge every static mesh under each animated part into one mesh per material (pivots stay separate groups)
function mergeTree(g){
  g.updateMatrixWorld(true);
  const inv=g.matrixWorld.clone().invert(),buckets=new Map(),done=[],pivots=[];
  (function walk(o){for(const c of o.children){if(c.userData.pivot){pivots.push(c);continue}if(c.isMesh){const m=new THREE.Matrix4().multiplyMatrices(inv,c.matrixWorld),gg=c.geometry.index?c.geometry.clone():c.geometry.clone();gg.applyMatrix4(m);if(!buckets.has(c.material))buckets.set(c.material,[]);buckets.get(c.material).push(gg);done.push(c)}walk(c)}})(g);
  for(const c of done)c.removeFromParent();
  for(const [m,list] of buckets){
    for(const gg of list)for(const k of Object.keys(gg.attributes))if(!['position','normal','uv'].includes(k))gg.deleteAttribute(k);
    const flat=list.some(x=>!x.index),parts=flat?list.map(x=>x.index?x.toNonIndexed():x):list,merged=mergeGeometries(parts,false);parts.forEach(x=>x.dispose());list.forEach(x=>x.dispose());if(!merged)continue;
    const mesh=new THREE.Mesh(merged,m);mesh.castShadow=!m.transparent;mesh.receiveShadow=true;g.add(mesh);
  }
  pivots.forEach(mergeTree);
}

export function createCharacter(look){
  const o={...look},root=new THREE.Group(),b=pivot(new THREE.Group());root.add(b);
  // older looks may still say outfit:'hoodie' with a sleeve colour for the varsity style; keep them as hoodies
  const lg=body(b,o);
  const pose=POSES[o.pose]||POSES.idle,arms={L:arm(b,1,o,pose.L),R:arm(b,-1,o,pose.R)};
  const head=pivot(new THREE.Group());head.position.y=HEAD_Y;head.scale.set(1.04*HEAD_K,HEAD_K,HEAD_K);b.add(head);
  const eyes=face(head,o);hair(head,o);
  if(o.glasses)glasses(head,o.glasses);
  if(o.headphones)headphones(o.headphones.on==='head'?head:b,o.headphones);
  if(o.pose==='tablet')tablet(b);
  const bot=o.robot?robot(root,-.5,.15):null,phase=Math.random()*6;
  root.scale.setScalar(o.scale||1);
  mergeTree(root);
  let blinkAt=800+Math.random()*3000,walking=false,w=0,lastT=0,sitting=false,st=0;
  // Walk cycle blends in/out (w: 0 = posed, 1 = full stride); the tablet pose keeps its arms
  // Seated (st: 0 = standing, 1 = on the chair): arms move to a typing pose in front of the body
  const TYPE={x:-.6,in:.28,out:0,e:-1.2,ez:0};
  function swing(a,c){const {s,p:p0}=a.sh.userData,keep=o.pose==='tablet'&&!st?1:1-w;
    const p=st?{x:p0.x+(TYPE.x-p0.x)*st,in:p0.in+(TYPE.in-p0.in)*st,out:p0.out*(1-st),e:p0.e+(TYPE.e+Math.sin(lastT*.018+s*2)*.06-p0.e)*st,ez:(p0.ez||0)*(1-st)}:p0;
    a.sh.rotation.set(p.x*keep+c*.45*(1-keep),-s*p.in*keep,s*(p.out*keep+.06*(1-keep)));
    a.el.rotation.set(p.e*keep-.3*(1-keep),0,s*(p.ez||0)*keep)}
  function update(t){
    const dt=Math.min(.1,(t-lastT)/1000);lastT=t;
    w=walking?Math.min(1,w+dt*5):Math.max(0,w-dt*5);st=sitting?Math.min(1,st+dt*3):Math.max(0,st-dt*3);
    head.rotation.set(Math.sin(t*.0009+phase)*.05+.16*st,Math.sin(t*.0006+phase)*.12*(1-w),Math.sin(t*.0011+phase)*.04);
    if(t>blinkAt+160)blinkAt=t+2200+Math.random()*3800;
    const k=t-blinkAt,sy=k>0&&k<160?Math.max(.08,Math.abs(k-80)/80):1;eyes.forEach(e=>e.scale.y=sy);
    const c=Math.sin(t*.0095+phase);
    // seated: hips down onto the seat, legs forward under the desk
    lg.L.rotation.x=c*.5*w-1.35*st;lg.R.rotation.x=-c*.5*w-1.35*st;
    b.position.y=Math.abs(c)*.03*w-.3*st;
    b.scale.y=1+Math.sin(t*.0022+phase)*.006*(1-w);// breathing
    swing(arms.L,-c);swing(arms.R,c);
    if(o.pose==='wave'&&w<.5&&st<.5)arms.R.el.rotation.z=-(1.7+Math.sin(t*.008)*.35)*(1-w*2);
    if(bot)bot.position.y=.03+Math.sin(t*.003+phase)*.025;
  }
  return {group:root,update,setWalk:v=>{walking=v},setSit:v=>{sitting=v}};
}
