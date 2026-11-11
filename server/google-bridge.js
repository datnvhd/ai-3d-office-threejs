// Google Drive / Sheets / Docs access for tasks. A Google link in a request is downloaded before the task runs and
// handed to the agent like a dropped file (a Sheet becomes .xlsx, so every sheet is read by name).
// Files shared "anyone with the link" download without an account. Private files need a Google account signed in
// here with read-only Drive access (OAuth for a desktop app, loopback redirect + PKCE). The OAuth client (ID/secret)
// comes from the user's own Google Cloud project: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET or pasted in the app.
// The refresh token stays in ~/.ai-3d-office/google-auth.json and never reaches the browser or the AI.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {STORE_DIR} from './claude-bridge.js';
import {isRemoteReq} from './remote-access.js';

const AUTH_FILE=join(STORE_DIR,'google-auth.json');
const SCOPES='openid email https://www.googleapis.com/auth/drive.readonly';
const LOGIN_TIMEOUT=10*60*1000,MAX_LINKS=5;
export const GOOGLE_MAX_FILE=25*1024*1024;

const readAuth=()=>{try{return JSON.parse(readFileSync(AUTH_FILE,'utf8'))}catch{return {}}};
const writeAuth=a=>{mkdirSync(STORE_DIR,{recursive:true});writeFileSync(AUTH_FILE,JSON.stringify(a,null,2),{mode:0o600})};
const client=()=>{
  if(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)return {id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET,env:true};
  const c=readAuth().client;return c?.id&&c?.secret?c:null;
};
let access=null;// {token,exp} in memory only

// Error the page turns into "sign in to Google" (needLogin) or "this account cannot open the file"
export class GoogleAccessError extends Error{
  constructor(message,extra){super(message);this.status=409;this.extra={google:extra}}
}

async function accessToken(){
  if(access&&access.exp>Date.now()+60e3)return access.token;
  const a=readAuth(),c=client();if(!a.refreshToken||!c)return null;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:c.id,client_secret:c.secret,refresh_token:a.refreshToken,grant_type:'refresh_token'})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){if(d.error==='invalid_grant'){delete a.refreshToken;writeAuth(a)}return null}// revoked or expired: sign in again
  access={token:d.access_token,exp:Date.now()+(d.expires_in||3600)*1000};return access.token;
}

// ---------- reading links ----------
const LINK_RE=/https?:\/\/(?:docs|drive|sheets)\.google\.com\/[^\s<>()"'`\]]+/gi;
export const googleLinks=text=>[...new Set(String(text||'').match(LINK_RE)||[])].slice(0,MAX_LINKS);
function parseLink(url){
  if(/\/folders\//.test(url))return {url,folder:true};
  const m=url.match(/\/(spreadsheets|document|presentation|file|drawings)\/d\/(?:e\/)?([\w-]{20,})/),q=url.match(/[?&]id=([\w-]{20,})/);
  const id=m?.[2]||q?.[1];if(!id)return null;
  return {url,id,type:m?.[1]||'file',gid:url.match(/[#?&]gid=(\d+)/)?.[1]??null,published:/\/d\/e\//.test(url)};
}
// Google types are exported to the matching Office file
const EXPORT={
  'application/vnd.google-apps.spreadsheet':['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  'application/vnd.google-apps.document':['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  'application/vnd.google-apps.presentation':['pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  'application/vnd.google-apps.drawing':['pdf','application/pdf'],
};
const PUBLIC={spreadsheets:id=>`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,document:id=>`https://docs.google.com/document/d/${id}/export?format=docx`,
  presentation:id=>`https://docs.google.com/presentation/d/${id}/export/pptx`,drawings:id=>`https://docs.google.com/drawings/d/${id}/export/pdf`,
  file:id=>`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`};
const PUBLIC_EXT={spreadsheets:'xlsx',document:'docx',presentation:'pptx',drawings:'pdf'};

async function body(r){
  const len=+r.headers.get('content-length')||0;if(len>GOOGLE_MAX_FILE)throw new Error('Tệp trên Google lớn hơn 25MB.');
  const b=Buffer.from(await r.arrayBuffer());if(b.length>GOOGLE_MAX_FILE)throw new Error('Tệp trên Google lớn hơn 25MB.');return b;
}
const nameFromHeader=h=>{const m=String(h||'').match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);try{return m?decodeURIComponent(m[1]||m[2]):null}catch{return m?.[2]||null}};
const withExt=(name,ext)=>ext&&!name.toLowerCase().endsWith('.'+ext)?`${name}.${ext}`:name;

// Without an account: works only when the file is shared "anyone with the link"; null when Google asks to sign in
async function fetchPublic(L){
  const src=L.published?(L.type==='spreadsheets'?`https://docs.google.com/spreadsheets/d/e/${L.id}/pub?output=xlsx`:null):PUBLIC[L.type](L.id);
  if(!src)return null;
  const r=await fetch(src,{redirect:'follow'}).catch(()=>null);
  if(!r||!r.ok||/accounts\.google\.com|ServiceLogin/.test(r.url)||/text\/html/i.test(r.headers.get('content-type')||''))return null;
  const buf=await body(r);
  return {name:withExt(nameFromHeader(r.headers.get('content-disposition'))||`google-${L.type}-${L.id.slice(0,8)}`,PUBLIC_EXT[L.type]),buf};
}

async function fetchWithAccount(L,token,email){
  const H={Authorization:`Bearer ${token}`};
  const meta=await fetch(`https://www.googleapis.com/drive/v3/files/${L.id}?fields=name,mimeType,size&supportsAllDrives=true`,{headers:H});
  if(meta.status===404||meta.status===403)throw new GoogleAccessError(`Tài khoản Google ${email||''} không có quyền xem tệp này (${L.url}). Hãy xin quyền xem, chia sẻ link công khai, hoặc đăng nhập tài khoản khác.`,{needLogin:false,denied:true,email,url:L.url});
  if(!meta.ok)throw new Error(`Google Drive trả lỗi ${meta.status} khi đọc ${L.url}`);
  const m=await meta.json();
  let r,name=m.name||L.id;
  if(m.mimeType?.startsWith('application/vnd.google-apps.')){
    const ex=EXPORT[m.mimeType];if(!ex)throw new Error(`Không tải được loại tệp Google này (${m.mimeType.split('.').pop()}): ${L.url}`);
    r=await fetch(`https://www.googleapis.com/drive/v3/files/${L.id}/export?mimeType=${encodeURIComponent(ex[1])}`,{headers:H});
    // the Drive export stops at 10MB; the Docs export link takes the same token and has no such limit
    if(!r.ok&&PUBLIC[L.type]&&L.type!=='file')r=await fetch(PUBLIC[L.type](L.id),{headers:H});
    name=withExt(name,ex[0]);
  }else{
    if(+m.size>GOOGLE_MAX_FILE)throw new Error(`Tệp "${name}" trên Google Drive lớn hơn 25MB.`);
    r=await fetch(`https://www.googleapis.com/drive/v3/files/${L.id}?alt=media&supportsAllDrives=true`,{headers:H});
  }
  if(!r.ok)throw new Error(`Không tải được "${name}" từ Google (lỗi ${r.status}).`);
  const out={name,buf:await body(r)};
  // which sheet the link points at (needs the Sheets API on the Cloud project; skipped if it is off)
  if(L.type==='spreadsheets'&&L.gid!=null){
    const s=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${L.id}?fields=sheets.properties(sheetId,title)`,{headers:H}).then(x=>x.ok?x.json():null).catch(()=>null);
    out.sheet=s?.sheets?.find(x=>String(x.properties.sheetId)===L.gid)?.properties.title||null;
  }
  return out;
}

// Downloads every Google link in the text: [{name,buf,src,sheet?}]. Throws GoogleAccessError when one needs an account.
export async function fetchGoogleLinks(text){
  const out=[];
  for(const url of googleLinks(text)){
    const L=parseLink(url);if(!L)continue;
    if(L.folder)throw Object.assign(new Error(`Chưa hỗ trợ đọc cả thư mục Google Drive (${url}). Hãy gửi link từng tệp.`),{code:400});
    const token=await accessToken().catch(()=>null),email=readAuth().email;
    // "Publish to web" links (/d/e/…) carry a different id that only the public export understands
    let got=token&&!L.published?await fetchWithAccount(L,token,email):null;
    if(!got)got=await fetchPublic(L);
    if(!got)throw new GoogleAccessError(`Tệp Google này cần quyền truy cập: ${url}. Hãy đăng nhập tài khoản Google có quyền xem tệp (ô Google trên thanh trên cùng) rồi giao việc lại.`,{needLogin:true,url});
    out.push({...got,src:url});
  }
  return out;
}

// ---------- sign-in ----------
function openBrowser(url){
  const [c,a]=process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  try{spawn(c,a,{detached:true,stdio:'ignore',windowsHide:true}).on('error',()=>{}).unref()}catch{}
}
const PAGE=(ok,msg)=>`<!doctype html><meta charset="utf-8"><title>AI 3D Office</title><body style="font:16px system-ui;background:#1d2330;color:#eee;display:grid;place-items:center;height:90vh"><div><h2>${ok?'✓ Đã kết nối Google':'✗ Chưa kết nối được'}</h2><p>${msg}</p></div>`;

export function googleBridge(){
  let login={state:'idle'},srv=null,timer=null;
  function stopLogin(){clearTimeout(timer);srv?.close();srv=null}

  function startLogin(){
    const c=client();if(!c){login={state:'error',message:'Chưa có OAuth Client ID / Secret của Google.'};return}
    stopLogin();
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),state=randomBytes(16).toString('hex');
    srv=http.createServer(async(req,res)=>{
      const u=new URL(req.url,'http://127.0.0.1');
      if(u.searchParams.get('state')!==state){res.writeHead(404);return res.end()}
      const done=(ok,msg)=>{res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8'});res.end(PAGE(ok,msg));stopLogin()};
      if(u.searchParams.get('error')){login={state:'error',message:'Đã hủy đăng nhập Google ('+u.searchParams.get('error')+').'};return done(false,login.message)}
      try{
        const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:u.searchParams.get('code')||'',client_id:c.id,client_secret:c.secret,redirect_uri:redirect,grant_type:'authorization_code',code_verifier:verifier})});
        const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.error||`HTTP ${r.status}`);
        if(!d.refresh_token)throw new Error('Google không trả refresh token.');
        if(!String(d.scope||'').includes('drive.readonly'))throw new Error('Chưa cấp quyền xem tệp Google Drive (hãy tick ô cho phép khi đăng nhập).');
        let email=null;try{email=JSON.parse(Buffer.from(d.id_token.split('.')[1],'base64url')).email}catch{}
        writeAuth({...readAuth(),refreshToken:d.refresh_token,email,at:new Date().toISOString()});
        access={token:d.access_token,exp:Date.now()+(d.expires_in||3600)*1000};
        login={state:'success'};done(true,`Tài khoản ${email||''} đã được kết nối. Có thể đóng tab này và quay lại app.`);
      }catch(e){login={state:'error',message:'Đăng nhập Google thất bại: '+e.message};done(false,login.message)}
    });
    let redirect='';
    srv.listen(0,'127.0.0.1',()=>{
      redirect=`http://127.0.0.1:${srv.address().port}`;
      const url='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:c.id,redirect_uri:redirect,response_type:'code',scope:SCOPES,
        code_challenge:challenge,code_challenge_method:'S256',state,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true'});
      login={state:'waiting',url};openBrowser(url);
    });
    login={state:'starting'};
    timer=setTimeout(()=>{if(srv){stopLogin();login={state:'error',message:'Hết thời gian chờ đăng nhập Google (10 phút).'}}},LOGIN_TIMEOUT);
  }

  async function logout(){
    const a=readAuth();
    if(a.refreshToken)await fetch('https://oauth2.googleapis.com/revoke?token='+encodeURIComponent(a.refreshToken),{method:'POST'}).catch(()=>{});
    delete a.refreshToken;delete a.email;writeAuth(a);access=null;
  }

  function status(){
    const a=readAuth(),c=client();
    return {connected:!!(a.refreshToken&&c),email:a.refreshToken?a.email||null:null,hasClient:!!c,clientFromEnv:!!c?.env,clientId:c?c.id.replace(/^(.{8}).*(.{24})$/,'$1…$2'):null,
      login:{state:login.state,url:login.url||null,message:login.message||null}};
  }
  // {id,secret}, or the JSON file downloaded from Google Cloud ({"installed":{client_id,client_secret}})
  function saveClient(b){
    let id=String(b.id||'').trim(),secret=String(b.secret||'').trim();
    if(id.startsWith('{'))try{const j=JSON.parse(id),x=j.installed||j.web||j;id=x.client_id;secret=x.client_secret}catch{throw Object.assign(new Error('Nội dung JSON không hợp lệ.'),{code:400})}
    if(!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id||'')||!secret)throw Object.assign(new Error('Client ID phải có dạng …apps.googleusercontent.com và cần kèm Client secret.'),{code:400});
    const a=readAuth();if(a.client?.id!==id){delete a.refreshToken;delete a.email;access=null}
    writeAuth({...a,client:{id,secret}});
  }

  const json=(res,code,b)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(b))};
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
  const readBody=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>2e4)req.destroy()});req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
  const plugin={
    name:'google-bridge',
    configureServer(server){
      server.middlewares.use('/api/google',async(req,res)=>{
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        const path=(req.url||'/').split('?')[0];
        if(isRemoteReq(req)&&!(req.method==='GET'&&path==='/status'))return json(res,403,{error:'Đăng nhập Google chỉ làm được trên chính máy chạy app.'});
        try{
          if(req.method==='GET'&&path==='/status')return json(res,200,status());
          if(req.method==='POST'&&path==='/client'){saveClient(await readBody(req));return json(res,200,status())}
          if(req.method==='POST'&&path==='/client/remove'){const a=readAuth();await logout();delete a.client;delete a.refreshToken;delete a.email;writeAuth(a);return json(res,200,status())}
          if(req.method==='POST'&&path==='/login'){startLogin();return json(res,200,status())}
          if(req.method==='POST'&&path==='/login/cancel'){stopLogin();login={state:'idle'};return json(res,200,status())}
          if(req.method==='POST'&&path==='/logout'){await logout();login={state:'idle'};return json(res,200,status())}
          json(res,404,{error:'Không có API này.'});
        }catch(e){json(res,e.code===400?400:500,{error:String(e?.message||e)})}
      });
    },
  };
  plugin.configurePreviewServer=plugin.configureServer;
  return plugin;
}
