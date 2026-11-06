// Vite dev-server plugin: checks the Claude Code connection, runs `claude setup-token`
// (browser OAuth) in a pseudo-terminal, captures the long-lived token and stores it
// outside the project. The token never leaves this Node process.
import {execFile,spawn} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import pty from '@lydell/node-pty';
import {isRemoteReq} from './remote-access.js';

export const STORE_DIR=join(homedir(),'.ai-3d-office');
const STORE_FILE=join(STORE_DIR,'claude-auth.json');
const TOKEN_RE=/sk-ant-oat01-[A-Za-z0-9_-]{20,}/;
const URL_RE=/https:\/\/claude\.(?:com|ai)\/\S*oauth\/authorize\?\S+/;
const LOGIN_TIMEOUT=10*60*1000;
const isWin=process.platform==='win32';

const stripAnsi=s=>s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'');
const mask=t=>t?`${t.slice(0,13)}…${t.slice(-4)}`:null;

// Child env without this process's own Claude Code session or API-key overrides
export function cleanEnv(extra={}){
  const env={...process.env};
  for(const k of Object.keys(env))if(k==='CLAUDECODE'||k.startsWith('CLAUDE_CODE_')||k==='ANTHROPIC_API_KEY'||k==='ANTHROPIC_AUTH_TOKEN')delete env[k];
  return {...env,...extra};
}

// Extra env for running a .js file with process.execPath: in the desktop app that is Electron, which acts as Node only with this
export const NODE_ENV=process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{};

export function run(bin,args,{env=cleanEnv(),timeout=30000}={}){
  return new Promise(resolve=>{
    const child=execFile(bin,args,{env,timeout,cwd:tmpdir(),windowsHide:true,maxBuffer:4<<20},(err,stdout,stderr)=>resolve({err,stdout:String(stdout),stderr:String(stderr)}));
    child.stdin?.end();
  });
}

const versionKey=v=>v.split(/[.-]/).map(n=>n.padStart(6,'0')).join('.');
export function findClaudeBinary(){
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

// Chrome/Edge for the sign-in page; started with a throw-away profile so no claude.ai session is reused
function findBrowser(){
  const list=isWin
    ?[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(d=>[join(d,'Google','Chrome','Application','chrome.exe'),join(d,'Microsoft','Edge','Application','msedge.exe')])
    :['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge','/usr/bin/microsoft-edge-stable','/snap/bin/chromium'];
  return list.find(p=>existsSync(p))||null;
}
// `claude setup-token` opens $BROWSER with the sign-in URL: point it at a no-op so the default browser stays closed
function noopBrowser(){
  if(!isWin)return 'true';
  const f=join(STORE_DIR,'noop-browser.cmd');
  if(!existsSync(f)){mkdirSync(STORE_DIR,{recursive:true});writeFileSync(f,'@exit /b 0\r\n')}
  return f;
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

// After a task run ends on macOS/Linux: stop what it left running in its process group (a dev server started in the
// background, a simulator log stream…). Windows has no groups; there taskkill /T on stop is what cleans up.
export function reapGroup(p){
  if(isWin||!p?.pid)return;
  try{process.kill(-p.pid,'SIGTERM')}catch{}
}
export function killTree(p){
  if(!p)return;
  if(isWin)execFile('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true},()=>{});
  else{
    // Task runs are started in their own process group (detached), so a negative pid also stops what they started
    // (Metro, a simulator build, Playwright's Chrome); anything else is a plain child. SIGKILL if still there after 5s.
    const sig=s=>{try{process.kill(-p.pid,s)}catch{try{p.kill(s)}catch{}}};
    sig('SIGTERM');setTimeout(()=>{if(p.exitCode==null&&p.signalCode==null)sig('SIGKILL')},5000).unref?.();
  }
}

export function claudeBridge(){
  let bin=null,binChecked=false,version=null;
  let login={state:'idle'};// idle | starting | waiting | verifying | success | error
  let proc=null,buffer='',timer=null,browser=null,profile=null;

  async function ensureBin(){
    if(!binChecked){bin=findClaudeBinary();binChecked=true;if(bin)version=(await run(bin,['--version'])).stdout.trim()||null}
    return bin;
  }

  // A new browser window with an empty profile: the user signs in to whichever account they want
  function openFreshBrowser(url){
    closeBrowser();
    const exe=findBrowser();if(!exe)return false;
    profile=join(tmpdir(),`ai-office-claude-login-${Date.now()}`);
    browser=spawn(exe,[`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--new-window',url],{stdio:'ignore'});
    browser.on('error',()=>{});browser.on('exit',()=>{browser=null});
    return true;
  }
  function closeBrowser(){
    killTree(browser);browser=null;
    const dir=profile;profile=null;
    if(dir)setTimeout(()=>{try{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:500})}catch{}},2000);
  }

  function stopLogin(){clearTimeout(timer);killTree(proc);proc=null;closeBrowser()}

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
    proc=pty.spawn(bin,['setup-token'],{name:'xterm-256color',cols:1000,rows:60,cwd:tmpdir(),env:cleanEnv({BROWSER:noopBrowser()})});
    proc.onData(d=>{
      buffer=(buffer+d).slice(-40000);
      const text=stripAnsi(buffer);
      const token=text.match(TOKEN_RE);
      if(token&&proc){finishWithToken(token[0]);return}
      const url=text.match(URL_RE);
      if(url&&login.state==='starting')login={state:'waiting',url:url[0],fresh:openFreshBrowser(url[0])};
      const err=text.slice(-2000).match(/(?:OAuth error[^\n]*|Failed to exchange[^\n]*|Invalid code[^\n]*|account[^\n]*on hold[^\n]*)/i);
      if(err&&login.state==='waiting')login={...login,message:err[0].trim()};
    });
    proc.onExit(()=>{proc=null;clearTimeout(timer);if(login.state==='starting'||login.state==='waiting')login={state:'error',message:login.message||'Tiến trình đăng nhập đã kết thúc mà chưa nhận được token.'}});
    timer=setTimeout(()=>{if(proc){stopLogin();login={state:'error',message:'Hết thời gian chờ đăng nhập (10 phút).'}}},LOGIN_TIMEOUT);
  }

  async function status(){
    await ensureBin();
    const store=loadStore();
    const expired=store?.expiresAt&&Date.parse(store.expiresAt)<Date.now();
    // Only the token signed in through this app counts: the CLI's own (default) account is never used
    return {
      connected:!!(store?.token&&store.verifiedAt&&!store.lastError&&!expired),
      cli:{found:!!bin,version,path:bin},
      token:store?.token?{masked:mask(store.token),createdAt:store.createdAt,expiresAt:store.expiresAt,verifiedAt:store.verifiedAt,lastError:store.lastError,expired:!!expired,file:STORE_FILE}:null,
      login:{state:login.state,url:login.url||null,fresh:!!login.fresh,message:login.message||null}
    };
  }

  const json=(res,code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
  const readBody=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>1e4)req.destroy()});req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';

  const plugin={
    name:'claude-bridge',
    configureServer(server){
      server.middlewares.use('/api/claude',async(req,res)=>{
        // The dev server listens on 0.0.0.0: only this machine may touch credentials
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        // remote viewers (server/remote-access.js) may only read the status: signing in stays on this machine
        if(isRemoteReq(req)&&!(req.method==='GET'&&(req.url||'').split('?')[0]==='/status'))return json(res,403,{error:'Đăng nhập chỉ làm được trên chính máy chạy app.'});
        const path=(req.url||'/').split('?')[0];
        try{
          if(req.method==='GET'&&path==='/status')return json(res,200,await status());
          if(req.method==='POST'&&path==='/login'){await startLogin();return json(res,200,await status())}
          if(req.method==='POST'&&path==='/login/code'){
            const {code}=await readBody(req);
            if(!proc||login.state!=='waiting')return json(res,409,{error:'Không có phiên đăng nhập đang chờ mã.'});
            if(typeof code!=='string'||!/^[\w#.\-]{10,600}$/.test(code.trim()))return json(res,400,{error:'Mã xác thực không đúng định dạng.'});
            // Code and Enter in one write are taken as a paste and never submitted: send Enter separately
            const p=proc;login={...login,message:null};p.write(code.trim());setTimeout(()=>{if(proc===p)p.write('\r')},500);
            return json(res,200,{ok:true});
          }
          if(req.method==='POST'&&path==='/login/cancel'){stopLogin();login={state:'idle'};return json(res,200,await status())}
          if(req.method==='POST'&&path==='/login/open'){
            if(!proc||login.state!=='waiting')return json(res,409,{error:'Không có phiên đăng nhập đang chờ.'});
            login={...login,fresh:openFreshBrowser(login.url)};return json(res,200,await status());
          }
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
  // Same middleware on the preview server: the desktop app (electron/main.js) serves the build with vite preview
  return {...plugin,configurePreviewServer:plugin.configureServer};
}

// Used by the task runner (machine-bridge.js): the saved token is passed as CLAUDE_CODE_OAUTH_TOKEN to `claude -p`
export function getSavedClaudeToken(){const s=loadStore();return s?.token&&!s.lastError?s.token:null}
