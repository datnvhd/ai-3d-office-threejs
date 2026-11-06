// Before/after picture of a working folder, so the page can show what a task changed and undo it.
// Works the same for Git, SVN or no version control: file contents are kept in a content-addressed store
// (~/.ai-3d-office/snap/blobs), and a per-folder index (path -> size, mtime, hash) means only files that changed since
// the last picture are read again. Build/dependency folders are skipped; files over MAX_BLOB are tracked by size only.
import {createHash} from 'node:crypto';
import {readdir,stat,readFile,writeFile,mkdir,unlink,rm} from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';

const SKIP=new Set(['.git','.svn','.hg','node_modules','.vs','.idea','bin','obj','dist','build','out','target','coverage','.next','.nuxt',
  '.cache','__pycache__','.venv','venv','vendor','.angular','.turbo','.parcel-cache','.gradle','.terraform','.ai-office-files','$RECYCLE.BIN','System Volume Information',
  'Pods','DerivedData','.expo','.cxx','.maestro-output','.Trash']);
export const SNAP_SKIP=[...SKIP];
const MAX_BLOB=1024*1024,MAX_FILES=120000,MAX_NEW_BYTES=600*1024*1024,BATCH=48;

export function createSnapshots(storeDir){
  const base=join(storeDir,'snap'),blobs=join(base,'blobs');
  const indexes=new Map();// root -> Map(rel -> {s,m,h})
  const idxFile=root=>join(base,'idx-'+createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0,16)+'.json');
  const blobPath=h=>join(blobs,h.slice(0,2),h);
  function indexOf(root){
    if(!indexes.has(root)){let m=new Map();try{m=new Map(Object.entries(JSON.parse(readFileSync(idxFile(root),'utf8'))))}catch{}indexes.set(root,m)}
    return indexes.get(root);
  }
  const saveTimers=new Map();
  function saveIndex(root){
    clearTimeout(saveTimers.get(root));
    saveTimers.set(root,setTimeout(()=>{try{mkdirSync(base,{recursive:true});writeFileSync(idxFile(root),JSON.stringify(Object.fromEntries(indexOf(root))))}catch{}},1500));
  }
  async function putBlob(buf){
    const h=createHash('sha1').update(buf).digest('hex'),p=blobPath(h);
    if(!existsSync(p)){await mkdir(dirname(p),{recursive:true});try{await writeFile(p,buf,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}}
    return h;
  }

  // Every file under root (relative paths with '/'), skipping heavy folders
  async function walk(root){
    const out=[];let partial=false;
    async function dir(abs,rel){
      let ents;try{ents=await readdir(abs,{withFileTypes:true})}catch{return}
      for(const e of ents){
        if(out.length>=MAX_FILES){partial=true;return}
        const r=rel?rel+'/'+e.name:e.name;
        if(e.isDirectory()){if(!SKIP.has(e.name))await dir(join(abs,e.name),r)}
        else if(e.isFile())out.push(r);
      }
    }
    await dir(root,'');
    return {list:out,partial};
  }

  // Picture of root now: rel -> {s:size,m:mtime,h:hash|null}. Reads only files whose size/mtime changed since last time.
  async function scan(root,onProgress){
    root=resolve(root);
    const idx=indexOf(root),{list,partial}=await walk(root),files=new Map();let newBytes=0,read=0,capped=false;
    for(let i=0;i<list.length;i+=BATCH){
      await Promise.all(list.slice(i,i+BATCH).map(async rel=>{
        let st;try{st=await stat(join(root,...rel.split('/')))}catch{return}
        const s=st.size,m=Math.floor(st.mtimeMs),old=idx.get(rel);
        if(old&&old.s===s&&old.m===m){files.set(rel,old);return}
        let h=null;
        if(s<=MAX_BLOB&&newBytes+s<=MAX_NEW_BYTES){try{const buf=await readFile(join(root,...rel.split('/')));h=await putBlob(buf);newBytes+=s;read++}catch{}}
        else if(s<=MAX_BLOB)capped=true;
        const e={s,m,h};files.set(rel,e);if(h)idx.set(rel,e);
      }));
      if(onProgress&&i%(BATCH*40)===0)onProgress(i,list.length);
    }
    for(const rel of idx.keys())if(!files.has(rel))idx.delete(rel);
    if(read)saveIndex(root);
    return {root,files,partial:partial||capped,at:Date.now()};
  }

  // What changed between a picture and now: [{path,b:{h,s}|null,a:{h,s}|null}] (null = file did not exist)
  async function since(snap){
    const now=await scan(snap.root),out=[];
    const keys=new Set([...snap.files.keys(),...now.files.keys()]);
    for(const rel of keys){
      const b=snap.files.get(rel),a=now.files.get(rel);
      if(b&&a&&(b.s===a.s&&b.m===a.m||b.h&&b.h===a.h))continue;
      out.push({path:rel,b:b?{h:b.h,s:b.s}:null,a:a?{h:a.h,s:a.s}:null});
    }
    return out.sort((x,y)=>x.path.localeCompare(y.path));
  }

  // Folds a run's changes into the task's list: the first "before" is kept, the latest "after" wins,
  // and a file that ends up as it started drops out
  function merge(list=[],add=[]){
    const map=new Map(list.map(c=>[c.path,{...c}]));
    for(const c of add){
      const old=map.get(c.path),b=old?old.b:c.b,a=c.a;
      const same=!b&&!a||b&&a&&b.h&&b.h===a.h;
      if(same)map.delete(c.path);else map.set(c.path,{path:c.path,b,a});
    }
    return [...map.values()].sort((x,y)=>x.path.localeCompare(y.path));
  }

  const blob=async h=>h?readFile(blobPath(h)):null;
  const hashNow=async abs=>{try{const buf=await readFile(abs);return {h:createHash('sha1').update(buf).digest('hex'),s:buf.length}}catch{return null}};

  // Puts each changed file back as it was before the task. A file edited again since the task ended is left alone.
  async function undo(root,changes){
    const restored=[],skipped=[];
    for(const c of changes){
      const abs=join(root,...c.path.split('/')),cur=await hashNow(abs);
      const untouched=!c.a?!cur:cur&&(c.a.h?cur.h===c.a.h:cur.s===c.a.s);
      if(!untouched){skipped.push({path:c.path,why:'đã bị sửa tiếp sau khi việc kết thúc'});continue}
      if(c.b&&!c.b.h){skipped.push({path:c.path,why:'file quá lớn, không có bản lưu'});continue}
      try{
        if(!c.b)await unlink(abs);
        else{await mkdir(dirname(abs),{recursive:true});await writeFile(abs,await blob(c.b.h))}
        restored.push(c.path);
      }catch(e){skipped.push({path:c.path,why:e.message})}
    }
    return {restored,skipped};
  }

  // Unified line diff of every change, for the progress popup
  async function diff(changes,{context=3,maxLines=4000}={}){
    let budget=maxLines;const files=[];
    for(const c of changes){
      const f={path:c.path,status:!c.b?'added':!c.a?'deleted':'modified',add:0,del:0,hunks:[]};files.push(f);
      if(c.b&&!c.b.h||c.a&&!c.a.h){f.big=true;continue}
      let before,after;try{[before,after]=await Promise.all([blob(c.b?.h),blob(c.a?.h)])}catch{f.missing=true;continue}
      if([before,after].some(x=>x&&x.subarray(0,8000).includes(0))){f.binary=true;continue}
      const A=before?splitLines(before.toString('utf8')):[],B=after?splitLines(after.toString('utf8')):[];
      const ops=lineDiff(A,B);
      for(const o of ops){if(o[0]==='+')f.add++;else if(o[0]==='-')f.del++}
      if(budget<=0){f.truncated=true;continue}
      f.hunks=hunks(ops,context);
      const n=f.hunks.reduce((s,h)=>s+h.lines.length,0);
      if(n>budget){let left=budget;f.hunks=f.hunks.filter(h=>(left-=h.lines.length)>=0);f.truncated=true}
      budget-=n;
    }
    return files;
  }

  // Drops stored contents nothing refers to any more (folder indexes and the tasks' change lists)
  async function gc(keepHashes){
    const keep=new Set(keepHashes);
    try{for(const f of readdirSync(base))if(f.startsWith('idx-'))for(const e of Object.values(JSON.parse(readFileSync(join(base,f),'utf8'))))if(e.h)keep.add(e.h)}catch{}
    if(!existsSync(blobs))return 0;let n=0;
    for(const d of await readdir(blobs))for(const h of await readdir(join(blobs,d)).catch(()=>[]))if(!keep.has(h)){await rm(join(blobs,d,h),{force:true});n++}
    return n;
  }

  return {scan,since,merge,undo,diff,gc};
}

const splitLines=s=>{const l=s.replace(/\r\n/g,'\n').split('\n');if(l.at(-1)==='')l.pop();return l};

// Myers line diff -> [['=',a,b] | ['-',text] | ['+',text]]; very different large files fall back to delete-all/add-all
export function lineDiff(A,B){
  let s=0;while(s<A.length&&s<B.length&&A[s]===B[s])s++;
  let ea=A.length,eb=B.length;while(ea>s&&eb>s&&A[ea-1]===B[eb-1]){ea--;eb--}
  const a=A.slice(s,ea),b=B.slice(s,eb),N=a.length,M=b.length,MAX=Math.min(N+M,1500);
  const head=A.slice(0,s).map(x=>['=',x]),tail=A.slice(ea).map(x=>['=',x]);
  if(!N||!M)return [...head,...a.map(x=>['-',x]),...b.map(x=>['+',x]),...tail];
  const off=MAX+1,V=new Int32Array(2*MAX+3),trace=[];let found=false;
  for(let d=0;d<=MAX&&!found;d++){
    trace.push(V.slice());
    for(let k=-d;k<=d;k+=2){
      let x=k===-d||k!==d&&V[off+k-1]<V[off+k+1]?V[off+k+1]:V[off+k-1]+1,y=x-k;
      while(x<N&&y<M&&a[x]===b[y]){x++;y++}
      V[off+k]=x;if(x>=N&&y>=M){found=true;break}
    }
  }
  if(!found)return [...head,...a.map(x=>['-',x]),...b.map(x=>['+',x]),...tail];
  const mid=[];let x=N,y=M;
  for(let d=trace.length-1;d>0;d--){
    const v=trace[d],k=x-y,pk=k===-d||k!==d&&v[off+k-1]<v[off+k+1]?k+1:k-1,px=v[off+pk],py=px-pk;
    while(x>px&&y>py){mid.push(['=',a[--x]]);y--}
    if(x===px)mid.push(['+',b[--y]]);else mid.push(['-',a[--x]]);
  }
  while(x>0&&y>0){mid.push(['=',a[--x]]);y--}
  return [...head,...mid.reverse(),...tail];
}

// Groups diff ops into hunks with a few lines of context, numbered like diff -u
function hunks(ops,ctx){
  const oN=[],nN=[];let oa=1,ob=1;
  for(const o of ops){oN.push(oa);nN.push(ob);if(o[0]!=='+')oa++;if(o[0]!=='-')ob++}
  const ranges=[];
  ops.forEach((o,i)=>{if(o[0]==='=')return;const s=Math.max(0,i-ctx),e=Math.min(ops.length-1,i+ctx),last=ranges.at(-1);
    if(last&&s<=last[1]+1)last[1]=Math.max(last[1],e);else ranges.push([s,e])});
  return ranges.map(([s,e])=>({oldStart:oN[s],newStart:nN[s],lines:ops.slice(s,e+1)}));
}
