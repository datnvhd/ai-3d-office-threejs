// Remote access: lets other computers (a laptop on the office LAN, or over a VPN such as Tailscale) open the office of
// the machine that runs the agents, e.g. a Mac mini that builds and tests iOS apps. Off by default; switched on in the
// Máy cá nhân window. It is a second, small HTTP server on 0.0.0.0 that checks an access key and forwards to the local
// server (the Vite dev/preview server on 127.0.0.1). Everything still runs on this machine.
//
// - The key (128 bit) is given once in the link (?key=…) and then kept in an HttpOnly, SameSite=Strict cookie.
// - Forwarded requests carry a per-process secret header, so the bridges can tell them from this machine's own window.
// - Sign-in to Claude/Codex, saved web passwords and changing remote access itself stay on this machine only.
// - Plain HTTP: meant for a trusted LAN or a VPN, not the open internet.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import {randomBytes,timingSafeEqual} from 'node:crypto';

export const REMOTE_HEADER='x-ai-office-remote';
const NONCE=randomBytes(24).toString('hex');
const COOKIE='aio_key';
export const DEFAULT_REMOTE_PORT=47821;

// True for a request that came in through the remote server (the header is only trusted from the loopback socket)
export function isRemoteReq(req){
  const a=req.socket?.remoteAddress;
  return (a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1')&&req.headers[REMOTE_HEADER]===NONCE;
}
export const newRemoteKey=()=>randomBytes(16).toString('base64url');

// Paths a remote viewer may not use (method → regexps on the path after the host)
const BLOCKED=[
  [/^\/api\/(claude|codex)\//,req=>!(req.method==='GET'&&/^\/api\/(claude|codex)\/status(\?|$)/.test(req.url))],// sign-in: status only
  [/^\/api\/machine\/remote(\/|\?|$)/,()=>true],
  [/^\/api\/machine\/sites(\/|\?|$)/,req=>req.method!=='GET'],
  [/^\/api\/machine\/tasks\/\d+\/login(\?|$)/,()=>true],
];
const blockedMsg='Việc này chỉ làm được trên chính máy chạy app (đăng nhập tài khoản, mật khẩu web, bật/tắt truy cập từ xa).';

const cookieOf=req=>{const m=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));return m?decodeURIComponent(m[1]):null};
const same=(a,b)=>{if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyPage=(msg='')=>`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 3D Office</title>
<style>body{font-family:system-ui,sans-serif;background:#eef0fb;color:#1d2140;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{background:#fff;padding:24px;border-radius:14px;box-shadow:0 8px 30px #0001;max-width:380px;width:100%}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#555}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd;border-radius:8px;font-size:15px;margin:8px 0}button{padding:10px 16px;border:0;border-radius:8px;background:#5b5bd6;color:#fff;font-size:15px}
.err{color:#c33}</style></head><body><form method="get" action="/"><h1>AI 3D Office · truy cập từ xa</h1>
<p>Nhập mã truy cập hiển thị trong cửa sổ <b>Máy cá nhân → Truy cập từ xa</b> trên máy chạy app.</p>${msg?`<p class="err">${esc(msg)}</p>`:''}
<input name="key" autocomplete="off" autofocus placeholder="Mã truy cập"><button>Mở văn phòng</button></form></body></html>`;

// LAN addresses of this machine (IPv4, not loopback)
export function lanAddresses(){
  return Object.entries(os.networkInterfaces()).flatMap(([name,list])=>(list||[]).filter(i=>i.family==='IPv4'&&!i.internal).map(i=>({name,address:i.address})));
}

export function createRemoteServer({targetPort,key,port=DEFAULT_REMOTE_PORT,log=()=>{}}){
  const fails=new Map();// ip -> {n, since}: slow down key guessing
  const tooMany=ip=>{const f=fails.get(ip);return f&&Date.now()-f.since<10*60*1000&&f.n>=20};
  const failed=ip=>{const f=fails.get(ip);if(!f||Date.now()-f.since>10*60*1000)fails.set(ip,{n:1,since:Date.now()});else f.n++};
  const authed=req=>same(cookieOf(req),key());

  const forwardHeaders=req=>{
    const h={...req.headers};delete h[REMOTE_HEADER];
    h.host=`127.0.0.1:${targetPort()}`;h[REMOTE_HEADER]=NONCE;h['x-forwarded-for']=req.socket.remoteAddress||'';
    return h;
  };
  const server=http.createServer((req,res)=>{
    const ip=req.socket.remoteAddress||'?',url=new URL(req.url||'/','http://x');
    if(tooMany(ip)){res.writeHead(429,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Nhập sai mã quá nhiều lần, thử lại sau 10 phút.')}
    // ?key=… in the link: keep it in a cookie and drop it from the address bar
    const given=url.searchParams.get('key');
    if(given!=null){
      if(!same(given.trim(),key())){failed(ip);res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(keyPage('Mã truy cập không đúng.'))}
      url.searchParams.delete('key');
      res.writeHead(302,{'Set-Cookie':`${COOKIE}=${encodeURIComponent(key())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*86400}`,Location:url.pathname+(url.search||'')});
      log(`Thiết bị ${ip} đã mở văn phòng từ xa`);return res.end();
    }
    if(!authed(req)){
      if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Cần mã truy cập từ xa.'}))}
      res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(keyPage());
    }
    if(BLOCKED.some(([re,when])=>re.test(url.pathname)&&when(req))){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:blockedMsg}))}
    const up=http.request({host:'127.0.0.1',port:targetPort(),method:req.method,path:req.url,headers:forwardHeaders(req)},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});
    up.on('error',e=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Không kết nối được server nội bộ: '+e.message)});
    req.pipe(up);
  });
  // WebSocket (the dev server's live reload): same key check, then a raw pipe
  server.on('upgrade',(req,sock,head)=>{
    if(!authed(req)){sock.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return}
    const up=net.connect(targetPort(),'127.0.0.1',()=>{
      const h=forwardHeaders(req);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if(head?.length)up.write(head);sock.pipe(up).pipe(sock);
    });
    up.on('error',()=>sock.destroy());sock.on('error',()=>up.destroy());
  });
  return new Promise((resolve,reject)=>{
    let p=port,tries=0;
    server.on('error',e=>{if(e.code==='EADDRINUSE'&&tries++<10){p++;server.listen(p,'0.0.0.0')}else reject(e)});
    server.on('listening',()=>resolve({server,port:server.address().port,close:()=>new Promise(r=>{server.close(()=>r());server.closeAllConnections?.()})}));
    server.listen(p,'0.0.0.0');
  });
}
