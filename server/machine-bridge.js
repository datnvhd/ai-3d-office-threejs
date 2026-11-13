// Vite dev-server plugin: the "personal machine" side of the office. Reports this computer's info, runs a
// health check, and executes assigned tasks for real with Claude Code (`claude -p`) in a chosen working folder.
// Tasks never bypass Claude Code's permission system: 'default' (read & analyse) or 'acceptEdits' (edit files in the folder).
// WebSearch and WebFetch are pre-approved (read-only lookups); in -p mode there is nobody to approve them otherwise.
// Web tasks also get a real Chrome through Playwright MCP; saved site passwords reach the browser as Playwright
// "secrets" (the agent types the secret's name), so Claude never sees them.
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,statSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,copyFileSync,createReadStream} from 'node:fs';
import {extractDocxText,extractPptxText,extractXlsx,toCsv,sheetPreview,makeZip} from './file-extract.js';
import {fetchGoogleLinks} from './google-bridge.js';
import {readQuota} from './ai-quota.js';
import {ensureVideoKit,videoKitState,KIT_SRC} from './video-kit.js';
import {createRequire} from 'node:module';
import os from 'node:os';
import {join,resolve,isAbsolute,dirname,basename,relative,extname,sep} from 'node:path';
import {STORE_DIR,NODE_ENV,cleanEnv,run,findClaudeBinary,killTree,reapGroup,getSavedClaudeToken} from './claude-bridge.js';
import {findCodexBinary,codexAuth,codexExec,codexRun} from './codex-bridge.js';
import {createUpdater,cliGen,UPDATE_MODES} from './ai-updates.js';
import {createSnapshots} from './snapshot.js';
import {rnProject,mobileEnv,mobileEnvCached,mobileSummary,MOBILE_KIT,mobilePrompt,mobilePlanNote} from './mobile.js';
import {detectLimit,ENGINE_NAME} from './ai-limits.js';
import {createRemoteServer,isRemoteReq,newRemoteKey,lanAddresses,hashPassword,MIN_PASSWORD,DEFAULT_REMOTE_PORT} from './remote-access.js';
import {createTunnel} from './tunnel.js';
import {loadSkills,publicSkills,skillRefs,skillPrompt,skillsAvailablePrompt,importSkills,removeSkill,PERSONAL_DIR} from './skills.js';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ruleSteps,planPrompt,parsePlan,MODELS,LATEST,EFFORTS,modelId,modelLabel,pickModel,MAX_REWORK,reworkGuide,parseRework,LEVELS,teamOf,levelOf,MAX_CLARIFY,QUESTION_GUIDE,parseQuestion,parseLooseQuestion,parsePlanQuestion,fitModel,TIER,sameTier,engineOfModel,enginesOf,ENGINE_NAMES} from '../workflow-plan.js';
// What each level means for the agent doing the work
const LEVEL_NOTE={leader:'Bạn là Leader của đội: chịu trách nhiệm chất lượng chung, làm và duyệt kỹ, chỉ ra rủi ro.',senior:'Bạn là Senior: xử lý được việc khó, chủ động đề xuất giải pháp tốt.',middle:'Bạn là Middle: làm chắc chắn việc thông thường, hỏi lại khi yêu cầu chưa rõ.',junior:'Bạn là Junior: làm cẩn thận từng bước, nêu rõ chỗ chưa chắc chắn để người có kinh nghiệm xem lại.'};

const AGENTS_FILE=join(STORE_DIR,'agents.json');// the office's agent list (src.js); null = the 7 built-in agents
const CONFIG_FILE=join(STORE_DIR,'machine.json'),TASKS_FILE=join(STORE_DIR,'tasks.json'),SITES_FILE=join(STORE_DIR,'sites.json'),RUNS_DIR=join(STORE_DIR,'runs'),UPLOADS_DIR=join(STORE_DIR,'uploads');
const MAX_PARALLEL=2,MAX_TURNS=80,WEB_TURNS=100,TASK_TIMEOUT=20*60*1000,WEB_TIMEOUT=60*60*1000,MOBILE_TIMEOUT=45*60*1000,KEEP=200,URGENT_EXTRA=2,MAX_AGENTS=36;
// Files droppable on the task box: images and PDF are read by the agent from disk; text/Word/PowerPoint are extracted
// and inlined; Excel is split into one CSV per sheet; old binary formats (.xls/.doc) are passed as files to convert
const FILE_KINDS={pdf:'pdf',png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',docx:'text',pptx:'text',xlsx:'sheet',xlsm:'sheet',xls:'file',doc:'file',mp3:'media',m4a:'media',wav:'media',
  ...Object.fromEntries('txt md csv tsv json xml html htm log yaml yml ini sql'.split(' ').map(e=>[e,'text']))};
// results the page may play or show itself (?inline=1)
const PLAY_TYPES={mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
const MAX_FILE=25*1024*1024,MAX_FILES=6,MAX_GOOGLE=5,ATTACH_SUBDIR='.ai-office-files';

// Plain text for a dropped file by kind: docx/pptx are unzipped, other text read directly (bounded)
function fileText(path,kind,ext){
  try{if(ext==='docx')return (extractDocxText(readFileSync(path))||'').slice(0,20000);
    if(ext==='pptx')return (extractPptxText(readFileSync(path))||'').slice(0,20000);
    if(kind==='text')return readFileSync(path,'utf8').slice(0,20000);
  }catch{}
  return null;
}
// Excel: every sheet is written next to the file as <file>.sheets/<sheet name>.csv so the agent picks a sheet by name
const safeName=s=>(String(s).replace(/[\/:*?"<>|\x00-\x1f]+/g,'_').trim().slice(0,80))||'sheet';
function splitSheets(abs,rel){
  const ws=extractXlsx(readFileSync(abs)),dir=abs+'.sheets',used=new Set();mkdirSync(dir,{recursive:true});
  return ws.map(w=>{
    let f=safeName(w.name);while(used.has(f.toLowerCase()))f+='_';used.add(f.toLowerCase());
    writeFileSync(join(dir,f+'.csv'),'\ufeff'+toCsv(w.rows));
    return {name:w.name,hidden:w.hidden,rows:w.rows.length,cols:Math.max(0,...w.rows.map(r=>r.length)),rel:`${rel}.sheets/${f}.csv`,preview:sheetPreview(w.rows)};
  });
}
const OLD_FMT='Tệp định dạng cũ: đọc bằng công cụ sẵn có trên máy (ví dụ Python pandas/xlrd, LibreOffice --convert-to) nếu cần.';
function sheetPrompt(f){
  const head=`### Tệp Excel: ${f.name}${f.src?` (tải từ Google: ${f.src})`:''} — ${f.sheets.length} sheet\nTệp gốc: ${f.rel}\nMỗi sheet đã được xuất ra một file CSV (UTF-8) riêng. Khi người dùng nhắc tới một sheet theo tên, đọc đúng file CSV của sheet đó (so tên không phân biệt hoa thường, dấu cách thừa); nếu không nhắc, chọn sheet hợp với yêu cầu. Cần tính toán thì xử lý trên file CSV (ví dụ bằng script), đừng đoán từ phần xem trước.${f.sheet?`\nLink người dùng gửi đang mở sheet "${f.sheet}".`:''}`;
  let budget=8000;
  const list=f.sheets.map(s=>{
    let line=`- Sheet "${s.name}"${s.hidden?' (ẩn)':''}: ${s.rows} dòng × ${s.cols} cột → ${s.rel}`;
    if(s.preview&&s.rows&&budget>0){const p=s.preview.slice(0,budget);budget-=p.length;line+=`\n  Xem trước:\n\`\`\`\n${p}\n\`\`\``}
    return line;
  });
  return head+'\n'+list.join('\n');
}
// Prompt section describing the task's attachments (inline text for docs, path to read for images/PDF)
export function attachPrompt(t){
  if(!t.files?.length)return '';
  const from=f=>f.src?` (tải từ Google: ${f.src})`:'';
  const parts=t.files.map(f=>f.sheets?.length?sheetPrompt(f)
    : f.text!=null&&f.text.trim()
    ? `### Tệp đính kèm: ${f.name}${from(f)}\nĐường dẫn: ${f.rel}\n\`\`\`\n${f.text.slice(0,6000)}\n\`\`\`${f.text.length>6000?'\n(Nội dung dài, phần trên đã rút gọn: đọc đủ trong tệp gốc nếu cần.)':''}`
    : `### Tệp đính kèm: ${f.name}${from(f)} (${f.kind==='image'?'ảnh':f.kind==='pdf'?'tài liệu PDF':f.kind==='sheet'?'bảng tính':f.kind==='media'?'âm thanh (có thể dùng làm nhạc nền video)':'tệp'})\n${f.kind==='file'?OLD_FMT:f.kind==='media'?'Dùng trực tiếp tệp này nếu cần.':'Đọc nội dung tệp này bằng công cụ đọc tệp.'} Đường dẫn: ${f.rel}`);
  return `\nTỆP ĐÍNH KÈM: Người dùng gửi kèm ${t.files.length} tệp cho yêu cầu này. Hãy sử dụng nội dung của chúng khi thực hiện.\n${parts.join('\n')}\n`;
}
// MCP server Claude Code asks for permission through (--permission-prompt-tool); the user answers in the page
const PERM_MCP=join(dirname(fileURLToPath(import.meta.url)),'permission-mcp.js');
const MCP_CLI=(()=>{try{return join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')),'cli.js')}catch{return null}})();
// macOS: the executable inside the .app bundle (system-wide or in ~/Applications), so it can also be launched directly
const macApp=(app,exe)=>['/Applications',join(os.homedir(),'Applications')].map(d=>`${d}/${app}.app/Contents/MacOS/${exe}`);
const BROWSERS=[['chrome',['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',join(os.homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe'),...macApp('Google Chrome','Google Chrome'),'/opt/google/chrome/chrome']],
  ['msedge',['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',...macApp('Microsoft Edge','Microsoft Edge'),'/opt/microsoft/msedge/msedge']]];
// os.version() on Linux is the kernel build string ("#1 SMP …") and on macOS "Darwin Kernel Version …": use the product name
const macVolumes=()=>{try{return readdirSync('/Volumes').map(v=>join('/Volumes',v)).filter(v=>{try{return statSync(v).isDirectory()}catch{return false}})}catch{return []}};
let osNameCache=null;
const osName=()=>{
  if(osNameCache)return osNameCache;
  if(process.platform==='linux')try{const m=readFileSync('/etc/os-release','utf8').match(/^PRETTY_NAME="?([^"\n]+)/m);if(m)return osNameCache=m[1]}catch{}
  if(process.platform==='darwin')try{return osNameCache=`macOS ${execFileSync('sw_vers',['-productVersion'],{encoding:'utf8',timeout:5000}).trim()}`}catch{}
  return osNameCache=os.version?.()||os.type();
};
const findBrowser=()=>BROWSERS.find(([,paths])=>paths.some(p=>existsSync(p)))?.[0]||null;
// ---------- Design images ----------
// Design agents draw each screen as a standalone HTML/SVG file in <workdir>/.ai-office-design/<task id>/; when the task
// ends the server opens them in a headless Chrome/Edge (playwright-core) and saves PNGs. The user marks which images the
// developers should follow; later steps of the workflow (or a task handed over from the design) get the marked ones.
const isDesign=t=>/^design$/i.test(t.team||'')||t.agent==='designer'||/thiết kế|design|mockup|ui\/ux/i.test(t.role||'')&&!/phát triển|dev|lập trình/i.test(t.role||'');
const designDir=t=>join(t.cwd,'.ai-office-design',String(t.id));
// The design folder belongs to the app, not to the project: a design task may write its mockups there even in
// read-only mode (Claude: an Edit rule for that folder only; Codex: workspace-write with that folder as workspace)
const designOnly=t=>isDesign(t)&&!!t.cwd&&t.mode!=='acceptEdits';
const designRel=t=>`.ai-office-design/${t.id}/**`;
// Math video tasks (team "Video", or a role about video): the agent writes a script and a Manim scene and renders an
// MP4 with `mathvid`. Like design, its folder may be written even in read-only mode; a workflow's steps share it.
const isVideo=t=>/^video/i.test(t.team||'')||/video|clip/i.test(t.role||'');
const videoRel=t=>`video-toan/viec-${t.wf??t.id}`;
const videoDir=t=>join(t.cwd,'video-toan',`viec-${t.wf??t.id}`);
const videoOnly=t=>isVideo(t)&&!!t.cwd&&t.mode!=='acceptEdits';
const videoGuide=t=>`
VIDEO TOÁN HỌC NGẮN — bạn là biên tập viên video toán cho học sinh phổ thông.
Mục tiêu: một video dọc 9:16 (1080×1920, MP4, 20–40 giây) giải thích TRỰC QUAN một ý toán học (hình học, đồ thị, hàm số, đại số, xác suất…), sinh động, dễ nhớ, theo phong cách TikTok / YouTube Shorts / Reels.
Thư mục của video này: ${videoRel(t)} (ĐÃ TẠO SẴN; mọi file đặt trong đó${t.mode!=='acceptEdits'?'; đây là nơi DUY NHẤT bạn được ghi file':''}). Công cụ: lệnh \`mathvid\` (đã cài sẵn, \`mathvid -h\` để xem).
CÁCH LÀM ĐỂ KHÔNG PHẢI CHỜ XIN PHÉP: tạo/sửa file bằng công cụ ghi file (Write/Edit), KHÔNG dùng lệnh shell như mkdir, cat >, echo >, heredoc; chạy mathvid từ thư mục làm việc với đường dẫn đầy đủ, mỗi lệnh một mình (không cd, không nối bằng && hay |). Ví dụ: \`mathvid build ${videoRel(t)}/script.json ${videoRel(t)}/scene.py --out ten-ngan.mp4 --draft\` (file ra nằm trong thư mục video).
TRƯỚC KHI VIẾT, đọc: ${join(KIT_SRC,'mathvid_style.py')} và ${join(KIT_SRC,'mathvid_fx.py')} (các khối dựng sẵn, hiệu ứng), rồi video mẫu hợp với loại video bên dưới (scene.py + script.json): bài học ${join(KIT_SRC,'examples','pytago')}, sáng tạo/cảm xúc ${join(KIT_SRC,'examples','to-tinh')}.

XÁC ĐỊNH LOẠI VIDEO TRƯỚC:
A. BÀI HỌC (mặc định): giải thích kiến thức cho học sinh → làm theo QUY TRÌNH và XU HƯỚNG bên dưới (giọng đọc, đố vui, thẻ GHI NHỚ).
B. SÁNG TẠO / CẢM XÚC bằng toán học: tỏ tình, crush, Valentine, kỷ niệm yêu nhau, sinh nhật, chúc mừng, tri ân thầy cô 20/11, 8/3, cảm ơn, động viên thi cử… Khi đó:
   - class Video(Short) đặt theme = "romantic" (tỏ tình, yêu), "birthday" (sinh nhật, chúc mừng), "galaxy" (mơ mộng, vô tận), "sunset" (tri ân, ấm áp); progress = False.
   - Âm thanh: mặc định KHÔNG lời, chỉ nhạc: script.json {"voice":"none","music":"romantic"|"dreamy"|"happy"|"upbeat","segments":[{"id":…,"text":…,"duration":giây}]} (text chỉ để ghi chú, chữ hiện trên hình do scene vẽ). Nhạc do mathvid tự sáng tác, không bản quyền. Người dùng muốn có lời thì dùng giọng như bài học, "music" vẫn thêm được (tự nhỏ lại khi có lời). Người dùng gửi nhạc riêng thì "music": đường dẫn tệp.
   - 12–25 giây, mỗi khoảnh khắc 2–4 giây; chữ hiện bằng self.typewrite(), ngắn, tình cảm, tự nhiên (không sến quá, không thô).
   - Hiệu ứng có sẵn: starfield, glow, draw_heart (phương trình trái tim vẽ bằng bút sáng), heartbeat, gather(heart_points()) (hạt bay tụ thành tim), sparkle, firework, float_hearts, graph_reveal, end_title. Kết bằng end_title + firework/float_hearts.
   - Ẩn dụ toán học hay (vẫn phải ĐÚNG toán): hai đường thẳng không song song thì cắt nhau; phương trình trái tim x = 16sin³t, y = 13cos t − 5cos 2t − 2cos 3t − cos 4t; đường cardioid r = 1 − sin θ; giới hạn → ∞ ("thương em đến vô cùng"); số π không bao giờ kết thúc; giao của hai tập hợp; đồ thị sin như nhịp tim; tiếp tuyến chạm đúng một điểm; "nghiệm duy nhất"; tuổi mới = n + 1; vector cùng hướng.
   - Video mẫu chỉ để HỌC CÁCH VIẾT CODE, không phải để chép: mỗi video mới phải có ý tưởng, ẩn dụ, bố cục và hiệu ứng riêng hợp với người nhận và dịp (ví dụ sinh nhật: tuổi mới n + 1 và pháo hoa; tri ân: đồ thị đi lên như sự tiến bộ, giới hạn → ∞; tỏ tình: cardioid, π vô tận, tiếp tuyến…). Chỉ dùng lại "hai đường thẳng + trái tim" khi người dùng muốn đúng như vậy.
   - Cá nhân hóa bằng tên, ngày, lời nhắn người dùng đưa; không có thì dùng "anh/em" hoặc "bạn" chung chung và ghi trong kết quả rằng có thể gửi tên để làm lại. Không dùng ảnh người thật, nội dung nhạy cảm hay chế giễu.
   - Bỏ đố vui, thẻ GHI NHỚ, phụ đề; kiểm tra khung hình vẫn bắt buộc (bước 3 bên dưới).


QUY TRÌNH
1. Kịch bản → ${videoRel(t)}/script.json: {"voice":"nu" hoặc "nam","rate":"+20%","segments":[{"id":"hook","text":"…"},…]}
   - Chỉ MỘT ý chính. 5–8 đoạn, mỗi đoạn MỘT câu ngắn (≤ 14 từ), cắt hết chữ thừa ("chúng ta hãy cùng", "như các bạn đã biết"…), giọng nói tự nhiên, xưng "bạn".
   - Đoạn "hook" ≤ 3 giây, gây tò mò ngay: câu hỏi lạ, sai lầm phổ biến, con số bất ngờ, "Mẹo 5 giây…".
   - Lời đọc viết như khi NÓI: "x bình", "căn hai", "a mũ n", "pi", "lớn hơn hoặc bằng", "phần trăm"; không để ký hiệu toán trong text đọc.
   - Đoạn đố thêm "pause": 2.0 để chừa thời gian đếm ngược (quiz mặc định 3 nhịp, mỗi nhịp 0,75 giây). Đoạn cuối: chốt ý + "Lưu lại để ôn thi" hoặc "Theo dõi để xem phần 2".
   - Nếu bước trước (Research…) đã soạn nội dung/kịch bản thì dùng lại, nhưng tự kiểm tra lại tính đúng.
2. Cảnh → ${videoRel(t)}/scene.py: \`from mathvid_style import *\`, \`class Video(Short)\` với \`def build(self)\`.
   - Khớp lời và hình: self.at("id") chờ đoạn đó bắt đầu, self.hold("id") giữ tới khi đọc xong, self.left("id") = số giây còn lại (dùng cho run_time).
   - Khối có sẵn: hook, title, pop, stress, quiz, reveal, wrong, recap, axes; T() chữ tiếng Việt, M() công thức (x^2 → x², sqrt → √), card(), fit().
   - Vẽ THẬT bằng Manim: Axes().plot, Polygon, Circle, Angle, Dot, NumberLine, ValueTracker + always_redraw để thấy tham số thay đổi, Transform để biến đổi hình/biểu thức. Không làm video toàn chữ.
   - NHỊP NHANH kiểu TikTok: cứ 1,5–2,5 giây có thay đổi mới trên hình; hiệu ứng phụ 0,2–0,5 giây, vẽ hình chính ≤ 1,5 giây; không để màn hình đứng yên quá 1 giây, không khoảng lặng giữa các câu; cảnh sau vào ngay khi cảnh trước xong. Một màu = một đối tượng xuyên suốt. Chữ trên hình ≤ 8 từ một lúc; lời đọc lo phần giải thích.
   - Khung 9×16 đơn vị (x −4.5…4.5, y −8…8); nội dung chỉ trong y −3.6…6.4 (dưới là phụ đề và nút của TikTok). Máy chưa có LaTeX: dùng M("…"), không dùng MathTex/Tex.
3. Nháp: \`mathvid build ${videoRel(t)}/script.json ${videoRel(t)}/scene.py --out <ten-ngan>.mp4 --draft\`. Lỗi Python thì đọc lỗi và sửa scene.py.
   Sau đó ĐỌC ẢNH <ten-ngan>_frames.png (12 khung hình) để tự kiểm tra: chữ tràn/bị che, hình chồng lên nhau, hình vẽ đúng toán, khớp với lời, phụ đề dễ đọc. Sửa và dựng lại tới khi đạt (tối đa 3 vòng).
4. Bản cuối: chạy lại lệnh build KHÔNG có --draft. Người dùng gửi nhạc (mp3/m4a/wav trong tệp đính kèm) thì thêm --music <đường dẫn> (nhạc tự nhỏ lại khi có lời). Xóa file nháp không cần thiết.
5. Kiểm tra: \`mathvid probe ${videoRel(t)}/<ten-ngan>.mp4\`: dài 12–50 giây, 1080×1920, có tiếng.
TỐC ĐỘ: người dùng thấy video chậm hoặc muốn nhanh hơn thì đặt "speed": 1.1–1.3 trong script.json (tăng tốc cả hình và tiếng, giọng không méo) và/hoặc "rate" giọng lên "+25%"–"+35%", rồi dựng lại; muốn chậm hơn thì ngược lại.

XU HƯỚNG cho video BÀI HỌC (chọn một khung hợp với nội dung): "Sai lầm 90% học sinh mắc phải" (wrong rồi sửa) · "Mẹo giải nhanh trong 5 giây" · "Đố bạn 3 giây" (quiz rồi reveal) · "Toán trong đời thực" (tình huống quen thuộc → mô hình toán) · "Hình học thỏa mãn / chứng minh không lời" (biến đổi hình mượt) · "Cách dài vs cách nhanh" · chuỗi "Phần 1/2/3". Luôn có hook 1–2 giây đầu, nhịp nhanh, phụ đề chạy chữ to (mathvid tự làm), thanh tiến độ, kết bằng thẻ GHI NHỚ. Không dùng nhân vật, nhạc, hình hay meme có bản quyền của người khác.
KIẾN THỨC: đúng chương trình GDPT 2018 và thuật ngữ SGK tiếng Việt; tính lại mọi con số (có thể dùng python). Sai kiến thức là lỗi nặng nhất (cả với video sáng tạo: đồ thị và phương trình phải đúng).
KẾT QUẢ trả lời: đường dẫn file MP4, thời lượng, loại video và kịch bản tóm tắt theo đoạn, gợi ý caption đăng bài + 5 hashtag (bài học: #hoctoan #toan10 #meohoctap; sáng tạo: #totinh #toanhoc #valentine…), và gợi ý phần tiếp theo hoặc biến thể.
`;
// Building and running a mobile app in a simulator takes longer than a web task
// testing a site through the browser (test cases, UI checks) takes longer than a code task
const taskTimeout=t=>Math.max(rnProject(t.cwd)&&t.mode==='acceptEdits'?MOBILE_TIMEOUT:TASK_TIMEOUT,t.web?WEB_TIMEOUT:0);
const browserExe=name=>BROWSERS.filter(([n])=>!name||n===name).flatMap(([,paths])=>paths).find(p=>existsSync(p)&&!/\.app$/.test(p))||null;
// Browsers the agents may use: Chrome and Edge installed on the machine, or Playwright's own Firefox (downloaded on first use)
const BROWSER_NAMES={chrome:'Google Chrome',msedge:'Microsoft Edge',firefox:'Firefox',mychrome:'Chrome của tôi (đã đăng nhập sẵn)',myedge:'Edge của tôi (đã đăng nhập sẵn)'};
// "Chrome/Edge của tôi": the agent drives the user's own running browser, with its logged-in accounts, through the
// official Playwright Extension (Playwright MCP --extension), instead of a fresh automated browser
const EXT_ID='mmlmfjhmonkocbjadbfplnigmagldckm',EXT_URL=`https://chromewebstore.google.com/detail/playwright-extension/${EXT_ID}`;
const OWN={mychrome:'chrome',myedge:'msedge'};
const userDataDir=ch=>{const h=os.homedir(),la=process.env.LOCALAPPDATA||join(h,'AppData','Local');
  if(process.platform==='win32')return ch==='chrome'?join(la,'Google','Chrome','User Data'):join(la,'Microsoft','Edge','User Data');
  if(process.platform==='darwin')return join(h,'Library','Application Support',ch==='chrome'?'Google/Chrome':'Microsoft Edge');
  return join(h,'.config',ch==='chrome'?'google-chrome':'microsoft-edge')};
const extInstalled=ch=>{try{const d=userDataDir(ch);return readdirSync(d).some(p=>existsSync(join(d,p,'Extensions',EXT_ID)))}catch{return false}};
const firefoxExe=()=>{try{const p=createRequire(import.meta.url)('playwright-core').firefox.executablePath();return p&&existsSync(p)?p:null}catch{return null}};
const browserReady=n=>n==='firefox'?!!firefoxExe():OWN[n]?!!browserExe(OWN[n])&&extInstalled(OWN[n]):!!browserExe(n);
let ffInstall=null;// null, {state:'installing'} or {state:'error',error}
function installFirefox(){
  if(firefoxExe()||ffInstall?.state==='installing')return;
  ffInstall={state:'installing'};
  const cli=join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')),'cli.js');
  const p=spawn(process.execPath,[cli,'install','firefox'],{env:{...process.env,...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},windowsHide:true});
  let err='';p.stderr.on('data',d=>err+=d);p.stdout.on('data',()=>{});
  p.on('close',c=>{ffInstall=firefoxExe()?null:{state:'error',error:(err.trim().split('\n').pop()||`mã lỗi ${c}`).slice(0,200)}});
  p.on('error',e=>{ffInstall={state:'error',error:e.message}});
}
// The browser picked in the settings when it is available, else the first one installed: {name, exe, own}
// (own: the user's browser through the extension; `uitest` still starts its own copy of that browser)
const pickBrowser=want=>{
  if(want&&OWN[want]&&browserReady(want))return {name:OWN[want],exe:browserExe(OWN[want]),own:want};
  if(want&&want!=='auto'&&browserReady(want))return {name:want,exe:want==='firefox'?firefoxExe():browserExe(want)};
  const n=findBrowser();return {name:n,exe:n?browserExe(n):null};
};
// `uitest` for the agents' shell: server/ui-test-runner.mjs on the app's own Node and Playwright, with this machine's
// Chrome/Edge. Written when a browser task starts; the folder is put on PATH, which every agent inherits.
const UITEST_RUNNER=join(dirname(fileURLToPath(import.meta.url)),'ui-test-runner.mjs'),TOOL_BIN=join(STORE_DIR,'bin');
function installUiTest(pick=pickBrowser()){
  try{
    mkdirSync(TOOL_BIN,{recursive:true});
    const exe=pick.exe||'',engine=pick.name==='firefox'?'firefox':'chromium',node=process.execPath,asNode=!!process.versions.electron,sh=p=>p.replace(/\\/g,'/');
    if(process.platform==='win32')writeFileSync(join(TOOL_BIN,'uitest.cmd'),`@echo off\r\n${asNode?'set ELECTRON_RUN_AS_NODE=1\r\n':''}set "UITEST_BROWSER=${exe}"\r\nset "UITEST_ENGINE=${engine}"\r\n"${node}" "${UITEST_RUNNER}" %*\r\n`);
    writeFileSync(join(TOOL_BIN,'uitest'),`#!/bin/sh\n${asNode?'export ELECTRON_RUN_AS_NODE=1\n':''}export UITEST_BROWSER="${sh(exe)}"\nexport UITEST_ENGINE=${engine}\nexec "${sh(node)}" "${sh(UITEST_RUNNER)}" "$@"\n`,{mode:0o755});
    const d=process.platform==='win32'?';':':';
    if(!(process.env.PATH||'').split(d).includes(TOOL_BIN))process.env.PATH=TOOL_BIN+d+(process.env.PATH||'');
  }catch{}
}
installUiTest();
const designGuide=t=>`
ẢNH THIẾT KẾ CHO DEV: kết quả thiết kế phải là ẢNH để dev code theo. Với mỗi màn hình, trạng thái hoặc thành phần quan trọng, tạo MỘT file HTML độc lập (CSS viết ngay trong file, không cần JavaScript; tài nguyên ngoài chỉ được dùng Google Fonts) trong thư mục:
${designDir(t)}
Đặt tên theo thứ tự và nội dung, ví dụ 01-dang-nhap.html, 02-dang-nhap-loi.html, 03-trang-chu-mobile.html; thẻ <title> là tên ảnh (ví dụ "Đăng nhập – trạng thái lỗi"). Khung desktop rộng 1440px; file có "mobile" trong tên dùng khung 390px. Có thể tạo nhiều file (thường 2–8); icon/logo có thể là file .svg trong cùng thư mục.
Hệ thống tự chụp mỗi file thành ảnh PNG; người dùng chọn ảnh nào gửi cho dev. Trong phần kết quả, liệt kê từng ảnh (tên file — mô tả) và ghi bảng màu, font, cỡ chữ, khoảng cách chính.
`;
async function shootDesigns(t,note){
  if(!isDesign(t)||!t.cwd)return;
  const dir=designDir(t);if(!existsSync(dir))return;
  const files=readdirSync(dir).filter(f=>/\.(html?|svg)$/i.test(f)).sort().slice(0,20);if(!files.length)return;
  let browser;
  try{
    const {chromium}=createRequire(import.meta.url)('playwright-core'),exe=browserExe();
    browser=await chromium.launch({headless:true,...(exe?{executablePath:exe}:{channel:'chrome'})});
    const out=[];
    for(const f of files){
      const mobile=/mobile/i.test(f),page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
      try{
        await page.goto(pathToFileURL(join(dir,f)).href,{waitUntil:'load',timeout:15000});await page.waitForTimeout(400);
        const h=await page.evaluate(()=>document.documentElement.scrollHeight).catch(()=>900),png=f.replace(/\.\w+$/,'.png');
        await page.screenshot({path:join(dir,png),...(h>4200?{clip:{x:0,y:0,width:mobile?390:1440,height:4200}}:{fullPage:true}),timeout:20000});
        const title=(await page.title().catch(()=>''))||f.replace(/\.\w+$/,'').replace(/[-_]/g,' '),prev=(t.designs||[]).find(d=>d.png===png);
        out.push({png,src:f,title:title.trim().slice(0,120),marked:prev?prev.marked:true});
      }catch(e){note('denied',`Không chụp được ${f}: ${String(e.message).split('\n')[0].slice(0,140)}`,false)}
      finally{await page.close().catch(()=>{})}
    }
    t.designs=out;
    if(out.length)note('out',`🎨 Đã chụp ${out.length} ảnh thiết kế: ${out.map(d=>d.title).join(', ')}`,false);
  }catch(e){note('denied','Không chụp được ảnh thiết kế: '+String(e.message).split('\n')[0].slice(0,160),false)}
  finally{await browser?.close().catch(()=>{})}
}
// Claude Code's answer when the account cannot use the requested model (retired, or not on this plan)
const MODEL_MISSING=/not_found_error|may not exist|not have access to (it|this model)|model[^\n]{0,60}(not found|not available|unavailable|does not exist)/i;
// `claude` flags for a task's model and reasoning effort (old records may hold a family alias, still valid for the CLI)
const modelArgs=t=>[...(t.model?['--model',engineOfModel(t.model)?sameTier(t.model,'claude'):t.model]:[]),...(EFFORTS[t.effort]?['--effort',t.effort]:[])];
// `codex exec` flags for the same (a Claude model maps to the Codex model of the same difficulty)
const codexModelArgs=t=>[...(t.model?['-c',`model=${sameTier(t.model,'codex')}`]:[]),...(EFFORTS[t.effort]?['-c',`model_reasoning_effort=${t.effort}`]:[])];
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
  test:{short:'Chạy test',label:'Chạy test tự động: npm test, vitest, jest, playwright test, pytest, uitest (kịch bản giao diện có chụp ảnh từng bước)',write:true,cmds:['npm test','npm run test','npx vitest','npx jest','npx playwright test','pytest','uitest']},
  gh:{short:'GitHub CLI',label:'GitHub CLI: xem issue, PR, CI (bình luận/tạo issue khi được sửa file)',cmds:['gh issue view','gh issue list','gh pr view','gh pr list','gh pr diff','gh pr checks','gh run list','gh run view'],writeCmds:['gh issue create','gh issue comment','gh pr comment']},
  docs:{short:'Tài liệu & sơ đồ',label:'Tài liệu & sơ đồ: Mermaid CLI (mmdc), pandoc',write:true,cmds:['npx -y @mermaid-js/mermaid-cli','mmdc','pandoc']},
  mobile:MOBILE_KIT,// its commands are only given when the working folder is a React Native app (mobile.js)
  browser:{short:'Trình duyệt',label:'Trình duyệt tự động (Playwright) bật sẵn cho mọi việc của đội',web:true},
  mathvideo:{short:'Video toán',label:'Video toán học: lệnh mathvid (Manim, giọng đọc tiếng Việt, ffmpeg), tự cài lần đầu',cmds:['mathvid']}
};
const DEFAULT_TEAM_KITS={Frontend:['files','git','node','test','gh','mobile'],Backend:['files','git','node','python','test','gh'],QA:['files','git','test','browser','mobile'],BA:['files','docs'],
  Design:['files','browser'],Data:['files','python'],Video:['files','python','mathvideo'],Research:['files'],'Ban điều hành':['files','git'],'*':['files']};
// never allowed, whatever the kits say
const DENY_CMDS=['git push','git reset --hard','git clean','rm -rf','npm publish','gh repo delete','gh release create',
  'svn commit','svn ci','svn update','svn up','svn switch','svn revert','svn delete','svn rm','svn import','svn merge','svn lock','svn unlock'];
const MODES={default:'Chỉ đọc & phân tích',acceptEdits:'Cho phép tạo/sửa file trong thư mục làm việc'};
const DEFAULT_WORKDIR=join(os.homedir(),'AI-Office-Workspace');
// Which CLI runs each agent's tasks ('both': the Director or the model picked decides per task); agents not listed use Claude Code
const ENGINES=ENGINE_NAMES;
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
// Sent in the same session when the last run used up its steps
const CONT_PROMPT=`Lượt trước đã bị dừng vì hết số bước hoặc hết thời gian cho phép, nhiệm vụ chưa xong. Làm tiếp từ chỗ đang dở (đừng đọc lại những gì đã đọc, đừng làm lại phần đã xong), ưu tiên phần còn thiếu quan trọng nhất và hoàn thành gọn. Khi xong, kết thúc bằng phần "Kết quả:" tóm tắt toàn bộ những gì đã làm trong cả nhiệm vụ.`;
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
  let bin=null,binChecked=false,version=null,binGen=-1;
  let port=5173;// the dev server's real port, set once it listens; web tasks open their files through it
  let config={workdir:DEFAULT_WORKDIR,mode:'default',browserVisible:true,...readJson(CONFIG_FILE,{})};
  // kit lists saved before the Mobile kit existed: give it to the teams that build or test code (it only acts in RN apps)
  if(config.teamKits&&!config.kitsMobile)for(const list of Object.values(config.teamKits))if(Array.isArray(list)&&(list.includes('node')||list.includes('test'))&&!list.includes('mobile'))list.push('mobile');
  config.kitsMobile=true;
  config.agentEngines={...DEFAULT_AGENT_ENGINES,...config.agentEngines};
  // What an agent may use: {engine, models, maxEffort} (see fitModel in workflow-plan.js)
  const aiOf=agent=>({engine:ENGINES[config.agentEngines[agent]]?config.agentEngines[agent]:'claude',...(config.agentAI||{})[agent]});
  // Engine to try first for an agent that may use both: the one that is signed in and not used up, Claude first
  const preferEngine=()=>engineReady('claude')&&!limitOf('claude')?'claude':engineReady('codex')&&!limitOf('codex')?'codex':'claude';
  const engineOf=agent=>{const es=enginesOf(aiOf(agent));return es.length>1?preferEngine():es[0]};
  const kitsFor=team=>(config.teamKits||{})[team]??DEFAULT_TEAM_KITS[team]??DEFAULT_TEAM_KITS['*'];
  // Bash rules for a task from its team's kits; read-only mode keeps only the commands that just look
  function kitRules(t){
    const write=t.mode==='acceptEdits',cmds=[];
    const rn=rnProject(t.cwd);
    for(const k of kitsFor(t.team||'')){const kit=TOOLKITS[k];if(!kit||kit.web||kit.write&&!write||k==='mobile'&&!rn)continue;cmds.push(...kit.cmds,...(write?kit.writeCmds||[]:[]))}
    const list=[...new Set(cmds)];
    return {cmds:list,allow:[...list.map(c=>`Bash(${c}:*)`),...(designOnly(t)?[`Edit(${designRel(t)})`]:[]),...(videoOnly(t)?[`Edit(${videoRel(t)}/**)`]:[])],deny:DENY_CMDS.map(c=>`Bash(${c}:*)`)};
  }
  let codexBin=null,codexChecked=false,codexVersion=null,codexAuthCache=null,codexGen=-1;
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
      const roots=process.platform==='win32'?'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l=>`${l}:\\`).filter(d=>{try{return existsSync(d)}catch{return false}})
        :process.platform==='darwin'?['/',...macVolumes()]:['/'];// macOS: other disks are mounted under /Volumes
      const home=os.homedir(),quick=[home,join(home,'Desktop'),join(home,'Documents'),join(home,'source','repos'),join(home,'Developer'),join(home,'Projects'),join(home,'projects')].filter(d=>existsSync(d));
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
  // ---------- per-agent auto-approval (default: ask every time) ----------
  // 'commands': shell commands outside the kits run without asking (file edits still follow the permission mode);
  // 'all': also file edits inside the working folder (even in read-only mode) and the other tools. Edits outside the
  // working folder still ask. The always-blocked commands (DENY_CMDS) never reach a prompt, and commands that look
  // destructive or reach outside the machine still ask the user whatever the setting.
  const AUTO_LEVELS={ask:'Hỏi mỗi lần',commands:'Tự chạy lệnh',all:'Tự cho phép tất cả'};
  const autoOf=t=>AUTO_LEVELS[config.agentAuto?.[t.agent]]?config.agentAuto[t.agent]:'ask';
  const RISKY=/\b(rm|rmdir)\s+(-\w*[rf]|\/s)|\bdel\s+(\/[a-z]\s+)*\/[sq]|remove-item\b[^|;&]*-(recurse|force)|\bformat(-volume)?\s+[a-z]:|\bmkfs|\bdd\s+if=|\b(shutdown|reboot|halt|poweroff)\b|stop-computer|restart-computer|\bsudo\b|\brunas\b|\bchmod\s+-R\s+777|\bchown\s+-R|\b(curl|wget|iwr|invoke-webrequest|irm)\b[^|]*\|\s*(sh|bash|zsh|iex|invoke-expression|powershell)|\bgit\s+(push|reset\s+--hard|clean)|\bnpm\s+publish|\breg\s+(add|delete)|\bset-executionpolicy|\b(diskpart|bcdedit|cipher\s+\/w)/i;
  // allowed without asking: {how} when the agent's level covers this request, null when the user must be asked
  function autoDecision(t,tool,input){
    const lvl=autoOf(t);if(lvl==='ask')return null;
    const shell=tool==='Bash'||tool==='PowerShell';
    if(shell&&RISKY.test(String(input?.command||'')))return null;
    if(lvl==='all'&&editTools.has(tool)){
      const f=input?.file_path||input?.notebook_path;if(!f||!t.cwd)return null;
      const rel=relative(resolve(t.cwd),resolve(t.cwd,String(f))),inside=!rel.startsWith('..')&&!isAbsolute(rel);
      return inside?'tự cho phép tất cả':null;
    }
    if(lvl==='all')return 'tự cho phép tất cả';
    if(lvl==='commands'&&shell)return 'tự chạy lệnh';
    return null;
  }
  // A task's pending prompts are answered "no" when it ends or is stopped
  function dropPerms(t,why='Việc đã dừng.'){for(const p of t.perms||[])permDecisions.set(p.id,{decision:'deny',message:why});t.perms=[]}
  // Files uploaded but not yet attached to a task: id -> {path,name,kind,ext,at}. Dropped after an hour if unused.
  const uploads=new Map();
  function stageUpload(name,buf,meta={}){
    const ext=(name.split('.').pop()||'').toLowerCase(),kind=FILE_KINDS[ext];
    if(!kind)throw Object.assign(new Error(`Định dạng không hỗ trợ: .${ext}`),{code:400});
    for(const [id,u] of uploads)if(Date.now()-u.at>36e5){rmSync(u.path,{force:true});uploads.delete(id)}
    mkdirSync(UPLOADS_DIR,{recursive:true});
    const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const safe=(name.replace(/[^\w.() -]+/g,'_').slice(0,120))||('tep.'+ext),path=join(UPLOADS_DIR,id+'__'+safe);
    writeFileSync(path,buf);uploads.set(id,{path,name:safe,kind,ext,at:Date.now(),...meta});
    return {id,name:safe,size:buf.length,kind};
  }
  // Move the picked uploads into the task's folder inside the working dir and read text where we can
  function consumeFiles(ids,rootId,cwd){
    const dir=join(cwd,ATTACH_SUBDIR,String(rootId)),out=[];
    for(const id of (Array.isArray(ids)?ids:[]).slice(0,MAX_FILES+MAX_GOOGLE)){
      const u=uploads.get(id);if(!u||!existsSync(u.path))continue;
      mkdirSync(dir,{recursive:true});const dest=join(dir,u.name);
      try{copyFileSync(u.path,dest)}catch{continue}
      rmSync(u.path,{force:true});uploads.delete(id);
      const rel=`${ATTACH_SUBDIR}/${rootId}/${u.name}`,f={name:u.name,kind:u.kind,rel,abs:dest,src:u.src,sheet:u.sheet};
      if(u.kind==='sheet')try{f.sheets=splitSheets(dest,rel)}catch{}// unreadable workbook: the agent gets the file path only
      else f.text=fileText(dest,u.kind,u.ext);
      out.push(f);
    }
    return out;
  }
  let saveTimer=null;
  // Persisted tasks keep only the attachment names, not the inlined file text, so tasks.json stays small
  const forDisk=t=>t.files?{...t,files:t.files.map(({name,kind,rel,src,sheet,sheets})=>({name,kind,rel,src,sheet,sheets:sheets?.map(({preview,...s})=>s)}))}:t;
  const save=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>writeJson(TASKS_FILE,tasks.slice(0,KEEP).map(forDisk)),400)};
  const saveConfig=()=>writeJson(CONFIG_FILE,{workdir:config.workdir,recentDirs:config.recentDirs,mode:config.mode,browserVisible:config.browserVisible,browser:config.browser,extToken:config.extToken,agentEngines:config.agentEngines,agentAI:config.agentAI,teamKits:config.teamKits,kitsMobile:true,remote:config.remote,autoSwitch:config.autoSwitch,aiLimits:config.aiLimits,aiUpdate:config.aiUpdate,aiUpdateSkip:config.aiUpdateSkip,agentAuto:config.agentAuto,lastCheck});

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
    if(!binChecked||binGen!==cliGen()){binGen=cliGen();bin=findClaudeBinary();binChecked=true;version=bin?(await run(bin,['--version'])).stdout.trim()||null:null}
    return bin;
  }
  // Only the token signed in through the app: the CLI's own (default) account is never used
  async function auth(){return getSavedClaudeToken()?'token':null}
  async function ensureCodex(){
    if(!codexChecked||codexGen!==cliGen()){codexGen=cliGen();codexBin=findCodexBinary();codexChecked=true;codexAuthCache=null;codexVersion=codexBin?(await codexRun(codexBin,['--version'])).stdout.trim()||null:null}
    return codexBin;
  }
  // Claude Code / Codex updates (server/ai-updates.js): asked in the app or done in the background, never while a task runs on it
  const updater=createUpdater({getBin:e=>e==='claude'?bin:codexBin,getVersion:e=>e==='claude'?version:codexVersion,
    busy:e=>tasks.some(t=>t.status==='running'&&(t.engine===e||t.kind==='plan')),mode:()=>UPDATE_MODES[config.aiUpdate]?config.aiUpdate:'ask',skipped:e=>config.aiUpdateSkip?.[e]});
  async function codexAuthKind(){
    if(codexAuthCache&&Date.now()-codexAuthCache.at<60000)return codexAuthCache.kind;
    const kind=await ensureCodex()?await codexAuth(codexBin):null;
    codexAuthCache={kind,at:Date.now()};return kind;
  }
  const usesCodex=()=>Object.values(config.agentEngines).some(e=>e==='codex'||e==='both');

  // ---------- AI plan usage limits (server/ai-limits.js) ----------
  // A plan that hit its usage limit (5-hour, daily, weekly) is not used until it resets (kept in machine.json across
  // restarts); its tasks go to the other engine. Both used up: the task stops with a message saying when each resets.
  const limitOf=e=>{const l=config.aiLimits?.[e];return l&&l.until>Date.now()?l:null};
  const setLimit=(e,l)=>{(config.aiLimits??={})[e]={until:l.until,message:l.message,known:!!l.known,at:Date.now()};saveConfig()};
  const engineReady=e=>e==='claude'?!!(bin&&getSavedClaudeToken()):!!(codexBin&&codexAuthCache?.kind);
  const atTime=ms=>new Date(ms).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
  const limitText=e=>{const l=limitOf(e);return l?`${ENGINE_NAME[e]} hết hạn mức đến ${l.known?'':'khoảng '}${atTime(l.until)}`:''};
  const bothLimited=()=>!!(limitOf('claude')&&limitOf('codex'));
  const BOTH_MSG=()=>`Đã hết hạn mức sử dụng của cả hai gói AI: ${limitText('claude')}; ${limitText('codex')}. Hãy thử lại sau giờ mở lại, hoặc nâng cấp gói.`;
  // Engine for a run that would use `pref`: {engine, note} or {error}
  function routeEngine(pref){
    if(!limitOf(pref))return {engine:pref};
    const other=pref==='claude'?'codex':'claude';
    if(limitOf(other))return {error:BOTH_MSG()};
    if(config.autoSwitch===false)return {error:`${limitText(pref)}. Bật "Tự chuyển sang AI còn hạn mức" trong cửa sổ Máy cá nhân để chạy bằng ${ENGINE_NAME[other]}.`};
    if(!engineReady(other))return {error:`${limitText(pref)}; ${ENGINE_NAME[other]} chưa cài hoặc chưa đăng nhập nên không chuyển được.`};
    return {engine:other,note:`${limitText(pref)}: việc này chạy bằng ${ENGINE_NAME[other]}.`};
  }
  // A failed run: if the plan's limit was the cause, remember it and put the task back in the queue (start() reroutes)
  function limitRetry(t,engine,{text,status},note){
    const l=detectLimit(engine,{text,status});if(!l)return false;
    setLimit(engine,l);
    note('denied',`⛔ ${ENGINE_NAME[engine]} hết hạn mức sử dụng của gói (${short(l.message,160)}). Mở lại ${l.known?'lúc':'khoảng'} ${atTime(l.until)}.`,false);
    t.status='queued';t.activity=null;save();pump();return true;
  }
  const authEnv=()=>{const token=getSavedClaudeToken();return cleanEnv(token?{CLAUDE_CODE_OAUTH_TOKEN:token}:{})};

  function workdirState(dir=config.workdir){
    try{if(!existsSync(dir))return {exists:false,writable:false};if(!statSync(dir).isDirectory())return {exists:false,writable:false,error:'Không phải thư mục'};
      const probe=join(dir,`.ai-office-probe-${process.pid}`);writeFileSync(probe,'ok');rmSync(probe,{force:true});return {exists:true,writable:true}}
    catch(e){return {exists:existsSync(dir),writable:false,error:short(e.message,100)}}
  }

  // Spawns `claude -p` with the prompt on stdin and streams JSON events; returns the child and a completion promise
  function claude(args,{cwd,input,onEvent,timeout,env}){
    const child=spawn(bin,['-p','--output-format','stream-json','--verbose',...args],{cwd,env:{...authEnv(),...env},windowsHide:true,detached:process.platform!=='win32',shell:/\.(cmd|bat)$/i.test(bin)});
    // time spent waiting for the user (permission prompts) is added back with extend()
    let deadline=Date.now()+timeout;
    const done=new Promise(res=>{
      let buf='',stderr='',result=null,timedOut=false;
      const timer=setInterval(()=>{if(Date.now()>deadline){timedOut=true;clearInterval(timer);killTree(child)}},2000);
      child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let ev;try{ev=JSON.parse(line)}catch{continue}if(ev.type==='result')result=ev;onEvent?.(ev)}});
      child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000)});
      child.on('error',e=>{stderr+=e.message});
      child.on('close',code=>{clearInterval(timer);reapGroup(child);res({code,result,stderr:stderr.trim(),timedOut})});
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
    return {child,done,extend:ms=>{deadline+=ms}};
  }
  function resultError(r,{stderr,timedOut},cancelled,timeoutMs,maxTurns=MAX_TURNS){
    if(cancelled)return 'Đã dừng theo yêu cầu.';
    if(timedOut)return `Quá thời gian cho phép (${Math.round((timeoutMs||TASK_TIMEOUT)/60000)} phút).`;
    if(r?.subtype==='error_max_turns')return `Đã dùng hết ${maxTurns} bước mà chưa hoàn thành. Hãy chia nhỏ yêu cầu hoặc bấm Thử lại.`;
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
    const me=await mobileEnv(true),rn=rnProject(config.workdir);
    steps.push({name:'Kiểm thử app mobile',ok:true,detail:`${rn?`App React Native${rn.expo?' (Expo)':''} trong ${rn.rel==='.'?'thư mục làm việc':rn.rel}`:'Thư mục làm việc không phải app React Native'} · ${mobileSummary(me).join(' · ')}`});
    const lim=['claude','codex'].map(e=>limitOf(e)?limitText(e):`${ENGINE_NAME[e]} còn hạn mức`).join(' · ');
    steps.push({name:'Hạn mức gói AI',ok:!bothLimited(),detail:bothLimited()?BOTH_MSG():`${lim}${config.autoSwitch===false?' · không tự chuyển':' · tự chuyển sang AI còn hạn mức'}`});
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
Chế độ quyền: ${MODES[t.mode]}.${t.mode==='default'?(designOnly(t)?` Không tạo hoặc sửa file của dự án. Ngoại lệ duy nhất: được tạo/sửa file thiết kế (HTML/SVG) trong ${designDir(t)}, hãy làm việc đó.`:autoOf(t)==='all'?' Người dùng cho phép riêng bạn tự tạo/sửa file bên trong thư mục làm việc khi việc cần; ngoài thư mục đó thì không.':' Không tạo hoặc sửa file; chỉ đọc, phân tích và trả lời.'):' Chỉ tạo/sửa file bên trong thư mục làm việc.'}${modeNote(t)}
${(k=>k.cmds.length?`Lệnh dòng lệnh được phép dùng (qua Bash): ${k.cmds.join(', ')}. ${autoOf(t)==='ask'?'Lệnh khác cần người dùng bấm cho phép và có thể bị từ chối (khi bị từ chối thì tìm cách khác hoặc giải thích, không thử lại cùng lệnh)':'Người dùng cho phép bạn tự chạy các lệnh khác khi cần (lệnh nguy hiểm như xóa đệ quy, sudo, tải script về chạy vẫn phải chờ người dùng duyệt; khi bị từ chối thì tìm cách khác)'}; không bao giờ push code hay svn commit/update.
`:autoOf(t)!=='ask'?`Bạn được tự chạy lệnh dòng lệnh khi cần (qua Bash); lệnh nguy hiểm như xóa đệ quy, sudo, tải script về chạy vẫn phải chờ người dùng duyệt; không bao giờ push code hay svn commit/update.
`:'')(kitRules(t))}Luôn trả lời bằng tiếng Việt. Khi xong, kết thúc bằng một phần "Kết quả:" tóm tắt ngắn gọn những gì đã làm hoặc tìm được.
${t.kind==='step'?stepContext(t):''}${isDesign(t)?designGuide(t):designNote(t)}${isVideo(t)?videoGuide(t):''}${mobilePrompt(t,{rn:rnProject(t.cwd),env:mobileEnvCached(),design:isDesign(t),shotsDir:join(RUNS_DIR,String(t.id)),canEdit:t.mode==='acceptEdits'})}${CHECKLIST_GUIDE}${attachPrompt(t)}${skillPrompt(t.skills,t.cwd)}${skillsAvailablePrompt(t.engine,t.cwd,t.skills)}${t.web?webPrompt(t):''}${(t.clarifies||0)<MAX_CLARIFY?QUESTION_GUIDE:''}
GIỮ DỰ ÁN SẠCH: người dùng không muốn file thừa trong dự án. Chỉ tạo/sửa trong thư mục làm việc những file là một phần của kết quả được yêu cầu (code, cấu hình, dữ liệu hay tài liệu người dùng cần). File phụ để làm việc (script chạy thử, test tạm, dữ liệu trung gian, log, ảnh chụp kiểm tra, ghi chú) phải đặt tên bắt đầu bằng _ai_tmp (ví dụ _ai_tmp_check.py) hoặc để trong thư mục _ai_tmp/; hệ thống tự xóa chúng khi xong việc, cùng các file tạm/log/cache mới sinh ra. Không tạo file .md (báo cáo, tóm tắt, ghi chú, kế hoạch) trừ khi người dùng yêu cầu rõ; viết nội dung đó trong câu trả lời. Trong phần kết quả, liệt kê các file đã tạo hoặc sửa trong dự án.
Mức ưu tiên: ${t.priority}
Nhiệm vụ:
${t.text}`;
  }
  // ---------- leftover files ----------
  // Agents are told to keep the project clean and to give their scratch files (test scripts, logs, screenshots, notes)
  // names starting with _ai_tmp. When the last task running in a folder ends, the files and folders that appeared
  // during the run and look like leftovers are removed: _ai_tmp*, temp/log/backup files, tool caches, screenshots and
  // .md notes nobody asked for. Files that existed before the run are never touched; the log lists what was removed
  // and which new files were kept.
  const SCAN_SKIP=new Set(['node_modules','.git','.svn','dist','build','vendor','venv','.venv','coverage','.next','.nuxt','.expo','Pods','.gradle','target',ATTACH_SUBDIR,'.ai-office-design']);
  const JUNK_DIRS=new Set(['__pycache__','.pytest_cache','.mypy_cache','.ruff_cache','.playwright-mcp','.ipynb_checkpoints','_ai_tmp','.ai_tmp']);
  const TMP_NAME=/^(_ai_tmp|\.ai_tmp)/i;
  const JUNK_FILE=/^(tmp|temp|scratch|debug)[_.-]|\.(tmp|temp|log|bak|orig|rej|swp|pyc)$|^~\$|^nul$|^\.DS_Store$|^Thumbs\.db$/i;
  const SHOT_FILE=/^(screenshot|screen[_-]?shot|screen|shot|capture|snap|page|test)[\w.-]*\.(png|jpe?g|webp)$/i;
  // every file and folder under dir (paths), skipping dependency/build/app folders
  function listTree(dir,depth=0,out=new Set()){
    if(!dir||depth>6||out.size>20000)return out;let ents;try{ents=readdirSync(dir,{withFileTypes:true})}catch{return out}
    for(const e of ents){const p=join(dir,e.name);if(e.isDirectory()){if(SCAN_SKIP.has(e.name))continue;out.add(p+sep);listTree(p,depth+1,out)}else out.add(p)}
    return out;
  }
  const asked=t=>[t.text,t.request,...(t.thread||[]).map(x=>x.q),...(t.clarify||[]).map(x=>x.answer)].join(' ');
  const wantsMd=t=>/\.md\b|markdown|readme|changelog|ghi (ra|vào) file|lưu (ra |thành |vào )?file|xuất (ra )?file|tạo (một |1 )?file/i.test(asked(t));
  const wantsShots=t=>/ảnh chụp|chụp (màn hình|ảnh)|screenshot/i.test(asked(t));
  // The app's own folders stay out of git status (local .git/info/exclude, nothing in the project changes)
  function hideAppDirs(cwd){
    const info=join(cwd||'','.git','info');if(!cwd||!existsSync(info))return;
    const f=join(info,'exclude');let s='';try{s=readFileSync(f,'utf8')}catch{}
    const add=[`/${ATTACH_SUBDIR}/`,'/.ai-office-design/','_ai_tmp*'].filter(l=>!s.split(/\r?\n/).includes(l));
    if(add.length)try{writeFileSync(f,`${s}${s&&!s.endsWith('\n')?'\n':''}# AI 3D Office\n${add.join('\n')}\n`)}catch{}
  }
  // One baseline per folder while tasks run in it, so parallel tasks never remove each other's work in progress
  const runsIn=new Map();// cwd → {before:Set, ids:Set, keepMd, keepShots}
  function leftStart(t){
    if(!t.cwd)return;hideAppDirs(t.cwd);
    // a fresh picture of the folder, unless another task still works there or this task carries on after running out of steps
    let r=runsIn.get(t.cwd);if(!r||![...r.ids].some(id=>procs.has(id)&&id!==t.id||id===t.id&&t.cont)){r={before:listTree(t.cwd),ids:new Set(),keepMd:false,keepShots:false};runsIn.set(t.cwd,r)}
    r.ids.add(t.id);
  }
  function leftEnd(t,note){
    const r=runsIn.get(t.cwd);if(!r)return;
    r.keepMd||=wantsMd(t);r.keepShots||=wantsShots(t);r.ids.delete(t.id);
    if([...r.ids].some(id=>procs.has(id)))return;// another task still works here: clean when it ends
    runsIn.delete(t.cwd);
    const added=[...listTree(t.cwd)].filter(p=>!r.before.has(p)),gone=[],kept=[];
    // also new files inside a scratch folder that was already there (_ai_tmp/ left by an earlier run)
    const junk=p=>{const dir=p.endsWith(sep),name=basename(dir?p.slice(0,-1):p),parts=relative(t.cwd,dir?p.slice(0,-1):p).split(sep);
      return parts.some(x=>TMP_NAME.test(x)||JUNK_DIRS.has(x))||(dir?JUNK_DIRS.has(name):JUNK_FILE.test(name)||(!r.keepShots&&SHOT_FILE.test(name))||(!r.keepMd&&/\.md$/i.test(name)))};
    // shortest paths first, so a removed folder takes its new content with it
    for(const p of added.sort((a,b)=>a.length-b.length)){
      if(gone.some(g=>g.endsWith(sep)&&p.startsWith(g)))continue;
      if(junk(p)){try{rmSync(p,{recursive:true,force:true});gone.push(p)}catch{}}
      else if(!p.endsWith(sep))kept.push(p);
    }
    const rel=p=>relative(t.cwd,p).replace(/\\/g,'/')+(p.endsWith(sep)?'/':'');
    if(gone.length){t.cleaned=[...(t.cleaned||[]),...gone.map(rel)];note('out',`🧹 Đã xóa ${gone.length} file/thư mục tạm sinh ra khi làm việc: ${gone.map(rel).slice(0,20).join(', ')}${gone.length>20?'…':''}`,false)}
    if(kept.length)note('out',`📄 File mới giữ lại trong dự án: ${kept.map(rel).slice(0,20).join(', ')}${kept.length>20?'…':''}`,false);
  }
  // Follow-up question on a finished task. A resumed session already has the context; without one, recap it.
  // A resumed conversation still remembers the old mode from its first prompt: say what changed
  const modeNote=t=>t.modeSwitched?`\nLƯU Ý: chế độ quyền vừa được đổi từ "${MODES[t.modeSwitched]}" sang "${MODES[t.mode]}". Chế độ mới thay cho mọi điều nói trước đó về quyền.${t.mode==='acceptEdits'?' Bạn đã có công cụ Write/Edit: tự tạo/sửa file trong thư mục làm việc, không bảo người dùng copy thủ công.':' Từ giờ không tạo hoặc sửa file.'}`:'';
  function askPrompt(t,ask,resumed){
    const q=`Người dùng hỏi thêm về nhiệm vụ này. Trả lời dựa trên ngữ cảnh đã có; chỉ làm thêm việc khi câu hỏi cần, không làm lại từ đầu. Giữ nguyên vai trò, chế độ quyền và trả lời bằng tiếng Việt.
${QUESTION_GUIDE}${t.kind==='step'&&t.wf!=null&&backTo(t)?`
Nếu người dùng bảo kiểm tra lại: kiểm tra thật trên trạng thái HIỆN TẠI của thư mục làm việc (đọc file, chạy lệnh được phép), không dựa vào kết quả cũ. Còn lỗi phải sửa thì trả lại bước liên quan bằng khối rework như hướng dẫn${resumed?' dưới đây':' ở trên'}; hệ thống sẽ cho agent đó sửa rồi giao lại cho bạn kiểm tra.${resumed?backTo(t):''}`:''}
Câu hỏi thêm:
${ask.q}`+skillPrompt(ask.skills,t.cwd);
    // design images made after this session began (e.g. the designer was asked again) are listed again
    if(resumed)return q+modeNote(t)+(isDesign(t)?'':designNote(t));
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
Tiếp tục làm nhiệm vụ với thông tin này.${more}${t.web?`\n${accountsText(t)}`:''}${modeNote(t)}${skillPrompt(c.skills,t.cwd)}`;
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
  // Tokens a run used, added to the task (every run counts: answers to questions, follow-ups, retries, the plan).
  // Claude: result.modelUsage per model (main model + helpers such as Haiku), else result.usage; input excludes cache.
  // Codex: turn usage, where input_tokens includes the cached part.
  function addTokens(t,engine,{usage,modelUsage}={}){
    const runs=[];
    // dated / suffixed ids (claude-haiku-4-5-20251001, …[1m]) get their family's name
    const nice=m=>modelLabel(m)||modelLabel(String(m).replace(/\[.*\]$/,'').replace(/-\d{8}$/,''))||m;
    if(engine==='codex'){if(usage){const c=usage.cached_input_tokens||0;runs.push([modelLabel(sameTier(t.model,'codex'))||'Codex',{input:Math.max(0,(usage.input_tokens||0)-c),cacheRead:c,cacheWrite:0,output:usage.output_tokens||0}])}}
    else if(modelUsage&&Object.keys(modelUsage).length)for(const [m,u] of Object.entries(modelUsage))runs.push([nice(m),{input:u.inputTokens||0,cacheRead:u.cacheReadInputTokens||0,cacheWrite:u.cacheCreationInputTokens||0,output:u.outputTokens||0}]);
    else if(usage)runs.push([modelLabel(t.model)||'Claude',{input:usage.input_tokens||0,cacheRead:usage.cache_read_input_tokens||0,cacheWrite:usage.cache_creation_input_tokens||0,output:usage.output_tokens||0}]);
    let added=0;
    for(const [name,u] of runs){
      const n=u.input+u.cacheRead+u.cacheWrite+u.output;if(!n)continue;added+=n;
      const T=t.tokens||={input:0,cacheRead:0,cacheWrite:0,output:0,total:0,runs:0,models:{}};
      for(const k of ['input','cacheRead','cacheWrite','output'])T[k]+=u[k];T.total+=n;T.models[name]=(T.models[name]||0)+n;
    }
    if(added)t.tokens.runs++;
    return added;
  }
  // Ends a follow-up run: answer or error on the question, the task back to done, cost and turns added up
  function endAsk(t,ask,{answer,error,cost,turns,question}){
    // the answer may end with a question for the user: kept apart so the page shows it with its choices
    let qn=question||null;
    // a workflow step asked to check again may send earlier steps back (QA → dev): taken out before the answer is cut
    const rw=answer&&t.kind==='step'&&t.wf!=null?parseRework(answer):null;if(rw)answer=rw.clean;
    if(answer&&!qn){const p=parseQuestion(answer)||parseLooseQuestion(answer);if(p){qn={q:p.question,options:p.options};if(p.clean!=null)answer=p.clean||p.question}}
    Object.assign(ask,{question:qn,answer:answer?redact(String(answer).slice(0,20000)):null,error:answer?null:redact(error),finished:new Date().toISOString(),costUsd:cost??null});
    Object.assign(t,{status:'done',asking:false,activity:null,costUsd:cost!=null?(t.costUsd||0)+cost:t.costUsd,turns:turns?(t.turns||0)+turns:t.turns});
    if(rw)checkRework(t,ask,rw);
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
  // a step can send back more than once (its first run, then follow-ups): `reworks` counts them
  const sentBack=(wf,o)=>tasks.filter(x=>x.wf===wf&&x.rework&&originOf(x)===o).reduce((n,x)=>n+(x.reworks||1),0);
  function backTo(t){
    if(t.wf==null)return '';
    const plan=planSteps(t.wf),anc=ancestors(t.wf,originOf(t)),prev=plan.filter(p=>anc.has(p.id));
    return prev.length?reworkGuide(prev.map(p=>({no:plan.indexOf(p)+1,name:p.name,title:p.stepTitle})),MAX_REWORK-sentBack(t.wf,originOf(t))):'';
  }
  // A finished step that sent work back: fix steps for the targets and the steps between them and this one,
  // then this step again; later steps wait for the newest versions. Over the limit, the workflow stops here.
  // With `ask`, the send-back came from a follow-up on a finished step ("check again, send it back to dev if wrong"):
  // the block was already taken out of the answer (rw), notes go on that answer, and the step itself stays done.
  function checkRework(t,ask=null,rw=null){
    if(!rw){rw=parseRework(t.result);if(!rw)return;t.result=rw.clean}
    const addNote=s=>{if(ask)ask.answer=(ask.answer||'')+s;else t.result+=s};
    const o=originOf(t),plan=planSteps(t.wf),anc=ancestors(t.wf,o),no=id=>plan.findIndex(p=>p.id===id)+1;
    const targets=rw.to.map(n=>plan[n-1]?.id).filter(id=>id!=null&&anc.has(id));
    if(!targets.length){addNote('\n\n_(Yêu cầu trả lại bị bỏ qua vì không trỏ tới bước trước hợp lệ.)_');return}
    const used=sentBack(t.wf,o);
    if(ask&&used>=MAX_REWORK){addNote(`\n\n_(Không trả lại được: bước này đã dùng hết ${MAX_REWORK} lần trả lại sửa. Hãy thử lại bước cần sửa bằng tay.)_`);return}
    if(t.rework)t.reworks=(t.reworks||1)+1;
    t.rework={to:targets.map(id=>`#${no(id)} ${plan[no(id)-1].name}`),reason:rw.reason};
    if(ask)addNote(`\n\n↩ Đã trả lại cho ${t.rework.to.join(', ')} để sửa; sửa xong sẽ kiểm tra lại.`);
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
${ask?`Người dùng yêu cầu ${t.name} kiểm tra lại: "${short(ask.q,500)}"
Đánh giá lần kiểm tra lại này:
${String(ask.answer||'').slice(0,3500)}`:'(Đánh giá đầy đủ nằm trong "Kết quả các bước trước".)'} Hãy sửa cho đạt và nêu rõ đã sửa những gì.`
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
Các bước đã sửa xong (xem "Kết quả các bước trước"). Kiểm tra lại toàn bộ, đặc biệt các điểm đã báo.${ask?`
Yêu cầu kiểm tra lại của người dùng: ${short(ask.q,500)}`:''}`});
    tasks.unshift(again);
    // steps already waiting (e.g. a deploy after QA) now wait for the newest version of each step they depend on
    const fresh=new Set([...Object.values(made),again.id]);
    for(const x of tasks)if(x.wf===t.wf&&x.kind==='step'&&x.status==='queued'&&!fresh.has(x.id))
      x.deps=(x.deps||[]).map(d=>{const y=tasks.find(z=>z.id===d);return y?newest(t.wf,originOf(y)).id:d});
  }
  // A workflow step sees the user's original request and the results of the steps it waits for
  // Marked design images a task should follow: from the design task it was handed over from, otherwise from the newest
  // design steps of its workflow (a redone design replaces the earlier one)
  function designsFor(t){
    const src=t.designFrom!=null?[tasks.find(x=>x.id===t.designFrom)].filter(Boolean)
      :t.wf!=null?Object.values(tasks.filter(x=>x.wf===t.wf&&x.id!==t.id&&x.status==='done'&&x.designs?.length).reduce((m,x)=>{const o=x.origin??x.id;if(!m[o]||m[o].id<x.id)m[o]=x;return m},{})):[];
    return src.flatMap(x=>x.designs.filter(d=>d.marked).map(d=>({...d,png:join(designDir(x),d.png),src:join(designDir(x),d.src),by:x.name})));
  }
  function designNote(t){
    const list=designsFor(t);if(!list.length)return '';
    return `
ẢNH THIẾT KẾ ĐỂ LÀM THEO (do ${[...new Set(list.map(d=>d.by))].join(', ')} tạo, người dùng đã chọn): mở từng ảnh bằng công cụ Read để xem trước khi làm; file HTML gốc chứa đúng màu, font, cỡ chữ và khoảng cách.
${list.map((d,i)=>`${i+1}. ${d.title}: ảnh ${d.png} · HTML ${d.src}`).join('\n')}
Bám sát các ảnh này; chỗ nào làm khác ảnh thì nêu rõ lý do trong kết quả.
`;
  }
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
  // Testing a screen or a set of test cases: a script run in seconds beats one model turn per click
  const testsUi=t=>kitsFor(t.team||'').includes('test')||/qa|test|kiểm thử|tester|chất lượng/i.test(`${t.team||''} ${t.role||''} ${t.agent||''} ${t.stepTitle||''}`);
  // Codex runs commands in an OS sandbox in which Chrome cannot start (spawn EPERM): no uitest / npx playwright there,
  // the test goes through the browser tools, which run outside the sandbox
  const uiTestGuide=t=>t.engine==='codex'?`
KIỂM THỬ GIAO DIỆN (Codex): lệnh \`uitest\` và \`npx playwright test\` KHÔNG chạy được trong môi trường này (sandbox chặn mở Chrome: spawn EPERM), đừng thử. Kiểm thử bằng công cụ browser_* :
- Mỗi test case: thao tác (browser_fill_form điền nhiều ô một lần, browser_click, browser_select_option), kiểm tra kết quả bằng browser_find hoặc browser_wait_for (không đọc lại cả trang), chụp minh chứng bằng browser_take_screenshot (không truyền filename) ở bước kết luận Đạt/Không đạt.
- Nhiều test case cùng một màn hình: dùng browser_evaluate trả về đúng dữ liệu cần (ví dụ số dòng, nội dung thông báo, giá trị các ô) để kiểm tra nhiều điều trong một lượt.
- BỘ TEST LỚN: làm từng module, ghi kết quả module đó vào Excel ngay khi xong (Đạt/Không đạt, bước thực hiện, tài khoản, lỗi), rồi mới sang module sau. Hết thời gian thì báo rõ đã chạy tới đâu.
- Không ghi "Bị chặn" cho test case khi công cụ browser_* vẫn dùng được.
`:`
KIỂM THỬ GIAO DIỆN (bắt buộc khi kiểm thử màn hình/luồng/test case): KHÔNG bấm từng bước bằng công cụ browser_* (mỗi thao tác tốn một lượt, rất chậm). Làm như sau:
1. Dò trang (chỉ khi chưa biết selector): browser_navigate rồi browser_find hoặc browser_snapshot có target để lấy selector/nhãn, vài lượt là đủ. Đọc code giao diện trong dự án cũng được.
2. Dự án đã có Playwright Test (có playwright.config.* và @playwright/test) → viết spec trong thư mục test của dự án, chụp ảnh sau mỗi bước bằng page.screenshot({path}), chạy \`npx playwright test <file>\`.
3. Chưa có → viết kịch bản tests/ui/<ten-man-hinh>.mjs rồi chạy \`uitest tests/ui/<ten-man-hinh>.mjs --task ${t.id}\` (thêm --base-url <url> nếu cần, --headed nếu người dùng muốn xem). Lệnh tự mở Chrome, chạy từng bước, chụp ảnh sau MỖI bước (bước lỗi có ảnh -LOI), ghi lỗi console/JS, request hỏng và HTTP ≥400, in kết quả từng bước và lưu ảnh + ket-qua.json vào test-results/ui/<tên>-<thời gian>/. Kịch bản KHÔNG import playwright; mọi thứ được truyền vào:
\`\`\`js
export default async ({page, step, check, secret, baseURL}) => {
  await step('TC01 Mở trang đăng nhập', async () => { await page.goto(baseURL + '/login'); await check.visible(page.getByRole('button', {name: 'Đăng nhập'})); });
  await step('TC02 Sai mật khẩu báo lỗi', async () => {
    await page.fill('#username', 'demo'); await page.fill('#password', 'sai-mat-khau'); await page.click('button[type=submit]');
    await check.text(page.locator('.error'), 'Sai mật khẩu');
  });
  await step('TC03 Đăng nhập đúng', async () => {
    await page.fill('#password', secret('SITE_1_PASSWORD')); await page.click('button[type=submit]'); await check.url(/dashboard/);
  });
};
\`\`\`
   Mỗi test case là một step (tên bắt đầu bằng mã test case nếu có). check: visible(loc), hidden(loc), text(loc, chuỗi|regex), value(loc, giá trị), count(loc, n), url(regex), true(điều kiện, thông báo). Step lỗi không dừng các step sau (thêm --stop-on-fail nếu các bước phụ thuộc nhau). Mật khẩu tài khoản đã lưu: secret('SITE_n_PASSWORD'), không bao giờ viết mật khẩu vào file.
   Phiên đăng nhập được nhớ giữa các lần chạy uitest của việc này: bước đăng nhập mở trang cần vào trước, chỉ đăng nhập khi bị chuyển về trang đăng nhập. Bước chuẩn bị (đăng nhập, nạp dữ liệu) thêm {always:true} làm tham số thứ ba của step.
4. Step lỗi: lỗi do kịch bản (sai selector, chờ chưa đủ) thì sửa kịch bản rồi CHỈ chạy lại các step đó: \`uitest <file> --task ${t.id} --only "TC_A_01|TC_A_07"\` (không chạy lại cả bộ); lỗi thật của sản phẩm thì ghi nhận. Chỉ dùng browser_* để xem tận mắt khi không hiểu vì sao lỗi.
BỘ TEST LỚN (nhiều module/hàng chục test case): thời gian có hạn, làm theo từng module và lưu tiến độ liên tục:
- Dò giao diện gọn: một kịch bản dò cho cả module (in ra selector/nhãn cần dùng, không in HTML dài), không viết nhiều kịch bản dò nhỏ lẻ.
- Mỗi module một file tests/ui/<module>.mjs (phần dùng chung như đăng nhập để ở tests/ui/<ten>-common.mjs). Viết → chạy → sửa các step lỗi bằng --only → GHI NGAY kết quả module đó vào file người dùng cần cập nhật (ví dụ cột kết quả trong Excel test case), rồi mới sang module sau. Bị dừng giữa chừng thì phần đã ghi không mất.
- Không gom việc chuẩn bị nặng (mở từng bản ghi để lấy dữ liệu) vào một step dài; chỉ lấy đúng dữ liệu các test case cần.
- Hết thời gian mà chưa xong: báo rõ module/test case nào đã chạy, chưa chạy, và lệnh để chạy tiếp.
5. Giữ lại kịch bản tests/ui/… và thư mục ảnh test-results/ui/… (đó là kết quả, để chạy lại khi kiểm thử hồi quy). Kết quả trả lời: bảng test case (mã · tên · Đạt/Không đạt · ảnh minh chứng · lỗi), đường dẫn thư mục ảnh và lệnh chạy lại.
`;
  function webPrompt(t){
    return `
TRÌNH DUYỆT: Bạn có bộ công cụ trình duyệt (MCP server tên "browser": browser_navigate, browser_click, browser_type, browser_find, browser_snapshot…) điều khiển một cửa sổ Chrome thật trên máy người dùng (mở link, đăng nhập, bấm, điền form, chọn, đọc nội dung, chụp màn hình).
Được truy cập mọi trang web cần cho nhiệm vụ, không giới hạn trong thư mục làm việc.
TIẾT KIỆM TOKEN (bắt buộc): một trang đọc toàn bộ có thể dài hàng chục nghìn token và nằm lại trong ngữ cảnh ở mọi bước sau.
- Mở trang, bấm, gõ KHÔNG trả về nội dung trang. Khi cần đọc trang, dùng theo thứ tự ưu tiên: browser_find (tìm chữ hoặc regex, trả về đúng phần khớp kèm ref để bấm/gõ) → browser_snapshot có "target" (selector CSS như "form", "main", "table", "[role=dialog]" hoặc một ref) và/hoặc "depth" → browser_evaluate trả về đúng dữ liệu cần (text/JSON ngắn đã lọc). Chỉ gọi browser_snapshot cả trang khi các cách trên không đủ, và tối đa một lần cho mỗi trang.
- Điền nhiều ô một lần bằng browser_fill_form. Kiểm tra kết quả bằng browser_wait_for hoặc browser_find (ví dụ tìm thông báo thành công/lỗi) thay vì đọc lại cả trang.
- Không mở lại trang đang ở, không đọc lại phần đã đọc, không thử lại cùng một thao tác đã thất bại quá 2 lần.
- Chụp màn hình (browser_take_screenshot, KHÔNG truyền filename để ảnh tự lưu vào thư mục riêng của nhiệm vụ) chỉ ở kết quả quan trọng và lúc hoàn thành, để người dùng xem lại. Ảnh chỉ được lưu cho người dùng, bạn không nhìn thấy ảnh.
${testsUi(t)?uiTestGuide(t):''}${accountsText(t)}
XEM FILE TRÊN MÁY: trình duyệt chặn link file:// . Để mở một file trong thư mục làm việc (ví dụ trang HTML bạn vừa tạo), dùng http://localhost:${port}/api/machine/preview/${t.id}/<đường dẫn tương đối trong thư mục làm việc>, ví dụ http://localhost:${port}/api/machine/preview/${t.id}/ten-du-an/index.html (CSS, JS, ảnh đi kèm tải được bình thường).
BỊ TRANG WEB CHẶN (CAPTCHA, "unusual traffic", "trình duyệt này có thể không an toàn", "xác minh bạn là người"…): KHÔNG tìm cách vượt qua, KHÔNG thử lại liên tục (dễ bị khóa IP/tài khoản). Dừng thao tác trên trang đó và:
- Cần tìm thông tin: dùng WebSearch/WebFetch thay cho tìm kiếm Google trong trình duyệt.
- Cần tài liệu Google (Docs/Sheets/Drive): báo người dùng dùng phần kết nối Google của app hoặc đính kèm file.
- Cần đăng nhập bằng Google trên web đang test: báo người dùng cấp tài khoản đăng nhập thường của môi trường test; vẫn test tiếp các phần không cần đăng nhập.
Ghi rõ trong kết quả: trang nào bị chặn, lúc nào, phần việc nào chưa làm được vì vậy.
${(t.ownBrowser??pickBrowser(config.browser).own)?OWN_BROWSER_GUIDE:'Khi xong việc trên web, đóng trình duyệt bằng browser_close.\n'}`;
  }
  const OWN_BROWSER_GUIDE=`TRÌNH DUYỆT CỦA NGƯỜI DÙNG: bạn đang điều khiển chính trình duyệt của người dùng, nơi họ đã đăng nhập sẵn email, mạng xã hội, ngân hàng, tài khoản công ty… Bắt buộc:
- Chỉ mở và thao tác các trang cần cho nhiệm vụ này. KHÔNG đọc, tìm hay chụp email, tin nhắn, lịch sử, mật khẩu đã lưu hay dữ liệu cá nhân không liên quan.
- KHÔNG đăng xuất, không đổi cài đặt tài khoản hay trình duyệt, không cài tiện ích, không gửi/đăng/thanh toán/xóa gì thay người dùng nếu nhiệm vụ không yêu cầu rõ.
- Không đóng các tab người dùng đang mở. Khi xong việc, KHÔNG gọi browser_close (sẽ ngắt kết nối khỏi trình duyệt của người dùng).
`;
  // Per-task Playwright MCP config + secrets file (deleted when the task ends); screenshots land in the run folder
  function webSetup(t,kit={allow:[],deny:[]},extraServers={}){
    if(!MCP_CLI)throw new Error('Chưa cài Playwright MCP (@playwright/mcp). Chạy npm install trong thư mục dự án.');
    const pick=pickBrowser(config.browser),browser=pick.name;if(!browser)throw new Error('Không tìm thấy Chrome hoặc Edge trên máy để agent dùng.');
    installUiTest(pick);
    const dir=join(RUNS_DIR,String(t.id));if(!t.asking)rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
    const secrets=join(dir,'secrets.env'),list=sitesFor(t);
    writeFileSync(secrets,list.map((s,i)=>`SITE_${i+1}_PASSWORD=${quoteEnv(s.password||'')}`).join('\n')+'\n',{mode:0o600});
    // Token savers: no page snapshot or generated Playwright code after each action, console errors only,
    // screenshots saved to the run folder for the user but not sent back to the model
    // the user's own browser (extension): no fresh profile, window size, device or headless; the extension asks the
    // user which tab to share unless its token was saved in the settings
    const own=!!pick.own;t.ownBrowser=pick.own||null;
    const args=[MCP_CLI,'--browser',browser,...(browser==='firefox'?['--executable-path',pick.exe]:[]),...(own?['--extension']:['--isolated']),'--secrets',secrets,'--output-dir',dir,...(own?[]:['--viewport-size','1366x860']),
      '--snapshot-mode','none','--codegen','none','--image-responses','omit','--console-level','error','--no-webmcp',...(own?[]:[...(rnProject(t.cwd)?['--device','iPhone 15']:[]),...(config.browserVisible?[]:['--headless'])])];
    const env={...NODE_ENV,...(own&&config.extToken?{PLAYWRIGHT_MCP_EXTENSION_TOKEN:config.extToken}:{})};
    const mcp=join(dir,'mcp.json');writeFileSync(mcp,JSON.stringify({mcpServers:{browser:{command:process.execPath,args,env},...extraServers}}));
    t.siteLabels=list.map(s=>s.label);t.browser=browser;
    // Only the built-in tools a web task needs, and none of the browser tools it never uses (their schemas cost tokens every turn)
    const tools=['Read','Glob','Grep','WebFetch','WebSearch',...(t.mode==='acceptEdits'||designOnly(t)||autoOf(t)==='all'?['Write','Edit']:[]),...(kit.allow.length||autoOf(t)!=='ask'?['Bash']:[])];
    return {dir,secrets,mcpArgs:args,mcpEnv:env,args:['--mcp-config',mcp,'--strict-mcp-config','--tools',tools.join(','),'--allowedTools','mcp__browser','WebFetch','WebSearch',...kit.allow,'--disallowedTools',...WEB_TOOLS_OFF,...kit.deny]};
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
      // the user's own browser serves one task at a time (the extension connects to one agent)
      if(t.web&&pickBrowser(config.browser).own&&tasks.some(x=>x!==t&&x.status==='running'&&x.ownBrowser)){const a='Chờ việc khác dùng xong trình duyệt của bạn';if(t.activity!==a){t.activity=a;changed=true}continue}
      launch(t);
    }
    // a step stopped above may unblock nothing, but steps waiting on it must stop too
    if(changed){save();if(tasks.some(t=>t.status==='queued'&&depState(t).blocked))pump()}
  }
  // Takes a picture of the working folder first (for the diff and undo), then runs the task
  async function launch(t){
    const rn=rnProject(t.cwd||config.workdir);
    if(t.kind==='plan'){if(rn)mobileEnv().catch(()=>{});return start(t)}// the plan uses what is already known
    booting.add(t.id);
    Object.assign(t,{status:'running',activity:'Đang ghi lại trạng thái thư mục trước khi chạy…'});save();
    if(isVideo(t)){
      t.activity='Đang kiểm tra bộ công cụ video…';
      const k=await ensureVideoKit(msg=>{t.activity=msg});
      if(!k.ok){booting.delete(t.id);fail(t,k.error);pump();return}
      try{mkdirSync(videoDir(t),{recursive:true})}catch{}
    }
    // an RN app: look at the simulators/emulators now, so the prompt says what this machine can test
    if(rn){t.activity='Đang kiểm tra máy ảo iOS/Android trên máy…';await mobileEnv().catch(()=>{});try{mkdirSync(join(RUNS_DIR,String(t.id)),{recursive:true})}catch{}}
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
    // The permission mode chosen in the Máy cá nhân window applies whenever a task runs or carries on (answer, follow-up,
    // retry, later workflow steps), not only the mode it was created with. modeSwitched tells the agent in its prompt.
    t.modeSwitched=t.mode!==config.mode?t.mode:null;t.mode=config.mode;
    if(t.kind==='plan')return startPlan(t);
    // the task's model says which engine runs it; a follow-up stays with the engine that holds the conversation
    if(!t.asking)t.engine=engineOfModel(t.model)||engineOf(t.agent);
    // Codex not signed in: keep the workflow moving with Claude Code and say so in the log
    if(t.engine==='codex'&&codexAuthCache&&!codexAuthCache.kind&&bin){t.engine='claude';t.model=sameTier(t.model,'claude');t.fallback='Codex chưa đăng nhập nên bước này chạy bằng Claude Code.'}
    // the plan of the chosen engine hit its usage limit: the other one takes the run, or the task stops if both did
    const rt=routeEngine(t.engine);t.routeNote=rt.note||null;
    if(rt.error){fail(t,rt.error);pump();return}
    if(rt.engine!==t.engine&&engineOfModel(t.model))t.model=sameTier(t.model,rt.engine);
    t.engine=rt.engine;
    if(t.engine==='codex')return startCodex(t);
    const wd=workdirState(t.cwd);
    if(!bin||!getSavedClaudeToken()||!wd.writable)return fail(t,!bin?'Không tìm thấy Claude Code CLI trên máy.':!getSavedClaudeToken()?'Chưa đăng nhập tài khoản Claude trong ứng dụng.':`Thư mục làm việc không dùng được: ${t.cwd}`);
    let web=null;const kit=kitRules(t);leftStart(t);
    // Anything outside the allowed rules is asked in the page through this task's permission MCP server
    t.permToken=randomBytes(16).toString('hex');t.perms=[];
    const perm={command:process.execPath,args:[PERM_MCP],env:{...NODE_ENV,AI_OFFICE_PORT:String(port),AI_OFFICE_TASK:String(t.id),AI_OFFICE_TOKEN:t.permToken}};
    if(t.web)try{web=webSetup(t,kit,{perm})}catch(e){return fail(t,e.message)}
    let permArgs=['--permission-prompt-tool','mcp__perm__approve'];
    if(!web){const dir=join(RUNS_DIR,String(t.id)),f=join(dir,'perm-mcp.json');mkdirSync(dir,{recursive:true});writeFileSync(f,JSON.stringify({mcpServers:{perm}}));permArgs=['--mcp-config',f,...permArgs]}
    const ask=t.asking?t.thread.at(-1):null,resume=!!(ask&&t.session),reply=!ask&&!!t.reply,replyResume=reply&&!!t.session;
    // the last run used up its steps: carry on in the same session (nothing is read again), log and counters kept
    const cont=!ask&&!reply&&!!t.cont&&!!t.session;
    if(ask){Object.assign(t,{status:'running',activity:'Đang trả lời câu hỏi thêm…',log:t.log||[]});ask.started=new Date().toISOString()}
    else if(cont)Object.assign(t,{status:'running',activity:'Đang làm tiếp trong cùng phiên…',log:t.log||[]});
    else if(reply)Object.assign(t,{status:'running',activity:'Đang tiếp tục với câu trả lời của bạn…',log:t.log||[]});
    else Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Claude Code…',log:[]});
    // Step log for the progress popup: init, tool calls, their (shortened) output and Claude's own messages
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    if(t.fallback&&!ask)note('denied',t.fallback,false);
    if(t.routeNote)note('denied',t.routeNote,false);
    if(t.modeSwitched)note('init',`Chế độ quyền: ${MODES[t.mode]} (trước đó: ${MODES[t.modeSwitched]})`,false);
    if(ask)note('ask',`Hỏi thêm: ${short(ask.q,300)}${resume?'':' (gửi kèm tóm tắt ngữ cảnh)'}`,false);
    if(reply)note('ask',`Bạn trả lời: ${short(t.clarify.at(-1).answer,300)}`,false);
    const outText=c=>Array.isArray(c)?c.map(x=>x.type==='text'?x.text:x.type==='image'?'[hình ảnh]':'').join(' '):String(c??'');
    const turns=String(t.web||isVideo(t)?WEB_TURNS:MAX_TURNS);
    // Claude's AskUserQuestion tool has no one to answer it in `claude -p`, so the run would carry on guessing.
    // Stop the run there instead and let the task wait for the user's answer, like the question block does.
    let toolQ=null;const said=[];const canAsk=ask||(t.clarifies||0)<MAX_CLARIFY;
    // Browser tools loaded up front: saves the opening ToolSearch turn
    const {child,done,extend}=claude([...(resume||replyResume||cont?['--resume',t.session]:!ask&&t.resumeSession?['--resume',t.resumeSession]:[]),'--max-turns',turns,'--permission-mode',t.mode,...modelArgs(t),...(isVideo(t)?['--add-dir',KIT_SRC]:[]),...permArgs,...(web?.args||['--allowedTools','WebSearch','WebFetch',...kit.allow,'--disallowedTools',...kit.deny])],{cwd:t.cwd,input:ask?askPrompt(t,ask,resume):cont?CONT_PROMPT:reply?replyPrompt(t,replyResume):prompt(t),timeout:taskTimeout(t),env:{MCP_TOOL_TIMEOUT:'86400000',...(web?{ENABLE_TOOL_SEARCH:'false'}:{})},onEvent:ev=>{if(ev.session_id)t.session=ev.session_id;
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
      // out of steps or time on the first try: the task carries on in the same session, so its scratch files stay for now
      const willCont=!ask&&!toolQ&&t.status!=='cancelled'&&(out.timedOut||out.result?.subtype==='error_max_turns')&&!t.cont&&!!t.session;
      if(!willCont)leftEnd(t,note);
      await shootDesigns(t,note);
      await finishSnap(t,note);
      const r=out.result,cancelled=t.status==='cancelled',ok=!cancelled&&r&&!r.is_error&&r.subtype==='success';
      if(r)addTokens(t,'claude',r);
      if(toolQ&&!cancelled){
        const text=redact(said.join('\n\n').slice(0,20000));
        if(ask)return endAsk(t,ask,{answer:text||'Mình cần thêm thông tin trước khi trả lời.',question:toolQ,cost:r?.total_cost_usd,turns:r?.num_turns});
        t.reply=null;
        Object.assign(t,{status:'waiting',result:text||null,question:{...toolQ,at:new Date().toISOString()},activity:'Chờ bạn trả lời câu hỏi',finished:null,
          durationMs:Date.now()-Date.parse(t.started),costUsd:r?.total_cost_usd??t.costUsd??null});
        save();pump();return;
      }
      // The Claude plan's usage limit: back in the queue, to run on Codex (or stop if Codex is used up too)
      if(!ok&&!cancelled&&!toolQ&&limitRetry(t,'claude',{text:`${r?.result||''}\n${out.stderr}`,status:r?.api_error_status??null},note))return;
      // A pinned older version the account cannot use: run again once on the newest model of the same family
      const id=modelId(t.model),latest=LATEST[MODELS[id]?.family];
      if(!ok&&!cancelled&&latest&&latest!==id&&MODEL_MISSING.test(`${r?.result||''} ${out.stderr}`)){
        Object.assign(t,{status:'queued',model:latest,fallback:`${modelLabel(id)} không dùng được với tài khoản này, chạy lại bằng ${modelLabel(latest)}.`,activity:null});
        save();pump();return;
      }
      if(ask){
        // the saved session is gone (e.g. Claude data cleared): ask again once with a recap instead
        if(!ok&&!cancelled&&resume&&/no conversation found|session/i.test(`${r?.result||''} ${out.stderr}`)){t.session=null;t.status='queued';note('denied','Không mở lại được phiên cũ, hỏi lại kèm tóm tắt ngữ cảnh.',false);save();pump();return}
        return endAsk(t,ask,{answer:ok&&r.result,error:resultError(r,out,cancelled,taskTimeout(t),+turns),cost:r?.total_cost_usd,turns:r?.num_turns});
      }
      if(!ok&&!cancelled&&t.resumeSession&&/no conversation found/i.test(`${r?.result||''} ${out.stderr}`)){t.resumeSession=null;t.status='queued';save();pump();return}
      // the saved session cannot be continued (gone, or cut off at a question): carry on once with the exchange recapped
      if(!ok&&!cancelled&&!out.timedOut&&replyResume&&r?.subtype!=='error_max_turns'&&r?.api_error_status!==401){note('denied','Không mở lại được phiên cũ, tiếp tục kèm tóm tắt trao đổi.',false);t.session=null;t.status='queued';save();pump();return}
      // out of steps or time on the first try: one more run in the same session instead of failing
      if(willCont){
        note('denied',`${out.timedOut?`Đã hết ${Math.round(taskTimeout(t)/60000)} phút`:`Đã dùng hết ${turns} bước`}, tự làm tiếp thêm một lượt trong cùng phiên (không đọc lại từ đầu).`,false);
        Object.assign(t,{cont:{turns:r?.num_turns||(out.timedOut?0:+turns),cost:r?.total_cost_usd||0},reply:null,status:'queued',activity:null});
        save();pump();return;
      }
      const before=t.cont||{turns:0,cost:0};t.cont=null;
      t.reply=null;
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(r.result||'').slice(0,20000)):null,error:ok?null:redact(resultError(r,out,cancelled,taskTimeout(t),+turns)),
        durationMs:before.turns||before.cost||out.timedOut?Date.now()-Date.parse(t.started):r?.duration_ms??(Date.now()-Date.parse(t.started)),turns:r?.num_turns!=null?r.num_turns+before.turns:null,costUsd:r?.total_cost_usd!=null?r.total_cost_usd+before.cost:null,activity:null});
      if(ok&&!checkQuestion(t)&&t.kind==='step')checkRework(t);
      save();pump();
    });
  }
  // Director turns the request into workflow steps with one short Claude call (no tools);
  // if Claude is unavailable or its plan is unusable, the keyword planner takes over
  function startPlan(t){
    // both plans used up: say so now instead of making steps that would all stop on it
    if(bothLimited()){fail(t,BOTH_MSG());pump();return}
    Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Director đang lập kế hoạch…',log:[]});
    const note=(kind,text)=>{t.log.push({at:Date.now(),kind,text:redact(text)});t.activity=short(text,120)};
    note('init','Director bắt đầu phân tích yêu cầu và chia việc cho các agent liên quan');
    let child=null;
    // Planning runs on Claude; on Codex when Claude's plan is used up (or not signed in); keyword planner otherwise
    const input=planPrompt(t.text,t.owner,t.team)+mobilePlanNote(rnProject(t.cwd),mobileEnvCached())+attachPrompt(t);
    // the Director's own AI setting says which engine plans first; the other takes over when it is used up or not signed in
    const ok=e=>engineReady(e)&&!limitOf(e),first=engineOf(t.agent),second=first==='claude'?'codex':'claude';
    const planner=ok(first)?first:config.autoSwitch!==false&&ok(second)?second:null;
    if(planner&&planner!==first)note('denied',`${limitOf(first)?limitText(first):`${ENGINE_NAME[first]} chưa sẵn sàng`}: Director lập kế hoạch bằng ${ENGINE_NAME[planner]}.`);
    let run=null;
    if(planner==='claude')run=claude(['--max-turns','1','--tools','',...modelArgs(t)],{cwd:t.cwd,input,timeout:180000});
    else if(planner==='codex'){
      const c=codexExec(codexBin,{cwd:t.cwd,input,extra:['--ephemeral',...codexModelArgs(t)],timeout:180000});
      // same shape as a Claude result for the code below; out.limitText lets a used-up Codex plan be noticed
      run={child:c.child,done:c.done.then(o=>({result:o.message&&!o.error?{is_error:false,subtype:'success',result:o.message,num_turns:1,total_cost_usd:null}:null,usage:o.usage,stderr:o.stderr,limitText:`${o.error||''}\n${o.stderr}`}))};
    }
    if(run){child=run.child;procs.set(t.id,child)}
    save();
    (run?run.done:Promise.resolve(null)).then(out=>{
      procs.delete(t.id);
      if(out)addTokens(t,planner,planner==='codex'?{usage:out.usage}:out.result||{});
      if(t.status==='cancelled'){Object.assign(t,{error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString(),activity:null});save();pump();return}
      // the planner's plan hit its usage limit: plan again on the other engine (or with keywords if both are used up)
      if(planner&&!(out?.result&&!out.result.is_error)&&limitRetry(t,planner,{text:out?.limitText??`${out?.result?.result||''}\n${out?.stderr||''}`,status:out?.result?.api_error_status??null},note))return;
      const pq=out?.result&&!out.result.is_error&&(t.clarifies||0)<MAX_CLARIFY?parsePlanQuestion(out.result.result):null;
      if(pq){note('text',`❓ ${pq.question}`);Object.assign(t,{status:'waiting',question:{q:pq.question,options:pq.options,at:new Date().toISOString()},activity:'Chờ bạn trả lời câu hỏi',
        turns:out.result.num_turns??null,costUsd:out.result.total_cost_usd??null});save();pump();return}
      const ai=out?.result&&!out.result.is_error?parsePlan(out.result.result,t.team):null;
      if(!ai)note('denied',out?`Không đọc được kế hoạch từ ${ENGINE_NAME[planner]||'AI'}, dùng bộ chia việc theo từ khóa.`:limitOf('claude')?`${limitText('claude')} và Codex chưa sẵn sàng: dùng bộ chia việc theo từ khóa.`:'Claude Code chưa sẵn sàng, dùng bộ chia việc theo từ khóa.');
      const plan=ai||{title:'',steps:ruleSteps(t.text,t.owner,t.team)};
      t.wfTitle=plan.title||short(t.text,60);
      const ids={},who=id=>t.team.find(a=>a.id===id);
      for(const s of plan.steps){
        const a=who(s.agent),id=nextId++;ids[s.key]=id;
        tasks.unshift({id,kind:'step',wf:t.id,wfTitle:t.wfTitle,stepTitle:s.title,request:t.text,deps:s.after.map(k=>ids[k]).filter(Boolean),planDeps:s.after.map(k=>ids[k]).filter(Boolean),
          agent:s.agent,name:a.name,role:a.role,desc:a.desc,team:a.team,level:a.level,text:s.task,priority:t.priority,status:'queued',created:new Date().toISOString(),
          model:t.forcedModel||s.model,effort:t.forcedEffort||(t.forcedModel?null:s.effort),modelWhy:t.forcedModel||t.forcedEffort?'Chọn thủ công':s.why||'Director chọn',
          cwd:t.cwd,mode:t.mode,host:t.host,web:t.web||kitsFor(a.team||'').includes('browser'),siteIds:t.siteIds,engine:engineOfModel(t.forcedModel||s.model)||engineOf(s.agent),files:t.files,fileNames:t.fileNames,skills:t.skills});
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
    leftStart(t);
    const ask=t.asking?t.thread.at(-1):null,resume=!!(ask&&t.codexThread),reply=!ask&&!!t.reply,replyResume=reply&&!!t.codexThread;
    // the last run ran out of time: carry on in the same Codex thread, log and counters kept
    const cont=!ask&&!reply&&!!t.cont&&!!t.codexThread;
    if(ask){Object.assign(t,{status:'running',activity:'Đang trả lời câu hỏi thêm…',log:t.log||[]});ask.started=new Date().toISOString()}
    else if(cont)Object.assign(t,{status:'running',activity:'Đang làm tiếp trong cùng phiên…',log:t.log||[]});
    else if(reply)Object.assign(t,{status:'running',activity:'Đang tiếp tục với câu trả lời của bạn…',log:t.log||[]});
    else Object.assign(t,{status:'running',started:new Date().toISOString(),steps:0,activity:'Đang khởi động Codex…',log:[]});
    const note=(kind,text,isActivity=true)=>{text=redact(text);t.log.push({at:Date.now(),kind,text});if(t.log.length>200)t.log.shift();if(isActivity)t.activity=short(text,120)};
    if(t.routeNote)note('denied',t.routeNote,false);
    const toml=v=>JSON.stringify(v);// JSON strings/arrays are valid TOML values
    // `codex exec` never asks, so MCP calls need pre-approval; the same risky browser tools as for Claude are switched off
    const extra=web?['-c',`mcp_servers.browser.command=${toml(process.execPath)}`,'-c',`mcp_servers.browser.args=${toml(web.mcpArgs)}`,
      // the MCP server runs on the app's own Electron: without ELECTRON_RUN_AS_NODE it starts the app instead of Node
      ...Object.entries(web.mcpEnv).flatMap(([k,v])=>['-c',`mcp_servers.browser.env.${k}=${toml(v)}`]),'-c','mcp_servers.browser.default_tools_approval_mode=approve','-c',`mcp_servers.browser.disabled_tools=${toml(WEB_TOOLS_OFF.map(n=>n.replace('mcp__browser__','')))}`]:[];
    if(t.modeSwitched)note('init',`Chế độ quyền: ${MODES[t.mode]} (trước đó: ${MODES[t.modeSwitched]})`,false);
    if(ask)note('ask',`Hỏi thêm: ${short(ask.q,300)}${resume?'':' (gửi kèm tóm tắt ngữ cảnh)'}`,false);
    if(reply)note('ask',`Bạn trả lời: ${short(t.clarify.at(-1).answer,300)}`,false);
    else if(!cont){for(const f of t.files||[])if(f.kind==='image')extra.push('-i',f.abs);for(const d of designsFor(t).slice(0,8))if(existsSync(d.png))extra.push('-i',d.png)}// attach images so Codex can see them
    extra.push(...codexModelArgs(t));
    if(!ask&&!reply&&!cont&&t.model)note('init',`Model ${modelLabel(sameTier(t.model,'codex'))}${EFFORTS[t.effort]?` · suy luận ${EFFORTS[t.effort].toLowerCase()}`:''}${t.modelWhy?` · ${t.modelWhy}`:''}`,false);
    let turns=0;
    // read-only design task: its design folder is the (only writable) workspace; the project is read by its full path
    const dOnly=designOnly(t);if(dOnly)mkdirSync(designDir(t),{recursive:true});
    const vOnly=videoOnly(t);if(isVideo(t)||t.web)extra.push('-c','sandbox_workspace_write.network_access=true');// mathvid reads the voice from the Internet; uitest opens the site under test
    const {child,done}=codexExec(codexBin,{cwd:dOnly?designDir(t):vOnly?videoDir(t):t.cwd,input:ask?askPrompt(t,ask,resume):cont?CONT_PROMPT:reply?replyPrompt(t,replyResume):prompt(t),resume:resume||replyResume||cont?t.codexThread:(!ask&&t.resumeThread)||null,sandbox:t.mode==='acceptEdits'||dOnly||vOnly?'workspace-write':'read-only',extra,timeout:taskTimeout(t),onEvent:ev=>{
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
      // out of time on the first try: carry on in the same thread, so the scratch files stay for now
      const willCont=!ask&&t.status!=='cancelled'&&out.timedOut&&!t.cont&&!!t.codexThread;
      if(!willCont)leftEnd(t,note);
      await shootDesigns(t,note);
      await finishSnap(t,note);
      const cancelled=t.status==='cancelled',ok=!cancelled&&!out.timedOut&&!out.error&&out.code===0&&!!out.message;
      addTokens(t,'codex',{usage:out.usage});
      // The ChatGPT plan's usage limit: back in the queue, to run on Claude Code (or stop if Claude is used up too)
      if(!ok&&!cancelled&&!out.timedOut&&limitRetry(t,'codex',{text:`${out.error||''}\n${out.stderr}`},note))return;
      const err=cancelled?'Đã dừng theo yêu cầu.':out.timedOut?`Quá thời gian cho phép (${Math.round(taskTimeout(t)/60000)} phút).`:/not logged in|401|unauthorized/i.test((out.error||'')+out.stderr)?'Codex chưa đăng nhập hoặc phiên ChatGPT đã hết hạn. Bấm ô "Codex" trên thanh trên cùng để đăng nhập lại.':short(out.error||out.stderr||'Codex dừng mà không trả kết quả.',600);
      if(ask)return endAsk(t,ask,{answer:ok&&out.message,error:err,turns});
      if(willCont){
        note('denied',`Đã hết ${Math.round(taskTimeout(t)/60000)} phút, tự làm tiếp thêm một lượt trong cùng phiên (không đọc lại từ đầu).`,false);
        Object.assign(t,{cont:{turns:turns||0,cost:0},reply:null,status:'queued',activity:null});
        save();pump();return;
      }
      const before=t.cont||{turns:0};t.cont=null;
      t.reply=null;
      Object.assign(t,{status:cancelled?'cancelled':ok?'done':'error',finished:new Date().toISOString(),result:ok?redact(String(out.message).slice(0,20000)):null,error:ok?null:redact(err),
        durationMs:Date.now()-Date.parse(t.started),turns:turns+before.turns||null,costUsd:null,activity:null});
      if(ok&&!checkQuestion(t)&&t.kind==='step')checkRework(t);
      save();pump();
    });
  }
  function add(body){
    const text=String(body.text||'').trim();
    if(!text||text.length>8000)throw Object.assign(new Error('Nội dung nhiệm vụ trống hoặc quá dài (tối đa 8000 ký tự).'),{code:400});
    if(!/^[a-z0-9_-]{1,40}$/i.test(body.agent||''))throw Object.assign(new Error('Agent không hợp lệ.'),{code:400});
    const siteIds=Array.isArray(body.siteIds)?body.siteIds.filter(id=>sites.some(s=>s.id===id)).slice(0,10):[];
    const t={id:nextId++,agent:body.agent,name:short(body.name,60),role:short(body.role,80),desc:String(body.desc||'').slice(0,2000),team:short(body.agentTeam||'',40),level:LEVELS[body.level]?body.level:undefined,designFrom:Number.isInteger(body.designFrom)?body.designFrom:undefined,text,priority:short(body.priority||'Bình thường',30),
      status:'queued',created:new Date().toISOString(),cwd:config.workdir,mode:config.mode,host:os.hostname(),web:!!body.web||kitsFor(short(body.agentTeam||'',40)).includes('browser'),siteIds,engine:engineOf(body.agent)};
    // Model and effort: what the user forced, otherwise picked from the request and fitted to what the agent may use
    const forced=modelId(body.model),forcedEffort=EFFORTS[body.effort]?body.effort:null;
    const pick=forced?{engine:engineOfModel(forced),model:forced,effort:forcedEffort}:fitModel(aiOf(body.agent),{...pickModel(text),...(forcedEffort?{effort:forcedEffort}:{})},engineOf(body.agent));
    Object.assign(t,{engine:pick.engine,model:pick.model,effort:pick.effort,modelWhy:forced||forcedEffort?'Chọn thủ công':'Tự chọn theo nội dung yêu cầu'});
    // Workflow: a Director planning task first; it creates the steps for the relevant agents when done
    const team=Array.isArray(body.team)?body.team.filter(a=>/^[a-z0-9_-]{1,40}$/i.test(a?.id||'')).slice(0,40).map(a=>({id:a.id,name:short(a.name,60),role:short(a.role,80),desc:String(a.desc||'').slice(0,2000),team:short(teamOf(a),40),level:levelOf(a),ai:aiOf(a.id)})):[];
    if(body.workflow&&team.length){
      const d=team.find(a=>a.id==='director')||team.find(a=>a.id===body.agent)||team[0];
      // Planning is one short JSON answer: the normal-tier model of the Director's engine at medium effort, unless the user forced a stronger model
      const pe=engineOf(d.id),base=fitModel(aiOf(d.id),{model:TIER[pe].normal},pe).model,strong=forced&&MODELS[forced].rank>MODELS[base].rank;
      Object.assign(t,{kind:'plan',wf:t.id,owner:body.agent,team,agent:d.id,name:d.name,role:d.role,stepTitle:'Lập kế hoạch & phân công',engine:pe,
        forcedModel:forced,forcedEffort,model:strong?forced:base,effort:forcedEffort||'medium',modelWhy:strong?'Chọn thủ công':'Lập kế hoạch'});
    }
    // Dropped files (docx/pdf/images): move them into the task folder and remember them on the task
    const files=consumeFiles(body.files?.map(f=>f?.id),t.wf??t.id,t.cwd);
    if(files.length){t.files=files;t.fileNames=files.map(f=>f.name)}
    // skills typed as /name: their instructions go into the prompt (and to every step of a workflow)
    {const sk=skillRefs(text,t.cwd);if(sk.length)t.skills=sk}
    {const v=vcsCache.get(t.cwd)?.v||vcsKind(t.cwd);t.vcs={kind:v.kind,branch:v.branch||null,rev:v.rev||null}}
    tasks.unshift(t);if(tasks.length>KEEP)tasks.length=KEEP;save();pump();return t;
  }

  // ---------- remote access (server/remote-access.js): other computers open this office with a key ----------
  let remote=null,remoteError=null,remoteBusy=null;
  // Public link (any network): a second remote server on 127.0.0.1 that also asks for the password, reached through a
  // Cloudflare quick tunnel; independent of the LAN switch, same access key
  let pubServer=null,pubError=null;
  const tunnel=createTunnel();
  process.once('exit',()=>tunnel.stop());
  const remoteCfg=()=>config.remote||(config.remote={on:false,key:null,port:DEFAULT_REMOTE_PORT});
  // the key is shown only on this machine; a remote viewer just learns that it is connected from afar
  async function remoteInfo(viewer=false){
    const c=remoteCfg(),port=remote?.port||c.port||DEFAULT_REMOTE_PORT,T=tunnel.state();
    // public: the link carries the key, the password is typed on the device
    const pub={wanted:!!c.public?.on,hasPassword:!!c.public?.pass,state:pubError?'error':T.state,message:pubError||T.message||null,minPassword:MIN_PASSWORD,
      ...(viewer?{}:{url:T.state==='on'&&T.url?`${T.url}/?key=${encodeURIComponent(c.key||'')}`:null})};
    return {on:!!remote,wanted:!!c.on,port,error:remoteError,viewer,public:pub,
      ...(viewer?{}:{key:c.key,addresses:lanAddresses().map(a=>({...a,url:`http://${a.address}:${port}/?key=${encodeURIComponent(c.key||'')}`}))})};
  }
  async function applyRemote(){
    const c=remoteCfg();
    if(remoteBusy)await remoteBusy;
    remoteBusy=(async()=>{
      if(remote&&(!c.on||remote.port!==c.port&&c.portChanged)){await remote.close().catch(()=>{});remote=null}
      if(c.on&&!remote){
        if(!c.key){c.key=newRemoteKey();saveConfig()}
        try{remote=await createRemoteServer({targetPort:()=>port,key:()=>remoteCfg().key,port:c.port||DEFAULT_REMOTE_PORT});remoteError=null}
        catch(e){remote=null;remoteError=`Không mở được cổng ${c.port}: ${e.message}`}
      }
    })();
    await remoteBusy;remoteBusy=null;
    // public link: needs a password; the tunnel points at the 127.0.0.1-only server that asks for it
    const P=c.public||{};
    if(P.on&&P.pass){
      if(!c.key){c.key=newRemoteKey();saveConfig()}
      if(!pubServer)try{pubServer=await createRemoteServer({targetPort:()=>port,key:()=>remoteCfg().key,password:()=>remoteCfg().public?.pass,host:'127.0.0.1',port:(c.port||DEFAULT_REMOTE_PORT)+1});pubError=null}
        catch(e){pubServer=null;pubError=`Không mở được cổng cho link công khai: ${e.message}`}
      if(pubServer)tunnel.start(pubServer.port);
    }else{tunnel.stop();if(pubServer){await pubServer.close().catch(()=>{});pubServer=null}pubError=null}
  }

  async function status(req=null){
    const viewer=!!req&&isRemoteReq(req);
    const b=await ensureBin(),a=b?await auth():null,wd=workdirState(),cpus=os.cpus();
    const cb=await ensureCodex(),ca=cb?await codexAuthKind():null;
    return {
      host:{name:os.hostname(),os:`${osName()} (${os.release()})`,arch:os.arch(),cpu:cpus[0]?.model?.trim()||'?',cores:cpus.length,
        ramTotal:os.totalmem(),ramFree:os.freemem(),uptime:os.uptime(),user:os.userInfo().username,node:process.version},
      claude:{found:!!b,path:b,version,auth:a},
      codex:{found:!!cb,path:cb,version:codexVersion,auth:ca,ready:!!(cb&&ca&&wd.writable)},
      engines:ENGINES,agentEngines:config.agentEngines,agentAI:config.agentAI||{},
      config:{workdir:config.workdir,mode:config.mode,modes:MODES,defaultWorkdir:DEFAULT_WORKDIR,browserVisible:config.browserVisible,
        toolkits:Object.fromEntries(Object.entries(TOOLKITS).map(([k,v])=>[k,{short:v.short,label:v.label,write:!!v.write}])),teamKits:config.teamKits||{},defaultKits:DEFAULT_TEAM_KITS},
      browser:{mcp:!!MCP_CLI,channel:pickBrowser(config.browser).name,pick:config.browser||'auto',names:BROWSER_NAMES,ready:Object.fromEntries(Object.keys(BROWSER_NAMES).map(n=>[n,browserReady(n)])),firefox:ffInstall,own:pickBrowser(config.browser).own||null,extUrl:EXT_URL,extInstalled:{mychrome:extInstalled('chrome'),myedge:extInstalled('msedge')},extToken:!!config.extToken,sites:sites.filter(s=>!s.temp).map(siteView)},
      mobile:await mobileEnv().then(e=>({...e,summary:mobileSummary(e),project:rnProject(config.workdir)})).catch(()=>null),
      remote:await remoteInfo(viewer),
      auto:{levels:AUTO_LEVELS,agents:config.agentAuto||{}},
      updates:(updater.check().catch(()=>{}),updater.view()),
      video:videoKitState(),
      limits:{autoSwitch:config.autoSwitch!==false,both:bothLimited(),claude:limitOf('claude'),codex:limitOf('codex')},
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
  // Files a task created or edited that can be downloaded (still there, task not undone)
  const outFiles=t=>t.undone||!t.cwd?[]:(t.changes||[]).filter(c=>c.a).map(c=>c.path);
  const view=t=>({...t,outFiles:outFiles(t).slice(0,20),files:undefined,log:(t.log||[]).slice(-8),thread:undefined,asks:t.thread?.length||0,permToken:undefined,permAlways:undefined,changes:undefined,changesN:t.changes?.length||0});
  const full=t=>({...t,outFiles:outFiles(t),files:undefined,permToken:undefined,permAlways:undefined});
  // the skill list, read in the background (server/skills.js); never waits more than 3s (e.g. a macOS privacy prompt)
  const skillsNow=async(cwd,maxAge)=>{await Promise.race([loadSkills(cwd,maxAge),new Promise(r=>setTimeout(r,3000))]);return publicSkills(cwd)};
  const permCaller=(req,t)=>t?.permToken&&req.headers['x-perm-token']===t.permToken;

  const plugin={
    name:'machine-bridge',
    configureServer(server){
      // what the machine lacks (Node.js, Claude Code, Codex CLI) is installed in the background once the server runs (not during vite build)
      if(!process.env.CI&&!process.env.AI_OFFICE_SELFTEST)setTimeout(()=>{(async()=>{await ensureBin();await ensureCodex();await updater.setup()})().catch(()=>{})},3000).unref?.();
      server.httpServer?.on('listening',()=>{const a=server.httpServer.address();if(a?.port)port=a.port;if(remoteCfg().on||remoteCfg().public?.on)applyRemote()});
      server.httpServer?.once('close',()=>{remote?.close().catch(()=>{});remote=null;tunnel.stop();pubServer?.close().catch(()=>{});pubServer=null});
      if(!existsSync(config.workdir)&&config.workdir===DEFAULT_WORKDIR)try{mkdirSync(DEFAULT_WORKDIR,{recursive:true})}catch{}
      server.middlewares.use('/api/machine',async(req,res)=>{
        // Runs programs on this computer: only this computer may call it, and writes need the CSRF header
        if(!isLocal(req.socket.remoteAddress))return json(res,403,{error:'Chỉ truy cập được từ chính máy đang chạy server.'});
        if(req.method!=='GET'&&req.headers['x-ai-office']!=='1')return json(res,403,{error:'Thiếu header bảo vệ CSRF.'});
        const path=(req.url||'/').split('?')[0],m=path.match(/^\/tasks\/(\d+)\/(cancel|retry)$/);
        // through remote access (also blocked in remote-access.js): no remote settings, saved passwords or login forms
        if(isRemoteReq(req)&&(path.startsWith('/remote')||path==='/update'||path.startsWith('/sites')&&req.method!=='GET'||path.startsWith('/skills')&&req.method!=='GET'||/^\/tasks\/\d+\/login$/.test(path)))
          return json(res,403,{error:'Việc này chỉ làm được trên chính máy chạy app.'});
        try{
          if(path==='/remote'){
            if(req.method==='GET')return json(res,200,await remoteInfo());
            if(req.method==='POST'){
              const b=await readBody(req),c=remoteCfg();
              if(b.port!==undefined){const p=+b.port;if(!Number.isInteger(p)||p<1024||p>65535)return json(res,400,{error:'Cổng phải từ 1024 đến 65535.'});if(p!==c.port){c.port=p;c.portChanged=true}}
              if(b.newKey){c.key=newRemoteKey();if(remote){await remote.close().catch(()=>{});remote=null}}// old links and cookies stop working
              if(b.on!==undefined)c.on=!!b.on;
              // public link: a password of at least MIN_PASSWORD characters is required before it can be switched on
              if(b.password!==undefined){
                const pw=String(b.password||'');if(pw.length<MIN_PASSWORD||pw.length>200)return json(res,400,{error:`Mật khẩu cần từ ${MIN_PASSWORD} ký tự.`});
                c.public={...c.public,pass:hashPassword(pw)};// every device signed in before has to sign in again
              }
              if(b.public!==undefined){if(b.public&&!c.public?.pass)return json(res,400,{error:'Đặt mật khẩu truy cập trước khi bật link công khai.'});c.public={...c.public,on:!!b.public}}
              await applyRemote();delete c.portChanged;saveConfig();
              return json(res,200,await remoteInfo());
            }
          }
          if(req.method==='GET'&&path==='/status')return json(res,200,await status(req));
          // What is left of each AI plan's usage windows (?fresh=1 re-reads instead of the few-minutes cache)
          if(req.method==='GET'&&path==='/quota'){
            const fresh=/[?&]fresh=1/.test(req.url||'');await ensureCodex();
            const [claude,codex]=await Promise.all([readQuota('claude',{fresh,token:getSavedClaudeToken()}),codexBin?readQuota('codex',{fresh,bin:codexBin}):{ok:false,error:'Chưa cài Codex CLI.'}]);
            return json(res,200,{claude,codex});
          }
          // Claude Code / Codex update: {engine} installs it (hidden window), {skip:engine} stops asking for this version, {check:true} looks again
          if(req.method==='POST'&&path==='/update'){
            const b=await readBody(req);await ensureBin();await ensureCodex();
            if(b.check)await updater.check(true);
            if(b.skip==='claude'||b.skip==='codex'){const v=updater.view().engines[b.skip].latest;if(v){(config.aiUpdateSkip??={})[b.skip]=v;saveConfig()}}
            if(b.engine==='claude'||b.engine==='codex')updater.install(b.engine);
            return json(res,200,await status(req));
          }
          if(req.method==='POST'&&path==='/check'){await ensureBin();return json(res,200,{check:await check(),status:await status(req)})}
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
            if((b.browser!==undefined&&(OWN[b.browser]||OWN[config.browser])||b.extToken!==undefined)&&isRemoteReq(req))return json(res,403,{error:'Chế độ dùng trình duyệt đã đăng nhập của bạn chỉ đổi được trên chính máy chạy app.'});
            if(b.extToken!==undefined)config.extToken=String(b.extToken||'').trim().slice(0,200)||null;
            if(b.browser!==undefined){if(b.browser!=='auto'&&!BROWSER_NAMES[b.browser])return json(res,400,{error:'Trình duyệt không hợp lệ.'});config.browser=b.browser;if(b.browser==='firefox')installFirefox()}
            if(b.autoSwitch!==undefined)config.autoSwitch=!!b.autoSwitch;
            if(b.aiUpdate!==undefined){
              if(isRemoteReq(req))return json(res,403,{error:'Cài đặt cập nhật AI chỉ đổi được trên chính máy chạy app.'});
              if(!UPDATE_MODES[b.aiUpdate])return json(res,400,{error:'Chế độ cập nhật không hợp lệ.'});config.aiUpdate=b.aiUpdate;updater.check().catch(()=>{});
            }
            // which agents may run commands without asking: only from this machine, never through remote access
            if(b.agentAuto&&typeof b.agentAuto==='object'){
              if(isRemoteReq(req))return json(res,403,{error:'Quyền tự chạy lệnh của AI chỉ đổi được trên chính máy chạy app.'});
              for(const [id,lvl] of Object.entries(b.agentAuto).slice(0,60)){
                if(!/^[a-z0-9_-]{1,40}$/i.test(id)||!AUTO_LEVELS[lvl])return json(res,400,{error:'AI hoặc mức quyền không hợp lệ.'});
                config.agentAuto??={};if(lvl==='ask')delete config.agentAuto[id];else config.agentAuto[id]=lvl;
              }
            }
            // the user knows the plan is usable again (upgraded, reset early): try it on the next task
            if(b.clearLimit==='claude'||b.clearLimit==='codex')delete config.aiLimits?.[b.clearLimit];
            if(b.teamKits&&typeof b.teamKits==='object')for(const [team,list] of Object.entries(b.teamKits).slice(0,40))
              if(team.length<=40&&Array.isArray(list))(config.teamKits??={})[team]=list.filter(k=>TOOLKITS[k]);
            if(b.agent!==undefined){if(!/^[a-z0-9_-]{1,40}$/i.test(b.agent)||!ENGINES[b.engine])return json(res,400,{error:'Agent hoặc công cụ không hợp lệ.'});config.agentEngines[b.agent]=b.engine;
              // models it may use ([] = the recommended ones) and its highest reasoning effort (none = no cap)
              if(Array.isArray(b.models)||b.maxEffort!==undefined){
                const models=(Array.isArray(b.models)?b.models:[]).filter(m=>MODELS[m]&&enginesOf({engine:b.engine}).includes(MODELS[m].engine)).slice(0,30);
                const ai={...(models.length?{models}:{}),...(EFFORTS[b.maxEffort]?{maxEffort:b.maxEffort}:{})};
                config.agentAI??={};if(Object.keys(ai).length)config.agentAI[b.agent]=ai;else delete config.agentAI[b.agent];
              }}
            saveConfig();return json(res,200,await status(req));
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
            // this agent may run it without asking: allow at once and say so in the log
            const how=autoDecision(t,tool,input);
            if(how){(t.log||=[]).push({at:Date.now(),kind:'tool',text:`✅ Tự cho phép (${how}): ${describeTool({name:tool,input})}`});save();return json(res,200,{decision:'allow'})}
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
          // ---- download what a task produced: one file (?path=) or all of them as a zip ----
          const dlM=req.method==='GET'&&path.match(/^\/tasks\/(\d+)\/(file|files\.zip)$/);
          if(dlM){
            const t=tasks.find(t=>t.id===+dlM[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            const root=resolve(t.cwd||'.'),inRoot=p=>{const a=resolve(root,...String(p).split('/'));return a.startsWith(root+sep)&&existsSync(a)&&statSync(a).isFile()?a:null};
            const disp=n=>`attachment; filename="${n.replace(/[^ -~]|["\\]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(n)}`;
            res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
            if(dlM[2]==='file'){
              const p=new URL(req.url,'http://x').searchParams.get('path')||'',abs=outFiles(t).includes(p)&&inRoot(p);// only files this task changed
              if(!abs)return json(res,404,{error:'File không còn hoặc không thuộc kết quả của việc này.'});
              const size=statSync(abs).size,inline=/[?&]inline=1/.test(req.url||'')&&PLAY_TYPES[extname(abs).slice(1).toLowerCase()];
              res.setHeader('Content-Type',inline||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
              if(!inline)res.setHeader('Content-Disposition',disp(basename(abs)));
              const range=inline&&String(req.headers.range||'').match(/^bytes=(\d*)-(\d*)$/);
              if(range&&(range[1]||range[2])){
                const start=range[1]?+range[1]:Math.max(0,size-+range[2]),end=range[1]&&range[2]?Math.min(+range[2],size-1):size-1;
                if(start>=size||start>end){res.statusCode=416;res.setHeader('Content-Range',`bytes */${size}`);return res.end()}
                res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);res.setHeader('Content-Length',end-start+1);
                return createReadStream(abs,{start,end}).pipe(res);
              }
              res.setHeader('Content-Length',size);
              return createReadStream(abs).pipe(res);
            }
            let total=0;const list=[];
            for(const p of outFiles(t)){const abs=inRoot(p);if(!abs)continue;const st=statSync(abs);if((total+=st.size)>300*1024*1024)break;list.push({name:p,buf:readFileSync(abs),mtime:st.mtime})}
            if(!list.length)return json(res,404,{error:'Việc này không còn file kết quả nào.'});
            const z=makeZip(list);res.setHeader('Content-Type','application/zip');res.setHeader('Content-Length',z.length);res.setHeader('Content-Disposition',disp(`ket-qua-viec-${t.id}.zip`));
            return res.end(z);
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
          // Skills: list (for the / menu), import a .zip/.skill/SKILL.md (raw body, name in X-Filename), remove a personal one
          if(req.method==='GET'&&path==='/skills')return json(res,200,{skills:await skillsNow(config.workdir),dir:PERSONAL_DIR});
          if(req.method==='POST'&&path==='/skills/import'){
            const name=(()=>{try{return decodeURIComponent(req.headers['x-filename']||'')}catch{return String(req.headers['x-filename']||'')}})();
            if(!name)return json(res,400,{error:'Thiếu tên tệp.'});
            const buf=await new Promise((ok,bad)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>MAX_FILE){bad(Object.assign(new Error('Tệp quá lớn (tối đa 25MB).'),{code:400}));req.destroy()}else c.push(d)});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',bad)});
            const imported=importSkills(name,buf);return json(res,200,{imported,skills:await skillsNow(config.workdir,0)});
          }
          const skDel=req.method==='DELETE'&&path.match(/^\/skills\/([\w.-]{1,64})$/);
          if(skDel){removeSkill(skDel[1],config.workdir);return json(res,200,{skills:await skillsNow(config.workdir,0)})}
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
          // design images of a task (only files it listed) and the user's marks
          const dimg=req.method==='GET'&&path.match(/^\/tasks\/(\d+)\/designs\/([\w.\-]+\.png)$/i);
          if(dimg){
            const t=tasks.find(t=>t.id===+dimg[1]),d=t?.designs?.find(x=>x.png===dimg[2]);if(!d)return json(res,404,{error:'Không có ảnh.'});
            const file=join(designDir(t),d.png);if(!existsSync(file))return json(res,404,{error:'Ảnh đã bị xóa.'});
            res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');return res.end(readFileSync(file));
          }
          const dmark=req.method==='POST'&&path.match(/^\/tasks\/(\d+)\/designs$/);
          if(dmark){
            const t=tasks.find(t=>t.id===+dmark[1]);if(!t?.designs)return json(res,404,{error:'Việc này không có ảnh thiết kế.'});
            const b=await readBody(req);for(const d of t.designs)if(b.all!==undefined||d.png===b.png)d.marked=b.all!==undefined?!!b.all:!!b.marked;
            save();return json(res,200,{task:full(t)});
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
          if(req.method==='POST'&&path==='/tasks'){await ensureBin();await ensureCodex();const body=await readBody(req);
            // Google links in the request (Sheets/Docs/Drive) are downloaded now and attached like dropped files;
            // a file that needs an account stops here with a 409 the page turns into "sign in to Google"
            const g=await fetchGoogleLinks(body.text);
            if(g.length)body.files=[...(Array.isArray(body.files)?body.files.slice(0,MAX_FILES):[]),...g.map(f=>({id:stageUpload(f.name,f.buf,{src:f.src,sheet:f.sheet}).id}))];await skillsNow(config.workdir);return json(res,200,{task:view(add(body))})}
          // Delete finished tasks. A workflow goes as a whole, and only once none of its steps is running or waiting
          // (its later steps need the earlier results).
          const active=t=>t.status==='running'||t.status==='queued';
          const busyWf=new Set(tasks.filter(active).map(t=>t.wf).filter(w=>w!=null));
          const drop=list=>{
            const ids=new Set(list.map(t=>t.id));
            for(const t of list){
              rmSync(join(RUNS_DIR,String(t.id)),{recursive:true,force:true});if(t.cwd)rmSync(designDir(t),{recursive:true,force:true});// its design images go with it
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
            await skillsNow(t.cwd);
            (t.thread||=[]).push({q,at:new Date().toISOString(),...(k=>k.length?{skills:k}:{})(skillRefs(q,t.cwd))});if(t.thread.length>30)t.thread.shift();
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
            // /name in the answer: that skill's instructions go with it (and stay with the task from now on)
            await skillsNow(t.cwd);const sk=skillRefs(text,t.cwd);if(sk.length)t.skills=[...new Set([...(t.skills||[]),...sk])];
            (t.clarify||=[]).push({q:t.question.q,options:t.question.options,answer:text,at:new Date().toISOString(),...(sk.length?{skills:sk}:{})});
            t.clarifies=(t.clarifies||0)+1;
            if(t.kind==='plan')t.text+=`\n\nThông tin bổ sung (trả lời câu hỏi "${t.question.q}"): ${text}`;else t.reply=text;
            Object.assign(t,{question:null,status:'queued',urgent:true,activity:'Chờ đến lượt tiếp tục'});save();pump();
            return json(res,200,{task:full(t)});
          }
          if(req.method==='POST'&&m){
            const t=tasks.find(t=>t.id===+m[1]);if(!t)return json(res,404,{error:'Không tìm thấy nhiệm vụ.'});
            if(m[2]==='cancel'){
              if(t.status==='queued'&&t.asking){Object.assign(t.thread.at(-1),{error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});Object.assign(t,{status:'done',asking:false,activity:null})}
              else if(t.status==='queued'||t.status==='waiting'){
                // stopped while waiting to carry on after running out of steps: its scratch files are cleaned now
                if(t.cont){t.cont=null;leftEnd(t,(kind,text)=>(t.log||=[]).push({at:Date.now(),kind,text}))}
                Object.assign(t,{status:'cancelled',question:null,reply:null,error:'Đã dừng theo yêu cầu.',finished:new Date().toISOString()});
              }
              else if(t.status==='running'){t.status='cancelled';dropPerms(t);killTree(procs.get(t.id))}
            }else if(t.status==='error'||t.status==='cancelled'){
              // a planning task that already created its steps is not re-planned
              if(t.kind==='plan'&&tasks.some(x=>x.wf===t.id&&x.kind==='step'))return json(res,409,{error:'Kế hoạch đã được tạo; hãy thử lại từng bước trong luồng.'});
              Object.assign(t,{status:'queued',error:null,result:null,finished:null,started:null,steps:0,activity:null,cwd:config.workdir,mode:config.mode,created:new Date().toISOString(),blockedBy:null,fallback:null,cont:null});
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
        }catch(e){json(res,e.status||(e.code===400?400:500),{error:String(e?.message||e),...e.extra})}
      });
      server.httpServer?.once('close',()=>{for(const p of procs.values())killTree(p)});
    }
  };
  // Same middleware on the preview server: the desktop app (electron/main.js) serves the build with vite preview
  return {...plugin,configurePreviewServer:plugin.configureServer};
}
