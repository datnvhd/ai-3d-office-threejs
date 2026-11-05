// Workflow planning shared by the server (machine-bridge.js) and the browser (simulation mode).
// A request becomes ordered steps for the relevant agents, e.g. a login page: design → design review → dev → test;
// a bug fix: dev → test. On the machine the Director plans with Claude (planPrompt + parsePlan);
// ruleSteps is the keyword fallback and the planner for simulated tasks.
// Step shape: {key, agent, title, task, model, effort, why, after:[keys of steps that must finish first]}
export const MAX_STEPS=8;
// Claude models a task can run on, from Claude Code's model catalog: USD per million tokens [input, output] and
// capability rank. "auto" ones are what the Director picks from (best capability for the price); older versions are
// only offered for manual choice, as each is weaker and/or pricier than a newer one
export const MODELS={
  'claude-haiku-5-5':{label:'Haiku 5.5',family:'haiku',price:[0.1,0.5],rank:4,auto:true},
  'claude-sonnet-5-5':{label:'Sonnet 5.5',family:'sonnet',price:[2,10],rank:6,auto:true},
  'claude-opus-5-5':{label:'Opus 5.5',family:'opus',price:[4,20],rank:7,auto:true},
  'claude-opus-5':{label:'Opus 5',family:'opus',price:[5,25],rank:7},
  'claude-sonnet-5':{label:'Sonnet 5',family:'sonnet',price:[2,10],rank:4},
  'claude-opus-4-8':{label:'Opus 4.8',family:'opus',price:[5,25],rank:5},
  'claude-opus-4-7':{label:'Opus 4.7',family:'opus',price:[5,25],rank:5},
  'claude-opus-4-6':{label:'Opus 4.6',family:'opus',price:[5,25],rank:3},
  'claude-sonnet-4-6':{label:'Sonnet 4.6',family:'sonnet',price:[3,15],rank:2},
  'claude-sonnet-4-5':{label:'Sonnet 4.5',family:'sonnet',price:[3,15],rank:1},
  'claude-haiku-4-5':{label:'Haiku 4.5',family:'haiku',price:[1,5],rank:1}
};
// Newest model of each family: the fallback when a pinned version is not available, and what old family aliases meant
export const LATEST={haiku:'claude-haiku-5-5',sonnet:'claude-sonnet-5-5',opus:'claude-opus-5-5'};
export const modelId=m=>MODELS[m]?m:LATEST[m]||null;
export const modelLabel=m=>MODELS[modelId(m)]?.label||'';
// Reasoning effort (`claude --effort`); low costs about half of high, xhigh about double
export const EFFORTS={low:'Thấp',medium:'Vừa',high:'Cao',xhigh:'Rất cao',max:'Tối đa'};

const plain=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d');

// Keyword pick when no planner judged the task: Opus only for deep reasoning, Haiku for short trivial jobs, Sonnet otherwise.
// effort null keeps Claude Code's default
export function pickModel(text){
  const t=plain(text);
  if(/(kien truc|architecture|thiet ke he thong|bao mat|security|lo hong|hieu nang|performance|refactor|thuat toan|algorithm|phuc tap|chien luoc|rui ro|race condition|memory leak|deadlock)/.test(t))return {model:LATEST.opus,effort:'high'};
  if(t.length<300&&/(\bdich (?!vu)|translate|chinh ta|dinh dang|format|doi ten|rename|tom tat ngan|viet lai cau)/.test(t))return {model:LATEST.haiku,effort:'low'};
  return {model:LATEST.sonnet,effort:null};
}

export function ruleSteps(text,owner,team){
  const t=plain(text),has=id=>team.some(a=>a.id===id||teamOf(a)===BUILTIN_TEAM[id]);
  const bug=/\b(bug|fix|loi|sua loi|hong|crash|khong (chay|hoat dong|hien|load))\b/.test(t);
  const ui=/(trang|giao dien|man hinh|page|\bui\b|form|dang nhap|dang ky|login|signup|landing|dashboard|layout|\bnut\b|button|menu|popup|frontend|responsive)/.test(t);
  const be=/(dang nhap|dang ky|login|signup|api|database|co so du lieu|csdl|server|backend|xac thuc|auth|endpoint|luu tru)/.test(t);
  const data=/(phan tich|du lieu|bao cao|thong ke|kpi|\bdata\b|doanh thu)/.test(t);
  const research=/(nghien cuu|tim hieu|so sanh|khao sat|research|thi truong)/.test(t);
  const design=/(thiet ke|logo|icon|banner|mockup|wireframe|prototype)/.test(t);
  const testOnly=/(test|kiem thu|kiem tra)/.test(t)&&!bug&&!/(tao|xay|lam|viet|dung|phat trien)/.test(t);
  // Step tasks repeat the whole request, so only coding steps may climb to Opus on its keywords
  const modelFor=(agent,task)=>{const m=pickModel(task);return m.model===LATEST.opus&&!['frontend','backend'].includes(agent)?{model:LATEST.sonnet,effort:null}:m};
  const s=[];const add=(agent,title,task,after=[])=>{if(has(agent))s.push({key:'s'+(s.length+1),agent,title,task,...modelFor(agent,task),why:'Chọn theo từ khóa',after:after.filter(k=>s.some(x=>x.key===k))});return 's'+s.length};

  if(testOnly&&owner==='qa'){add('qa','Kiểm thử',text)}
  else if(bug){
    const devs=[];
    if(ui||owner==='frontend'||!be)devs.push(add('frontend','Sửa lỗi giao diện',`Tìm nguyên nhân và sửa lỗi phía giao diện: ${text}`));
    if(be||owner==='backend')devs.push(add('backend','Sửa lỗi hệ thống',`Tìm nguyên nhân và sửa lỗi phía API/hệ thống: ${text}`));
    add('qa','Kiểm thử lại',`Kiểm thử lại bản sửa và kiểm tra hồi quy cho lỗi: ${text}`,devs);
  }else if(ui){
    const d=add('designer','Thiết kế giao diện',`Thiết kế giao diện (bố cục, thành phần, màu sắc, trạng thái, responsive) cho: ${text}`);
    const r=add('director','Duyệt thiết kế','Duyệt bản thiết kế của Designer theo yêu cầu gốc: nêu điểm đạt, điểm cần chỉnh và chốt phương án để dev triển khai.',[d]);
    const devs=[add('frontend','Phát triển giao diện',`Dựng giao diện theo thiết kế đã duyệt cho: ${text}`,[r])];
    if(be)devs.push(add('backend','Phát triển API',`Xây dựng API/xử lý phía server cần cho: ${text}`,[r]));
    add('qa','Kiểm thử',`Viết và chạy test case cho tính năng: ${text}`,devs);
  }else if(be){
    const b=add('backend','Phát triển API',text);
    add('qa','Kiểm thử API',`Kiểm thử API/chức năng vừa làm: ${text}`,[b]);
  }else if(design){
    const d=add('designer','Thiết kế',text);
    add('director','Duyệt thiết kế','Duyệt bản thiết kế theo yêu cầu gốc và chốt các điểm cần chỉnh.',[d]);
  }else if(data||research){
    const first=[];
    if(research)first.push(add('research','Nghiên cứu',text));
    if(data)first.push(add('analyst','Phân tích dữ liệu',text,first));
    add('director','Tổng hợp & duyệt','Tổng hợp kết quả các bước trước thành báo cáo cuối cho người dùng.',first);
  }
  // Nothing matched: the agent the user picked does it (devs still get a test step)
  if(!s.length){const o=add(owner,'Thực hiện',text);if(['frontend','backend'].includes(owner))add('qa','Kiểm thử',`Kiểm thử kết quả: ${text}`,[o])}
  const taken=new Set();
  for(const x of s){const kind=/duyệt|tổng hợp/i.test(x.title)?'review':x.model===LATEST.opus?'hard':x.model===LATEST.haiku?'easy':'normal';x.agent=staff(team,x.agent,kind,taken)}
  return s.slice(0,MAX_STEPS);
}

export function planPrompt(text,owner,team){
  const o=team.find(a=>a.id===owner);
  return `Bạn là Director, điều phối các AI agent trong văn phòng. Người dùng vừa giao yêu cầu cho "${o?.name||owner}".
Hãy lập LUỒNG CÔNG VIỆC: chia yêu cầu thành các bước, mỗi bước giao cho đúng một agent phù hợp, theo thứ tự phụ thuộc.

Đội ngũ (id · tên · vai trò):
${team.map(a=>`- ${a.id} · ${a.name} · ${a.role} · đội ${teamOf(a)} · ${LEVELS[levelOf(a)]}${a.desc?` · mô tả: ${String(a.desc).replace(/\s+/g,' ').slice(0,300)}`:''}`).join('\n')}

Quy tắc:
- Chỉ dùng các agent liên quan; tối đa ${MAX_STEPS} bước. Việc đơn giản chỉ cần 1–2 bước.
- Mỗi đội có 1 Leader và các cấp Senior, Middle, Junior. Giao bước theo độ khó: khó, kiến trúc, rủi ro cao → Senior (hoặc Leader khi đội không có Senior); việc thông thường → Middle; việc đơn giản, lặp lại → Junior. Bước duyệt/review kết quả của đội giao cho Leader của đội đó. Các bước song song trong cùng đội giao cho những người khác nhau.
- Nếu yêu cầu quá mơ hồ để lập kế hoạch (không rõ cần làm gì, cho ai, kết quả mong muốn), thay vì kế hoạch hãy trả về đúng một khối JSON {"question":"câu hỏi ngắn","options":["lựa chọn 1","lựa chọn 2","lựa chọn 3"]} để hỏi lại người dùng. Chỉ hỏi khi thật cần; nếu có "Thông tin bổ sung" thì dùng nó để lập kế hoạch.
- "after" liệt kê key của các bước phải xong trước (chỉ được trỏ tới bước đứng trước). Các bước không phụ thuộc nhau có thể chạy song song.
- Mỗi "task" là chỉ dẫn cụ thể cho agent đó, viết bằng tiếng Việt; bước sau sẽ tự nhận kết quả của bước trước.
- Ví dụ: "Tạo trang đăng nhập" → designer thiết kế → director duyệt thiết kế → frontend dựng giao diện + backend làm API (song song) → qa kiểm thử.
- Designer tạo ẢNH thiết kế (mockup) cho từng màn hình; các bước sau (duyệt, dev, QA) tự nhận các ảnh người dùng đã chọn, nên việc có giao diện nên có bước designer trước bước dev.
- Ví dụ: "Sửa lỗi không đăng nhập được" → frontend/backend sửa lỗi → qa kiểm thử lại.
- Ví dụ: "Phân tích doanh thu quý" → analyst phân tích → director tổng hợp & duyệt.
- Bước nào cũng được TRẢ LẠI bước trước để sửa khi chưa đạt (hệ thống tự lặp: sửa → kiểm tra lại, tối đa ${MAX_REWORK} lần mỗi bước). Vì vậy với việc cần chất lượng, đặt bước qa kiểm thử hoặc director duyệt sau bước làm, và ghi rõ tiêu chí đạt trong "task" của bước kiểm tra đó.
- Chọn "model" và "effort" cho TỪNG bước: tổ hợp rẻ nhất mà vẫn làm tốt bước đó. Giá: USD cho 1 triệu token vào/ra.
  · "claude-haiku-5-5" (0,1/0,5, rẻ nhất, nhanh): việc đơn giản, máy móc: dịch, chính tả, định dạng, tóm tắt, trích thông tin có sẵn, tra một giá trị, điền form theo dữ liệu cho trước.
  · "claude-sonnet-5-5" (2/10): phần lớn công việc: tra cứu và phân tích giá/thị trường, nghiên cứu, so sánh, phân tích dữ liệu, tổng hợp báo cáo, thao tác web nhiều bước, viết code, sửa lỗi thông thường, viết và chạy test, duyệt thiết kế.
  · "claude-opus-5-5" (4/20, mạnh nhất): cần suy luận sâu: kiến trúc hoặc thiết kế hệ thống, bảo mật, lỗi khó tìm nguyên nhân, thuật toán phức tạp, quyết định rủi ro cao.
  · "effort" là mức suy luận: "low" việc máy móc, "medium" việc thông thường, "high" việc cần cân nhắc kỹ, "xhigh" bài khó nhiều bước suy luận. Effort tăng chi phí đáng kể (low khoảng một nửa high, xhigh khoảng gấp đôi high). Với việc chỉ khó vừa phải, tăng effort trước khi chuyển lên model đắt hơn.
  · "why": một câu ngắn nêu lý do chọn model và effort đó.

Chỉ trả về đúng MỘT khối JSON, không kèm giải thích:
{"title":"tên ngắn của luồng","steps":[{"key":"s1","agent":"designer","title":"Thiết kế giao diện","task":"...","model":"claude-sonnet-5-5","effort":"medium","why":"Thiết kế theo yêu cầu rõ ràng, không cần suy luận sâu","after":[]}]}

Yêu cầu của người dùng:
${text}`;
}

// Validates the planner's JSON; returns {title, steps} or null
export function parsePlan(raw,team){
  const m=String(raw||'').match(/\{[\s\S]*\}/);if(!m)return null;
  let p;try{p=JSON.parse(m[0])}catch{return null}
  if(!Array.isArray(p?.steps)||!p.steps.length)return null;
  const steps=[],keys=new Set();
  for(const x of p.steps.slice(0,MAX_STEPS)){
    const key=String(x?.key||'').slice(0,20);
    if(!key||keys.has(key)||!team.some(a=>a.id===x.agent)||!String(x.task||'').trim())return null;
    // An unknown model falls back to the keyword pick; max effort is never chosen automatically
    const id=modelId(x.model),pick=id?{model:id,effort:EFFORTS[x.effort]&&x.effort!=='max'?x.effort:null}:pickModel(x.task);
    steps.push({key,agent:x.agent,title:String(x.title||'Bước '+(steps.length+1)).slice(0,80),task:String(x.task).slice(0,4000),...pick,why:id?String(x.why||'').slice(0,160):'Chọn theo từ khóa',after:(Array.isArray(x.after)?x.after:[]).map(String).filter(k=>keys.has(k))});
    keys.add(key);
  }
  return {title:String(p.title||'').slice(0,80),steps};
}

// ---------- Send back for rework ----------
// Any workflow step may send earlier steps back to be fixed (QA → dev, Director → designer…). The server (and the
// simulation) then runs a fix step for each, redoes the steps in between, and gives the reviewer another round.
export const MAX_REWORK=3;
// Prompt part for a step that has earlier steps: prev = [{no,name,title}], left = send-backs this step has left
export function reworkGuide(prev,left){
  return `
TRẢ LẠI ĐỂ SỬA: nếu phần việc của bước trước còn lỗi hoặc chưa đạt yêu cầu gốc đến mức phải sửa (không dùng cho góp ý nhỏ), bạn được trả lại cho agent đã làm bước đó. Hệ thống sẽ cho agent đó sửa, rồi giao lại cho bạn kiểm tra.
Các bước trước:
${prev.map(p=>`- #${p.no} ${p.name} · ${p.title}`).join('\n')}
Cách trả lại: vẫn viết đầy đủ đánh giá (lỗi cụ thể, cách tái hiện, tiêu chí chưa đạt, cách sửa đề xuất), rồi đặt ở CUỐI CÙNG (sau phần "Kết quả:") đúng một khối:
\`\`\`rework
{"to":[${prev[prev.length-1].no}],"reason":"tóm tắt ngắn điều phải sửa"}
\`\`\`
"to" là số thứ tự các bước cần sửa (một hoặc nhiều). Đạt yêu cầu thì KHÔNG thêm khối này.
${left>0?`Bạn còn ${left} lần trả lại.`:'Đã hết lượt trả lại: nếu vẫn chưa đạt, vẫn thêm khối rework; luồng sẽ dừng để người dùng quyết định.'}
`;
}
// Finds the rework block in a step's answer: {to:[step numbers], reason, clean: the answer without the block} or null
export function parseRework(text){
  const m=String(text||'').match(/```rework\s*([\s\S]*?)```/i);if(!m)return null;
  let j;try{j=JSON.parse(m[1])}catch{return null}
  const to=[...new Set((Array.isArray(j?.to)?j.to:[j?.to]).map(Number).filter(n=>Number.isInteger(n)&&n>0))];
  if(!to.length)return null;
  return {to,reason:String(j.reason||'').trim().slice(0,600)||'Chưa đạt yêu cầu',clean:String(text).replace(m[0],'').trim()};
}

// ---------- Teams and levels ----------
// Every agent belongs to a team (built-in agents: their own) and has a level; each team has exactly one Leader.
export const LEVELS={leader:'Leader',senior:'Senior',middle:'Middle',junior:'Junior'};
export const BUILTIN_TEAM={director:'Ban điều hành',research:'Research',frontend:'Frontend',backend:'Backend',analyst:'Data',designer:'Design',qa:'QA'};
export const teamOf=a=>a?.team||BUILTIN_TEAM[a?.id]||a?.role||a?.id||'';
export const levelOf=a=>LEVELS[a?.level]?a.level:BUILTIN_TEAM[a?.id]?'leader':'middle';
const RANK={leader:3,senior:2,middle:1,junior:0};
// One Leader per team: none → the most senior member is promoted; several → the first stays, the others become Senior
export function normalizeLeaders(list){
  const byTeam=new Map();for(const a of list){const t=teamOf(a);if(!byTeam.has(t))byTeam.set(t,[]);byTeam.get(t).push(a)}
  for(const members of byTeam.values()){
    const leads=members.filter(a=>levelOf(a)==='leader');
    if(!leads.length){const top=[...members].sort((a,b)=>RANK[levelOf(b)]-RANK[levelOf(a)])[0];top.level='leader'}
    else leads.slice(1).forEach(a=>a.level='senior');
    for(const a of members)a.level=levelOf(a);
  }
  return list;
}
// Who in a team takes a step: a review goes to the Leader; hard work to a Senior, normal work to a Middle, easy work to a
// Junior, falling back to the nearest level. Members already given a step in this plan come last, so work spreads out.
const PREF={review:['leader','senior','middle','junior'],hard:['senior','leader','middle','junior'],normal:['middle','senior','junior','leader'],easy:['junior','middle','senior','leader']};
export function staff(team,anchorId,kind,taken=new Set()){
  const anchor=team.find(a=>a.id===anchorId),t=anchor?teamOf(anchor):BUILTIN_TEAM[anchorId];
  const members=team.filter(a=>teamOf(a)===t);if(!members.length)return anchorId;
  for(const lv of PREF[kind]||PREF.normal){const c=members.filter(a=>levelOf(a)===lv);if(!c.length)continue;
    const free=c.filter(a=>!taken.has(a.id)),pick=(free.length?free:c)[Math.random()*(free.length||c.length)|0];taken.add(pick.id);return pick.id}
  return anchorId;
}

// ---------- Asking back when information is missing ----------
// An agent that cannot make a sensible assumption ends its answer with a question block; the task then waits for the
// user, who picks one of the options or writes their own answer, and the agent carries on in the same conversation.
export const MAX_CLARIFY=3;
export const QUESTION_GUIDE=`
THIẾU THÔNG TIN: nếu thiếu thông tin quan trọng mà không thể tự giả định hợp lý (ví dụ không rõ dùng công nghệ nào, cho đối tượng nào, phạm vi tới đâu, dữ liệu ở đâu), ĐỪNG đoán. Dừng lại, nói ngắn gọn vì sao cần hỏi, rồi đặt ở CUỐI CÙNG đúng một khối:
\`\`\`question
{"question":"câu hỏi ngắn, rõ ràng","options":["lựa chọn 1","lựa chọn 2","lựa chọn 3"]}
\`\`\`
2–5 lựa chọn ngắn, cụ thể (người dùng cũng có thể tự nhập câu trả lời khác). Gộp mọi điều cần hỏi vào một câu hỏi. Nếu có thể tự giả định hợp lý thì cứ làm và ghi rõ giả định trong phần kết quả, không hỏi.
Bạn đang chạy không tương tác: chỉ khối question ở trên mới hiện ô cho người dùng trả lời, và việc sẽ dừng chờ đến khi họ trả lời. Khi đã làm xong thì đừng kết thúc bằng câu hỏi (kể cả câu gợi ý kiểu "Bạn có muốn tôi… không?"), vì câu hỏi ở cuối sẽ được coi là cần người dùng trả lời.
`;
// Fallback when the agent asks in plain text instead of a question block: the answer ends with a question
// (optionally followed by a short list of choices), so the task should wait for the user instead of carrying on
export function parseLooseQuestion(text){
  const strip=l=>l.replace(/^[>#\s]+/,'').replace(/\*\*|__/g,'').trim();
  const lines=String(text||'').replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  let end=lines.length;const opts=[];
  while(end>0&&opts.length<7&&/^([-*•]|\d+[.)]|[a-eA-E][.)])\s+/.test(lines[end-1]))opts.unshift(strip(lines[--end].replace(/^([-*•]|\d+[.)]|[a-eA-E][.)])\s+/,'')));
  if(opts.length>6)return null;
  const q=strip(lines[end-1]||'');
  if(!/[?？]\s*:?$/.test(q)||q.length>500)return null;
  return {question:q,options:cleanOptions(opts)};
}
const cleanOptions=o=>(Array.isArray(o)?o:[]).map(x=>String(x).trim().slice(0,160)).filter(Boolean).slice(0,6);
export function parseQuestion(text){
  const m=String(text||'').match(/```question\s*([\s\S]*?)```/i);if(!m)return null;
  let j;try{j=JSON.parse(m[1])}catch{return null}
  const q=String(j?.question||'').trim().slice(0,500);if(!q)return null;
  return {question:q,options:cleanOptions(j.options),clean:String(text).replace(m[0],'').trim()};
}
// The Director's planning answer is JSON; a too-vague request gets {"question":…,"options":[…]} instead of steps
export function parsePlanQuestion(raw){
  const m=String(raw||'').match(/\{[\s\S]*\}/);if(!m)return null;
  let j;try{j=JSON.parse(m[0])}catch{return null}
  if(Array.isArray(j?.steps)&&j.steps.length||!String(j?.question||'').trim())return null;
  return {question:String(j.question).trim().slice(0,500),options:cleanOptions(j.options)};
}
