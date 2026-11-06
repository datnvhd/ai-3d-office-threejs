// Vite dev-server plugin: connects the office to OpenAI Codex CLI (ChatGPT sign-in).
// `codex login` opens the ChatGPT sign-in page and stores credentials in Codex's own home (~/.codex);
// this server never reads or forwards them. Tasks run with `codex exec --json` (see codexExec below).
import {spawn,execFile} from 'node:child_process';
import {existsSync,readdirSync,realpathSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {killTree,reapGroup,NODE_ENV} from './claude-bridge.js';
import {isRemoteReq} from './remote-access.js';
import {cliGen} from './ai-updates.js';
import {toolBin} from './ai-tools.js';

const isWin=process.platform==='win32';
const LOGIN_TIMEOUT=10*60*1000;
const URL_RE=/https:\/\/auth\.openai\.com\/\S+/;
const stripAnsi=s=>s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'');

// An npm install's codex.js only finds the native codex.exe of its platform package and spawns it with two env vars.
// The desktop app runs .js files with Electron, which has no console: a console program it spawns without windowsHide
// (as codex.js does) gets its own visible cmd window. So the app starts that codex.exe itself, hidden, with the same env.
const TRIPLES={'win32 x64':'x86_64-pc-windows-msvc','win32 arm64':'aarch64-pc-windows-msvc','darwin x64':'x86_64-apple-darwin','darwin arm64':'aarch64-apple-darwin','linux x64':'x86_64-unknown-linux-musl','linux arm64':'aarch64-unknown-linux-musl'};
const nativeRoot=new Map();// native binary → its @openai/codex package folder
function nativeOf(js){
  const triple=TRIPLES[`${process.platform} ${process.arch}`];if(!triple)return null;
  let root;try{root=realpathSync(join(dirname(js),'..'))}catch{return null}
  const pkg=`codex-${process.platform}-${process.arch}`,exe=isWin?'codex.exe':'codex';
  const p=[join(root,'node_modules','@openai',pkg),join(dirname(root),pkg),root].map(d=>join(d,'vendor',triple,'bin',exe)).find(existsSync);
  if(p)nativeRoot.set(p,root);
  return p||null;
}
export function findCodexBinary(){const b=findCodexEntry();return b?.endsWith('.js')?nativeOf(b)||b:b}
// Native binary first; an npm .cmd shim is resolved to its codex.js (run with node),
// since Node cannot spawn .cmd files without a shell
function findCodexEntry(){
  if(process.env.CODEX_BIN&&existsSync(process.env.CODEX_BIN))return process.env.CODEX_BIN;
  const dirs=(process.env.PATH||'').split(isWin?';':':').filter(Boolean);
  for(const n of isWin?['codex.exe','codex.cmd']:['codex'])for(const dir of dirs){
    const p=join(dir,n);if(!existsSync(p))continue;
    // NVM for Windows: <nvm>\.nodejs\codex.exe is its proxy.exe, which runs codex.cmd through cmd. cmd mangles
    // arguments that contain quotes (e.g. -c key="value") when the path has spaces, so use the version's codex.js
    if(n==='codex.exe'&&existsSync(join(dir,'..','proxy.exe'))){
      const inst=join(dir,'..','installs'),vers=existsSync(inst)?[process.version,...readdirSync(inst).sort().reverse()]:[];
      const js=vers.map(v=>join(inst,v,'node_modules','@openai','codex','bin','codex.js')).find(existsSync);
      if(js)return js;
    }
    if(!n.endsWith('.cmd'))return p;
    const js=join(dirname(p),'node_modules','@openai','codex','bin','codex.js');if(existsSync(js))return js;
  }
  const local=join(homedir(),'.local','bin',isWin?'codex.exe':'codex');
  if(existsSync(local))return local;
  // the copy the app installed itself (server/ai-tools.js) when the machine had none
  const own=toolBin('codex');if(own)return own;
  // Binary bundled with the ChatGPT/Codex VS Code / Cursor extension, newest version first
  const exe=isWin?'codex.exe':'codex',found=[];
  for(const root of ['.vscode','.vscode-insiders','.cursor'].map(d=>join(homedir(),d,'extensions'))){
    if(!existsSync(root))continue;
    for(const d of readdirSync(root)){
      const m=d.match(/^openai\.chatgpt-(\d+\.\d+\.\d+)/);if(!m)continue;
      const binDir=join(root,d,'bin');if(!existsSync(binDir))continue;
      for(const plat of readdirSync(binDir)){const p=join(binDir,plat,exe);if(existsSync(p))found.push({v:m[1],bin:p})}
    }
  }
  found.sort((a,b)=>versionKey(b.v).localeCompare(versionKey(a.v)));
  return found[0]?.bin||null;
}
const versionKey=v=>v.split(/[.-]/).map(n=>n.padStart(6,'0')).join('.');
// [command, args] for spawning the binary
const cmd=(bin,args)=>bin.endsWith('.js')?[process.execPath,[bin,...args]]:[bin,args];
// a native binary from an npm install gets the env codex.js would give it (Codex uses it to say how to update)
const envFor=bin=>bin.endsWith('.js')?{...process.env,...NODE_ENV}:nativeRoot.has(bin)?{...process.env,CODEX_MANAGED_PACKAGE_ROOT:nativeRoot.get(bin),CODEX_MANAGED_BY_NPM:'1'}:process.env;

export function codexRun(bin,args,timeout=30000){
  return new Promise(resolve=>{
    const [c,a]=cmd(bin,args);
    const child=execFile(c,a,{timeout,cwd:tmpdir(),env:envFor(bin),windowsHide:true,maxBuffer:4<<20},(err,stdout,stderr)=>resolve({err,stdout:String(stdout),stderr:String(stderr)}));
    child.stdin?.end();
  });
}

// 'chatgpt' | 'apikey' | null, from `codex login status` (it may print to stderr)
export async function codexAuth(bin){
  const {stdout,stderr}=await codexRun(bin,['login','status']);
  const out=stdout+stderr;
  if(/not logged in/i.test(out))return null;
  if(/chatgpt/i.test(out))return 'chatgpt';
  if(/api key/i.test(out))return 'apikey';
  return null;
}

// Runs `codex exec --json` with the prompt on stdin and streams JSONL events.
// The done promise resolves with {code,message,usage,error,stderr,timedOut}.
// With `resume` (a thread id) it continues that conversation; `exec resume` has no -s/-C, so the sandbox goes in as config
// (unquoted: the nvm codex.exe shim goes through cmd, which breaks on quotes; Codex reads a non-TOML value as a plain string).
export function codexExec(bin,{cwd,input,sandbox='read-only',extra=[],onEvent,timeout,resume}){
  // On Windows the default workspace-write sandbox still blocks every write; Codex's Windows sandbox lets it write in the workspace
  const win=process.platform==='win32'&&sandbox==='workspace-write'?['--enable','experimental_windows_sandbox']:[];
  // no update check: the app updates Codex itself (server/ai-updates.js)
  const noUpd=['-c','check_for_update_on_startup=false'];
  const args=resume?['exec','resume','--json','--skip-git-repo-check',...noUpd,'-c',`sandbox_mode=${sandbox}`,...win,...extra,resume,'-']:['exec','--json','--skip-git-repo-check',...noUpd,'-s',sandbox,...win,'-C',cwd,...extra,'-'];
  const child=spawn(...cmd(bin,args),{cwd,env:envFor(bin),windowsHide:true,detached:!isWin});// own process group: see killTree
  const done=new Promise(res=>{
    let buf='',stderr='',message=null,usage=null,error=null,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;killTree(child)},timeout);
    child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let ev;try{ev=JSON.parse(line)}catch{continue}
      if(ev.type==='item.completed'&&ev.item?.type==='agent_message')message=ev.item.text;
      if(ev.type==='turn.completed')usage=ev.usage||null;
      if(ev.type==='turn.failed')error=ev.error?.message||'Codex báo lỗi.';
      if(ev.type==='error')error=ev.message||'Codex báo lỗi.';
      onEvent?.(ev)}});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000)});
    child.on('error',e=>{stderr+=e.message});
    child.on('close',code=>{clearTimeout(timer);reapGroup(child);res({code,message,usage,error,stderr:stripAnsi(stderr).trim(),timedOut})});
  });
  child.stdin.on('error',()=>{});child.stdin.end(input);
  return {child,done};
}

export function codexBridge(){
  let bin=null,binChecked=false,version=null,gen=-1;
  let login={state:'idle'};// idle | starting | waiting | success | error
  let proc=null,timer=null,lastTest=null;

  async function ensureBin(){
    if(!binChecked||gen!==cliGen()){gen=cliGen();bin=findCodexBinary();binChecked=true;version=bin?(await codexRun(bin,['--version'])).stdout.trim()||null:null}
    return bin;
  }
  function stopLogin(){clearTimeout(timer);killTree(proc);proc=null}

  async function startLogin(){
    if(proc)return;
    if(!await ensureBin()){login={state:'error',message:'Không tìm thấy Codex CLI trên máy.'};return}
    login={state:'starting'};let out='';
    proc=spawn(...cmd(bin,['login']),{cwd:tmpdir(),env:envFor(bin),windowsHide:true});
    const onData=d=>{
      out=(out+d).slice(-20000);const url=stripAnsi(out).match(URL_RE);
      if(url&&login.state==='starting')login={state:'waiting',url:url[0]};
    };
    proc.stdout.on('data',onData);proc.stderr.on('data',onData);
    proc.on('error',e=>{login={state:'error',message:e.message}});
    proc.on('close',async code=>{
      proc=null;clearTimeout(timer);
      if(login.state!=='starting'&&login.state!=='waiting')return;
      const a=await codexAuth(bin);
      login=a?{state:'success'}:{state:'error',message:code===0?'Đăng nhập chưa hoàn tất.':(stripAnsi(out).trim().split('\n').pop()||'Tiến trình đăng nhập đã kết thúc.')};
    });
    timer=setTimeout(()=>{if(proc){stopLogin();login={state:'error',message:'Hết thời gian chờ đăng nhập (10 phút).'}}},LOGIN_TIMEOUT);
  }

  async function test(){
    const s=Date.now(),{done}=codexExec(bin,{cwd:tmpdir(),input:'Reply with exactly: OK',extra:['--ephemeral'],timeout:120000});
    const r=await done,ok=!!r.message&&!r.error;
    lastTest={ok,at:new Date().toISOString(),ms:Date.now()-s,detail:ok?r.message.slice(0,60):(r.error||r.stderr.split('\n').pop()||'Codex không phản hồi.')};
    return lastTest;
  }

  async function status(){
    await ensureBin();
    const auth=bin?await codexAuth(bin):null;
    return {connected:!!auth,auth,cli:{found:!!bin,version,path:bin},lastTest,login:{state:login.state,url:login.url||null,message:login.message||null}};
  }

  const json=(res,code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';

  const plugin={
    name:'codex-bridge',
    configureServer(server){
      server.middlewares.use('/api/codex',async(req,res)=>{
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        // remote viewers (server/remote-access.js) may only read the status: signing in stays on this machine
        if(isRemoteReq(req)&&!(req.method==='GET'&&(req.url||'').split('?')[0]==='/status'))return json(res,403,{error:'Đăng nhập chỉ làm được trên chính máy chạy app.'});
        const path=(req.url||'/').split('?')[0];
        try{
          if(req.method==='GET'&&path==='/status')return json(res,200,await status());
          if(req.method==='POST'&&path==='/login'){await startLogin();return json(res,200,await status())}
          if(req.method==='POST'&&path==='/login/cancel'){stopLogin();login={state:'idle'};return json(res,200,await status())}
          if(req.method==='POST'&&path==='/verify'){
            if(!await ensureBin())return json(res,500,{error:'Không tìm thấy Codex CLI.'});
            await test();return json(res,200,await status());
          }
          if(req.method==='POST'&&path==='/logout'){if(await ensureBin())await codexRun(bin,['logout']);login={state:'idle'};lastTest=null;return json(res,200,await status())}
          json(res,404,{error:'Not found'});
        }catch(e){json(res,500,{error:String(e?.message||e)})}
      });
      server.httpServer?.once('close',stopLogin);
    }
  };
  // Same middleware on the preview server: the desktop app (electron/main.js) serves the build with vite preview
  return {...plugin,configurePreviewServer:plugin.configureServer};
}
