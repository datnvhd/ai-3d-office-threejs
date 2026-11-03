// Optional real 3D models for the agents. Drop GLB files into public/models/ and they replace the
// built-in procedural characters; without a file the procedural character stays.
// Lookup order per agent: <agent id>.glb (e.g. backend.glb), then the shared look file
// (dev.glb, manager.glb, designer.glb, student.glb — one per character sheet).
// Models are scaled to the office height, centred and put on the floor, facing +Z (glTF front).
// Animation clips named like "idle"/"stand" and "walk"/"run" are used when present, either inside the
// model file or as separate files from the same rig (<name>-idle.glb, <name>-walk.glb).
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/examples/jsm/utils/SkeletonUtils.js';

export const SHEET_OF={director:'manager',frontend:'dev',backend:'dev',qa:'dev',designer:'designer',analyst:'designer',research:'student'};
const HEIGHT={student:1.45};// the 12–15 girl is shorter
const loader=new GLTFLoader(),cache=new Map();

// Vite answers unknown paths with 404 (or index.html for browser navigations), so check the type too
async function exists(url){
  try{const r=await fetch(url,{method:'HEAD',cache:'no-store'});return r.ok&&!/text\/html/i.test(r.headers.get('content-type')||'')}catch{return false}
}
const load=url=>{if(!cache.has(url))cache.set(url,loader.loadAsync(url));return cache.get(url)};

export async function attachModel(char,agentId,look){
  const sheet=SHEET_OF[agentId]||look;// custom agents: the sheet of their chosen look
  for(const name of [agentId,sheet].filter(Boolean)){
    const url=`/models/${name}.glb`;
    if(!await exists(url))continue;
    let gltf;try{gltf=await load(url)}catch(e){console.warn('Không đọc được',url,e);continue}
    const model=cloneSkinned(gltf.scene);
    // normalise size and place feet on the floor at the character's origin
    const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar((HEIGHT[sheet]||1.65)/(size.y||1));
    box.setFromObject(model);const c=box.getCenter(new THREE.Vector3());
    model.position.set(model.position.x-c.x,model.position.y-box.min.y,model.position.z-c.z);
    model.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;o.frustumCulled=false}});
    const holder=new THREE.Group();holder.add(model);
    holder.scale.setScalar(1/(char.group.scale.x||1));// undo the procedural preset scale
    for(const ch of char.group.children)ch.visible=false;
    char.group.add(holder);

    // animations may also come as separate files from the same rig: <name>-idle.glb, <name>-walk.glb
    const clips=[...(gltf.animations||[])];
    for(const kind of ['idle','walk']){
      const extra=`/models/${name}-${kind}.glb`;
      if(!await exists(extra))continue;
      try{const a=(await load(extra)).animations?.[0];if(a){const c=a.clone();c.name=kind;clips.push(c)}}catch(e){console.warn('Không đọc được',extra,e)}
    }
    const find=re=>[...clips].reverse().find(c=>re.test(c.name));
    const walkClip=find(/walk|run|jog/i),idleClip=find(/idle|stand|breath/i)||clips.find(c=>c!==walkClip);
    const mixer=clips.length?new THREE.AnimationMixer(model):null;
    const idle=idleClip&&mixer.clipAction(idleClip),walk=walkClip&&mixer.clipAction(walkClip);
    (idle||walk)?.play();
    let walking=false,w=0,last=null;
    char.setWalk=v=>{
      if(v===walking)return;walking=v;
      if(idle&&walk){const [from,to]=v?[idle,walk]:[walk,idle];to.reset().play();from.crossFadeTo(to,.25,false)}
      else if(walk&&!idle){v?walk.play():walk.stop()}
    };
    char.update=t=>{
      const dt=last==null?0:Math.min(.1,(t-last)/1000);last=t;
      mixer?.update(dt);
      // no walk clip: a small bounce and sway so moving characters do not glide
      if(!walk){w+=((walking?1:0)-w)*Math.min(1,dt*8);holder.position.y=Math.abs(Math.sin(t*.011))*.05*w;holder.rotation.z=Math.sin(t*.011)*.05*w}
    };
    return name;
  }
  return null;
}
