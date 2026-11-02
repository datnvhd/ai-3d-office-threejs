// Vite dev-server plugin: the "personal machine" side of the office. Reports this computer's info, runs a
// health check, and executes assigned tasks for real with Claude Code (`claude -p`) in a chosen working folder.
// Tasks never bypass Claude Code's permission system: 'default' (read & analyse) or 'acceptEdits' (edit files in the folder).
// Web tasks also get a real Chrome through Playwright MCP; saved site passwords reach the browser as Playwright
// "secrets" (the agent types the secret's name), so Claude never sees them.
import {spawn} from 'node:child_process';
import {existsSync,statSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import {join,resolve,isAbsolute,dirname,basename} from 'node:path';
import {STORE_DIR,cleanEnv,run,findClaudeBinary,killTree,getSavedClaudeToken} from './claude-bridge.js';

const CONFIG_FILE=join(STORE_DIR,'machine.json'),TASKS_FILE=join(STORE_DIR,'tasks.json'),SITES_FILE=join(STORE_DIR,'sites.json'),RUNS_DIR=join(STORE_DIR,'runs');
const MAX_PARALLEL=2,MAX_TURNS=30,WEB_TURNS=60,TASK_TIMEOUT=20*60*1000,KEEP=100;
const MCP_CLI=(()=>{try{return join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')),'cli.js')}catch{return null}})();
const BROWSERS=[['chrome',['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),'/Applications/Google Chrome.app','/usr/bin/google-chrome']],
  ['msedge',['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/Applications/Microsoft Edge.app']]];
const findBrowser=()=>BROWSERS.find(([,paths])=>paths.some(p=>existsSync(p)))?.[0]||null;
const MODES={default:'Chỉ đọc & phân tích',acceptEdits:'Cho phép tạo/sửa file trong thư mục làm việc'};
const DEFAULT_WORKDIR=join(os.homedir(),'AI-Office-Workspace');

const readJson=(f,fallback)=>{try{return JSON.parse(readFileSync(f,'utf8'))}catch{return fallback}};
const writeJson=(f,data)=>{mkdirSync(STORE_DIR,{recursive:true});writeFileSync(f,JSON.stringify(data,null,2))};
const short=(s,n=140)=>{s=String(s??'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};

// What a tool call is doing, in one short line for the results panel
const BROWSER_VERBS={browser_navigate:'Mở trang',browser_navigate_back:'Quay lại trang trước',browser_click:'Bấm',browser_type:'Gõ',browser_fill_form:'Điền form',browser_snapshot:'Đọc nội dung trang',
  browser_take_screenshot:'Chụp màn hình',browser_wait_for:'Chờ trang',browser_close:'Đóng trình duyệt',browser_select_option:'Chọn',browser_press_key:'Nhấn phím',browser_tabs:'Chuyển tab',
  browser_evaluate:'Chạy JS trên trang',browser_hover:'Rê chuột',browser_file_upload:'Tải file lên',browser_handle_dialog:'Xử lý hộp thoại',browser_resize:'Đổi kích thước cửa sổ',browser_console_messages:'Đọc console',browser_network_requests:'Xem request mạng'};
function describeTool({name,input={}}){
  if(name.startsWith('mcp__browser__')){
    const tool=name.slice(14),target=input.url||input.element||input.key||input.text||(input.fields?input.fields.map(f=>f.name).join(', '):'')||input.filename||'';
    return short(`🌐 ${BROWSER_VERBS[tool]||tool}${target?': '+target:''}`,120);
  }
  const target=input.file_path||input.path||input.pattern||input.command||input.url||input.query||input.description||'';
  const verb={Read:'Đọc',Write:'Tạo file',Edit:'Sửa file',MultiEdit:'Sửa file',Glob:'Tìm file',Grep:'Tìm trong mã',Bash:'Chạy lệnh',PowerShell:'Chạy lệnh',WebFetch:'Đọc trang web',WebSearch:'Tìm trên web',TodoWrite:'Lập danh sách việc',Task:'Giao việc phụ'}[name]||`Dùng ${name}`;
  return short(target?`${verb}: ${target}`:verb,120);
}

export function machineBridge(){
  let bin=null,binChecked=false,version=null,authCache=null;
  let config={workdir:DEFAULT_WORKDIR,mode:'default',browserVisible:true,...readJson(CONFIG_FILE,{})};
  let lastCheck=readJson(CONFIG_FILE,{}).lastCheck||null;
  // Tasks interrupted by a server restart cannot be resumed
  let tasks=readJson(TASKS_FILE,[]).map(t=>t.status==='running'||t.status==='queued'?{...t,status:'error',error:'Server đã khởi động lại khi việc đang chạy.',finished:t.finished||new Date().toISOString()}:t);
  let nextId=tasks.reduce((m,t)=>Math.max(m,t.id),0)+1;
  const procs=new Map();
  let saveTimer=null;
  const save=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>writeJson(TASKS_FILE,tasks.slice(0,KEEP)),400)};
  const saveConfig=()=>writeJson(CONFIG_FILE,{workdir:config.workdir,mode:config.mode,browserVisible:config.browserVisible,lastCheck});

  // ---------- saved web logins (passwords stay in this file and are never sent to the page or to Claude) ----------
  let sites=readJson(SITES_FILE,[]);
  const saveSites=()=>{mkdirSync(STORE_DIR,{recursive:true});writeFileSync(SITES_FILE,JSON.stringify(sites,null,2),{mode:0o600})};
  const siteView=s=>({id:s.id,label:s.label,url:s.url,username:s.username,hasPassword:!!s.password});
  const hostOf=u=>{try{return new URL(/^\w+:\/\//.test(u)?u:'http://'+u).host.toLowerCase()}catch{return ''}};
  // Masks every saved password that shows up in logs or results
  const redact=s=>{if(s==null)return s;let out=String(s);for(const x of sites)if(x.password&&x.password.length>=3)out=out.split(x.password).join('••••••');return out};
  const quoteEnv=v=>!v.includes("'")?`'${v}'`:!v.includes('`')?`\`${v}\``:`"${v.replace(/\n/g,' ')}"`;

  async function ensureBin(){
    if(!binChecked){bin=findClaudeBinary();binChecked=true;if(bin)version=(await run(bin,['--version'])).stdout.trim()||null}
    return bin;
  }
  // Saved long-lived token first, otherwise the CLI's own login (cached for a minute)
  async function auth(){
    if(getSavedClaudeToken())return 'token';
    if(authCache&&Date.now()-authCache.at<60000)return authCache.kind;
    let kind=null;
    if(await ensureBin()){const {stdout}=await run(bin,['auth','status','--json']);try{if(JSON.parse(stdout).loggedIn)kind='cli'}catch{}}
    authCache={kind,at:Date.now()};return kind;
  }
  const authEnv=()=>{const token=getSavedClaudeToken();return cleanEnv(token?{CLAUDE_CODE_OAUTH_TOKEN:token}:{})};

  function workdirState(dir=config.workdir){
    try{if(!existsSync(dir))return {exists:false,writable:false};if(!statSync(dir).isDirectory())return {exists:false,writable:false,error:'Không phải thư mục'};
      const probe=join(dir,`.ai-office-probe-${process.pid}`);writeFileSync(probe,'ok');rmSync(probe,{force:true});return {exists:true,writable:true}}
    catch(e){return {exists:existsSync(dir),writable:false,error:short(e.message,100)}}
  }

  // Spawns `claude -p` with the prompt on stdin and streams JSON events; returns the child and a completion promise
  function claude(args,{cwd,input,onEvent,timeout}){
    const child=spawn(bin,['-p','--output-format','stream-json','--verbose',...args],{cwd,env:authEnv(),windowsHide:true,shell:/\.(cmd|bat)$/i.test(bin)});
    const done=new Promise(res=>{
      let buf='',stderr='',result=null,timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;killTree(child)},timeout);
      child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let ev;try{ev=JSON.parse(line)}catch{continue}if(ev.type==='result')result=ev;onEvent?.(ev)}});
      child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000)});
      child.on('error',e=>{stderr+=e.message});
      child.on('close',code=>{clearTimeout(timer);res({code,result,stderr:stderr.trim(),timedOut})});
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
    return {child,done};
  }
  function resultError(r,{stderr,timedOut},cancelled){
    if(cancelled)return 'Đã dừng theo yêu cầu.';
    if(timedOut)return 'Quá thời gian cho phép (20 phút).';
    if(r?.subtype==='error_max_turns')return `Đã dùng hết ${MAX_TURNS} bước mà chưa hoàn thành. Hãy chia nhỏ yêu cầu.`;
    if(r?.api_error_status===401)return 'Xác thực Claude Code thất bại (401): token không hợp lệ hoặc đã bị thu hồi.';
    if(r?.is_error)return short(r.result||'Claude Code báo lỗi khi xử lý.',600);
    return short(stderr||'Claude Code dừng mà không trả kết quả.',600);
  }

  // ---------- health check: folder, CLI, auth + a real round trip ----------
  async function check(){
    const steps=[],t0=Date.now();
    const wd=workdirState();
    steps.push({name:'Thư mục làm việc',ok:wd.writable,detail:wd.writable?config.workdir:(wd.error||(wd.exists?'Không ghi được':'Không tồn tại'))+` — ${config.workdir}`});
    const b=await ensureBin();
    steps.push({name:'Claude Code CLI',ok:!!b,detail:b?(version||b):'Không tìm thấy trên máy'});
    const a=b?await auth():null;
    steps.push({name:'Xác thực',ok:!!a,detail:a==='token'?'Token dài hạn đã lưu':a==='cli'?'Đăng nhập của Claude Code CLI':'Chưa đăng nhập'});
    if(b&&a&&wd.writable){
      const s=Date.now(),{done}=claude(['--max-turns','1','--tools',''],{cwd:config.workdir,input:'Reply with exactly: OK',timeout:90000});
      const out=await done,ok=!!out.result&&!out.result.is_error;
      steps.push({name:'Chạy thử trên máy',ok,detail:ok?`Claude phản hồi sau ${((Date.now()-s)/1000).toFixed(1)}s: "${short(out.result.result,40)}"`:resultError(out.result,out)});
    }else steps.push({name:'Chạy thử trên máy',ok:false,detail:'Bỏ qua vì bước trước chưa đạt'});
    lastCheck={ok:steps.every(s=>s.ok),at:new Date().toISOString(),ms:Date.now()-t0,steps};saveConfig();
    return lastCheck;
  }

  // ---------- task runner ----------
  function prompt(t){
    return `Bạn là "${t.name}", AI agent đảm nhiệm vai trò "${t.role}" trong văn phòng AI của người dùng.
Bạn đang chạy trực tiếp trên máy cá nhân của người dùng, trong thư mục làm việc hiện tại (${t.cwd}).
Chế độ quyền: ${MODES[t.mode]}.${t.mode==='default'?' Không tạo hoặc sửa file; chỉ đọc, phân tích và trả lời.':' Chỉ tạo/sửa file bên trong thư mục làm việc.'}
Luôn trả lời bằng tiếng Việt. Khi xong, kết thúc bằng một phần "Kết quả:" tóm tắt ngắn gọn những gì đã làm hoặc tìm được.
${t.web?webPrompt(t):''}
Mức ưu tiên: ${t.priority}
Nhiệm vụ:
${t.text}`;
  }
  // Sites given to a web task: the ones the user picked, otherwise those whose host appears in the request
  function sitesFor(t){
    if(t.siteIds?.length)return sites.filter(s=>t.siteIds.includes(s.id));
    const text=t.text.toLowerCase();return sites.filter(s=>{const h=hostOf(s.url);return h&&text.includes(h)});
  }
  function webPrompt(t){
    const list=sitesFor(t);
    return `
TRÌNH DUYỆT: Bạn có bộ công cụ mcp__browser__* điều khiển một cửa sổ Chrome thật trên máy người dùng (mở link, đăng nhập, bấm, điền form, chọn, đọc nội dung, chụp màn hình).
Được truy cập mọi trang web cần cho nhiệm vụ, không giới hạn trong thư mục làm việc. Dùng browser_snapshot để đọc trang trước khi thao tác; chụp màn hình (browser_take_screenshot, KHÔNG truyền filename để ảnh tự lưu vào thư mục riêng của nhiệm vụ) ở các bước quan trọng và khi xong để người dùng xem lại.
${list.length?`Tài khoản đăng nhập đã lưu (dùng khi trang yêu cầu đăng nhập):
${list.map((s,i)=>`- ${s.label} · ${s.url} · tên đăng nhập: ${s.username||'(không có)'} · mật khẩu: gõ CHÍNH XÁC chuỗi SITE_${i+1}_PASSWORD vào ô mật khẩu (bằng browser_type hoặc browser_fill_form). Hệ thống tự thay bằng mật khẩu thật; bạn không biết và không cần biết mật khẩu.`).join('\n')}
Không bao giờ in, lưu ra file hay gửi đi mật khẩu. Nếu đăng nhập thất bại, mô tả thông báo lỗi trên trang thay vì thử lại nhiều lần.`:'Chưa có tài khoản đăng nhập nào được cung cấp cho nhiệm vụ này; nếu trang đòi đăng nhập, dừng lại và báo cho người dùng.'}
Khi xong việc trên web, đóng trình duyệt bằng browser_close.
`;
  }
  // Per-task Playwright MCP config + secrets file (deleted when the task ends); screenshots land in the run folder
  function webSetup(t){
    if(!MCP_CLI)throw new Error('Chưa cài Playwright MCP (@playwright/mcp). Chạy npm install trong thư mục dự án.');
    const browser=findBrowser();if(!browser)throw new Error('Không tìm thấy Chrome hoặc Edge trên máy để agent dùng.');
    const dir=join(RUNS_DIR,String(t.id));rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
    const secrets=join(dir,'secrets.env'),list=sitesFor(t);
    writeFileSync(secrets,list.map((s,i)=>`SITE_${i+1}_PASSWORD=${quoteEnv(s.password||'')}`).join('\n')+'\n',{mode:0o600});
    const args=[MCP_CLI,'--browser',browser,'--isolated','--secrets',secrets,'--output-dir',dir,'--viewport-size','1366x860',...(config.browserVisible?[]:['--headless'])];
    const mcp=join(dir,'mcp.json');writeFileSync(mcp,JSON.stringify({mcpServers:{browser:{command:process.execPath,args}}}));
    t.siteLabels=list.map(s=>s.label);t.browser=browser;
    return {dir,secrets,args:['--mcp-config',mcp,'--strict-mcp-config','--allowedTools','mcp__browser','WebFetch']};
  }
  function pump(){
    for(const t of [...tasks].reverse()){
      if(procs.size>=MAX_PARALLEL)break;
      if(t.status==='queued')start(t);
    }
  }
  function start(t){
    const wd=workdirState(t.cwd);
    if(!bin||!wd.writable){Object.assign(t,{status:'error',error:!bin?'Không tìm thấy Claude Code CLI trên máy.':`Thư mục làm việc không dùng được: ${t.cwd}`,finished:new Date().toISOString()});save();return}
    let web=null;
    if(t.web)try{web=webSetup(t)}catch(e){Object.assign(t,{status:'error',error:e.message,finished:new Date().toISOString()});save();return}
    Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Claude Code…',log:[]});
    // Step log for the progress popup: init, tool calls, their (shortened) output and Claude's own messages
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    const outText=c=>Array.isArray(c)?c.map(x=>x.type==='text'?x.text:x.type==='image'?'[hình ảnh]':'').join(' '):String(c??'');
    const turns=String(t.web?WEB_TURNS:MAX_TURNS);
    const {child,done}=claude(['--max-turns',turns,'--permission-mode',t.mode,...(web?.args||[])],{cwd:t.cwd,input:prompt(t),timeout:TASK_TIMEOUT,onEvent:ev=>{
      if(ev.type==='system'&&ev.subtype==='init'&&web){const b=(ev.mcp_servers||[]).find(s=>s.name==='browser');if(b&&b.status!=='connected')note('denied',`Trình duyệt chưa sẵn sàng (${b.status})`,false)}
      if(ev.type==='system'&&ev.subtype==='init')note('init',`Đã khởi động Claude Code · model ${ev.model||'?'}`);
      if(ev.type==='assistant')for(const c of ev.message?.content||[]){
        if(c.type==='tool_use'){t.steps++;note('tool',describeTool(c))}
        else if(c.type==='text'&&c.text?.trim())note('text',short(c.text,600));
      }
      if(ev.type==='user')for(const c of ev.message?.content||[])if(c.type==='tool_result')note(c.is_error?'denied':'out',short(outText(c.content)||'(không có đầu ra)',300),false);
    }});
    procs.set(t.id,child);save();
    done.then(out=>{
      procs.delete(t.id);
      if(web)rmSync(web.secrets,{force:true});
      const r=out.result,cancelled=t.status==='cancelled',ok=!cancelled&&r&&!r.is_error&&r.subtype==='success';
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(r.result||'').slice(0,20000)):null,error:ok?null:redact(resultError(r,out,cancelled)),
        durationMs:r?.duration_ms??(Date.now()-Date.parse(t.started)),turns:r?.num_turns??null,costUsd:r?.total_cost_usd??null,activity:null});
      save();pump();
    });
  }
  function add(body){
    const text=String(body.text||'').trim();
    if(!text||text.length>8000)throw Object.assign(new Error('Nội dung nhiệm vụ trống hoặc quá dài (tối đa 8000 ký tự).'),{code:400});
    if(!/^[a-z0-9_-]{1,40}$/i.test(body.agent||''))throw Object.assign(new Error('Agent không hợp lệ.'),{code:400});
    const siteIds=Array.isArray(body.siteIds)?body.siteIds.filter(id=>sites.some(s=>s.id===id)).slice(0,10):[];
    const t={id:nextId++,agent:body.agent,name:short(body.name,60),role:short(body.role,80),text,priority:short(body.priority||'Bình thường',30),
      status:'queued',created:new Date().toISOString(),cwd:config.workdir,mode:config.mode,host:os.hostname(),web:!!body.web,siteIds};
    tasks.unshift(t);if(tasks.length>KEEP)tasks.length=KEEP;save();pump();return t;
  }

  async function status(){
    const b=await ensureBin(),a=b?await auth():null,wd=workdirState(),cpus=os.cpus();
    return {
      host:{name:os.hostname(),os:`${os.version?.()||os.type()} (${os.release()})`,arch:os.arch(),cpu:cpus[0]?.model?.trim()||'?',cores:cpus.length,
        ramTotal:os.totalmem(),ramFree:os.freemem(),uptime:os.uptime(),user:os.userInfo().username,node:process.version},
      claude:{found:!!b,path:b,version,auth:a},
      config:{workdir:config.workdir,mode:config.mode,modes:MODES,defaultWorkdir:DEFAULT_WORKDIR,browserVisible:config.browserVisible},
      browser:{mcp:!!MCP_CLI,channel:findBrowser(),sites:sites.map(siteView)},
      workdir:wd,lastCheck,
      running:tasks.filter(t=>t.status==='running').length,queued:tasks.filter(t=>t.status==='queued').length,
      ready:!!(b&&a&&wd.writable)
    };
  }

  const json=(res,code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
  const readBody=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>4e4)req.destroy()});req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
  const view=t=>({...t,log:(t.log||[]).slice(-8)});

  return {
    name:'machine-bridge',
    configureServer(server){
      if(!existsSync(config.workdir)&&config.workdir===DEFAULT_WORKDIR)try{mkdirSync(DEFAULT_WORKDIR,{recursive:true})}catch{}
      server.middlewares.use('/api/machine',async(req,res)=>{
        // Runs programs on this computer: only this computer may call it, and writes need the CSRF header
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        const path=(req.url||'/').split('?')[0],m=path.match(/^\/tasks\/(\d+)\/(cancel|retry)$/);
        try{
          if(req.method==='GET'&&path==='/status')return json(res,200,await status());
          if(req.method==='POST'&&path==='/check'){await ensureBin();return json(res,200,{check:await check(),status:await status()})}
          if(req.method==='POST'&&path==='/config'){
            const b=await readBody(req);
            if(b.workdir!==undefined){
              const dir=String(b.workdir).trim();
              if(!dir||!isAbsolute(dir))return json(res,400,{error:'Hãy nhập đường dẫn tuyệt đối, ví dụ C:\\Users\\ban\\Projects\\demo'});
              const full=resolve(dir);if(b.create&&!existsSync(full))mkdirSync(full,{recursive:true});
              const wd=workdirState(full);if(!wd.writable)return json(res,400,{error:wd.exists?`Không ghi được vào thư mục: ${wd.error||full}`:`Thư mục không tồn tại: ${full}`});
              config.workdir=full;
            }
            if(b.mode!==undefined){if(!MODES[b.mode])return json(res,400,{error:'Chế độ quyền không hợp lệ.'});config.mode=b.mode}
            if(b.browserVisible!==undefined)config.browserVisible=!!b.browserVisible;
            saveConfig();return json(res,200,await status());
          }
          if(req.method==='GET'&&path==='/tasks')return json(res,200,{tasks:tasks.map(view)});
          // saved web logins: passwords go in, never come back out
          if(req.method==='POST'&&path==='/sites'){
            const b=await readBody(req),label=short(b.label,60),url=String(b.url||'').trim(),username=String(b.username||'').slice(0,200),password=typeof b.password==='string'?b.password.slice(0,500):'';
            if(!label||!hostOf(url))return json(res,400,{error:'Cần nhập tên và link hợp lệ (ví dụ http://pm.trinam.vn).'});
            const old=b.id&&sites.find(s=>s.id===b.id);
            if(old)Object.assign(old,{label,url,username,...(password?{password}:{})});
            else{if(!password)return json(res,400,{error:'Cần nhập mật khẩu.'});sites.push({id:'s'+Date.now().toString(36),label,url,username,password})}
            saveSites();return json(res,200,{sites:sites.map(siteView)});
          }
          const del=req.method==='DELETE'&&path.match(/^\/sites\/([\w-]+)$/);
          if(del){sites=sites.filter(s=>s.id!==del[1]);saveSites();return json(res,200,{sites:sites.map(siteView)})}
          // screenshots a web task saved in its run folder
          const shots=req.method==='GET'&&path.match(/^\/tasks\/(\d+)\/shots(?:\/([\w.-]+\.(?:png|jpe?g)))?$/i);
          if(shots){
            const dir=join(RUNS_DIR,shots[1]);
            if(!shots[2])return json(res,200,{shots:existsSync(dir)?readdirSync(dir).filter(f=>/\.(png|jpe?g)$/i.test(f)).map(f=>({name:f,at:statSync(join(dir,f)).mtimeMs})).sort((a,b)=>a.at-b.at):[]});
            const file=join(dir,basename(shots[2]));if(!existsSync(file))return json(res,404,{error:'Không có ảnh.'});
            res.setHeader('Content-Type',/png$/i.test(file)?'image/png':'image/jpeg');res.setHeader('Cache-Control','no-store');return res.end(readFileSync(file));
          }
          const one=req.method==='GET'&&path.match(/^\/tasks\/(\d+)$/);
          if(one){const t=tasks.find(t=>t.id===+one[1]);return t?json(res,200,{task:t}):json(res,404,{error:'Không tìm thấy nhiệm vụ.'})}
          if(req.method==='POST'&&path==='/tasks'){await ensureBin();return json(res,200,{task:view(add(await readBody(req)))})}
          if(req.method==='DELETE'&&path==='/tasks'){tasks=tasks.filter(t=>t.status==='running'||t.status==='queued');save();return json(res,200,{tasks:tasks.map(view)})}
          if(req.method==='POST'&&m){
            const t=tasks.find(t=>t.id===+m[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(m[2]==='cancel'){
              if(t.status==='queued')Object.assign(t,{status:'cancelled',error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});
              else if(t.status==='running'){t.status='cancelled';killTree(procs.get(t.id))}
            }else if(t.status==='error'||t.status==='cancelled'){
              Object.assign(t,{status:'queued',error:null,result:null,finished:null,started:null,steps:0,activity:null,cwd:config.workdir,mode:config.mode,created:new Date().toISOString()});
              tasks=[t,...tasks.filter(x=>x!==t)];pump();
            }
            save();return json(res,200,{task:view(t)});
          }
          json(res,404,{error:'Not found'});
        }catch(e){json(res,e.code===400?400:500,{error:String(e?.message||e)})}
      });
      server.httpServer?.once('close',()=>{for(const p of procs.values())killTree(p)});
    }
  };
}
