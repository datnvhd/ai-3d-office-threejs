// Vite dev-server plugin: checks the Claude Code connection, runs `claude setup-token`
// (browser OAuth) in a pseudo-terminal, captures the long-lived token and stores it
// outside the project. The token never leaves this Node process.
import {execFile} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import pty from '@lydell/node-pty';

const STORE_DIR=join(homedir(),'.ai-3d-office');
const STORE_FILE=join(STORE_DIR,'claude-auth.json');
const TOKEN_RE=/sk-ant-oat01-[A-Za-z0-9_-]{20,}/;
const URL_RE=/https:\/\/claude\.(?:com|ai)\/\S*oauth\/authorize\?\S+/;
const LOGIN_TIMEOUT=10*60*1000;
const isWin=process.platform==='win32';

const stripAnsi=s=>s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'');
const mask=t=>t?`${t.slice(0,13)}…${t.slice(-4)}`:null;

// Child env without this process's own Claude Code session or API-key overrides
function cleanEnv(extra={}){
  const env={...process.env};
  for(const k of Object.keys(env))if(k==='CLAUDECODE'||k.startsWith('CLAUDE_CODE_')||k==='ANTHROPIC_API_KEY'||k==='ANTHROPIC_AUTH_TOKEN')delete env[k];
  return {...env,...extra};
}

function run(bin,args,{env=cleanEnv(),timeout=30000}={}){
  return new Promise(resolve=>{
    const child=execFile(bin,args,{env,timeout,cwd:tmpdir(),windowsHide:true,maxBuffer:4<<20},(err,stdout,stderr)=>resolve({err,stdout:String(stdout),stderr:String(stderr)}));
    child.stdin?.end();
  });
}

const versionKey=v=>v.split(/[.-]/).map(n=>n.padStart(6,'0')).join('.');
function findClaudeBinary(){
  if(process.env.CLAUDE_BIN&&existsSync(process.env.CLAUDE_BIN))return process.env.CLAUDE_BIN;
  const exe=isWin?'claude.exe':'claude';
  for(const dir of (process.env.PATH||'').split(isWin?';':':')){
    for(const name of isWin?['claude.exe','claude.cmd']:['claude'])if(dir&&existsSync(join(dir,name)))return join(dir,name);
  }
  const local=join(homedir(),'.local','bin',exe);
  if(existsSync(local))return local;
  // Native binary bundled with the VS Code / Cursor extension, newest version first
  const found=[];
  for(const root of ['.vscode','.vscode-insiders','.cursor'].map(d=>join(homedir(),d,'extensions'))){
    if(!existsSync(root))continue;
    for(const d of readdirSync(root)){
      const m=d.match(/^anthropic\.claude-code-(\d+\.\d+\.\d+)/);const bin=join(root,d,'resources','native-binary',exe);
      if(m&&existsSync(bin))found.push({v:m[1],bin});
    }
  }
  found.sort((a,b)=>versionKey(b.v).localeCompare(versionKey(a.v)));
  return found[0]?.bin||null;
}

function loadStore(){try{return JSON.parse(readFileSync(STORE_FILE,'utf8'))}catch{return null}}
function saveStore(data){mkdirSync(STORE_DIR,{recursive:true});writeFileSync(STORE_FILE,JSON.stringify(data,null,2),{mode:0o600})}

// Sends one tiny prompt with the token: the only reliable check, since `auth status` does not validate it
async function verifyToken(bin,token){
  const {err,stdout}=await run(bin,['-p','Reply with exactly: OK','--max-turns','1','--output-format','json','--tools',''],{env:cleanEnv({CLAUDE_CODE_OAUTH_TOKEN:token}),timeout:90000});
  try{
    const r=JSON.parse(stdout.trim().split('\n').pop());
    if(!r.is_error)return {ok:true};
    return {ok:false,error:r.api_error_status===401?'Token không hợp lệ hoặc đã bị thu hồi (401).':(r.result||'Claude Code trả về lỗi.')};
  }catch{return {ok:false,error:err?.killed?'Hết thời gian chờ Claude Code phản hồi.':'Không đọc được phản hồi từ Claude Code.'}}
}

function killTree(p){
  if(!p)return;
  if(isWin)execFile('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true},()=>{});
  else try{p.kill()}catch{}
}

export function claudeBridge(){
  let bin=null,binChecked=false,version=null;
  let login={state:'idle'};// idle | starting | waiting | verifying | success | error
  let proc=null,buffer='',timer=null;

  async function ensureBin(){
    if(!binChecked){bin=findClaudeBinary();binChecked=true;if(bin)version=(await run(bin,['--version'])).stdout.trim()||null}
    return bin;
  }

  function stopLogin(){clearTimeout(timer);killTree(proc);proc=null}

  async function finishWithToken(token){
    stopLogin();
    login={state:'verifying'};
    const v=await verifyToken(bin,token);
    if(!v.ok){login={state:'error',message:`Đã nhận token nhưng kiểm tra thất bại: ${v.error}`};return}
    const now=new Date();
    saveStore({token,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+365*864e5).toISOString(),verifiedAt:now.toISOString(),lastError:null});
    login={state:'success'};
  }

  async function startLogin(){
    if(proc)return;
    if(!await ensureBin()){login={state:'error',message:'Không tìm thấy Claude Code CLI trên máy.'};return}
    buffer='';login={state:'starting'};
    proc=pty.spawn(bin,['setup-token'],{name:'xterm-256color',cols:1000,rows:60,cwd:tmpdir(),env:cleanEnv()});
    proc.onData(d=>{
      buffer=(buffer+d).slice(-40000);
      const text=stripAnsi(buffer);
      const token=text.match(TOKEN_RE);
      if(token&&proc){finishWithToken(token[0]);return}
      const url=text.match(URL_RE);
      if(url&&login.state==='starting')login={state:'waiting',url:url[0]};
      const err=text.match(/(?:OAuth error|Failed to exchange[^\n]*|Invalid code[^\n]*|account[^\n]*on hold[^\n]*)/i);
      if(err&&login.state==='waiting')login={...login,message:err[0].trim()};
    });
    proc.onExit(()=>{proc=null;clearTimeout(timer);if(login.state==='starting'||login.state==='waiting')login={state:'error',message:login.message||'Tiến trình đăng nhập đã kết thúc mà chưa nhận được token.'}});
    timer=setTimeout(()=>{if(proc){stopLogin();login={state:'error',message:'Hết thời gian chờ đăng nhập (10 phút).'}}},LOGIN_TIMEOUT);
  }

  async function status(){
    await ensureBin();
    const store=loadStore();
    let cliLogin=null;
    if(bin){
      const {stdout}=await run(bin,['auth','status','--json']);
      try{const s=JSON.parse(stdout);cliLogin={loggedIn:!!s.loggedIn,method:s.authMethod||null,email:s.email||null,plan:s.subscriptionType||null}}catch{}
    }
    const expired=store?.expiresAt&&Date.parse(store.expiresAt)<Date.now();
    return {
      connected:!!(store?.token&&store.verifiedAt&&!store.lastError&&!expired),
      cli:{found:!!bin,version,path:bin},
      cliLogin,
      token:store?.token?{masked:mask(store.token),createdAt:store.createdAt,expiresAt:store.expiresAt,verifiedAt:store.verifiedAt,lastError:store.lastError,expired:!!expired,file:STORE_FILE}:null,
      login:{state:login.state,url:login.url||null,message:login.message||null}
    };
  }

  const json=(res,code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
  const readBody=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>1e4)req.destroy()});req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';

  return {
    name:'claude-bridge',
    configureServer(server){
      server.middlewares.use('/api/claude',async(req,res)=>{
        // The dev server listens on 0.0.0.0: only this machine may touch credentials
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        const path=(req.url||'/').split('?')[0];
        try{
          if(req.method==='GET'&&path==='/status')return json(res,200,await status());
          if(req.method==='POST'&&path==='/login'){await startLogin();return json(res,200,await status())}
          if(req.method==='POST'&&path==='/login/code'){
            const {code}=await readBody(req);
            if(!proc||login.state!=='waiting')return json(res,409,{error:'Không có phiên đăng nhập đang chờ mã.'});
            if(typeof code!=='string'||!/^[\w#.\-]{10,600}$/.test(code.trim()))return json(res,400,{error:'Mã xác thực không đúng định dạng.'});
            proc.write(code.trim()+'\r');return json(res,200,{ok:true});
          }
          if(req.method==='POST'&&path==='/login/cancel'){stopLogin();login={state:'idle'};return json(res,200,await status())}
          if(req.method==='POST'&&path==='/verify'){
            const store=loadStore();
            if(!store?.token)return json(res,404,{error:'Chưa có token đã lưu.'});
            if(!await ensureBin())return json(res,500,{error:'Không tìm thấy Claude Code CLI.'});
            const v=await verifyToken(bin,store.token);
            saveStore({...store,verifiedAt:v.ok?new Date().toISOString():store.verifiedAt,lastError:v.ok?null:v.error});
            return json(res,200,await status());
          }
          if(req.method==='DELETE'&&path==='/token'){rmSync(STORE_FILE,{force:true});login={state:'idle'};return json(res,200,await status())}
          json(res,404,{error:'Not found'});
        }catch(e){json(res,500,{error:String(e?.message||e)})}
      });
      server.httpServer?.once('close',stopLogin);
    }
  };
}

// For a future task runner: read the saved token server-side and pass it as CLAUDE_CODE_OAUTH_TOKEN to `claude -p`
export function getSavedClaudeToken(){return loadStore()?.token||null}
