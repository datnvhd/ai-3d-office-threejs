// Installs what the office needs when the machine does not have it: Claude Code, Codex CLI and Node.js.
// Each one is the official ready-to-run build (the npm registry's per-platform package of Claude Code / Codex, the
// nodejs.org archive of Node.js LTS), downloaded into ~/.ai-3d-office/tools/<tool>/<version>, checked against its
// published hash and unpacked with the system's tar. No npm, no admin rights, no console window. The bridges look
// here after the user's own installs (PATH, ~/.local/bin), so a machine that already has a tool keeps using its own.
import {createHash} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,rmSync,readFileSync,writeFileSync,readdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const TOOLS_DIR=join(homedir(),'.ai-3d-office','tools');
const isWin=process.platform==='win32',EXE=isWin?'.exe':'';
// Bumped whenever a CLI was installed or updated: every bridge then finds its binary again (see ensureBin)
let gen=0;
export const cliGen=()=>gen;
export const bumpCli=()=>{gen++};
export const TOOL_NAMES={node:'Node.js',claude:'Claude Code',codex:'Codex CLI'};

const TRIPLE={'win32 x64':'x86_64-pc-windows-msvc','win32 arm64':'aarch64-pc-windows-msvc','darwin x64':'x86_64-apple-darwin','darwin arm64':'aarch64-apple-darwin','linux x64':'x86_64-unknown-linux-musl','linux arm64':'aarch64-unknown-linux-musl'}[`${process.platform} ${process.arch}`];
const PLAT=`${process.platform}-${process.arch}`;// win32-x64, darwin-arm64, linux-x64…
const NODE_PLAT={win32:'win',darwin:'darwin',linux:'linux'}[process.platform];

// The installed tool: {version, bin} with bin absolute, or null
function current(name){
  try{const c=JSON.parse(readFileSync(join(TOOLS_DIR,name,'current.json'),'utf8'));const bin=join(TOOLS_DIR,name,c.version,c.bin);return existsSync(bin)?{version:c.version,bin}:null}catch{return null}
}
export const toolBin=name=>current(name)?.bin||null;
export const isToolPath=p=>!!p&&p.toLowerCase().startsWith(TOOLS_DIR.toLowerCase());

// Is a program on PATH (node, npm…)?
export function onPath(name){
  for(const dir of (process.env.PATH||'').split(isWin?';':':').filter(Boolean))
    for(const n of isWin?[`${name}.exe`,`${name}.cmd`]:[name])if(existsSync(join(dir,n)))return join(dir,n);
  return null;
}
// The app's Node.js goes on PATH (for this process and every agent it starts) when the machine has none of its own
export function useToolNode(){
  const node=current('node');if(!node||onPath('node'))return false;
  const dir=join(node.bin,'..');process.env.PATH=`${dir}${isWin?';':':'}${process.env.PATH||''}`;return true;
}

const getJson=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status} · ${url}`);return r.json()};
const getText=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status} · ${url}`);return r.text()};

// What to download for the newest version: {version, url, check:{algo, digest(base64|hex)}, bin: path inside the unpacked folder}
async function release(name){
  if(!TRIPLE||!NODE_PLAT)throw new Error(`Chưa hỗ trợ cài tự động trên ${process.platform} ${process.arch}`);
  if(name==='claude'){
    const v=(await getJson('https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest')).version;
    const m=await getJson(`https://registry.npmjs.org/@anthropic-ai%2fclaude-code-${PLAT}/${v}`);
    return {version:v,url:m.dist.tarball,check:sri(m.dist.integrity),bin:join('package',`claude${EXE}`)};
  }
  if(name==='codex'){
    const v=(await getJson('https://registry.npmjs.org/@openai%2fcodex/latest')).version;
    const m=await getJson(`https://registry.npmjs.org/@openai%2fcodex/${v}-${PLAT}`);
    return {version:v,url:m.dist.tarball,check:sri(m.dist.integrity),bin:join('package','vendor',TRIPLE,'bin',`codex${EXE}`)};
  }
  if(name==='node'){
    const lts=(await getJson('https://nodejs.org/dist/index.json')).find(x=>x.lts);
    const base=`node-${lts.version}-${NODE_PLAT}-${process.arch}`,file=`${base}${isWin?'.zip':'.tar.gz'}`;
    const sums=await getText(`https://nodejs.org/dist/${lts.version}/SHASUMS256.txt`);
    const hex=sums.split('\n').map(l=>l.trim().split(/\s+/)).find(([,f])=>f===file)?.[0];
    if(!hex)throw new Error(`Không thấy mã kiểm tra cho ${file}`);
    return {version:lts.version.replace(/^v/,''),url:`https://nodejs.org/dist/${lts.version}/${file}`,check:{algo:'sha256',hex},bin:isWin?join(base,'node.exe'):join(base,'bin','node')};
  }
  throw new Error('Công cụ không hợp lệ');
}
// npm "sha512-<base64>" integrity → {algo, b64}
function sri(s){const m=String(s||'').match(/^(sha512|sha256|sha1)-(.+)$/);if(!m)throw new Error('Gói không có mã kiểm tra');return {algo:m[1],b64:m[2]}}

async function download(url,file,check,onProgress){
  const r=await fetch(url,{signal:AbortSignal.timeout(30*60*1000)});
  if(!r.ok||!r.body)throw new Error(`Tải không được (HTTP ${r.status})`);
  const total=Number(r.headers.get('content-length'))||0,hash=createHash(check.algo);let got=0,last=0;
  const body=Readable.fromWeb(r.body);
  body.on('data',c=>{hash.update(c);got+=c.length;const p=total?Math.floor(got*100/total):0;if(p!==last){last=p;onProgress?.(p)}});
  await pipeline(body,createWriteStream(file));
  const digest=hash.digest(check.hex?'hex':'base64');
  if(digest!==(check.hex||check.b64))throw new Error('File tải về không khớp mã kiểm tra, đã bỏ');
}
// tar from the OS (Windows 10+ ships bsdtar, which also reads .zip)
function untar(file,dest){
  return new Promise((res,rej)=>{
    const tar=isWin?join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'):'tar';
    const c=spawn(tar,['-xf',file,'-C',dest],{windowsHide:true,stdio:['ignore','ignore','pipe']});let err='';
    c.stderr.on('data',d=>{err=(err+d).slice(-2000)});
    c.on('error',rej);c.on('close',code=>code===0?res():rej(new Error(`Giải nén lỗi: ${err.trim()||code}`)));
  });
}

// Downloads, checks and unpacks the newest version; older versions are removed when no longer in use.
// onProgress(phase, percent). Returns {version, bin}.
export async function installTool(name,onProgress=()=>{}){
  onProgress('Đang tìm bản mới nhất',0);
  const rel=await release(name),root=join(TOOLS_DIR,name),dest=join(root,rel.version),tmp=join(root,`.download-${process.pid}${rel.url.endsWith('.zip')?'.zip':'.tgz'}`);
  mkdirSync(root,{recursive:true});
  if(!existsSync(join(dest,rel.bin))){
    try{
      await download(rel.url,tmp,rel.check,p=>onProgress('Đang tải',p));
      onProgress('Đang giải nén',100);
      rmSync(dest,{recursive:true,force:true});mkdirSync(dest,{recursive:true});
      await untar(tmp,dest);
    }catch(e){rmSync(dest,{recursive:true,force:true});throw e}
    finally{rmSync(tmp,{force:true})}
  }
  const bin=join(dest,rel.bin);if(!existsSync(bin))throw new Error('Gói tải về không có file chạy như mong đợi');
  if(!isWin)try{chmodSync(bin,0o755)}catch{}
  writeFileSync(join(root,'current.json'),JSON.stringify({version:rel.version,bin:rel.bin}));
  // a version still running (Windows locks its files) stays until a later install
  for(const d of readdirSync(root))if(d!==rel.version&&!d.startsWith('.')&&d!=='current.json')try{rmSync(join(root,d),{recursive:true,force:true})}catch{}
  if(name==='node')useToolNode();
  gen++;
  return {version:rel.version,bin};
}
