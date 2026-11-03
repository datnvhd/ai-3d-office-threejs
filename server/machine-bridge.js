// Vite dev-server plugin: the "personal machine" side of the office. Reports this computer's info, runs a
// health check, and executes assigned tasks for real with Claude Code (`claude -p`) in a chosen working folder.
// Tasks never bypass Claude Code's permission system: 'default' (read & analyse) or 'acceptEdits' (edit files in the folder).
// Web tasks also get a real Chrome through Playwright MCP; saved site passwords reach the browser as Playwright
// "secrets" (the agent types the secret's name), so Claude never sees them.
import {spawn} from 'node:child_process';
import {existsSync,statSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,copyFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {createRequire} from 'node:module';
import os from 'node:os';
import {join,resolve,isAbsolute,dirname,basename} from 'node:path';
import {STORE_DIR,cleanEnv,run,findClaudeBinary,killTree,getSavedClaudeToken} from './claude-bridge.js';
import {findCodexBinary,codexAuth,codexExec,codexRun} from './codex-bridge.js';
import {ruleSteps,planPrompt,parsePlan,MODELS,LATEST,EFFORTS,modelId,modelLabel,pickModel} from '../workflow-plan.js';

const CONFIG_FILE=join(STORE_DIR,'machine.json'),TASKS_FILE=join(STORE_DIR,'tasks.json'),SITES_FILE=join(STORE_DIR,'sites.json'),RUNS_DIR=join(STORE_DIR,'runs'),UPLOADS_DIR=join(STORE_DIR,'uploads');
const MAX_PARALLEL=2,MAX_TURNS=30,WEB_TURNS=60,TASK_TIMEOUT=20*60*1000,KEEP=100;
// Files droppable on the task box: images and PDF are read by the agent from disk; text/Word are extracted and inlined
const FILE_KINDS={pdf:'pdf',png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',docx:'text',txt:'text',md:'text',csv:'text'};
const MAX_FILE=25*1024*1024,MAX_FILES=6,ATTACH_SUBDIR='.ai-office-files';

// Minimal reader for one entry of a .docx (a zip): find it in the central directory and inflate it
function readZipEntry(buf,name){
  let eocd=-1;for(let i=buf.length-22;i>=0;i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
  if(eocd<0)return null;
  let p=buf.readUInt32LE(eocd+16);const count=buf.readUInt16LE(eocd+10);
  for(let i=0;i<count&&buf.readUInt32LE(p)===0x02014b50;i++){
    const method=buf.readUInt16LE(p+10),compSize=buf.readUInt32LE(p+20),nameLen=buf.readUInt16LE(p+28),extraLen=buf.readUInt16LE(p+30),commLen=buf.readUInt16LE(p+32),lho=buf.readUInt32LE(p+42);
    if(buf.toString('utf8',p+46,p+46+nameLen)===name){
      const lNameLen=buf.readUInt16LE(lho+26),lExtra=buf.readUInt16LE(lho+28),start=lho+30+lNameLen+lExtra,data=buf.subarray(start,start+compSize);
      return method===0?data:method===8?inflateRawSync(data):null;
    }
    p+=46+nameLen+extraLen+commLen;
  }
  return null;
}
export function extractDocxText(buf){
  try{const xml=readZipEntry(buf,'word/document.xml');if(!xml)return null;
    return xml.toString('utf8').replace(/<w:tab[^>]*\/>/g,'\t').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#3[49];|&apos;/g,"'").replace(/\n{3,}/g,'\n\n').trim();
  }catch{return null}
}
// Plain text for a dropped file by kind: docx is unzipped, other text read directly (bounded)
function fileText(path,kind,ext){
  try{if(ext==='docx')return (extractDocxText(readFileSync(path))||'').slice(0,20000);
    if(kind==='text')return readFileSync(path,'utf8').slice(0,20000);
  }catch{}
  return null;
}
// Prompt section describing the task's attachments (inline text for docs, path to read for images/PDF)
export function attachPrompt(t){
  if(!t.files?.length)return '';
  const parts=t.files.map(f=>f.text!=null&&f.text.trim()
    ? `### Tệp đính kèm: ${f.name}\n\`\`\`\n${f.text.slice(0,6000)}\n\`\`\``
    : `### Tệp đính kèm: ${f.name} (${f.kind==='image'?'ảnh':f.kind==='pdf'?'tài liệu PDF':'tệp'})\nĐọc nội dung tệp này bằng công cụ đọc tệp. Đường dẫn: ${f.rel}`);
  return `\nTỆP ĐÍNH KÈM: Người dùng gửi kèm ${t.files.length} tệp cho yêu cầu này. Hãy sử dụng nội dung của chúng khi thực hiện.\n${parts.join('\n')}\n`;
}
const MCP_CLI=(()=>{try{return join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')),'cli.js')}catch{return null}})();
const BROWSERS=[['chrome',['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),'/Applications/Google Chrome.app','/usr/bin/google-chrome']],
  ['msedge',['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/Applications/Microsoft Edge.app']]];
const findBrowser=()=>BROWSERS.find(([,paths])=>paths.some(p=>existsSync(p)))?.[0]||null;
// Claude Code's answer when the account cannot use the requested model (retired, or not on this plan)
const MODEL_MISSING=/not_found_error|may not exist|not have access to (it|this model)|model[^\n]{0,60}(not found|not available|unavailable|does not exist)/i;
// `claude` flags for a task's model and reasoning effort (old records may hold a family alias, still valid for the CLI)
const modelArgs=t=>[...(t.model?['--model',modelId(t.model)||t.model]:[]),...(EFFORTS[t.effort]?['--effort',t.effort]:[])];
// Browser tools web tasks never need; run_code_unsafe would also run arbitrary code next to the secrets file
const WEB_TOOLS_OFF=['run_code_unsafe','network_requests','network_request','emulate_media','drag','drop','resize','console_messages'].map(n=>`mcp__browser__browser_${n}`);
const MODES={default:'Chỉ đọc & phân tích',acceptEdits:'Cho phép tạo/sửa file trong thư mục làm việc'};
const DEFAULT_WORKDIR=join(os.homedir(),'AI-Office-Workspace');
// Which CLI runs each agent's tasks; agents not listed use Claude Code
const ENGINES={claude:'Claude Code',codex:'Codex (ChatGPT)'};
const DEFAULT_AGENT_ENGINES={designer:'codex'};

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
  let bin=null,binChecked=false,version=null;
  let config={workdir:DEFAULT_WORKDIR,mode:'default',browserVisible:true,...readJson(CONFIG_FILE,{})};
  config.agentEngines={...DEFAULT_AGENT_ENGINES,...config.agentEngines};
  const engineOf=agent=>config.agentEngines[agent]==='codex'?'codex':'claude';
  let codexBin=null,codexChecked=false,codexVersion=null,codexAuthCache=null;
  let lastCheck=readJson(CONFIG_FILE,{}).lastCheck||null;
  // Tasks interrupted by a server restart cannot be resumed
  let tasks=readJson(TASKS_FILE,[]).map(t=>t.status==='running'||t.status==='queued'?{...t,status:'error',error:'Server đã khởi động lại khi việc đang chạy.',finished:t.finished||new Date().toISOString()}:t);
  let nextId=tasks.reduce((m,t)=>Math.max(m,t.id),0)+1;
  const procs=new Map();
  // Files uploaded but not yet attached to a task: id -> {path,name,kind,ext,at}. Dropped after an hour if unused.
  const uploads=new Map();
  function stageUpload(name,buf){
    const ext=(name.split('.').pop()||'').toLowerCase(),kind=FILE_KINDS[ext];
    if(!kind)throw Object.assign(new Error(`Định dạng không hỗ trợ: .${ext}`),{code:400});
    for(const [id,u] of uploads)if(Date.now()-u.at>36e5){rmSync(u.path,{force:true});uploads.delete(id)}
    mkdirSync(UPLOADS_DIR,{recursive:true});
    const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const safe=(name.replace(/[^\w.() -]+/g,'_').slice(0,120))||('tep.'+ext),path=join(UPLOADS_DIR,id+'__'+safe);
    writeFileSync(path,buf);uploads.set(id,{path,name:safe,kind,ext,at:Date.now()});
    return {id,name:safe,size:buf.length,kind};
  }
  // Move the picked uploads into the task's folder inside the working dir and read text where we can
  function consumeFiles(ids,rootId,cwd){
    const dir=join(cwd,ATTACH_SUBDIR,String(rootId)),out=[];
    for(const id of (Array.isArray(ids)?ids:[]).slice(0,MAX_FILES)){
      const u=uploads.get(id);if(!u||!existsSync(u.path))continue;
      mkdirSync(dir,{recursive:true});const dest=join(dir,u.name);
      try{copyFileSync(u.path,dest)}catch{continue}
      rmSync(u.path,{force:true});uploads.delete(id);
      out.push({name:u.name,kind:u.kind,rel:`${ATTACH_SUBDIR}/${rootId}/${u.name}`,abs:dest,text:fileText(dest,u.kind,u.ext)});
    }
    return out;
  }
  let saveTimer=null;
  // Persisted tasks keep only the attachment names, not the inlined file text, so tasks.json stays small
  const forDisk=t=>t.files?{...t,files:t.files.map(({name,kind,rel})=>({name,kind,rel}))}:t;
  const save=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>writeJson(TASKS_FILE,tasks.slice(0,KEEP).map(forDisk)),400)};
  const saveConfig=()=>writeJson(CONFIG_FILE,{workdir:config.workdir,mode:config.mode,browserVisible:config.browserVisible,agentEngines:config.agentEngines,lastCheck});

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
  // Only the token signed in through the app: the CLI's own (default) account is never used
  async function auth(){return getSavedClaudeToken()?'token':null}
  async function ensureCodex(){
    if(!codexChecked){codexBin=findCodexBinary();codexChecked=true;if(codexBin)codexVersion=(await codexRun(codexBin,['--version'])).stdout.trim()||null}
    return codexBin;
  }
  async function codexAuthKind(){
    if(codexAuthCache&&Date.now()-codexAuthCache.at<60000)return codexAuthCache.kind;
    const kind=await ensureCodex()?await codexAuth(codexBin):null;
    codexAuthCache={kind,at:Date.now()};return kind;
  }
  const usesCodex=()=>Object.values(config.agentEngines).includes('codex');
  const authEnv=()=>{const token=getSavedClaudeToken();return cleanEnv(token?{CLAUDE_CODE_OAUTH_TOKEN:token}:{})};

  function workdirState(dir=config.workdir){
    try{if(!existsSync(dir))return {exists:false,writable:false};if(!statSync(dir).isDirectory())return {exists:false,writable:false,error:'Không phải thư mục'};
      const probe=join(dir,`.ai-office-probe-${process.pid}`);writeFileSync(probe,'ok');rmSync(probe,{force:true});return {exists:true,writable:true}}
    catch(e){return {exists:existsSync(dir),writable:false,error:short(e.message,100)}}
  }

  // Spawns `claude -p` with the prompt on stdin and streams JSON events; returns the child and a completion promise
  function claude(args,{cwd,input,onEvent,timeout,env}){
    const child=spawn(bin,['-p','--output-format','stream-json','--verbose',...args],{cwd,env:{...authEnv(),...env},windowsHide:true,shell:/\.(cmd|bat)$/i.test(bin)});
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
    steps.push({name:'Xác thực',ok:!!a,detail:a?'Token dài hạn đã lưu':'Chưa đăng nhập Claude (bấm ô Claude Code trên thanh trên cùng)'});
    if(b&&a&&wd.writable){
      const s=Date.now(),{done}=claude(['--max-turns','1','--tools',''],{cwd:config.workdir,input:'Reply with exactly: OK',timeout:90000});
      const out=await done,ok=!!out.result&&!out.result.is_error;
      steps.push({name:'Chạy thử trên máy',ok,detail:ok?`Claude phản hồi sau ${((Date.now()-s)/1000).toFixed(1)}s: "${short(out.result.result,40)}"`:resultError(out.result,out)});
    }else steps.push({name:'Chạy thử trên máy',ok:false,detail:'Bỏ qua vì bước trước chưa đạt'});
    if(usesCodex()){
      codexAuthCache=null;
      const cb=await ensureCodex(),ca=cb?await codexAuthKind():null;
      steps.push({name:'Codex CLI',ok:!!cb,detail:cb?(codexVersion||cb):'Không tìm thấy trên máy'});
      steps.push({name:'Xác thực Codex',ok:!!ca,detail:ca==='chatgpt'?'Đăng nhập bằng tài khoản ChatGPT':ca==='apikey'?'Đăng nhập bằng API key':'Chưa đăng nhập'});
      if(cb&&ca&&wd.writable){
        const s=Date.now(),{done}=codexExec(cb,{cwd:config.workdir,input:'Reply with exactly: OK',extra:['--ephemeral'],timeout:120000});
        const out=await done,ok=!!out.message&&!out.error;
        steps.push({name:'Chạy thử Codex',ok,detail:ok?`Codex phản hồi sau ${((Date.now()-s)/1000).toFixed(1)}s: "${short(out.message,40)}"`:short(out.error||out.stderr||'Codex không phản hồi.',300)});
      }else steps.push({name:'Chạy thử Codex',ok:false,detail:'Bỏ qua vì bước trước chưa đạt'});
    }
    lastCheck={ok:steps.every(s=>s.ok),at:new Date().toISOString(),ms:Date.now()-t0,steps};saveConfig();
    return lastCheck;
  }

  // ---------- task runner ----------
  function prompt(t){
    return `Bạn là "${t.name}", AI agent đảm nhiệm vai trò "${t.role}" trong văn phòng AI của người dùng.
Bạn đang chạy trực tiếp trên máy cá nhân của người dùng, trong thư mục làm việc hiện tại (${t.cwd}).
Chế độ quyền: ${MODES[t.mode]}.${t.mode==='default'?' Không tạo hoặc sửa file; chỉ đọc, phân tích và trả lời.':' Chỉ tạo/sửa file bên trong thư mục làm việc.'}
Luôn trả lời bằng tiếng Việt. Khi xong, kết thúc bằng một phần "Kết quả:" tóm tắt ngắn gọn những gì đã làm hoặc tìm được.
${t.kind==='step'?stepContext(t):''}${attachPrompt(t)}${t.web?webPrompt(t):''}
Mức ưu tiên: ${t.priority}
Nhiệm vụ:
${t.text}`;
  }
  // A workflow step sees the user's original request and the results of the steps it waits for
  function stepContext(t){
    const prev=(t.deps||[]).map(id=>tasks.find(x=>x.id===id)).filter(Boolean);
    return `
LUỒNG CÔNG VIỆC: Đây là bước "${t.stepTitle}" trong luồng "${t.wfTitle}" do Director điều phối.
Yêu cầu gốc của người dùng: ${t.request}
${prev.length?`Kết quả các bước trước (dùng làm đầu vào cho bước này):
${prev.map(p=>`--- ${p.name} · ${p.stepTitle} ---\n${String(p.result||'').slice(0,3500)}`).join('\n')}
`:''}Chỉ làm phần việc của bước này; các bước khác do agent khác đảm nhận.
`;
  }
  // Sites given to a web task: the ones the user picked, otherwise those whose host appears in the request
  function sitesFor(t){
    if(t.siteIds?.length)return sites.filter(s=>t.siteIds.includes(s.id));
    const text=t.text.toLowerCase();return sites.filter(s=>{const h=hostOf(s.url);return h&&text.includes(h)});
  }
  function webPrompt(t){
    const list=sitesFor(t);
    return `
TRÌNH DUYỆT: Bạn có bộ công cụ trình duyệt (MCP server tên "browser": browser_navigate, browser_click, browser_type, browser_find, browser_snapshot…) điều khiển một cửa sổ Chrome thật trên máy người dùng (mở link, đăng nhập, bấm, điền form, chọn, đọc nội dung, chụp màn hình).
Được truy cập mọi trang web cần cho nhiệm vụ, không giới hạn trong thư mục làm việc.
TIẾT KIỆM TOKEN (bắt buộc): một trang đọc toàn bộ có thể dài hàng chục nghìn token và nằm lại trong ngữ cảnh ở mọi bước sau.
- Mở trang, bấm, gõ KHÔNG trả về nội dung trang. Khi cần đọc trang, dùng theo thứ tự ưu tiên: browser_find (tìm chữ hoặc regex, trả về đúng phần khớp kèm ref để bấm/gõ) → browser_snapshot có "target" (selector CSS như "form", "main", "table", "[role=dialog]" hoặc một ref) và/hoặc "depth" → browser_evaluate trả về đúng dữ liệu cần (text/JSON ngắn đã lọc). Chỉ gọi browser_snapshot cả trang khi các cách trên không đủ, và tối đa một lần cho mỗi trang.
- Điền nhiều ô một lần bằng browser_fill_form. Kiểm tra kết quả bằng browser_wait_for hoặc browser_find (ví dụ tìm thông báo thành công/lỗi) thay vì đọc lại cả trang.
- Không mở lại trang đang ở, không đọc lại phần đã đọc, không thử lại cùng một thao tác đã thất bại quá 2 lần.
- Chụp màn hình (browser_take_screenshot, KHÔNG truyền filename để ảnh tự lưu vào thư mục riêng của nhiệm vụ) chỉ ở kết quả quan trọng và lúc hoàn thành, để người dùng xem lại. Ảnh chỉ được lưu cho người dùng, bạn không nhìn thấy ảnh.
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
    // Token savers: no page snapshot or generated Playwright code after each action, console errors only,
    // screenshots saved to the run folder for the user but not sent back to the model
    const args=[MCP_CLI,'--browser',browser,'--isolated','--secrets',secrets,'--output-dir',dir,'--viewport-size','1366x860',
      '--snapshot-mode','none','--codegen','none','--image-responses','omit','--console-level','error','--no-webmcp',...(config.browserVisible?[]:['--headless'])];
    const mcp=join(dir,'mcp.json');writeFileSync(mcp,JSON.stringify({mcpServers:{browser:{command:process.execPath,args}}}));
    t.siteLabels=list.map(s=>s.label);t.browser=browser;
    // Only the built-in tools a web task needs, and none of the browser tools it never uses (their schemas cost tokens every turn)
    const tools=['Read','Glob','Grep','WebFetch',...(t.mode==='acceptEdits'?['Write','Edit']:[])];
    return {dir,secrets,mcpArgs:args,args:['--mcp-config',mcp,'--strict-mcp-config','--tools',tools.join(','),'--allowedTools','mcp__browser','WebFetch','--disallowedTools',...WEB_TOOLS_OFF]};
  }
  // Workflow steps wait for their dependencies; if one fails or is stopped, the steps after it stop too
  function depState(t){
    const deps=(t.deps||[]).map(id=>tasks.find(x=>x.id===id));
    const bad=deps.find(d=>!d||d.status==='error'||d.status==='cancelled');
    if(bad)return {blocked:bad};
    const waiting=deps.filter(d=>d.status!=='done');
    return {waiting};
  }
  function pump(){
    let changed=false;
    for(const t of [...tasks].reverse()){
      if(t.status!=='queued')continue;
      const {blocked,waiting}=depState(t);
      if(blocked){Object.assign(t,{status:'cancelled',blockedBy:blocked?.id??null,activity:null,error:`Dừng vì bước trước chưa xong: ${blocked?`${blocked.name} · ${blocked.stepTitle||''}`:'đã bị xóa'}.`,finished:new Date().toISOString()});changed=true;continue}
      if(waiting.length){const a=`Chờ ${waiting.map(d=>d.name).join(', ')} hoàn thành`;if(t.activity!==a){t.activity=a;changed=true}continue}
      if(procs.size>=MAX_PARALLEL)continue;
      start(t);
    }
    // a step stopped above may unblock nothing, but steps waiting on it must stop too
    if(changed){save();if(tasks.some(t=>t.status==='queued'&&depState(t).blocked))pump()}
  }
  function start(t){
    if(t.kind==='plan')return startPlan(t);
    t.engine=engineOf(t.agent);
    // Codex not signed in: keep the workflow moving with Claude Code and say so in the log
    if(t.engine==='codex'&&codexAuthCache&&!codexAuthCache.kind&&bin){t.engine='claude';t.fallback='Codex chưa đăng nhập nên bước này chạy bằng Claude Code.'}
    if(t.engine==='codex')return startCodex(t);
    const wd=workdirState(t.cwd);
    if(!bin||!getSavedClaudeToken()||!wd.writable){Object.assign(t,{status:'error',error:!bin?'Không tìm thấy Claude Code CLI trên máy.':!getSavedClaudeToken()?'Chưa đăng nhập tài khoản Claude trong ứng dụng.':`Thư mục làm việc không dùng được: ${t.cwd}`,finished:new Date().toISOString()});save();return}
    let web=null;
    if(t.web)try{web=webSetup(t)}catch(e){Object.assign(t,{status:'error',error:e.message,finished:new Date().toISOString()});save();return}
    Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Claude Code…',log:[]});
    // Step log for the progress popup: init, tool calls, their (shortened) output and Claude's own messages
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    if(t.fallback)note('denied',t.fallback,false);
    const outText=c=>Array.isArray(c)?c.map(x=>x.type==='text'?x.text:x.type==='image'?'[hình ảnh]':'').join(' '):String(c??'');
    const turns=String(t.web?WEB_TURNS:MAX_TURNS);
    // Browser tools loaded up front: saves the opening ToolSearch turn
    const {child,done}=claude(['--max-turns',turns,'--permission-mode',t.mode,...modelArgs(t),...(web?.args||[])],{cwd:t.cwd,input:prompt(t),timeout:TASK_TIMEOUT,env:web?{ENABLE_TOOL_SEARCH:'false'}:{},onEvent:ev=>{
      if(ev.type==='system'&&ev.subtype==='init'&&web){const b=(ev.mcp_servers||[]).find(s=>s.name==='browser');if(b&&b.status!=='connected')note('denied',`Trình duyệt chưa sẵn sàng (${b.status})`,false)}
      if(ev.type==='system'&&ev.subtype==='init')note('init',`Đã khởi động Claude Code · model ${ev.model||'?'}${t.effort?` · suy luận ${EFFORTS[t.effort].toLowerCase()}`:''}${t.modelWhy?` · ${t.modelWhy}`:''}`);
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
      // A pinned older version the account cannot use: run again once on the newest model of the same family
      const id=modelId(t.model),latest=LATEST[MODELS[id]?.family];
      if(!ok&&!cancelled&&latest&&latest!==id&&MODEL_MISSING.test(`${r?.result||''} ${out.stderr}`)){
        Object.assign(t,{status:'queued',model:latest,fallback:`${modelLabel(id)} không dùng được với tài khoản này, chạy lại bằng ${modelLabel(latest)}.`,activity:null});
        save();pump();return;
      }
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(r.result||'').slice(0,20000)):null,error:ok?null:redact(resultError(r,out,cancelled)),
        durationMs:r?.duration_ms??(Date.now()-Date.parse(t.started)),turns:r?.num_turns??null,costUsd:r?.total_cost_usd??null,activity:null});
      save();pump();
    });
  }
  // Director turns the request into workflow steps with one short Claude call (no tools);
  // if Claude is unavailable or its plan is unusable, the keyword planner takes over
  function startPlan(t){
    Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Director đang lập kế hoạch…',log:[]});
    const note=(kind,text)=>{t.log.push({at:Date.now(),kind,text:redact(text)});t.activity=short(text,120)};
    note('init','Director bắt đầu phân tích yêu cầu và chia việc cho các agent liên quan');
    let child=null;
    const run=bin&&getSavedClaudeToken()?claude(['--max-turns','1','--tools','',...modelArgs(t)],{cwd:t.cwd,input:planPrompt(t.text,t.owner,t.team)+attachPrompt(t),timeout:180000}):null;
    if(run){child=run.child;procs.set(t.id,child)}
    save();
    (run?run.done:Promise.resolve(null)).then(out=>{
      procs.delete(t.id);
      if(t.status==='cancelled'){Object.assign(t,{error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString(),activity:null});save();pump();return}
      const ai=out?.result&&!out.result.is_error?parsePlan(out.result.result,t.team):null;
      if(!ai)note('denied',out?'Không đọc được kế hoạch từ Claude, dùng bộ chia việc theo từ khóa.':'Claude Code chưa sẵn sàng, dùng bộ chia việc theo từ khóa.');
      const plan=ai||{title:'',steps:ruleSteps(t.text,t.owner,t.team)};
      t.wfTitle=plan.title||short(t.text,60);
      const ids={},who=id=>t.team.find(a=>a.id===id);
      for(const s of plan.steps){
        const a=who(s.agent),id=nextId++;ids[s.key]=id;
        tasks.unshift({id,kind:'step',wf:t.id,wfTitle:t.wfTitle,stepTitle:s.title,request:t.text,deps:s.after.map(k=>ids[k]).filter(Boolean),
          agent:s.agent,name:a.name,role:a.role,text:s.task,priority:t.priority,status:'queued',created:new Date().toISOString(),
          model:t.forcedModel||s.model,effort:t.forcedEffort||(t.forcedModel?null:s.effort),modelWhy:t.forcedModel||t.forcedEffort?'Chọn thủ công':s.why||'Director chọn',
          cwd:t.cwd,mode:t.mode,host:t.host,web:t.web,siteIds:t.siteIds,engine:engineOf(s.agent),files:t.files,fileNames:t.fileNames});
      }
      const name=id=>t.team.find(a=>a.id===id)?.name||id;
      t.result=`**Luồng công việc: ${t.wfTitle}** (${plan.steps.length} bước${ai?'':' · chia theo từ khóa'})\n\n${plan.steps.map((s,i)=>`${i+1}. **${name(s.agent)}** · ${s.title} · _${modelLabel(t.forcedModel||s.model)}${(t.forcedEffort||(!t.forcedModel&&s.effort))?`, suy luận ${EFFORTS[t.forcedEffort||s.effort].toLowerCase()}`:''}${!t.forcedModel&&!t.forcedEffort&&s.why?`: ${s.why}`:''}_${s.after.length?` _(sau bước ${s.after.map(k=>plan.steps.findIndex(x=>x.key===k)+1).join(', ')})_`:''}`).join('\n')}`;
      note('text',t.result);
      Object.assign(t,{status:'done',finished:new Date().toISOString(),durationMs:Date.now()-Date.parse(t.started),turns:out?.result?.num_turns??null,costUsd:out?.result?.total_cost_usd??null,activity:null});
      if(tasks.length>KEEP)tasks.length=KEEP;
      save();pump();
    });
  }
  // Same task flow as Claude, run by `codex exec`: read-only sandbox for 'default', workspace-write for 'acceptEdits'
  function startCodex(t){
    const wd=workdirState(t.cwd);
    if(!codexBin||!wd.writable){Object.assign(t,{status:'error',error:!codexBin?'Không tìm thấy Codex CLI trên máy.':`Thư mục làm việc không dùng được: ${t.cwd}`,finished:new Date().toISOString()});save();return}
    let web=null;
    if(t.web)try{web=webSetup(t)}catch(e){Object.assign(t,{status:'error',error:e.message,finished:new Date().toISOString()});save();return}
    Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Codex…',log:[]});
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    const toml=v=>JSON.stringify(v);// JSON strings/arrays are valid TOML values
    const extra=web?['-c',`mcp_servers.browser.command=${toml(process.execPath)}`,'-c',`mcp_servers.browser.args=${toml(web.mcpArgs)}`]:[];
    for(const f of t.files||[])if(f.kind==='image')extra.push('-i',f.abs);// attach images so Codex can see them
    let turns=0;
    const {child,done}=codexExec(codexBin,{cwd:t.cwd,input:prompt(t),sandbox:t.mode==='acceptEdits'?'workspace-write':'read-only',extra,timeout:TASK_TIMEOUT,onEvent:ev=>{
      const it=ev.item||{};
      if(ev.type==='thread.started')note('init','Đã khởi động Codex (ChatGPT)');
      else if(ev.type==='turn.started')turns++;
      else if(ev.type==='item.started'&&it.type==='command_execution'){t.steps++;note('tool',short(`Chạy lệnh: ${it.command}`,120))}
      else if(ev.type==='item.started'&&it.type==='mcp_tool_call'){t.steps++;note('tool',describeTool({name:`mcp__${it.server}__${it.tool}`,input:it.arguments||{}}))}
      else if(ev.type==='item.completed'){
        if(it.type==='agent_message'&&it.text?.trim())note('text',short(it.text,600));
        else if(it.type==='command_execution')note(it.exit_code?'denied':'out',short(it.aggregated_output||'(không có đầu ra)',300),false);
        else if(it.type==='mcp_tool_call')note(it.error?'denied':'out',short(it.error?.message||'Xong',300),false);
        else if(it.type==='file_change'){t.steps++;note('tool',short(`Sửa file: ${(it.changes||[]).map(c=>c.path).join(', ')}`,120))}
        else if(it.type==='web_search'){t.steps++;note('tool',short(`Tìm trên web: ${it.query||''}`,120))}
        else if(it.type==='error')note('denied',short(it.message,300),false);
      }
    }});
    procs.set(t.id,child);save();
    done.then(out=>{
      procs.delete(t.id);
      if(web)rmSync(web.secrets,{force:true});
      const cancelled=t.status==='cancelled',ok=!cancelled&&!out.timedOut&&!out.error&&out.code===0&&!!out.message;
      const err=cancelled?'Đã dừng theo yêu cầu.':out.timedOut?'Quá thời gian cho phép (20 phút).':/not logged in|401|unauthorized/i.test((out.error||'')+out.stderr)?'Codex chưa đăng nhập hoặc phiên ChatGPT đã hết hạn. Bấm ô "Codex" trên thanh trên cùng để đăng nhập lại.':short(out.error||out.stderr||'Codex dừng mà không trả kết quả.',600);
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(out.message).slice(0,20000)):null,error:ok?null:redact(err),
        durationMs:Date.now()-Date.parse(t.started),turns:turns||null,costUsd:null,activity:null});
      save();pump();
    });
  }
  function add(body){
    const text=String(body.text||'').trim();
    if(!text||text.length>8000)throw Object.assign(new Error('Nội dung nhiệm vụ trống hoặc quá dài (tối đa 8000 ký tự).'),{code:400});
    if(!/^[a-z0-9_-]{1,40}$/i.test(body.agent||''))throw Object.assign(new Error('Agent không hợp lệ.'),{code:400});
    const siteIds=Array.isArray(body.siteIds)?body.siteIds.filter(id=>sites.some(s=>s.id===id)).slice(0,10):[];
    const t={id:nextId++,agent:body.agent,name:short(body.name,60),role:short(body.role,80),text,priority:short(body.priority||'Bình thường',30),
      status:'queued',created:new Date().toISOString(),cwd:config.workdir,mode:config.mode,host:os.hostname(),web:!!body.web,siteIds,engine:engineOf(body.agent)};
    // Model and effort: what the user forced, otherwise picked from the request (workflow steps get theirs from the Director)
    const forced=modelId(body.model),forcedEffort=EFFORTS[body.effort]?body.effort:null,pick=pickModel(text);
    Object.assign(t,{model:forced||pick.model,effort:forcedEffort||(forced?null:pick.effort),modelWhy:forced||forcedEffort?'Chọn thủ công':'Tự chọn theo nội dung yêu cầu'});
    // Workflow: a Director planning task first; it creates the steps for the relevant agents when done
    const team=Array.isArray(body.team)?body.team.filter(a=>/^[a-z0-9_-]{1,40}$/i.test(a?.id||'')).slice(0,20).map(a=>({id:a.id,name:short(a.name,60),role:short(a.role,80)})):[];
    if(body.workflow&&team.length){
      const d=team.find(a=>a.id==='director')||team.find(a=>a.id===body.agent)||team[0];
      // Planning is one short JSON answer: Sonnet 5.5 at medium effort, unless the user forced a stronger model
      const strong=forced&&MODELS[forced].rank>MODELS[LATEST.sonnet].rank;
      Object.assign(t,{kind:'plan',wf:t.id,owner:body.agent,team,agent:d.id,name:d.name,role:d.role,stepTitle:'Lập kế hoạch & phân công',engine:'claude',
        forcedModel:forced,forcedEffort,model:strong?forced:LATEST.sonnet,effort:forcedEffort||'medium',modelWhy:strong?'Chọn thủ công':'Lập kế hoạch'});
    }
    // Dropped files (docx/pdf/images): move them into the task folder and remember them on the task
    const files=consumeFiles(body.files?.map(f=>f?.id),t.wf??t.id,t.cwd);
    if(files.length){t.files=files;t.fileNames=files.map(f=>f.name)}
    tasks.unshift(t);if(tasks.length>KEEP)tasks.length=KEEP;save();pump();return t;
  }

  async function status(){
    const b=await ensureBin(),a=b?await auth():null,wd=workdirState(),cpus=os.cpus();
    const cb=await ensureCodex(),ca=cb?await codexAuthKind():null;
    return {
      host:{name:os.hostname(),os:`${os.version?.()||os.type()} (${os.release()})`,arch:os.arch(),cpu:cpus[0]?.model?.trim()||'?',cores:cpus.length,
        ramTotal:os.totalmem(),ramFree:os.freemem(),uptime:os.uptime(),user:os.userInfo().username,node:process.version},
      claude:{found:!!b,path:b,version,auth:a},
      codex:{found:!!cb,path:cb,version:codexVersion,auth:ca,ready:!!(cb&&ca&&wd.writable)},
      engines:ENGINES,agentEngines:config.agentEngines,
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
  // Never send the attachments' absolute paths or extracted text to the browser; the names are enough
  const view=t=>({...t,files:undefined,log:(t.log||[]).slice(-8)});
  const full=t=>({...t,files:undefined});

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
            if(b.agent!==undefined){if(!/^[a-z0-9_-]{1,40}$/i.test(b.agent)||!ENGINES[b.engine])return json(res,400,{error:'Agent hoặc công cụ không hợp lệ.'});config.agentEngines[b.agent]=b.engine}
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
          if(one){const t=tasks.find(t=>t.id===+one[1]);return t?json(res,200,{task:full(t)}):json(res,404,{error:'Không tìm thấy nhiệm vụ.'})}
          // Upload one dropped file (raw body, name in the X-Filename header); returns an id to pass when creating a task
          if(req.method==='POST'&&path==='/upload'){
            const name=(()=>{try{return decodeURIComponent(req.headers['x-filename']||'')}catch{return String(req.headers['x-filename']||'')}})();
            if(!name)return json(res,400,{error:'Thiếu tên tệp.'});
            const buf=await new Promise((ok,bad)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>MAX_FILE){bad(Object.assign(new Error('Tệp quá lớn (tối đa 25MB).'),{code:400}));req.destroy()}else c.push(d)});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',bad)});
            return json(res,200,stageUpload(name,buf));
          }
          if(req.method==='POST'&&path==='/tasks'){await ensureBin();await ensureCodex();return json(res,200,{task:view(add(await readBody(req)))})}
          // Delete finished tasks. A workflow goes as a whole, and only once none of its steps is running or waiting
          // (its later steps need the earlier results).
          const active=t=>t.status==='running'||t.status==='queued';
          const busyWf=new Set(tasks.filter(active).map(t=>t.wf).filter(w=>w!=null));
          const drop=list=>{
            const ids=new Set(list.map(t=>t.id));
            for(const t of list){
              rmSync(join(RUNS_DIR,String(t.id)),{recursive:true,force:true});
              const root=t.wf??t.id;// attachments live under the root/plan id; remove once that task goes
              if(ids.has(root)&&t.cwd)rmSync(join(t.cwd,ATTACH_SUBDIR,String(root)),{recursive:true,force:true});
            }
            tasks=tasks.filter(t=>!ids.has(t.id));save();return ids.size;
          };
          if(req.method==='DELETE'&&path==='/tasks'){const n=drop(tasks.filter(t=>!active(t)&&!busyWf.has(t.wf)));return json(res,200,{removed:n,tasks:tasks.map(view)})}
          const delOne=req.method==='DELETE'&&path.match(/^\/tasks\/(\d+)$/);
          if(delOne){
            const t=tasks.find(t=>t.id===+delOne[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(t.wf!=null?busyWf.has(t.wf):active(t))return json(res,409,{error:'Việc vẫn đang chạy hoặc đang chờ. Hãy dừng trước khi xóa.'});
            const n=drop(t.wf!=null?tasks.filter(x=>x.wf===t.wf):[t]);return json(res,200,{removed:n,tasks:tasks.map(view)});
          }
          if(req.method==='POST'&&m){
            const t=tasks.find(t=>t.id===+m[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(m[2]==='cancel'){
              if(t.status==='queued')Object.assign(t,{status:'cancelled',error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});
              else if(t.status==='running'){t.status='cancelled';killTree(procs.get(t.id))}
            }else if(t.status==='error'||t.status==='cancelled'){
              // a planning task that already created its steps is not re-planned
              if(t.kind==='plan'&&tasks.some(x=>x.wf===t.id&&x.kind==='step'))return json(res,409,{error:'Kế hoạch đã được tạo; hãy thử lại từng bước trong luồng.'});
              Object.assign(t,{status:'queued',error:null,result:null,finished:null,started:null,steps:0,activity:null,cwd:config.workdir,mode:config.mode,created:new Date().toISOString(),blockedBy:null,fallback:null});
              // steps that stopped because of this one go back in the queue too
              if(t.wf)for(const x of tasks)if(x.wf===t.wf&&x.status==='cancelled'&&x.blockedBy)Object.assign(x,{status:'queued',error:null,finished:null,blockedBy:null});
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
