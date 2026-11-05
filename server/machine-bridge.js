// Vite dev-server plugin: the "personal machine" side of the office. Reports this computer's info, runs a
// health check, and executes assigned tasks for real with Claude Code (`claude -p`) in a chosen working folder.
// Tasks never bypass Claude Code's permission system: 'default' (read & analyse) or 'acceptEdits' (edit files in the folder).
// WebSearch and WebFetch are pre-approved (read-only lookups); in -p mode there is nobody to approve them otherwise.
// Web tasks also get a real Chrome through Playwright MCP; saved site passwords reach the browser as Playwright
// "secrets" (the agent types the secret's name), so Claude never sees them.
import {spawn} from 'node:child_process';
import {existsSync,statSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,copyFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {createRequire} from 'node:module';
import os from 'node:os';
import {join,resolve,isAbsolute,dirname,basename,relative,extname} from 'node:path';
import {STORE_DIR,NODE_ENV,cleanEnv,run,findClaudeBinary,killTree,getSavedClaudeToken} from './claude-bridge.js';
import {findCodexBinary,codexAuth,codexExec,codexRun} from './codex-bridge.js';
import {createSnapshots} from './snapshot.js';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ruleSteps,planPrompt,parsePlan,MODELS,LATEST,EFFORTS,modelId,modelLabel,pickModel,MAX_REWORK,reworkGuide,parseRework,LEVELS,teamOf,levelOf,MAX_CLARIFY,QUESTION_GUIDE,parseQuestion,parseLooseQuestion,parsePlanQuestion} from '../workflow-plan.js';
// What each level means for the agent doing the work
const LEVEL_NOTE={leader:'Bạn là Leader của đội: chịu trách nhiệm chất lượng chung, làm và duyệt kỹ, chỉ ra rủi ro.',senior:'Bạn là Senior: xử lý được việc khó, chủ động đề xuất giải pháp tốt.',middle:'Bạn là Middle: làm chắc chắn việc thông thường, hỏi lại khi yêu cầu chưa rõ.',junior:'Bạn là Junior: làm cẩn thận từng bước, nêu rõ chỗ chưa chắc chắn để người có kinh nghiệm xem lại.'};

const AGENTS_FILE=join(STORE_DIR,'agents.json');// the office's agent list (src.js); null = the 7 built-in agents
const CONFIG_FILE=join(STORE_DIR,'machine.json'),TASKS_FILE=join(STORE_DIR,'tasks.json'),SITES_FILE=join(STORE_DIR,'sites.json'),RUNS_DIR=join(STORE_DIR,'runs'),UPLOADS_DIR=join(STORE_DIR,'uploads');
const MAX_PARALLEL=2,MAX_TURNS=30,WEB_TURNS=60,TASK_TIMEOUT=20*60*1000,KEEP=200,URGENT_EXTRA=2,MAX_AGENTS=36;
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
// MCP server Claude Code asks for permission through (--permission-prompt-tool); the user answers in the page
const PERM_MCP=join(dirname(fileURLToPath(import.meta.url)),'permission-mcp.js');
const MCP_CLI=(()=>{try{return join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')),'cli.js')}catch{return null}})();
const BROWSERS=[['chrome',['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),'/Applications/Google Chrome.app','/opt/google/chrome/chrome']],
  ['msedge',['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/Applications/Microsoft Edge.app','/opt/microsoft/msedge/msedge']]];
// os.version() on Linux is the kernel build string ("#1 SMP …"): use the distribution's name instead
const osName=()=>{
  if(process.platform==='linux')try{const m=readFileSync('/etc/os-release','utf8').match(/^PRETTY_NAME="?([^"\n]+)/m);if(m)return m[1]}catch{}
  return os.version?.()||os.type();
};
const findBrowser=()=>BROWSERS.find(([,paths])=>paths.some(p=>existsSync(p)))?.[0]||null;
// Claude Code's answer when the account cannot use the requested model (retired, or not on this plan)
const MODEL_MISSING=/not_found_error|may not exist|not have access to (it|this model)|model[^\n]{0,60}(not found|not available|unavailable|does not exist)/i;
// `claude` flags for a task's model and reasoning effort (old records may hold a family alias, still valid for the CLI)
const modelArgs=t=>[...(t.model?['--model',modelId(t.model)||t.model]:[]),...(EFFORTS[t.effort]?['--effort',t.effort]:[])];
// Browser tools web tasks never need; run_code_unsafe would also run arbitrary code next to the secrets file
const WEB_TOOLS_OFF=['run_code_unsafe','network_requests','network_request','emulate_media','drag','drop','resize','console_messages'].map(n=>`mcp__browser__browser_${n}`);
const PREVIEW_TYPES={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm'};
// Toolkits for an IT team: shell commands an agent may run through Claude Code's Bash tool, switched on per team in the
// Máy cá nhân window. "write" kits (and writeCmds) only apply when the permission mode allows edits. browser = web tools on.
const TOOLKITS={
  files:{short:'Xem file',label:'Xem file & tìm kiếm (ls, cat, find, grep…)',cmds:['ls','dir','cat','head','tail','wc','find','grep','rg','tree']},
  git:{short:'Git/SVN',label:'Git & SVN: status, diff, log, blame (Git thêm add/commit khi được sửa file; không bao giờ push hay svn commit/update)',
    cmds:['git status','git diff','git log','git show','git branch','git blame','svn status','svn diff','svn log','svn info','svn blame','svn cat','svn list'],
    writeCmds:['git add','git commit','git checkout','git switch','git stash','git restore','svn add']},
  node:{short:'Node.js',label:'Node.js: npm, pnpm, yarn, npx, node, tsc, eslint, prettier',write:true,cmds:['npm','pnpm','yarn','npx','node','tsc','eslint','prettier']},
  python:{short:'Python',label:'Python: python, pip, pytest',write:true,cmds:['python','python3','py','pip','pytest']},
  test:{short:'Chạy test',label:'Chạy test tự động: npm test, vitest, jest, playwright test, pytest',write:true,cmds:['npm test','npm run test','npx vitest','npx jest','npx playwright test','pytest']},
  gh:{short:'GitHub CLI',label:'GitHub CLI: xem issue, PR, CI (bình luận/tạo issue khi được sửa file)',cmds:['gh issue view','gh issue list','gh pr view','gh pr list','gh pr diff','gh pr checks','gh run list','gh run view'],writeCmds:['gh issue create','gh issue comment','gh pr comment']},
  docs:{short:'Tài liệu & sơ đồ',label:'Tài liệu & sơ đồ: Mermaid CLI (mmdc), pandoc',write:true,cmds:['npx -y @mermaid-js/mermaid-cli','mmdc','pandoc']},
  browser:{short:'Trình duyệt',label:'Trình duyệt tự động (Playwright) bật sẵn cho mọi việc của đội',web:true}
};
const DEFAULT_TEAM_KITS={Frontend:['files','git','node','test','gh'],Backend:['files','git','node','python','test','gh'],QA:['files','git','test','browser'],BA:['files','docs'],
  Design:['files','browser'],Data:['files','python'],Research:['files'],'Ban điều hành':['files','git'],'*':['files']};
// never allowed, whatever the kits say
const DENY_CMDS=['git push','git reset --hard','git clean','rm -rf','npm publish','gh repo delete','gh release create',
  'svn commit','svn ci','svn update','svn up','svn switch','svn revert','svn delete','svn rm','svn import','svn merge','svn lock','svn unlock'];
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

// The agent's own checklist, shown live in the page: TodoWrite replaces the whole list; TaskCreate/TaskUpdate
// (newer Claude Code) add and update items one by one, the new item's number arriving in the tool result
function trackTodo(t,c){
  const i=c.input||{};
  if(c.name==='TodoWrite'&&Array.isArray(i.todos))t.todos=i.todos.slice(0,60).map(x=>({text:short(x.content||x.activeForm,200),active:short(x.activeForm||'',200),status:x.status||'pending'}));
  else if(c.name==='TaskCreate'&&i.subject)(t.todos||=[]).push({text:short(i.subject,200),active:short(i.activeForm||'',200),status:'pending',ref:c.id});
  else if(c.name==='TaskUpdate'&&i.taskId!=null){const x=(t.todos||[]).find(x=>x.tid===String(i.taskId));if(x){if(i.status)x.status=i.status;if(i.subject)x.text=short(i.subject,200);if(i.activeForm)x.active=short(i.activeForm,200)}}
}
// Print mode has no TodoWrite in recent Claude Code (and Codex has its own), so agents are asked to keep a markdown
// checklist in their messages; the latest one with 2+ items becomes the task's list. [x] done, [~] doing, [ ] to do.
const CHECK_RE=/^\s*(?:[-*]|\d+[.)])\s+\[( |x|X|~|-|\/)\]\s+(.+?)\s*$/;
function trackChecklist(t,text){
  const items=String(text||'').split('\n').map(l=>l.match(CHECK_RE)).filter(Boolean)
    .map(m=>({text:short(m[2].replace(/\*\*/g,''),200),status:/x/i.test(m[1])?'completed':m[1]===' '?'pending':'in_progress'}));
  if(items.length<2)return;
  if(!items.some(x=>x.status==='in_progress')){const next=items.find(x=>x.status==='pending');if(next&&items.some(x=>x.status==='completed'))next.status='in_progress'}
  t.todos=items.slice(0,60);
}
const CHECKLIST_GUIDE=`
DANH SÁCH VIỆC: nếu nhiệm vụ có từ 3 bước trở lên, ngay đầu tiên viết danh sách các bước dạng checklist markdown, mỗi dòng "- [ ] tên bước" (ngắn gọn). Mỗi khi xong một bước, viết lại cả danh sách: bước xong là "- [x]", bước đang làm là "- [~]". Người dùng theo dõi tiến độ qua danh sách này. Việc đơn giản thì không cần.
`;
// A web page asks for a login the task does not have (or the saved one failed): the agent ends with a login block,
// the page shows a username/password form, and the task carries on with the new account as a browser secret
const MAX_LOGINS=3;
const LOGIN_GUIDE=`ĐĂNG NHẬP: nếu trang đòi đăng nhập mà không có tài khoản phù hợp ở trên, hoặc đăng nhập bằng tài khoản đã lưu bị từ chối, ĐỪNG kết thúc bằng lời báo. Dừng lại và đặt ở CUỐI CÙNG đúng một khối:
\`\`\`login
{"url":"link trang cần đăng nhập","reason":"vì sao cần đăng nhập (ngắn)","error":"thông báo lỗi trên trang nếu vừa đăng nhập thất bại, không có thì để trống"}
\`\`\`
Hệ thống sẽ hỏi người dùng tên đăng nhập và mật khẩu rồi cho bạn làm tiếp (mở lại trang và đăng nhập). Không hỏi mật khẩu bằng lời, không đoán mật khẩu.`;
function parseLogin(text){
  const m=String(text||'').match(/```login\s*([\s\S]*?)```/i);if(!m)return null;
  let j={};try{j=JSON.parse(m[1])}catch{}
  return {url:String(j.url||'').trim().slice(0,500),reason:String(j.reason||'').trim().slice(0,300),error:String(j.error||'').trim().slice(0,300),clean:String(text).replace(m[0],'').trim()};
}
// The agent only said in words that the page needs a login
const LOGIN_WORDS=/login\.jsp|permissionViolation|(yêu cầu|cần|đòi|chuyển (sang|đến|tới|về)|bị chặn|phải|chưa)[^.\n]{0,40}(đăng nhập|login)|(đăng nhập|login)[^.\n]{0,30}(thất bại|không thành công|bị từ chối|sai)/i;
function trackTodoResult(t,c,text){
  const x=(t.todos||[]).find(x=>x.ref&&x.ref===c.tool_use_id);if(!x)return;
  const m=String(text||'').match(/#\s*(\d+)/)||String(text||'').match(/\b(\d+)\b/);if(m)x.tid=m[1];delete x.ref;
}

export function machineBridge(){
  let bin=null,binChecked=false,version=null;
  let port=5173;// the dev server's real port, set once it listens; web tasks open their files through it
  let config={workdir:DEFAULT_WORKDIR,mode:'default',browserVisible:true,...readJson(CONFIG_FILE,{})};
  config.agentEngines={...DEFAULT_AGENT_ENGINES,...config.agentEngines};
  const engineOf=agent=>config.agentEngines[agent]==='codex'?'codex':'claude';
  const kitsFor=team=>(config.teamKits||{})[team]??DEFAULT_TEAM_KITS[team]??DEFAULT_TEAM_KITS['*'];
  // Bash rules for a task from its team's kits; read-only mode keeps only the commands that just look
  function kitRules(t){
    const write=t.mode==='acceptEdits',cmds=[];
    for(const k of kitsFor(t.team||'')){const kit=TOOLKITS[k];if(!kit||kit.web||kit.write&&!write)continue;cmds.push(...kit.cmds,...(write?kit.writeCmds||[]:[]))}
    const list=[...new Set(cmds)];
    return {cmds:list,allow:list.map(c=>`Bash(${c}:*)`),deny:DENY_CMDS.map(c=>`Bash(${c}:*)`)};
  }
  let codexBin=null,codexChecked=false,codexVersion=null,codexAuthCache=null;
  let lastCheck=readJson(CONFIG_FILE,{}).lastCheck||null;
  // Tasks interrupted by a server restart cannot be resumed
  let tasks=readJson(TASKS_FILE,[]).map(t=>t.status!=='running'&&t.status!=='queued'?t:t.asking?{...t,status:'done',asking:false,activity:null,thread:t.thread.map((x,i,a)=>i===a.length-1&&!x.answer&&!x.error?{...x,error:'Server đã khởi động lại khi đang trả lời.'}:x)}:{...t,status:'error',error:'Server đã khởi động lại khi việc đang chạy.',finished:t.finished||new Date().toISOString()});
  let nextId=tasks.reduce((m,t)=>Math.max(m,t.id),0)+1;
  const procs=new Map();
  // ---------- before/after pictures of the working folder (diff + undo per task) ----------
  const snaps=createSnapshots(STORE_DIR),snapOf=new Map(),booting=new Set();
  // contents no kept task refers to any more are dropped once at start (in the background)
  setTimeout(()=>snaps.gc(tasks.flatMap(t=>(t.changes||[]).flatMap(c=>[c.b?.h,c.a?.h]).filter(Boolean))).catch(()=>{}),5000);
  // A run is over: fold what it changed into the task's change list
  async function finishSnap(t,note){
    const s=snapOf.get(t.id);if(!s)return;snapOf.delete(t.id);
    try{
      const add=await snaps.since(s);if(!add.length)return;
      t.changes=snaps.merge(t.changes,add);t.undone=null;
      note?.('out',`📝 ${add.length} file thay đổi trong lượt này${s.partial?' (thư mục quá lớn, một phần file không được lưu bản trước)':''}`,false);
    }catch(e){note?.('denied',`Không so sánh được thay đổi: ${e.message}`,false)}
  }

  // ---------- version control of a folder: Git or SVN (nearest .git/.svn going up), cached briefly ----------
  let svnBin;
  const findSvn=()=>{
    if(svnBin!==undefined)return svnBin;
    const dirs=(process.env.PATH||'').split(process.platform==='win32'?';':':'),exe=process.platform==='win32'?'svn.exe':'svn';
    svnBin=[...dirs.map(d=>join(d,exe)),'C:/Program Files/TortoiseSVN/bin/svn.exe','C:/Program Files/SlikSvn/bin/svn.exe','C:/Program Files/Subversion/bin/svn.exe'].find(p=>{try{return existsSync(p)}catch{return false}})||null;
    return svnBin;
  };
  const vcsCache=new Map();
  function vcsKind(dir){
    let d=resolve(dir);
    for(let i=0;i<40;i++){
      if(existsSync(join(d,'.git')))return {kind:'git',root:d};
      if(existsSync(join(d,'.svn')))return {kind:'svn',root:d};
      const up=dirname(d);if(up===d)break;d=up;
    }
    return {kind:null,root:null};
  }
  async function vcsInfo(dir){
    const hit=vcsCache.get(dir);if(hit&&Date.now()-hit.at<30000)return hit.v;
    const v={...vcsKind(dir)};
    try{
      if(v.kind==='git'){
        const g=args=>run('git',['-C',dir,...args],{timeout:8000}).then(r=>r.err?'':r.stdout.trim());
        [v.branch,v.remote,v.rev]=await Promise.all([g(['rev-parse','--abbrev-ref','HEAD']),g(['remote','get-url','origin']),g(['rev-parse','--short','HEAD'])]);
        v.dirty=(await g(['status','--porcelain','-uno'])).split('\n').filter(Boolean).length;
      }else if(v.kind==='svn'){
        v.cli=!!findSvn();
        if(v.cli){const r=await run(findSvn(),['info',dir],{timeout:10000});const f=k=>r.stdout.match(new RegExp(`^${k}: (.*)$`,'m'))?.[1]?.trim()||'';
          v.remote=f('URL');v.rev=f('Revision');v.repoRoot=f('Repository Root')}
      }
    }catch{}
    vcsCache.set(dir,{at:Date.now(),v});return v;
  }

  // ---------- folder picker: list sub-folders of a path (drives / home when none) ----------
  function listDirs(p){
    if(!p){
      const roots=process.platform==='win32'?'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l=>`${l}:\\`).filter(d=>{try{return existsSync(d)}catch{return false}}):['/'];
      const home=os.homedir(),quick=[home,join(home,'Desktop'),join(home,'Documents'),join(home,'source','repos')].filter(d=>existsSync(d));
      return {path:'',parent:null,dirs:[],roots,quick,recent:(config.recentDirs||[]).filter(d=>existsSync(d))};
    }
    const full=resolve(p);
    if(!existsSync(full)||!statSync(full).isDirectory())throw Object.assign(new Error(`Không mở được thư mục: ${full}`),{code:400});
    let ents=[];try{ents=readdirSync(full,{withFileTypes:true})}catch(e){throw Object.assign(new Error(`Không có quyền đọc thư mục: ${short(e.message,100)}`),{code:400})}
    const dirs=ents.filter(e=>e.isDirectory()&&!/^(\$|System Volume Information$|\.git$|\.svn$)/i.test(e.name)).map(e=>e.name).sort((a,b)=>a.localeCompare(b,'vi',{numeric:true})).slice(0,800)
      .map(name=>{const c=join(full,name);return {name,vcs:existsSync(join(c,'.git'))?'git':existsSync(join(c,'.svn'))?'svn':null}});
    const up=dirname(full);
    return {path:full,parent:up===full?'':up,dirs,vcs:vcsKind(full),writable:workdirState(full).writable};
  }

  // ---------- permission prompts: Claude Code asks through server/permission-mcp.js, the page answers ----------
  const permDecisions=new Map();// prompt id -> {decision,message}
  let permSeq=0;
  const editTools=new Set(['Edit','Write','MultiEdit','NotebookEdit']);
  // What "always allow in this task" covers: a Bash command by its first two words, all file edits, or the tool
  const permRule=(tool,input)=>tool==='Bash'||tool==='PowerShell'?`${tool}:${String(input?.command||'').trim().split(/\s+/).slice(0,2).join(' ')}`:editTools.has(tool)?'edit':tool;
  const permRuleLabel=(tool,input)=>tool==='Bash'||tool==='PowerShell'?`lệnh "${String(input?.command||'').trim().split(/\s+/).slice(0,2).join(' ')} …"`:editTools.has(tool)?'mọi thao tác sửa file':`công cụ ${tool}`;
  function permDetail(tool,input={}){
    if(tool==='Bash'||tool==='PowerShell')return String(input.command||'').slice(0,1500);
    if(tool==='Edit')return `${input.file_path||''}\n--- cũ\n${String(input.old_string||'').slice(0,700)}\n+++ mới\n${String(input.new_string||'').slice(0,700)}`;
    if(tool==='MultiEdit')return `${input.file_path||''} · ${(input.edits||[]).length} chỗ sửa`;
    if(tool==='Write')return `${input.file_path||''} (${String(input.content||'').length} ký tự)\n${String(input.content||'').slice(0,700)}`;
    return short(JSON.stringify(input),1200);
  }
  // A task's pending prompts are answered "no" when it ends or is stopped
  function dropPerms(t,why='Việc đã dừng.'){for(const p of t.perms||[])permDecisions.set(p.id,{decision:'deny',message:why});t.perms=[]}
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
  const saveConfig=()=>writeJson(CONFIG_FILE,{workdir:config.workdir,recentDirs:config.recentDirs,mode:config.mode,browserVisible:config.browserVisible,agentEngines:config.agentEngines,teamKits:config.teamKits,lastCheck});

  // ---------- saved web logins (passwords stay in this file and are never sent to the page or to Claude) ----------
  let sites=readJson(SITES_FILE,[]);
  // logins given for one task only (not "remember") stay in memory and never reach the file
  const saveSites=()=>{mkdirSync(STORE_DIR,{recursive:true});writeFileSync(SITES_FILE,JSON.stringify(sites.filter(s=>!s.temp),null,2),{mode:0o600})};
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
    // time spent waiting for the user (permission prompts) is added back with extend()
    let deadline=Date.now()+timeout;
    const done=new Promise(res=>{
      let buf='',stderr='',result=null,timedOut=false;
      const timer=setInterval(()=>{if(Date.now()>deadline){timedOut=true;clearInterval(timer);killTree(child)}},2000);
      child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let ev;try{ev=JSON.parse(line)}catch{continue}if(ev.type==='result')result=ev;onEvent?.(ev)}});
      child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000)});
      child.on('error',e=>{stderr+=e.message});
      child.on('close',code=>{clearInterval(timer);res({code,result,stderr:stderr.trim(),timedOut})});
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
    return {child,done,extend:ms=>{deadline+=ms}};
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
${t.team?`Đội: ${t.team} · cấp bậc: ${LEVELS[levelOf(t)]}. ${LEVEL_NOTE[levelOf(t)]}
`:''}${t.desc?`Mô tả công việc và cách làm việc người dùng đặt cho bạn (luôn tuân theo):
${t.desc}
`:''}Bạn đang chạy trực tiếp trên máy cá nhân của người dùng, trong thư mục làm việc hiện tại (${t.cwd}).
Chế độ quyền: ${MODES[t.mode]}.${t.mode==='default'?' Không tạo hoặc sửa file; chỉ đọc, phân tích và trả lời.':' Chỉ tạo/sửa file bên trong thư mục làm việc.'}
${(k=>k.cmds.length?`Lệnh dòng lệnh được phép dùng (qua Bash): ${k.cmds.join(', ')}. Lệnh khác cần người dùng bấm cho phép và có thể bị từ chối (khi bị từ chối thì tìm cách khác hoặc giải thích, không thử lại cùng lệnh); không bao giờ push code hay svn commit/update.
`:'')(kitRules(t))}Luôn trả lời bằng tiếng Việt. Khi xong, kết thúc bằng một phần "Kết quả:" tóm tắt ngắn gọn những gì đã làm hoặc tìm được.
${t.kind==='step'?stepContext(t):''}${CHECKLIST_GUIDE}${attachPrompt(t)}${t.web?webPrompt(t):''}${(t.clarifies||0)<MAX_CLARIFY?QUESTION_GUIDE:''}
Không tạo file .md (báo cáo, tóm tắt, ghi chú, kế hoạch) trừ khi người dùng yêu cầu rõ; viết nội dung đó trong câu trả lời. File .md mới không được yêu cầu sẽ bị xóa khi xong việc.
Mức ưu tiên: ${t.priority}
Nhiệm vụ:
${t.text}`;
  }
  // ---------- leftover .md files ----------
  // A task's new .md files (reports, notes, plans the agent wrote on its own) are removed when it ends, unless the
  // request asked for a markdown/README/document file. Files that existed before the run are never touched.
  const MD_SKIP=new Set(['node_modules','dist','build','vendor','venv','.venv','__pycache__','coverage']);
  function listMd(dir,depth=0,out=[]){
    if(!dir||depth>4||out.length>3000)return out;let ents;try{ents=readdirSync(dir,{withFileTypes:true})}catch{return out}
    for(const e of ents){if(e.isDirectory()){if(!MD_SKIP.has(e.name)&&!e.name.startsWith('.'))listMd(join(dir,e.name),depth+1,out)}else if(/\.md$/i.test(e.name))out.push(join(dir,e.name))}
    return out;
  }
  const wantsMd=t=>/\.md\b|markdown|readme|changelog|ghi (ra|vào) file|lưu (ra |thành |vào )?file|xuất (ra )?file|tạo (một |1 )?file/i.test([t.text,t.request,...(t.thread||[]).map(x=>x.q),...(t.clarify||[]).map(x=>x.answer)].join(' '));
  function cleanMd(t,before,note){
    if(!before||wantsMd(t))return;const gone=[];
    for(const f of listMd(t.cwd))if(!before.has(f)){try{rmSync(f,{force:true});gone.push(relative(t.cwd,f))}catch{}}
    if(gone.length){t.cleaned=[...(t.cleaned||[]),...gone];note('out',`🧹 Đã xóa ${gone.length} file .md tạm không được yêu cầu: ${gone.join(', ')}`,false)}
  }
  // Follow-up question on a finished task. A resumed session already has the context; without one, recap it.
  function askPrompt(t,ask,resumed){
    const q=`Người dùng hỏi thêm về nhiệm vụ này. Trả lời dựa trên ngữ cảnh đã có; chỉ làm thêm việc khi câu hỏi cần, không làm lại từ đầu. Giữ nguyên vai trò, chế độ quyền và trả lời bằng tiếng Việt.
${QUESTION_GUIDE}
Câu hỏi thêm:
${ask.q}`;
    if(resumed)return q;
    const prev=t.thread.slice(0,-1).filter(x=>x.answer);
    return `${prompt(t)}

--- BẠN ĐÃ HOÀN THÀNH NHIỆM VỤ TRÊN ---
Kết quả bạn đã trả lời:
${String(t.result||'').slice(0,6000)}
${prev.map(x=>`
Người dùng hỏi thêm: ${x.q}
Bạn trả lời: ${String(x.answer).slice(0,3000)}`).join('\n')}

${q}`;
  }
  // The user answered the agent's question: a resumed session only needs the answer; otherwise the whole exchange is recapped
  function replyPrompt(t,resumed){
    const c=t.clarify.at(-1),more=(t.clarifies||0)<MAX_CLARIFY?'':' Không hỏi thêm nữa; nếu vẫn còn thiếu thì tự giả định hợp lý và ghi rõ giả định.';
    if(resumed)return `Người dùng trả lời câu hỏi "${c.q}" của bạn: ${c.answer}
Tiếp tục làm nhiệm vụ với thông tin này.${more}${t.web?`\n${accountsText(t)}`:''}`;
    return `${prompt(t)}

TRAO ĐỔI TRƯỚC ĐÓ VỚI NGƯỜI DÙNG:
${t.clarify.map(x=>`Bạn hỏi: ${x.q}
Người dùng trả lời: ${x.answer}`).join('\n')}

Tiếp tục làm nhiệm vụ với các thông tin trên.${more}`;
  }
  // A finished run that ends with a question block: the task waits for the user's answer (up to MAX_CLARIFY times)
  function checkQuestion(t){
    if(t.web&&checkLogin(t))return true;
    const loose=!parseQuestion(t.result)&&parseLooseQuestion(t.result);
    const q=parseQuestion(t.result)||(loose&&{...loose,clean:t.result});if(!q)return false;
    if((t.clarifies||0)>=MAX_CLARIFY){t.result=`${q.clean}\n\n_(Agent muốn hỏi thêm: ${q.question}, nhưng đã hết lượt hỏi.)_`;return false}
    Object.assign(t,{status:'waiting',result:q.clean||null,question:{q:q.question,options:q.options,at:new Date().toISOString()},activity:'Chờ bạn trả lời câu hỏi',finished:null});
    return true;
  }
  // Web task that stopped at a login page: wait for the user's username/password (login block, or said in words)
  function checkLogin(t){
    if((t.logins||0)>=MAX_LOGINS)return false;
    let l=parseLogin(t.result);
    if(!l&&LOGIN_WORDS.test(t.result||'')){
      const url=(String(t.result).match(/https?:\/\/[^\s)`'"<>\]]+/)||String(t.text+' '+(t.request||'')).match(/https?:\/\/[^\s)`'"<>\]]+/)||[])[0]||'';
      const host=hostOf(url);
      // a saved login for that site that was not tried yet would have been in the prompt; only ask when none fits
      if(host&&!sitesFor(t).some(s=>hostOf(s.url)===host))l={url,reason:'Trang yêu cầu đăng nhập',error:'',clean:t.result};
    }
    if(!l)return false;
    const url=l.url||(String(t.text+' '+(t.request||'')).match(/https?:\/\/[^\s)`'"<>\]]+/)||[])[0]||'',host=hostOf(url);
    if(!host)return false;
    const known=sitesFor(t).find(s=>hostOf(s.url)===host);
    Object.assign(t,{status:'waiting',result:l.clean||null,activity:'Chờ bạn nhập tài khoản đăng nhập',finished:null,
      question:{kind:'login',q:`Cần tài khoản đăng nhập ${host}${l.reason?`: ${l.reason}`:''}`,url,host,error:l.error||'',username:known?.username||'',options:[],at:new Date().toISOString()}});
    return true;
  }
  // A task that cannot start: a follow-up keeps the task done and puts the error on the question
  function fail(t,msg){
    const now=new Date().toISOString();snapOf.delete(t.id);
    if(t.asking){Object.assign(t.thread.at(-1),{error:msg,finished:now});Object.assign(t,{status:'done',asking:false,activity:null})}
    else Object.assign(t,{status:'error',error:msg,finished:now});
    save();
  }
  // Ends a follow-up run: answer or error on the question, the task back to done, cost and turns added up
  function endAsk(t,ask,{answer,error,cost,turns,question}){
    // the answer may end with a question for the user: kept apart so the page shows it with its choices
    let qn=question||null;
    if(answer&&!qn){const p=parseQuestion(answer)||parseLooseQuestion(answer);if(p){qn={q:p.question,options:p.options};if(p.clean!=null)answer=p.clean||p.question}}
    Object.assign(ask,{question:qn,answer:answer?redact(String(answer).slice(0,20000)):null,error:answer?null:redact(error),finished:new Date().toISOString(),costUsd:cost??null});
    Object.assign(t,{status:'done',asking:false,activity:null,costUsd:cost!=null?(t.costUsd||0)+cost:t.costUsd,turns:turns?(t.turns||0)+turns:t.turns});
    save();pump();
  }
  // ---------- send back for rework ----------
  // Plan steps keep their id; a rework copy points to the plan step it redoes with `origin`. Steps are numbered
  // #1, #2… in plan order, which is what agents use to say where their send-back goes.
  const originOf=x=>x.origin??x.id;
  const planSteps=wf=>tasks.filter(x=>x.wf===wf&&x.kind==='step'&&x.origin==null).sort((a,b)=>a.id-b.id);
  const newest=(wf,o)=>tasks.filter(x=>x.wf===wf&&x.kind==='step'&&originOf(x)===o).sort((a,b)=>b.id-a.id)[0];
  const planDepsOf=x=>(x.planDeps??x.deps??[]).map(d=>{const y=tasks.find(z=>z.id===d);return y?originOf(y):d});
  // Plan steps that a plan step builds on, directly or through others
  function ancestors(wf,o){
    const plan=planSteps(wf),seen=new Set();
    const walk=id=>{const x=plan.find(p=>p.id===id);for(const d of x?planDepsOf(x):[])if(!seen.has(d)){seen.add(d);walk(d)}};
    walk(o);return seen;
  }
  const sentBack=(wf,o)=>tasks.filter(x=>x.wf===wf&&x.rework&&originOf(x)===o).length;
  function backTo(t){
    if(t.wf==null)return '';
    const plan=planSteps(t.wf),anc=ancestors(t.wf,originOf(t)),prev=plan.filter(p=>anc.has(p.id));
    return prev.length?reworkGuide(prev.map(p=>({no:plan.indexOf(p)+1,name:p.name,title:p.stepTitle})),MAX_REWORK-sentBack(t.wf,originOf(t))):'';
  }
  // A finished step that sent work back: fix steps for the targets and the steps between them and this one,
  // then this step again; later steps wait for the newest versions. Over the limit, the workflow stops here.
  function checkRework(t){
    const rw=parseRework(t.result);if(!rw)return;
    t.result=rw.clean;
    const o=originOf(t),plan=planSteps(t.wf),anc=ancestors(t.wf,o),no=id=>plan.findIndex(p=>p.id===id)+1;
    const targets=rw.to.map(n=>plan[n-1]?.id).filter(id=>id!=null&&anc.has(id));
    if(!targets.length){t.result+='\n\n_(Yêu cầu trả lại bị bỏ qua vì không trỏ tới bước trước hợp lệ.)_';return}
    const used=sentBack(t.wf,o);
    t.rework={to:targets.map(id=>`#${no(id)} ${plan[no(id)-1].name}`),reason:rw.reason};
    if(used>=MAX_REWORK){Object.assign(t,{status:'error',error:`Vẫn chưa đạt sau ${MAX_REWORK} lần trả lại sửa: ${rw.reason}`});return}
    const redo=plan.filter(p=>anc.has(p.id)&&(targets.includes(p.id)||[...ancestors(t.wf,p.id)].some(a=>targets.includes(a))));
    const made={},now=new Date().toISOString();
    const depsFor=x=>planDepsOf(x).map(d=>made[d]??newest(t.wf,d)?.id).filter(Boolean);
    const copy=(src,over)=>({id:nextId++,kind:'step',wf:src.wf,wfTitle:src.wfTitle,request:src.request,agent:src.agent,name:src.name,role:src.role,desc:src.desc,team:src.team,level:src.level,priority:src.priority,
      model:src.model,effort:src.effort,modelWhy:src.modelWhy,cwd:src.cwd,mode:src.mode,host:src.host,web:src.web,siteIds:src.siteIds,files:src.files,fileNames:src.fileNames,
      status:'queued',created:now,...over});
    for(const p of redo){// plan order, so a step's own fixes are made before the steps that use them
      const prev=newest(t.wf,p.id),target=targets.includes(p.id),deps=[t.id,...depsFor(p)];
      const why=target?`Bước #${no(o)} ${t.name} · ${t.stepTitle} đã TRẢ LẠI phần việc của bạn để sửa.
Lý do: ${rw.reason}
(Đánh giá đầy đủ nằm trong "Kết quả các bước trước".) Hãy sửa cho đạt và nêu rõ đã sửa những gì.`
        :`Các bước trước phần việc của bạn đã được sửa lại theo yêu cầu của ${t.name}: ${rw.reason}
Cập nhật phần việc của bạn cho khớp với kết quả mới và nêu rõ đã thay đổi gì.`;
      const t2=copy(prev,{urgent:true,origin:p.id,stepTitle:`${p.stepTitle} · sửa lại`,deps,engine:prev.engine,resumeSession:prev.session||null,resumeThread:prev.codexThread||null,
        text:`${why}

Việc gốc của bạn: ${p.text}${prev.session||prev.codexThread?'':`

Kết quả lần trước của bạn:
${String(prev.result||'').slice(0,3000)}`}`});
      made[p.id]=t2.id;tasks.unshift(t2);
    }
    const base=plan.find(p=>p.id===o)||t,round=used+2;
    const again=copy(t,{urgent:true,origin:o,stepTitle:`${base.stepTitle} · vòng ${round}`,deps:depsFor(base),engine:t.engine,resumeSession:t.session||null,resumeThread:t.codexThread||null,
      text:`${base.text}

ĐÂY LÀ LẦN KIỂM TRA LẠI (vòng ${round}): lần trước bạn đã trả lại để sửa vì: ${rw.reason}
Các bước đã sửa xong (xem "Kết quả các bước trước"). Kiểm tra lại toàn bộ, đặc biệt các điểm đã báo.`});
    tasks.unshift(again);
    // steps already waiting (e.g. a deploy after QA) now wait for the newest version of each step they depend on
    const fresh=new Set([...Object.values(made),again.id]);
    for(const x of tasks)if(x.wf===t.wf&&x.kind==='step'&&x.status==='queued'&&!fresh.has(x.id))
      x.deps=(x.deps||[]).map(d=>{const y=tasks.find(z=>z.id===d);return y?newest(t.wf,originOf(y)).id:d});
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
${backTo(t)}`;
  }
  // Sites given to a web task: the ones the user picked, otherwise those whose host appears in the request
  function sitesFor(t){
    if(t.siteIds?.length)return sites.filter(s=>t.siteIds.includes(s.id));
    const text=t.text.toLowerCase();return sites.filter(s=>{const h=hostOf(s.url);return h&&text.includes(h)});
  }
  // Saved logins for a web task, as the agent sees them: name, link, username and the secret's name for the password
  function accountsText(t){
    const list=sitesFor(t);
    return list.length?`Tài khoản đăng nhập đã lưu (dùng khi trang yêu cầu đăng nhập):
${list.map((s,i)=>`- ${s.label} · ${s.url} · tên đăng nhập: ${s.username||'(không có)'} · mật khẩu: gõ CHÍNH XÁC chuỗi SITE_${i+1}_PASSWORD vào ô mật khẩu (bằng browser_type hoặc browser_fill_form). Hệ thống tự thay bằng mật khẩu thật; bạn không biết và không cần biết mật khẩu.`).join('\n')}
Không bao giờ in, lưu ra file hay gửi đi mật khẩu.
${LOGIN_GUIDE}`:`Chưa có tài khoản đăng nhập nào cho nhiệm vụ này.
${LOGIN_GUIDE}`;
  }
  function webPrompt(t){
    return `
TRÌNH DUYỆT: Bạn có bộ công cụ trình duyệt (MCP server tên "browser": browser_navigate, browser_click, browser_type, browser_find, browser_snapshot…) điều khiển một cửa sổ Chrome thật trên máy người dùng (mở link, đăng nhập, bấm, điền form, chọn, đọc nội dung, chụp màn hình).
Được truy cập mọi trang web cần cho nhiệm vụ, không giới hạn trong thư mục làm việc.
TIẾT KIỆM TOKEN (bắt buộc): một trang đọc toàn bộ có thể dài hàng chục nghìn token và nằm lại trong ngữ cảnh ở mọi bước sau.
- Mở trang, bấm, gõ KHÔNG trả về nội dung trang. Khi cần đọc trang, dùng theo thứ tự ưu tiên: browser_find (tìm chữ hoặc regex, trả về đúng phần khớp kèm ref để bấm/gõ) → browser_snapshot có "target" (selector CSS như "form", "main", "table", "[role=dialog]" hoặc một ref) và/hoặc "depth" → browser_evaluate trả về đúng dữ liệu cần (text/JSON ngắn đã lọc). Chỉ gọi browser_snapshot cả trang khi các cách trên không đủ, và tối đa một lần cho mỗi trang.
- Điền nhiều ô một lần bằng browser_fill_form. Kiểm tra kết quả bằng browser_wait_for hoặc browser_find (ví dụ tìm thông báo thành công/lỗi) thay vì đọc lại cả trang.
- Không mở lại trang đang ở, không đọc lại phần đã đọc, không thử lại cùng một thao tác đã thất bại quá 2 lần.
- Chụp màn hình (browser_take_screenshot, KHÔNG truyền filename để ảnh tự lưu vào thư mục riêng của nhiệm vụ) chỉ ở kết quả quan trọng và lúc hoàn thành, để người dùng xem lại. Ảnh chỉ được lưu cho người dùng, bạn không nhìn thấy ảnh.
${accountsText(t)}
XEM FILE TRÊN MÁY: trình duyệt chặn link file:// . Để mở một file trong thư mục làm việc (ví dụ trang HTML bạn vừa tạo), dùng http://localhost:${port}/api/machine/preview/${t.id}/<đường dẫn tương đối trong thư mục làm việc>, ví dụ http://localhost:${port}/api/machine/preview/${t.id}/ten-du-an/index.html (CSS, JS, ảnh đi kèm tải được bình thường).
Khi xong việc trên web, đóng trình duyệt bằng browser_close.
`;
  }
  // Per-task Playwright MCP config + secrets file (deleted when the task ends); screenshots land in the run folder
  function webSetup(t,kit={allow:[],deny:[]},extraServers={}){
    if(!MCP_CLI)throw new Error('Chưa cài Playwright MCP (@playwright/mcp). Chạy npm install trong thư mục dự án.');
    const browser=findBrowser();if(!browser)throw new Error('Không tìm thấy Chrome hoặc Edge trên máy để agent dùng.');
    const dir=join(RUNS_DIR,String(t.id));if(!t.asking)rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
    const secrets=join(dir,'secrets.env'),list=sitesFor(t);
    writeFileSync(secrets,list.map((s,i)=>`SITE_${i+1}_PASSWORD=${quoteEnv(s.password||'')}`).join('\n')+'\n',{mode:0o600});
    // Token savers: no page snapshot or generated Playwright code after each action, console errors only,
    // screenshots saved to the run folder for the user but not sent back to the model
    const args=[MCP_CLI,'--browser',browser,'--isolated','--secrets',secrets,'--output-dir',dir,'--viewport-size','1366x860',
      '--snapshot-mode','none','--codegen','none','--image-responses','omit','--console-level','error','--no-webmcp',...(config.browserVisible?[]:['--headless'])];
    const mcp=join(dir,'mcp.json');writeFileSync(mcp,JSON.stringify({mcpServers:{browser:{command:process.execPath,args,env:NODE_ENV},...extraServers}}));
    t.siteLabels=list.map(s=>s.label);t.browser=browser;
    // Only the built-in tools a web task needs, and none of the browser tools it never uses (their schemas cost tokens every turn)
    const tools=['Read','Glob','Grep','WebFetch','WebSearch',...(t.mode==='acceptEdits'?['Write','Edit']:[]),...(kit.allow.length?['Bash']:[])];
    return {dir,secrets,mcpArgs:args,args:['--mcp-config',mcp,'--strict-mcp-config','--tools',tools.join(','),'--allowedTools','mcp__browser','WebFetch','WebSearch',...kit.allow,'--disallowedTools',...WEB_TOOLS_OFF,...kit.deny]};
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
    // oldest first, but fixes for sent-back work and their re-checks go first and may use extra slots, so they start right away
    const order=[...tasks].reverse().sort((a,b)=>(b.urgent?1:0)-(a.urgent?1:0));
    for(const t of order){
      if(t.status!=='queued')continue;
      const {blocked,waiting}=depState(t);
      if(blocked){Object.assign(t,{status:'cancelled',blockedBy:blocked?.id??null,activity:null,error:`Dừng vì bước trước chưa xong: ${blocked?`${blocked.name} · ${blocked.stepTitle||''}`:'đã bị xóa'}.`,finished:new Date().toISOString()});changed=true;continue}
      if(waiting.length){const a=`Chờ ${waiting.map(d=>d.name).join(', ')} hoàn thành`;if(t.activity!==a){t.activity=a;changed=true}continue}
      if(procs.size+booting.size>=MAX_PARALLEL+(t.urgent?URGENT_EXTRA:0))continue;
      launch(t);
    }
    // a step stopped above may unblock nothing, but steps waiting on it must stop too
    if(changed){save();if(tasks.some(t=>t.status==='queued'&&depState(t).blocked))pump()}
  }
  // Takes a picture of the working folder first (for the diff and undo), then runs the task
  async function launch(t){
    if(t.kind==='plan')return start(t);
    booting.add(t.id);
    Object.assign(t,{status:'running',activity:'Đang ghi lại trạng thái thư mục trước khi chạy…'});save();
    try{if(t.cwd&&existsSync(t.cwd))snapOf.set(t.id,await snaps.scan(t.cwd,(i,n)=>{t.activity=`Đang ghi lại trạng thái thư mục trước khi chạy… ${i}/${n} file`}))}
    catch(e){(t.log||=[]).push({at:Date.now(),kind:'denied',text:`Không ghi lại được trạng thái thư mục (${short(e.message,120)}); việc này sẽ không có diff/hoàn tác.`})}
    booting.delete(t.id);
    if(t.status==='cancelled'){
      snapOf.delete(t.id);
      if(t.asking){t.status='queued';endAsk(t,t.thread.at(-1),{error:'Đã dừng theo yêu cầu.'})}
      else Object.assign(t,{error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString(),activity:null});
      save();pump();return;
    }
    t.status='queued';start(t);
  }
  function start(t){
    if(t.kind==='plan')return startPlan(t);
    if(!t.asking)t.engine=engineOf(t.agent);// a follow-up stays with the engine that holds the conversation
    // Codex not signed in: keep the workflow moving with Claude Code and say so in the log
    if(t.engine==='codex'&&codexAuthCache&&!codexAuthCache.kind&&bin){t.engine='claude';t.fallback='Codex chưa đăng nhập nên bước này chạy bằng Claude Code.'}
    if(t.engine==='codex')return startCodex(t);
    const wd=workdirState(t.cwd);
    if(!bin||!getSavedClaudeToken()||!wd.writable)return fail(t,!bin?'Không tìm thấy Claude Code CLI trên máy.':!getSavedClaudeToken()?'Chưa đăng nhập tài khoản Claude trong ứng dụng.':`Thư mục làm việc không dùng được: ${t.cwd}`);
    let web=null;const kit=kitRules(t),mdBefore=new Set(listMd(t.cwd));
    // Anything outside the allowed rules is asked in the page through this task's permission MCP server
    t.permToken=randomBytes(16).toString('hex');t.perms=[];
    const perm={command:process.execPath,args:[PERM_MCP],env:{...NODE_ENV,AI_OFFICE_PORT:String(port),AI_OFFICE_TASK:String(t.id),AI_OFFICE_TOKEN:t.permToken}};
    if(t.web)try{web=webSetup(t,kit,{perm})}catch(e){return fail(t,e.message)}
    let permArgs=['--permission-prompt-tool','mcp__perm__approve'];
    if(!web){const dir=join(RUNS_DIR,String(t.id)),f=join(dir,'perm-mcp.json');mkdirSync(dir,{recursive:true});writeFileSync(f,JSON.stringify({mcpServers:{perm}}));permArgs=['--mcp-config',f,...permArgs]}
    const ask=t.asking?t.thread.at(-1):null,resume=!!(ask&&t.session),reply=!ask&&!!t.reply,replyResume=reply&&!!t.session;
    if(ask){Object.assign(t,{status:'running',activity:'Đang trả lời câu hỏi thêm…',log:t.log||[]});ask.started=new Date().toISOString()}
    else if(reply)Object.assign(t,{status:'running',activity:'Đang tiếp tục với câu trả lời của bạn…',log:t.log||[]});
    else Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Claude Code…',log:[]});
    // Step log for the progress popup: init, tool calls, their (shortened) output and Claude's own messages
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    if(t.fallback&&!ask)note('denied',t.fallback,false);
    if(ask)note('ask',`Hỏi thêm: ${short(ask.q,300)}${resume?'':' (gửi kèm tóm tắt ngữ cảnh)'}`,false);
    if(reply)note('ask',`Bạn trả lời: ${short(t.clarify.at(-1).answer,300)}`,false);
    const outText=c=>Array.isArray(c)?c.map(x=>x.type==='text'?x.text:x.type==='image'?'[hình ảnh]':'').join(' '):String(c??'');
    const turns=String(t.web?WEB_TURNS:MAX_TURNS);
    // Claude's AskUserQuestion tool has no one to answer it in `claude -p`, so the run would carry on guessing.
    // Stop the run there instead and let the task wait for the user's answer, like the question block does.
    let toolQ=null;const said=[];const canAsk=ask||(t.clarifies||0)<MAX_CLARIFY;
    // Browser tools loaded up front: saves the opening ToolSearch turn
    const {child,done,extend}=claude([...(resume||replyResume?['--resume',t.session]:!ask&&t.resumeSession?['--resume',t.resumeSession]:[]),'--max-turns',turns,'--permission-mode',t.mode,...modelArgs(t),...permArgs,...(web?.args||['--allowedTools','WebSearch','WebFetch',...kit.allow,'--disallowedTools',...kit.deny])],{cwd:t.cwd,input:ask?askPrompt(t,ask,resume):reply?replyPrompt(t,replyResume):prompt(t),timeout:TASK_TIMEOUT,env:{MCP_TOOL_TIMEOUT:'86400000',...(web?{ENABLE_TOOL_SEARCH:'false'}:{})},onEvent:ev=>{if(ev.session_id)t.session=ev.session_id;
      if(ev.type==='system'&&ev.subtype==='init'&&web){const b=(ev.mcp_servers||[]).find(s=>s.name==='browser');if(b&&b.status!=='connected')note('denied',`Trình duyệt chưa sẵn sàng (${b.status})`,false)}
      if(ev.type==='system'&&ev.subtype==='init')note('init',`Đã khởi động Claude Code · model ${ev.model||'?'}${t.effort?` · suy luận ${EFFORTS[t.effort].toLowerCase()}`:''}${t.modelWhy?` · ${t.modelWhy}`:''}`);
      if(ev.type==='assistant')for(const c of ev.message?.content||[]){
        if(c.type==='tool_use'&&c.name==='AskUserQuestion'&&canAsk&&!toolQ){
          const qs=(c.input?.questions||[]).filter(x=>x?.question);if(!qs.length)continue;
          toolQ={q:short(qs.map(x=>x.question).join('\n'),500),options:qs.length===1?(qs[0].options||[]).map(o=>String(o?.label??o).trim().slice(0,160)).filter(Boolean).slice(0,6):[]};
          note('text',`❓ ${toolQ.q}`);killTree(child);
        }
        else if(c.type==='tool_use'){t.steps++;note('tool',describeTool(c));trackTodo(t,c)}
        else if(c.type==='text'&&c.text?.trim()){said.push(c.text.trim());trackChecklist(t,c.text);note('text',short(c.text,600))}
      }
      if(ev.type==='user')for(const c of ev.message?.content||[])if(c.type==='tool_result'){const o=outText(c.content);trackTodoResult(t,c,o);note(c.is_error?'denied':'out',short(o||'(không có đầu ra)',300),false)}
    }});
    child.extend=extend;procs.set(t.id,child);save();
    done.then(async out=>{
      procs.delete(t.id);dropPerms(t);
      if(web)rmSync(web.secrets,{force:true});
      cleanMd(t,mdBefore,note);
      await finishSnap(t,note);
      const r=out.result,cancelled=t.status==='cancelled',ok=!cancelled&&r&&!r.is_error&&r.subtype==='success';
      if(toolQ&&!cancelled){
        const text=redact(said.join('\n\n').slice(0,20000));
        if(ask)return endAsk(t,ask,{answer:text||'Mình cần thêm thông tin trước khi trả lời.',question:toolQ,cost:r?.total_cost_usd,turns:r?.num_turns});
        t.reply=null;
        Object.assign(t,{status:'waiting',result:text||null,question:{...toolQ,at:new Date().toISOString()},activity:'Chờ bạn trả lời câu hỏi',finished:null,
          durationMs:Date.now()-Date.parse(t.started),costUsd:r?.total_cost_usd??t.costUsd??null});
        save();pump();return;
      }
      // A pinned older version the account cannot use: run again once on the newest model of the same family
      const id=modelId(t.model),latest=LATEST[MODELS[id]?.family];
      if(!ok&&!cancelled&&latest&&latest!==id&&MODEL_MISSING.test(`${r?.result||''} ${out.stderr}`)){
        Object.assign(t,{status:'queued',model:latest,fallback:`${modelLabel(id)} không dùng được với tài khoản này, chạy lại bằng ${modelLabel(latest)}.`,activity:null});
        save();pump();return;
      }
      if(ask){
        // the saved session is gone (e.g. Claude data cleared): ask again once with a recap instead
        if(!ok&&!cancelled&&resume&&/no conversation found|session/i.test(`${r?.result||''} ${out.stderr}`)){t.session=null;t.status='queued';note('denied','Không mở lại được phiên cũ, hỏi lại kèm tóm tắt ngữ cảnh.',false);save();pump();return}
        return endAsk(t,ask,{answer:ok&&r.result,error:resultError(r,out,cancelled),cost:r?.total_cost_usd,turns:r?.num_turns});
      }
      if(!ok&&!cancelled&&t.resumeSession&&/no conversation found/i.test(`${r?.result||''} ${out.stderr}`)){t.resumeSession=null;t.status='queued';save();pump();return}
      // the saved session cannot be continued (gone, or cut off at a question): carry on once with the exchange recapped
      if(!ok&&!cancelled&&!out.timedOut&&replyResume&&r?.subtype!=='error_max_turns'&&r?.api_error_status!==401){note('denied','Không mở lại được phiên cũ, tiếp tục kèm tóm tắt trao đổi.',false);t.session=null;t.status='queued';save();pump();return}
      t.reply=null;
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(r.result||'').slice(0,20000)):null,error:ok?null:redact(resultError(r,out,cancelled)),
        durationMs:r?.duration_ms??(Date.now()-Date.parse(t.started)),turns:r?.num_turns??null,costUsd:r?.total_cost_usd??null,activity:null});
      if(ok&&!checkQuestion(t)&&t.kind==='step')checkRework(t);
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
      const pq=out?.result&&!out.result.is_error&&(t.clarifies||0)<MAX_CLARIFY?parsePlanQuestion(out.result.result):null;
      if(pq){note('text',`❓ ${pq.question}`);Object.assign(t,{status:'waiting',question:{q:pq.question,options:pq.options,at:new Date().toISOString()},activity:'Chờ bạn trả lời câu hỏi',
        turns:out.result.num_turns??null,costUsd:out.result.total_cost_usd??null});save();pump();return}
      const ai=out?.result&&!out.result.is_error?parsePlan(out.result.result,t.team):null;
      if(!ai)note('denied',out?'Không đọc được kế hoạch từ Claude, dùng bộ chia việc theo từ khóa.':'Claude Code chưa sẵn sàng, dùng bộ chia việc theo từ khóa.');
      const plan=ai||{title:'',steps:ruleSteps(t.text,t.owner,t.team)};
      t.wfTitle=plan.title||short(t.text,60);
      const ids={},who=id=>t.team.find(a=>a.id===id);
      for(const s of plan.steps){
        const a=who(s.agent),id=nextId++;ids[s.key]=id;
        tasks.unshift({id,kind:'step',wf:t.id,wfTitle:t.wfTitle,stepTitle:s.title,request:t.text,deps:s.after.map(k=>ids[k]).filter(Boolean),planDeps:s.after.map(k=>ids[k]).filter(Boolean),
          agent:s.agent,name:a.name,role:a.role,desc:a.desc,team:a.team,level:a.level,text:s.task,priority:t.priority,status:'queued',created:new Date().toISOString(),
          model:t.forcedModel||s.model,effort:t.forcedEffort||(t.forcedModel?null:s.effort),modelWhy:t.forcedModel||t.forcedEffort?'Chọn thủ công':s.why||'Director chọn',
          cwd:t.cwd,mode:t.mode,host:t.host,web:t.web||kitsFor(a.team||'').includes('browser'),siteIds:t.siteIds,engine:engineOf(s.agent),files:t.files,fileNames:t.fileNames});
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
    if(!codexBin||!wd.writable)return fail(t,!codexBin?'Không tìm thấy Codex CLI trên máy.':`Thư mục làm việc không dùng được: ${t.cwd}`);
    let web=null;
    if(t.web)try{web=webSetup(t)}catch(e){return fail(t,e.message)}
    const mdBefore=new Set(listMd(t.cwd));
    const ask=t.asking?t.thread.at(-1):null,resume=!!(ask&&t.codexThread),reply=!ask&&!!t.reply,replyResume=reply&&!!t.codexThread;
    if(ask){Object.assign(t,{status:'running',activity:'Đang trả lời câu hỏi thêm…',log:t.log||[]});ask.started=new Date().toISOString()}
    else if(reply)Object.assign(t,{status:'running',activity:'Đang tiếp tục với câu trả lời của bạn…',log:t.log||[]});
    else Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Codex…',log:[]});
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    const toml=v=>JSON.stringify(v);// JSON strings/arrays are valid TOML values
    // `codex exec` never asks, so MCP calls need pre-approval; the same risky browser tools as for Claude are switched off
    const extra=web?['-c',`mcp_servers.browser.command=${toml(process.execPath)}`,'-c',`mcp_servers.browser.args=${toml(web.mcpArgs)}`,
      '-c','mcp_servers.browser.default_tools_approval_mode=approve','-c',`mcp_servers.browser.disabled_tools=${toml(WEB_TOOLS_OFF.map(n=>n.replace('mcp__browser__','')))}`]:[];
    if(ask)note('ask',`Hỏi thêm: ${short(ask.q,300)}${resume?'':' (gửi kèm tóm tắt ngữ cảnh)'}`,false);
    if(reply)note('ask',`Bạn trả lời: ${short(t.clarify.at(-1).answer,300)}`,false);
    else for(const f of t.files||[])if(f.kind==='image')extra.push('-i',f.abs);// attach images so Codex can see them
    let turns=0;
    const {child,done}=codexExec(codexBin,{cwd:t.cwd,input:ask?askPrompt(t,ask,resume):reply?replyPrompt(t,replyResume):prompt(t),resume:resume||replyResume?t.codexThread:(!ask&&t.resumeThread)||null,sandbox:t.mode==='acceptEdits'?'workspace-write':'read-only',extra,timeout:TASK_TIMEOUT,onEvent:ev=>{
      const it=ev.item||{};
      if(it.type==='todo_list'&&Array.isArray(it.items))t.todos=it.items.slice(0,60).map(x=>({text:short(x.text,200),status:x.completed?'completed':'pending'}));
      if(ev.type==='thread.started'){if(ev.thread_id)t.codexThread=ev.thread_id;note('init','Đã khởi động Codex (ChatGPT)')}
      else if(ev.type==='turn.started')turns++;
      else if(ev.type==='item.started'&&it.type==='command_execution'){t.steps++;note('tool',short(`Chạy lệnh: ${it.command}`,120))}
      else if(ev.type==='item.started'&&it.type==='mcp_tool_call'){t.steps++;note('tool',describeTool({name:`mcp__${it.server}__${it.tool}`,input:it.arguments||{}}))}
      else if(ev.type==='item.completed'){
        if(it.type==='agent_message'&&it.text?.trim()){trackChecklist(t,it.text);note('text',short(it.text,600))}
        else if(it.type==='command_execution')note(it.exit_code?'denied':'out',short(it.aggregated_output||'(không có đầu ra)',300),false);
        else if(it.type==='mcp_tool_call')note(it.error?'denied':'out',short(it.error?.message||'Xong',300),false);
        else if(it.type==='file_change'){t.steps++;note('tool',short(`Sửa file: ${(it.changes||[]).map(c=>c.path).join(', ')}`,120))}
        else if(it.type==='web_search'){t.steps++;note('tool',short(`Tìm trên web: ${it.query||''}`,120))}
        else if(it.type==='error')note('denied',short(it.message,300),false);
      }
    }});
    procs.set(t.id,child);save();
    done.then(async out=>{
      procs.delete(t.id);
      if(web)rmSync(web.secrets,{force:true});
      cleanMd(t,mdBefore,note);
      await finishSnap(t,note);
      const cancelled=t.status==='cancelled',ok=!cancelled&&!out.timedOut&&!out.error&&out.code===0&&!!out.message;
      const err=cancelled?'Đã dừng theo yêu cầu.':out.timedOut?'Quá thời gian cho phép (20 phút).':/not logged in|401|unauthorized/i.test((out.error||'')+out.stderr)?'Codex chưa đăng nhập hoặc phiên ChatGPT đã hết hạn. Bấm ô "Codex" trên thanh trên cùng để đăng nhập lại.':short(out.error||out.stderr||'Codex dừng mà không trả kết quả.',600);
      if(ask)return endAsk(t,ask,{answer:ok&&out.message,error:err,turns});
      t.reply=null;
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(out.message).slice(0,20000)):null,error:ok?null:redact(err),
        durationMs:Date.now()-Date.parse(t.started),turns:turns||null,costUsd:null,activity:null});
      if(ok&&!checkQuestion(t)&&t.kind==='step')checkRework(t);
      save();pump();
    });
  }
  function add(body){
    const text=String(body.text||'').trim();
    if(!text||text.length>8000)throw Object.assign(new Error('Nội dung nhiệm vụ trống hoặc quá dài (tối đa 8000 ký tự).'),{code:400});
    if(!/^[a-z0-9_-]{1,40}$/i.test(body.agent||''))throw Object.assign(new Error('Agent không hợp lệ.'),{code:400});
    const siteIds=Array.isArray(body.siteIds)?body.siteIds.filter(id=>sites.some(s=>s.id===id)).slice(0,10):[];
    const t={id:nextId++,agent:body.agent,name:short(body.name,60),role:short(body.role,80),desc:String(body.desc||'').slice(0,2000),team:short(body.agentTeam||'',40),level:LEVELS[body.level]?body.level:undefined,text,priority:short(body.priority||'Bình thường',30),
      status:'queued',created:new Date().toISOString(),cwd:config.workdir,mode:config.mode,host:os.hostname(),web:!!body.web||kitsFor(short(body.agentTeam||'',40)).includes('browser'),siteIds,engine:engineOf(body.agent)};
    // Model and effort: what the user forced, otherwise picked from the request (workflow steps get theirs from the Director)
    const forced=modelId(body.model),forcedEffort=EFFORTS[body.effort]?body.effort:null,pick=pickModel(text);
    Object.assign(t,{model:forced||pick.model,effort:forcedEffort||(forced?null:pick.effort),modelWhy:forced||forcedEffort?'Chọn thủ công':'Tự chọn theo nội dung yêu cầu'});
    // Workflow: a Director planning task first; it creates the steps for the relevant agents when done
    const team=Array.isArray(body.team)?body.team.filter(a=>/^[a-z0-9_-]{1,40}$/i.test(a?.id||'')).slice(0,20).map(a=>({id:a.id,name:short(a.name,60),role:short(a.role,80),desc:String(a.desc||'').slice(0,2000),team:short(teamOf(a),40),level:levelOf(a)})):[];
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
    {const v=vcsCache.get(t.cwd)?.v||vcsKind(t.cwd);t.vcs={kind:v.kind,branch:v.branch||null,rev:v.rev||null}}
    tasks.unshift(t);if(tasks.length>KEEP)tasks.length=KEEP;save();pump();return t;
  }

  async function status(){
    const b=await ensureBin(),a=b?await auth():null,wd=workdirState(),cpus=os.cpus();
    const cb=await ensureCodex(),ca=cb?await codexAuthKind():null;
    return {
      host:{name:os.hostname(),os:`${osName()} (${os.release()})`,arch:os.arch(),cpu:cpus[0]?.model?.trim()||'?',cores:cpus.length,
        ramTotal:os.totalmem(),ramFree:os.freemem(),uptime:os.uptime(),user:os.userInfo().username,node:process.version},
      claude:{found:!!b,path:b,version,auth:a},
      codex:{found:!!cb,path:cb,version:codexVersion,auth:ca,ready:!!(cb&&ca&&wd.writable)},
      engines:ENGINES,agentEngines:config.agentEngines,
      config:{workdir:config.workdir,mode:config.mode,modes:MODES,defaultWorkdir:DEFAULT_WORKDIR,browserVisible:config.browserVisible,
        toolkits:Object.fromEntries(Object.entries(TOOLKITS).map(([k,v])=>[k,{short:v.short,label:v.label,write:!!v.write}])),teamKits:config.teamKits||{},defaultKits:DEFAULT_TEAM_KITS},
      browser:{mcp:!!MCP_CLI,channel:findBrowser(),sites:sites.filter(s=>!s.temp).map(siteView)},
      workdir:wd,lastCheck,vcs:wd.exists?await vcsInfo(config.workdir):{kind:null},recentDirs:(config.recentDirs||[]).filter(d=>existsSync(d)),
      running:tasks.filter(t=>t.status==='running').length,queued:tasks.filter(t=>t.status==='queued').length,
      ready:!!(b&&a&&wd.writable)
    };
  }

  const json=(res,code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
  const readBody=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>4e4)req.destroy()});req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
  const isLocal=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
  // Never send the attachments' absolute paths or extracted text to the browser; the names are enough
  // the permission token and rules stay on the server; the list view sends only how many files changed
  const view=t=>({...t,files:undefined,log:(t.log||[]).slice(-8),thread:undefined,asks:t.thread?.length||0,permToken:undefined,permAlways:undefined,changes:undefined,changesN:t.changes?.length||0});
  const full=t=>({...t,files:undefined,permToken:undefined,permAlways:undefined});
  const permCaller=(req,t)=>t?.permToken&&req.headers['x-perm-token']===t.permToken;

  const plugin={
    name:'machine-bridge',
    configureServer(server){
      server.httpServer?.on('listening',()=>{const a=server.httpServer.address();if(a?.port)port=a.port});
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
              config.workdir=full;config.recentDirs=[full,...(config.recentDirs||[]).filter(d=>d.toLowerCase()!==full.toLowerCase())].slice(0,8);
            }
            if(b.mode!==undefined){if(!MODES[b.mode])return json(res,400,{error:'Chế độ quyền không hợp lệ.'});config.mode=b.mode}
            if(b.browserVisible!==undefined)config.browserVisible=!!b.browserVisible;
            if(b.teamKits&&typeof b.teamKits==='object')for(const [team,list] of Object.entries(b.teamKits).slice(0,40))
              if(team.length<=40&&Array.isArray(list))(config.teamKits??={})[team]=list.filter(k=>TOOLKITS[k]);
            if(b.agent!==undefined){if(!/^[a-z0-9_-]{1,40}$/i.test(b.agent)||!ENGINES[b.engine])return json(res,400,{error:'Agent hoặc công cụ không hợp lệ.'});config.agentEngines[b.agent]=b.engine}
            saveConfig();return json(res,200,await status());
          }
          if(req.method==='GET'&&path==='/tasks')return json(res,200,{tasks:tasks.map(view)});
          // folder picker: sub-folders of ?path= (drives, home and recent folders when empty)
          if(req.method==='GET'&&path==='/fs'){const p=new URL(req.url,'http://x').searchParams.get('path')||'';return json(res,200,listDirs(p))}

          // ---- permission prompts. From the task's MCP server (token header): ask, then poll for the answer ----
          const permAsk=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/perm$/);
          if(permAsk){
            const t=tasks.find(t=>t.id===+permAsk[1]);if(!permCaller(req,t))return json(res,403,{error:'Sai mã xác thực.'});
            const b=await readBody(req),tool=short(b.tool,80),input=b.input&&typeof b.input==='object'?b.input:{},rule=permRule(tool,input);
            if((t.permAlways||[]).includes(rule))return json(res,200,{decision:'allow'});
            if(t.status!=='running')return json(res,200,{decision:'deny',message:'Việc đã dừng.'});
            const p={id:'p'+(++permSeq),tool,desc:describeTool({name:tool,input}),detail:redact(permDetail(tool,input)),ruleLabel:permRuleLabel(tool,input),rule,at:Date.now()};
            (t.perms||=[]).push(p);t.activity=`🔐 Chờ bạn cho phép: ${p.desc}`;
            (t.log||=[]).push({at:Date.now(),kind:'ask',text:`🔐 Xin phép: ${p.desc}`});save();
            return json(res,200,{id:p.id});
          }
          const permPoll=req.method==='GET'&&path.match(/^\/tasks\/(\d+)\/perm\/(p\d+)$/);
          if(permPoll){
            const t=tasks.find(t=>t.id===+permPoll[1]);if(!permCaller(req,t))return json(res,403,{error:'Sai mã xác thực.'});
            const d=permDecisions.get(permPoll[2]);if(d){permDecisions.delete(permPoll[2]);return json(res,200,d)}
            return (t.perms||[]).some(p=>p.id===permPoll[2])?json(res,200,{id:permPoll[2]}):json(res,200,{decision:'deny',message:'Yêu cầu đã hết hạn.'});
          }
          // From the page: allow / always allow in this task / deny
          const permAns=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/perm\/(p\d+)\/answer$/);
          if(permAns){
            const t=tasks.find(t=>t.id===+permAns[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            const p=(t.perms||[]).find(p=>p.id===permAns[2]);if(!p)return json(res,409,{error:'Yêu cầu này đã được trả lời hoặc đã hết hạn.'});
            const b=await readBody(req),allow=!!b.allow;
            t.perms=t.perms.filter(x=>x!==p);
            if(allow&&b.always&&!(t.permAlways||=[]).includes(p.rule))t.permAlways.push(p.rule);
            permDecisions.set(p.id,allow?{decision:'allow'}:{decision:'deny',message:`Người dùng không cho phép${b.message?': '+short(b.message,300):'.'}`});
            // auto-answer other waiting prompts the new rule now covers
            if(allow&&b.always)for(const x of [...t.perms])if(x.rule===p.rule){permDecisions.set(x.id,{decision:'allow'});t.perms=t.perms.filter(y=>y!==x)}
            procs.get(t.id)?.extend?.(Date.now()-p.at);// waiting for the user does not count against the time limit
            t.log.push({at:Date.now(),kind:allow?'out':'denied',text:allow?`✓ Bạn cho phép${b.always?` (luôn cho phép ${p.ruleLabel} trong việc này)`:''}: ${p.desc}`:`⛔ Bạn từ chối: ${p.desc}`});
            t.activity=t.perms.length?`🔐 Chờ bạn cho phép: ${t.perms[0].desc}`:'Đang tiếp tục…';save();
            return json(res,200,{task:full(t)});
          }

          // ---- what a task changed: line diff, and putting the files back ----
          const diffM=req.method==='GET'&&path.match(/^\/tasks\/(\d+)\/diff$/);
          if(diffM){
            const t=tasks.find(t=>t.id===+diffM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            return json(res,200,{files:await snaps.diff(t.changes||[]),undone:t.undone||null,cwd:t.cwd});
          }
          const undoM=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/undo$/);
          if(undoM){
            const t=tasks.find(t=>t.id===+undoM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(t.status==='running'||t.status==='queued'||booting.has(t.id))return json(res,409,{error:'Việc đang chạy. Hãy dừng việc trước khi hoàn tác.'});
            if(!t.changes?.length)return json(res,409,{error:'Việc này không thay đổi file nào.'});
            if(t.undone)return json(res,409,{error:'Việc này đã được hoàn tác.'});
            const r=await snaps.undo(t.cwd,t.changes);
            t.undone={at:new Date().toISOString(),restored:r.restored.length,skipped:r.skipped};
            (t.log||=[]).push({at:Date.now(),kind:'out',text:`↩ Đã hoàn tác ${r.restored.length} file${r.skipped.length?`, bỏ qua ${r.skipped.length} file`:''}`});
            save();return json(res,200,{task:full(t),...r});
          }
          // agent list of the office: built-in ones by id (with the user's name/role/description), custom ones in full
          if(req.method==='GET'&&path==='/agents')return json(res,200,{agents:readJson(AGENTS_FILE,null)});
          if(req.method==='POST'&&path==='/agents'){
            const list=(await readBody(req)).agents;
            if(!Array.isArray(list)||list.length>MAX_AGENTS)return json(res,400,{error:`Danh sách agent không hợp lệ (tối đa ${MAX_AGENTS}).`});
            const seen=new Set(),out=[];
            for(const a of list){
              const id=String(a?.id||''),name=String(a?.name||'').trim().slice(0,40);
              if(!/^[a-z0-9_-]{1,40}$/i.test(id)||seen.has(id)||!name)return json(res,400,{error:'Agent cần có tên và mã hợp lệ, không trùng nhau.'});
              seen.add(id);
              out.push({id,name,role:String(a.role||'').trim().slice(0,80),desc:String(a.desc||'').trim().slice(0,2000),builtin:!!a.builtin,
                team:String(a.team||'').trim().slice(0,40),level:LEVELS[a.level]?a.level:'middle',
                ...(a.builtin?{}:{color:Number.isInteger(a.color)?a.color&0xffffff:0x9aa3b5,preset:String(a.preset||'dev').slice(0,20),slot:Number.isInteger(a.slot)?a.slot:-1})});
            }
            if(!seen.has('director'))return json(res,400,{error:'Không thể xóa Director.'});
            writeJson(AGENTS_FILE,out);return json(res,200,{agents:out});
          }
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
          // Follow-up question on a finished task: continues the same conversation (Claude --resume / codex exec resume)
          const askM=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/ask$/);
          if(askM){
            const t=tasks.find(t=>t.id===+askM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            const q=String((await readBody(req)).text||'').trim();
            if(!q||q.length>8000)return json(res,400,{error:'Câu hỏi trống hoặc quá dài (tối đa 8000 ký tự).'});
            if(t.status!=='done'||t.kind==='plan')return json(res,409,{error:'Chỉ hỏi thêm được việc đã hoàn thành.'});
            await ensureBin();await ensureCodex();
            (t.thread||=[]).push({q,at:new Date().toISOString()});if(t.thread.length>30)t.thread.shift();
            Object.assign(t,{asking:true,status:'queued',activity:'Chờ đến lượt trả lời câu hỏi thêm'});save();pump();
            return json(res,200,{task:full(t)});
          }
          // Login asked by a web task: the account is saved (or kept for this task only) and given to the browser as a secret
          const loginM=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/login$/);
          if(loginM){
            const t=tasks.find(t=>t.id===+loginM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(t.status!=='waiting'||t.question?.kind!=='login')return json(res,409,{error:'Việc này không còn chờ tài khoản đăng nhập.'});
            const b=await readBody(req),username=String(b.username||'').trim().slice(0,200),password=typeof b.password==='string'?b.password.slice(0,500):'';
            if(!username||!password)return json(res,400,{error:'Cần nhập tên đăng nhập và mật khẩu.'});
            const q=t.question,u=new URL(/^\w+:\/\//.test(q.url)?q.url:'http://'+q.url),origin=u.origin;
            // same site and username: update the password; otherwise a new entry
            let s=sites.find(x=>hostOf(x.url)===q.host&&x.username===username);
            if(s)Object.assign(s,{password,...(b.save?{temp:false}:{})});
            else{s={id:'s'+Date.now().toString(36),label:short(b.label||q.host,60),url:origin,username,password,...(b.save?{}:{temp:true})};sites.push(s)}
            saveSites();
            // the account this task uses for that site is the new one; other sites it already had stay
            t.siteIds=[...new Set([...sitesFor(t).filter(x=>hostOf(x.url)!==q.host).map(x=>x.id),s.id])];
            (t.clarify||=[]).push({q:q.q,answer:`Đã cung cấp tài khoản "${username}" cho ${q.host}${b.save?' (đã lưu)':''}`,at:new Date().toISOString()});
            t.logins=(t.logins||0)+1;
            t.reply=`Người dùng đã cung cấp tài khoản đăng nhập cho ${q.host} (tên đăng nhập: ${username}). Mở lại ${q.url}, đăng nhập bằng tài khoản này rồi làm tiếp nhiệm vụ.`;
            Object.assign(t,{question:null,status:'queued',urgent:true,activity:'Chờ đến lượt tiếp tục với tài khoản mới'});save();pump();
            return json(res,200,{task:full(t)});
          }
          // Answer to an agent's question: the task carries on (a plan is made again with the answer added to the request)
          const ansM=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/answer$/);
          if(ansM){
            const t=tasks.find(t=>t.id===+ansM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            const text=String((await readBody(req)).text||'').trim();
            if(!text||text.length>4000)return json(res,400,{error:'Câu trả lời trống hoặc quá dài (tối đa 4000 ký tự).'});
            if(t.status!=='waiting'||!t.question)return json(res,409,{error:'Việc này không còn chờ câu trả lời.'});
            (t.clarify||=[]).push({q:t.question.q,options:t.question.options,answer:text,at:new Date().toISOString()});
            t.clarifies=(t.clarifies||0)+1;
            if(t.kind==='plan')t.text+=`\n\nThông tin bổ sung (trả lời câu hỏi "${t.question.q}"): ${text}`;else t.reply=text;
            Object.assign(t,{question:null,status:'queued',urgent:true,activity:'Chờ đến lượt tiếp tục'});save();pump();
            return json(res,200,{task:full(t)});
          }
          if(req.method==='POST'&&m){
            const t=tasks.find(t=>t.id===+m[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(m[2]==='cancel'){
              if(t.status==='queued'&&t.asking){Object.assign(t.thread.at(-1),{error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});Object.assign(t,{status:'done',asking:false,activity:null})}
              else if(t.status==='queued'||t.status==='waiting')Object.assign(t,{status:'cancelled',question:null,reply:null,error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});
              else if(t.status==='running'){t.status='cancelled';dropPerms(t);killTree(procs.get(t.id))}
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
          // A task's working folder over http, so its browser can open files it made (file:// is blocked in Playwright MCP).
          // Only files inside that task's folder; this API only answers this computer.
          const pv=req.method==='GET'&&path.match(/^\/preview\/(\d+)(\/.*)?$/);
          if(pv){
            const t=tasks.find(t=>t.id===+pv[1]);if(!t?.cwd)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            let rel;try{rel=decodeURIComponent(pv[2]||'/')}catch{return json(res,400,{error:'Đường dẫn không hợp lệ.'})}
            const root=resolve(t.cwd);let file=resolve(root,'.'+rel);
            const inside=relative(root,file);if(inside.startsWith('..')||isAbsolute(inside))return json(res,403,{error:'Ngoài thư mục làm việc.'});
            if(existsSync(file)&&statSync(file).isDirectory())file=join(file,'index.html');
            if(!existsSync(file)||!statSync(file).isFile())return json(res,404,{error:'Không có file.'});
            res.setHeader('Content-Type',PREVIEW_TYPES[extname(file).toLowerCase()]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
            return res.end(readFileSync(file));
          }
          json(res,404,{error:'Not found'});
        }catch(e){json(res,e.code===400?400:500,{error:String(e?.message||e)})}
      });
      server.httpServer?.once('close',()=>{for(const p of procs.values())killTree(p)});
    }
  };
  // Same middleware on the preview server: the desktop app (electron/main.js) serves the build with vite preview
  return {...plugin,configurePreviewServer:plugin.configureServer};
}
