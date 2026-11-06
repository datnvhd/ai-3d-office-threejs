// Remote access: lets other devices open the office of the machine that runs the agents. Off by default; switched on in
// the Máy cá nhân window. A small HTTP server checks the access and forwards to the local server (the Vite dev/preview
// server on 127.0.0.1). Everything still runs on this machine. Two kinds:
//
// - LAN (createRemoteServer on 0.0.0.0): a laptop or phone on the same Wi-Fi/LAN. The key (128 bit) is given once in the
//   link (?key=…) and then kept in an HttpOnly, SameSite=Strict cookie. Plain HTTP: for a trusted network only.
// - Public (password set, on 127.0.0.1 only): reached from anywhere through a Cloudflare quick tunnel (tunnel.js), which
//   gives an https://….trycloudflare.com link. Because that link is on the internet, the key alone is not enough: the
//   device also needs the password set on this machine (scrypt hash), failed tries are limited per device and in total,
//   and the session cookie is Secure and stops working when the key or the password changes.
//
// Forwarded requests carry a per-process secret header, so the bridges can tell them from this machine's own window.
// Sign-in to Claude/Codex, saved web passwords and changing remote access itself stay on this machine only.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import {randomBytes,timingSafeEqual,scryptSync,createHmac} from 'node:crypto';

export const REMOTE_HEADER='x-ai-office-remote';
const NONCE=randomBytes(24).toString('hex');
const COOKIE='aio_key',PUB_COOKIE='aio_pub';
export const DEFAULT_REMOTE_PORT=47821;

// True for a request that came in through the remote server (the header is only trusted from the loopback socket)
export function isRemoteReq(req){
  const a=req.socket?.remoteAddress;
  return (a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1')&&req.headers[REMOTE_HEADER]===NONCE;
}
export const newRemoteKey=()=>randomBytes(16).toString('base64url');
// Password for the public link: {salt, hash} (scrypt); checked in constant time
export const MIN_PASSWORD=8;
export function hashPassword(pw){const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(String(pw),salt,32).toString('hex')}}
export function checkPassword(pw,p){if(!p?.salt||!p?.hash)return false;return same(scryptSync(String(pw||''),p.salt,32).toString('hex'),p.hash)}

// Paths a remote viewer may not use (method → regexps on the path after the host)
const BLOCKED=[
  [/^\/api\/(claude|codex)\//,req=>!(req.method==='GET'&&/^\/api\/(claude|codex)\/status(\?|$)/.test(req.url))],// sign-in: status only
  [/^\/api\/machine\/remote(\/|\?|$)/,()=>true],
  [/^\/api\/machine\/sites(\/|\?|$)/,req=>req.method!=='GET'],
  [/^\/api\/machine\/tasks\/\d+\/login(\?|$)/,()=>true],
];
const blockedMsg='Việc này chỉ làm được trên chính máy chạy app (đăng nhập tài khoản, mật khẩu web, bật/tắt truy cập từ xa).';

const cookieOf=(req,name)=>{const m=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));return m?decodeURIComponent(m[1]):null};
const same=(a,b)=>{if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PAGE_CSS=`body{font-family:system-ui,sans-serif;background:#eef0fb;color:#1d2140;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{box-sizing:border-box;background:#fff;padding:24px;border-radius:14px;box-shadow:0 8px 30px #0001;max-width:380px;width:100%}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#555;line-height:1.5}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ccd;border-radius:10px;font-size:16px;margin:8px 0}button{width:100%;padding:12px 16px;border:0;border-radius:10px;background:#f08c5a;color:#fff;font-size:16px;font-weight:700;margin-top:6px}
.err{color:#c33}`;
const head=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>AI 3D Office</title><style>${PAGE_CSS}</style></head><body>`;
const keyPage=(msg='')=>`${head}<form method="get" action="/"><h1>AI 3D Office · truy cập từ xa</h1>
<p>Nhập mã truy cập hiển thị trong cửa sổ <b>Máy cá nhân → Truy cập từ xa</b> trên máy chạy app.</p>${msg?`<p class="err">${esc(msg)}</p>`:''}
<input name="key" autocomplete="off" autofocus placeholder="Mã truy cập"><button>Mở văn phòng</button></form></body></html>`;
// Public link: the key comes from the link (hidden field), the password is typed
const loginPage=(key,msg='')=>`${head}<form method="post" action="/__login"><h1>AI 3D Office</h1>
<p>Nhập mật khẩu truy cập đã đặt trên máy chạy app.</p>${msg?`<p class="err">${esc(msg)}</p>`:''}
${key?`<input type="hidden" name="key" value="${esc(key)}">`:'<input name="key" autocomplete="off" placeholder="Mã truy cập (trong link)">'}
<input type="password" name="password" autocomplete="current-password" autofocus placeholder="Mật khẩu"><button>Mở văn phòng</button></form></body></html>`;

// Addresses of this machine other devices on the same network can use (IPv4, not loopback). Adapters of VMs, WSL and
// containers are left out: no phone or laptop can reach them.
const VIRTUAL=/vEthernet|WSL|docker|^br-|^veth|VirtualBox|vboxnet|VMware|vmnet|Hyper-V|^utun|^llw|^awdl|^bridge/i;
export function lanAddresses(){
  return Object.entries(os.networkInterfaces()).flatMap(([name,list])=>(list||[]).filter(i=>i.family==='IPv4'&&!i.internal&&!VIRTUAL.test(name)).map(i=>({name,address:i.address})));
}

// password: null (LAN) or () => {salt, hash} (public link through the tunnel)
export function createRemoteServer({targetPort,key,port=DEFAULT_REMOTE_PORT,host='0.0.0.0',password=null,log=()=>{}}){
  const pub=!!password,WINDOW=15*60*1000;
  const fails=new Map();let total={n:0,since:Date.now()};// ip -> {n, since}: slow down key/password guessing
  // behind the tunnel every request comes from 127.0.0.1: Cloudflare gives the device's address in a header
  const ipOf=req=>(pub&&req.headers['cf-connecting-ip'])||req.socket.remoteAddress||'?';
  const tooMany=ip=>{const f=fails.get(ip);return f&&Date.now()-f.since<WINDOW&&f.n>=(pub?10:20)||pub&&Date.now()-total.since<3600000&&total.n>=100};
  const failed=ip=>{const f=fails.get(ip);if(!f||Date.now()-f.since>WINDOW)fails.set(ip,{n:1,since:Date.now()});else f.n++;
    if(Date.now()-total.since>3600000)total={n:0,since:Date.now()};total.n++};
  // public session cookie: bound to the current key and password, so changing either signs every device out
  const pubToken=()=>{const p=password?.();return p?.hash?createHmac('sha256',key()).update(p.hash).digest('base64url'):null};
  const authed=req=>pub?same(cookieOf(req,PUB_COOKIE),pubToken()):same(cookieOf(req,COOKIE),key());
  const html=(res,code,body)=>{res.writeHead(code,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(body)};

  const forwardHeaders=(req,ip)=>{
    const h={...req.headers};delete h[REMOTE_HEADER];
    h.host=`127.0.0.1:${targetPort()}`;h[REMOTE_HEADER]=NONCE;h['x-forwarded-for']=ip;
    return h;
  };
  const readForm=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy()});req.on('end',()=>r(Object.fromEntries(new URLSearchParams(b))))});

  const server=http.createServer(async(req,res)=>{
    const ip=ipOf(req),url=new URL(req.url||'/','http://x');
    if(tooMany(ip)){res.writeHead(429,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Nhập sai quá nhiều lần, thử lại sau 15 phút.')}
    if(pub){
      if(req.method==='POST'&&url.pathname==='/__login'){
        const f=await readForm(req);
        if(!same(String(f.key||'').trim(),key())||!checkPassword(f.password,password())){failed(ip);log(`Đăng nhập sai từ ${ip}`);return html(res,401,loginPage(same(String(f.key||'').trim(),key())?f.key:'','Mã hoặc mật khẩu không đúng.'))}
        res.writeHead(302,{'Set-Cookie':`${PUB_COOKIE}=${encodeURIComponent(pubToken())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30*86400}`,Location:'/'});
        log(`Thiết bị ${ip} đã mở văn phòng qua link công khai`);return res.end();
      }
      if(!authed(req)){
        if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Cần đăng nhập lại.'}))}
        return html(res,401,loginPage(url.searchParams.get('key')||''));
      }
    }else{
      // ?key=… in the link: keep it in a cookie and drop it from the address bar
      const given=url.searchParams.get('key');
      if(given!=null){
        if(!same(given.trim(),key())){failed(ip);return html(res,401,keyPage('Mã truy cập không đúng.'))}
        url.searchParams.delete('key');
        res.writeHead(302,{'Set-Cookie':`${COOKIE}=${encodeURIComponent(key())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*86400}`,Location:url.pathname+(url.search||'')});
        log(`Thiết bị ${ip} đã mở văn phòng từ xa`);return res.end();
      }
      if(!authed(req)){
        if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Cần mã truy cập từ xa.'}))}
        return html(res,401,keyPage());
      }
    }
    if(BLOCKED.some(([re,when])=>re.test(url.pathname)&&when(req))){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:blockedMsg}))}
    const up=http.request({host:'127.0.0.1',port:targetPort(),method:req.method,path:req.url,headers:forwardHeaders(req,ip)},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});
    up.on('error',e=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Không kết nối được server nội bộ: '+e.message)});
    req.pipe(up);
  });
  // WebSocket (the dev server's live reload): same check, then a raw pipe
  server.on('upgrade',(req,sock,head)=>{
    if(!authed(req)){sock.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return}
    const up=net.connect(targetPort(),'127.0.0.1',()=>{
      const h=forwardHeaders(req,ipOf(req));
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if(head?.length)up.write(head);sock.pipe(up).pipe(sock);
    });
    up.on('error',()=>sock.destroy());sock.on('error',()=>up.destroy());
  });
  return new Promise((resolve,reject)=>{
    let p=port,tries=0;
    server.on('error',e=>{if(e.code==='EADDRINUSE'&&tries++<10){p++;server.listen(p,host)}else reject(e)});
    server.on('listening',()=>resolve({server,port:server.address().port,close:()=>new Promise(r=>{server.close(()=>r());server.closeAllConnections?.()})}));
    server.listen(p,host);
  });
}
