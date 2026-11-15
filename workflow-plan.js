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
  'claude-haiku-5-5':{label:'Haiku 5.5',engine:'claude',family:'haiku',price:[0.1,0.5],rank:4,auto:true},
  'claude-sonnet-5-5':{label:'Sonnet 5.5',engine:'claude',family:'sonnet',price:[2,10],rank:6,auto:true},
  'claude-opus-5-5':{label:'Opus 5.5',engine:'claude',family:'opus',price:[4,20],rank:7,auto:true},
  'claude-opus-5':{label:'Opus 5',engine:'claude',family:'opus',price:[5,25],rank:7},
  'claude-sonnet-5':{label:'Sonnet 5',engine:'claude',family:'sonnet',price:[2,10],rank:4},
  'claude-opus-4-8':{label:'Opus 4.8',engine:'claude',family:'opus',price:[5,25],rank:5},
  'claude-opus-4-7':{label:'Opus 4.7',engine:'claude',family:'opus',price:[5,25],rank:5},
  'claude-opus-4-6':{label:'Opus 4.6',engine:'claude',family:'opus',price:[5,25],rank:3},
  'claude-sonnet-4-6':{label:'Sonnet 4.6',engine:'claude',family:'sonnet',price:[3,15],rank:2},
  'claude-sonnet-4-5':{label:'Sonnet 4.5',engine:'claude',family:'sonnet',price:[3,15],rank:1},
  'claude-haiku-4-5':{label:'Haiku 4.5',engine:'claude',family:'haiku',price:[1,5],rank:1},
  // Codex (ChatGPT plan, `codex exec -m`): from Codex CLI's model list; usage counts against the ChatGPT plan, no per-token price
  'gpt-6-luna':{label:'GPT-6 Luna',engine:'codex',family:'luna',rank:4,auto:true},
  'gpt-6.1-sol':{label:'GPT-6.1 Sol',engine:'codex',family:'sol',rank:6,auto:true},
  'gpt-6-astra':{label:'GPT-6 Astra',engine:'codex',family:'astra',rank:7,auto:true},
  'gpt-6.1-terra':{label:'GPT-6.1 Terra',engine:'codex',family:'terra',rank:5},
  'gpt-6-sol':{label:'GPT-6 Sol',engine:'codex',family:'sol',rank:4},
  'gpt-5.6-sol':{label:'GPT-5.6 Sol',engine:'codex',family:'sol',rank:3},
  'gpt-5.6-terra':{label:'GPT-5.6 Terra',engine:'codex',family:'terra',rank:2},
  'gpt-5.6-luna':{label:'GPT-5.6 Luna',engine:'codex',family:'luna',rank:1}
};
// Newest model of each family: the fallback when a pinned version is not available, and what old family aliases meant
export const LATEST={haiku:'claude-haiku-5-5',sonnet:'claude-sonnet-5-5',opus:'claude-opus-5-5',luna:'gpt-6-luna',sol:'gpt-6.1-sol',astra:'gpt-6-astra',terra:'gpt-6.1-terra'};
export const modelId=m=>MODELS[m]?m:LATEST[m]||null;
export const modelLabel=m=>MODELS[modelId(m)]?.label||'';
// Reasoning effort (`claude --effort`, Codex `model_reasoning_effort`); low costs about half of high, xhigh about double
export const EFFORTS={low:'Thấp',medium:'Vừa',high:'Cao',xhigh:'Rất cao',max:'Tối đa'};
const EFFORT_ORDER=Object.keys(EFFORTS);

// ---------- Which AI each agent may use ----------
// Per agent (machine.json agentEngines + agentAI): engine 'claude' | 'codex' | 'both', the models it may use
// ([] = the recommended ones) and the highest reasoning effort a task may get.
export const ENGINE_NAMES={claude:'Claude Code',codex:'Codex (ChatGPT)',both:'Claude + Codex'};
// Difficulty tier → recommended model of each engine
export const TIER={claude:{easy:'claude-haiku-5-5',normal:'claude-sonnet-5-5',hard:'claude-opus-5-5'},codex:{easy:'gpt-6-luna',normal:'gpt-6.1-sol',hard:'gpt-6-astra'}};
const TIER_OF={haiku:'easy',luna:'easy',sonnet:'normal',sol:'normal',terra:'normal',opus:'hard',astra:'hard'};
export const tierOf=m=>TIER_OF[MODELS[modelId(m)]?.family]||'normal';
export const engineOfModel=m=>MODELS[modelId(m)]?.engine||null;
// The same-tier model on another engine (a Claude task moved to Codex, or the other way round)
export const sameTier=(m,engine)=>engineOfModel(m)===engine?modelId(m):TIER[engine][tierOf(m)];
export const enginesOf=ai=>ai?.engine==='both'?['claude','codex']:[ai?.engine==='codex'?'codex':'claude'];
export function allowedModels(ai,engine){
  const all=Object.keys(MODELS).filter(m=>MODELS[m].engine===engine);
  return ai?.models?.length?all.filter(m=>ai.models.includes(m)):all.filter(m=>MODELS[m].auto);
}
export const capEffort=(effort,max)=>EFFORTS[effort]&&EFFORTS[max]&&EFFORT_ORDER.indexOf(effort)>EFFORT_ORDER.indexOf(max)?max:effort;
// Fits a {model, effort} pick to what the agent may use: its engine(s) (prefer = engine to try first when it may use both),
// an allowed model of the same difficulty (else the closest in strength) and at most its highest effort. Returns {engine, model, effort}.
export function fitModel(ai,pick,prefer){
  const engines=enginesOf(ai).filter(e=>allowedModels(ai,e).length);if(!engines.length)engines.push(enginesOf(ai)[0]);
  const want=engineOfModel(pick.model);
  const engine=engines.includes(want)?want:engines.includes(prefer)?prefer:engines[0];
  let list=allowedModels(ai,engine);if(!list.length)list=allowedModels(null,engine);
  const target=sameTier(pick.model||TIER.claude.normal,engine);
  const model=list.includes(target)?target:[...list].sort((a,b)=>Math.abs(MODELS[a].rank-MODELS[target].rank)-Math.abs(MODELS[b].rank-MODELS[target].rank)||MODELS[b].rank-MODELS[a].rank)[0];
  return {engine,model,effort:capEffort(pick.effort,ai?.maxEffort)||null};
}
// One line for the planner: which AI an agent uses
const aiLine=a=>{const ai=a.ai;if(!ai)return '';const ms=enginesOf(ai).flatMap(e=>allowedModels(ai,e));
  return ` · AI: ${ENGINE_NAMES[ai.engine]||ENGINE_NAMES.claude} · model được dùng: ${ms.join(', ')}${ai.maxEffort?` · effort tối đa: ${ai.maxEffort}`:''}`};

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
  // a video request goes to the team's video agent (team "Video"), with the facts and script first and a check after
  const vid=team.find(a=>/^video/i.test(teamOf(a)));
  const video=!!vid&&/(video|clip|tiktok|reels|shorts|\bmp4\b)/.test(t);
  // Step tasks repeat the whole request, so only coding steps may climb to Opus on its keywords
  const modelFor=(agent,task)=>{const m=pickModel(task);return m.model===LATEST.opus&&!['frontend','backend'].includes(agent)?{model:LATEST.sonnet,effort:null}:m};
  const s=[];const add=(agent,title,task,after=[])=>{if(has(agent))s.push({key:'s'+(s.length+1),agent,title,task,...modelFor(agent,task),why:'Chọn theo từ khóa',after:after.filter(k=>s.some(x=>x.key===k))});return 's'+s.length};

  const creative=/(to tinh|lang man|valentine|crush|nguoi yeu|ky niem|sinh nhat|chuc mung|tri an|20\/11|8\/3|cam on|dong vien|tang (ban|em|anh|co|thay|me|bo))/.test(t);
  if(video&&creative){add(vid.id,'Dựng video',text)}
  else if(video){
    const r=add('research','Kiến thức & kịch bản',`Soạn nội dung cho một video toán ngắn (30–60 giây, học sinh phổ thông): một ý chính, kiến thức đúng SGK, ví dụ số đã tính lại, sai lầm hay gặp, và kịch bản lời đọc 6–9 đoạn ngắn có câu mở đầu gây tò mò. Yêu cầu: ${text}`);
    const v=add(vid.id,'Dựng video',text,[r]);
    add('qa','Kiểm tra video','Kiểm tra video vừa dựng: đọc ảnh khung hình (_frames.png) và kịch bản trong thư mục video-toan của việc này; soát kiến thức toán, chính tả, chữ bị tràn/che, độ khớp lời–hình. Chưa đạt thì trả lại bước dựng video kèm danh sách cần sửa.',[v]);
  }
  else if(testOnly&&owner==='qa'){add('qa','Kiểm thử',text)}
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
  for(const x of s){const kind=/duyệt|tổng hợp/i.test(x.title)?'review':x.model===LATEST.opus?'hard':x.model===LATEST.haiku?'easy':'normal';x.agent=staff(team,x.agent,kind,taken);
    Object.assign(x,fitModel(team.find(a=>a.id===x.agent)?.ai,x))}
  return s.slice(0,MAX_STEPS);
}

export function planPrompt(text,owner,team){
  const o=team.find(a=>a.id===owner);
  return `Bạn là Director, điều phối các AI agent trong văn phòng. Người dùng vừa giao yêu cầu cho "${o?.name||owner}".
Hãy lập LUỒNG CÔNG VIỆC: chia yêu cầu thành các bước, mỗi bước giao cho đúng một agent phù hợp, theo thứ tự phụ thuộc.

Đội ngũ (id · tên · vai trò):
${team.map(a=>`- ${a.id} · ${a.name} · ${a.role} · đội ${teamOf(a)} · ${LEVELS[levelOf(a)]}${aiLine(a)}${a.desc?` · mô tả: ${String(a.desc).replace(/\s+/g,' ').slice(0,300)}`:''}`).join('\n')}

Quy tắc:
- Chỉ dùng các agent liên quan; tối đa ${MAX_STEPS} bước. Việc đơn giản chỉ cần 1–2 bước.
- Mỗi đội có 1 Leader và các cấp Senior, Middle, Junior. Giao bước theo độ khó: khó, kiến trúc, rủi ro cao → Senior (hoặc Leader khi đội không có Senior); việc thông thường → Middle; việc đơn giản, lặp lại → Junior. Bước duyệt/review kết quả của đội giao cho Leader của đội đó. Các bước song song trong cùng đội giao cho những người khác nhau.
- Nếu yêu cầu quá mơ hồ để lập kế hoạch (không rõ cần làm gì, cho ai, kết quả mong muốn), thay vì kế hoạch hãy trả về đúng một khối JSON {"question":"câu hỏi ngắn","options":["lựa chọn 1","lựa chọn 2","lựa chọn 3"]} để hỏi lại người dùng. Chỉ hỏi khi thật cần; nếu có "Thông tin bổ sung" thì dùng nó để lập kế hoạch.
- "after" liệt kê key của các bước phải xong trước (chỉ được trỏ tới bước đứng trước). Các bước không phụ thuộc nhau có thể chạy song song.
- Mỗi "task" là chỉ dẫn cụ thể cho agent đó, viết bằng tiếng Việt; bước sau sẽ tự nhận kết quả của bước trước.
- Ví dụ: "Tạo trang đăng nhập" → designer thiết kế → director duyệt thiết kế → frontend dựng giao diện + backend làm API (song song) → qa kiểm thử.
- Designer tạo ẢNH thiết kế (mockup) cho từng màn hình; các bước sau (duyệt, dev, QA) tự nhận các ảnh người dùng đã chọn, nên việc có giao diện nên có bước designer trước bước dev.
- Việc lớn gồm nhiều phần độc lập của đội QA, BA, Research, Data hoặc Marketing (bộ test case nhiều module, đặc tả nhiều module, nghiên cứu nhiều đối thủ, phân tích nhiều bộ dữ liệu, nhiều bài nội dung): giao MỘT bước cho Leader đội đó. Leader tự chia cho các thành viên trong đội làm song song rồi tổng hợp, nên KHÔNG tự tách thành nhiều bước cùng đội. Việc code của dev không chia kiểu này.
- Ví dụ: "Sửa lỗi không đăng nhập được" → frontend/backend sửa lỗi → qa kiểm thử lại.
- Ví dụ: "Làm video TikTok giải thích hàm số bậc hai" → research soạn kiến thức & kịch bản lời đọc → agent đội Video dựng video MP4 (chỉ agent đội Video làm được video) → qa xem khung hình, soát kiến thức và chính tả (có thể trả lại để sửa). Có agent Marketing thì có thể thêm bước viết caption/hashtag song song với QA. Video sáng tạo/cảm xúc bằng toán (tỏ tình, sinh nhật, tri ân thầy cô…) chỉ cần agent đội Video (1 bước), không cần research.
- Ví dụ: "Phân tích doanh thu quý" → analyst phân tích → director tổng hợp & duyệt.
- Bước nào cũng được TRẢ LẠI bước trước để sửa khi chưa đạt (hệ thống tự lặp: sửa → kiểm tra lại, tối đa ${MAX_REWORK} lần mỗi bước). Vì vậy với việc cần chất lượng, đặt bước qa kiểm thử hoặc director duyệt sau bước làm, và ghi rõ tiêu chí đạt trong "task" của bước kiểm tra đó.
- Chọn "model" và "effort" cho TỪNG bước: tổ hợp rẻ nhất mà vẫn làm tốt bước đó. Mỗi agent dùng Claude, Codex hoặc cả hai (xem "AI" và "model được dùng" của agent): CHỈ chọn model trong danh sách được dùng của agent nhận bước đó và không vượt "effort tối đa". Agent dùng cả hai thì chọn bên hợp việc hơn (ví dụ Codex cho code/thiết kế ảnh, Claude cho phân tích/viết), hoặc chia các bước song song cho cả hai để giảm tải hạn mức.
  Claude (giá USD cho 1 triệu token vào/ra):
  · "claude-haiku-5-5" (0,1/0,5, rẻ nhất, nhanh): việc đơn giản, máy móc: dịch, chính tả, định dạng, tóm tắt, trích thông tin có sẵn, tra một giá trị, điền form theo dữ liệu cho trước.
  · "claude-sonnet-5-5" (2/10): phần lớn công việc: tra cứu và phân tích giá/thị trường, nghiên cứu, so sánh, phân tích dữ liệu, tổng hợp báo cáo, thao tác web nhiều bước, viết code, sửa lỗi thông thường, viết và chạy test, duyệt thiết kế.
  · "claude-opus-5-5" (4/20, mạnh nhất): cần suy luận sâu: kiến trúc hoặc thiết kế hệ thống, bảo mật, lỗi khó tìm nguyên nhân, thuật toán phức tạp, quyết định rủi ro cao.
  Codex (tính vào hạn mức gói ChatGPT, cùng ba mức độ khó):
  · "gpt-6-luna" (nhanh, tiết kiệm): việc đơn giản như Haiku.
  · "gpt-6.1-sol" (mô hình chính cho code và việc hằng ngày): việc thông thường như Sonnet.
  · "gpt-6-astra" (mạnh nhất): việc khó như Opus.
  Các model khác trong danh sách được dùng của agent (bản cũ hơn) chỉ chọn khi agent không có model khuyên dùng phù hợp.
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
    const id=modelId(x.model),pick=fitModel(team.find(a=>a.id===x.agent).ai,id?{model:id,effort:EFFORTS[x.effort]&&x.effort!=='max'?x.effort:null}:pickModel(x.task));
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

// ---------- Split a step across the team ----------
// A big step of a team whose work splits cleanly (QA test suites, BA specs, research topics, data sets, marketing
// content) may be split: the agent answers with a split block, the server gives each part to a teammate (parts run at
// the same time), then the same agent merges the results in a final step, in its own session. Dev work is never split:
// parts would edit the same code in one folder at the same time.
export const MAX_SPLIT=6;
const DEV_RE=/front ?end|back ?end|\bdev\b|developer|lập trình|full ?stack|mobile dev|\bios\b|android|devops/i;
// per kind: what the team does (who), when a step is big enough to split, what a part is, what to settle before
// splitting, the rules of a part, what a part answers and what the merge step does
export const SPLIT_KINDS={
  qa:{label:'QA',re:/\bqa\b|test|kiểm thử|tester|chất lượng/i,
    when:'bộ test case LỚN (khoảng từ 15 test case, hoặc từ 2 module/màn hình độc lập trở lên)',
    how:'Đọc danh sách test case (file đính kèm, Excel, tài liệu…), nhóm theo module/màn hình',
    indep:'không phần nào cần dữ liệu do phần khác tạo ra, và không hai phần cùng sửa một bản ghi',
    first:'dò giao diện, kịch bản đăng nhập tests/ui/<ten>-common.mjs, tài khoản, URL',
    example:{title:'Đăng nhập (TC01–TC12)',task:'chỉ dẫn đầy đủ cho phần này: mã các test case, file nguồn, URL, tài khoản, kịch bản chung dùng lại được',merge:'việc cần làm khi tổng hợp, ví dụ ghi cột Kết quả vào file Excel X'},
    small:'Bộ test nhỏ',
    rules:n=>[`Chỉ làm đúng các test case của phần này.`,
      `KHÔNG sửa file kết quả chung (ví dụ file Excel test case gốc, báo cáo chung): bước tổng hợp sẽ ghi. Kết quả của bạn nằm trong câu trả lời.`,
      `Kịch bản test của phần đặt tên riêng (ví dụ tests/ui/<module-cua-phan>.mjs). Kịch bản dùng chung đã có (tests/ui/*-common.mjs) chỉ dùng, không sửa; cần khác thì chép ra bản riêng.`,
      `Không tạo, sửa hay xóa dữ liệu dùng chung mà phần khác có thể đang dùng; cần dữ liệu riêng thì tự tạo với tên có hậu tố "-p${n}".`],
    result:'bảng test case (mã · tên · Đạt/Không đạt · ảnh minh chứng · lỗi), đường dẫn thư mục ảnh và lệnh chạy lại kịch bản của phần này',
    merge:[`Gộp bảng kết quả của mọi phần (mã · tên · Đạt/Không đạt · ảnh minh chứng · lỗi), thống kê tổng số Đạt/Không đạt.`,
      `Phần nào báo LỖI hoặc bỏ sót test case: tự chạy lại phần đó (dùng kịch bản phần đó đã viết, uitest <file> --only "<mã>").`,
      `Chỉ bước này được ghi vào file kết quả chung (ví dụ cột Kết quả trong Excel test case).`]},
  ba:{label:'BA',re:/\bba\b|business analy|phân tích nghiệp vụ|nghiệp vụ|đặc tả|user stor|\bsrs\b|\bbrd\b/i,
    when:'tài liệu nghiệp vụ LỚN (đặc tả, user story, use case, luồng nghiệp vụ… cho từ 3 module/chức năng độc lập trở lên)',
    how:'Đọc yêu cầu và tài liệu nguồn, chia theo module/chức năng',
    indep:'mỗi phần viết trọn một nhóm module, phần nào cũng không phải viết lại nội dung của phần khác',
    first:'mẫu tài liệu (mục lục, mẫu user story/use case, mẫu tiêu chí chấp nhận), cách đánh mã (mỗi phần một dải mã riêng, ví dụ US-DH-01 cho module Đơn hàng), danh sách vai trò người dùng, bảng thuật ngữ; ghi vào một file khung chung để các phần dùng',
    example:{title:'Đơn hàng & Thanh toán',task:'chỉ dẫn đầy đủ cho phần này: các module, tài liệu nguồn, file khung chung, dải mã được dùng, file đầu ra của phần',merge:'gộp thành file đặc tả docs/srs.docx theo mục lục chung'},
    small:'Tài liệu nhỏ',
    rules:n=>[`Chỉ viết các module của phần này, vào file riêng của phần (ví dụ docs/<module>.md, hoặc đúng file đầu ra được giao).`,
      `KHÔNG sửa tài liệu chung hay file khung chung: bước tổng hợp sẽ gộp. Dùng đúng mẫu, vai trò, thuật ngữ và dải mã đã chốt trong file khung.`,
      `Chỗ nào liên quan tới module của phần khác (dữ liệu dùng chung, luồng đi qua nhiều module) thì ghi vào mục "Phụ thuộc với module khác", không tự viết phần của module đó.`,
      `Thông tin còn thiếu thì ghi giả định hoặc đưa vào mục "Câu hỏi mở", không dừng cả phần để hỏi.`],
    result:'danh sách module và mã (US/UC) đã viết, đường dẫn file của phần, các phụ thuộc với module khác và câu hỏi mở',
    merge:[`Gộp tài liệu của mọi phần thành tài liệu hoàn chỉnh theo mục lục chung (một file hoặc bộ file như yêu cầu).`,
      `Thống nhất thuật ngữ, vai trò, cách đánh mã và văn phong; bỏ nội dung trùng; xử lý các phụ thuộc giữa module mà các phần đã ghi lại.`,
      `Phần nào báo LỖI hoặc thiếu module: tự viết bổ sung. Gom các câu hỏi mở thành một danh sách cho người dùng.`]},
  data:{label:'Data',re:/\bdata\b|dữ liệu|analyst|thống kê|\bbi\b/i,
    when:'phân tích dữ liệu LỚN (nhiều file/bảng/sheet, hoặc từ 3 mảng phân tích độc lập trở lên)',
    how:'Xem các nguồn dữ liệu và câu hỏi cần trả lời, chia theo file/bảng, khu vực, kỳ báo cáo hoặc theo câu hỏi phân tích',
    indep:'mỗi phần đọc nguồn riêng hoặc trả lời câu hỏi riêng, không phần nào chờ kết quả của phần khác',
    first:'định nghĩa các chỉ số (công thức), cách làm sạch dữ liệu, đơn vị, mốc thời gian, định dạng bảng kết quả',
    example:{title:'Doanh thu miền Bắc (Q1–Q3)',task:'chỉ dẫn đầy đủ cho phần này: file/sheet nguồn, định nghĩa chỉ số, câu hỏi cần trả lời, định dạng bảng kết quả, file đầu ra của phần',merge:'gộp thành báo cáo bao-cao-quy.xlsx kèm biểu đồ'},
    small:'Dữ liệu nhỏ',
    rules:n=>[`Chỉ phân tích phần dữ liệu/câu hỏi của phần này, dùng đúng định nghĩa chỉ số và cách làm sạch đã chốt.`,
      `Chỉ ĐỌC file dữ liệu gốc, không sửa. Kết quả trung gian lưu vào file riêng của phần (ví dụ output/phan-${n}.csv).`,
      `KHÔNG sửa báo cáo chung: bước tổng hợp sẽ gộp.`,
      `Ghi rõ vấn đề chất lượng dữ liệu gặp phải (thiếu, trùng, bất thường) và cách đã xử lý.`],
    result:'bảng số liệu chính, nhận xét, đường dẫn file kết quả của phần và ghi chú chất lượng dữ liệu',
    merge:[`Gộp số liệu của mọi phần, kiểm tra tổng khớp với dữ liệu gốc và các phần dùng cùng định nghĩa chỉ số.`,
      `Phần nào báo LỖI: tự phân tích lại phần đó.`,
      `Chỉ bước này được ghi báo cáo chung (bảng tổng, biểu đồ, nhận định, khuyến nghị).`]},
  research:{label:'Research',re:/research|nghiên cứu|khảo sát/i,
    when:'nghiên cứu RỘNG (từ 3 chủ đề, đối thủ, thị trường hoặc nhóm nguồn độc lập trở lên)',
    how:'Xác định các chủ đề/đối tượng cần nghiên cứu, chia theo chủ đề hoặc đối tượng',
    indep:'mỗi phần nghiên cứu đối tượng riêng, không phần nào cần kết quả của phần khác',
    first:'khung so sánh chung (tiêu chí, đơn vị, mốc thời gian, định dạng bảng, mức độ chi tiết)',
    example:{title:'Đối thủ A, B',task:'chỉ dẫn đầy đủ cho phần này: đối tượng, khung tiêu chí, nguồn nên dùng, định dạng bảng kết quả',merge:'gộp thành báo cáo so sánh có khuyến nghị'},
    small:'Chủ đề hẹp',
    rules:n=>[`Chỉ nghiên cứu các đối tượng của phần này, theo đúng khung tiêu chí chung.`,
      `Mọi số liệu và nhận định quan trọng phải có nguồn (link) và thời điểm.`,
      `KHÔNG tạo hay sửa báo cáo chung: bước tổng hợp sẽ gộp. Kết quả nằm trong câu trả lời (file riêng của phần nếu dài).`],
    result:'bảng theo khung tiêu chí chung kèm nguồn, các phát hiện chính và điểm chưa chắc chắn',
    merge:[`Gộp kết quả mọi phần thành báo cáo chung: bảng so sánh theo khung tiêu chí, nhận định, khuyến nghị.`,
      `Kiểm tra số liệu mâu thuẫn giữa các phần (khác nguồn, khác thời điểm) và ghi rõ cách xử lý.`,
      `Phần nào báo LỖI hoặc thiếu: tự nghiên cứu bổ sung.`]},
  marketing:{label:'Marketing',re:/marketing|content|nội dung|truyền thông|\bseo\b|copywrit|social/i,
    when:'nhiều sản phẩm nội dung độc lập (từ 5 bài viết/post/kịch bản, hoặc từ 3 kênh/chiến dịch trở lên)',
    how:'Liệt kê các sản phẩm cần làm, chia theo kênh, chủ đề hoặc nhóm bài',
    indep:'mỗi phần làm trọn các sản phẩm của mình, không hai phần làm trùng chủ đề',
    first:'giọng văn, thông điệp chính, đối tượng, từ khóa, quy cách (độ dài, hashtag, CTA), các ý đã giao cho từng phần để tránh trùng',
    example:{title:'Facebook: 5 bài tuần 1',task:'chỉ dẫn đầy đủ cho phần này: kênh, số lượng, chủ đề từng bài, giọng văn, thông điệp, quy cách, file đầu ra của phần',merge:'gộp thành lịch đăng content-plan.xlsx'},
    small:'Ít nội dung',
    rules:n=>[`Chỉ làm các sản phẩm của phần này, đúng giọng văn, thông điệp và quy cách đã chốt.`,
      `Lưu vào file riêng của phần (ví dụ content/phan-${n}.md). KHÔNG sửa file kế hoạch/lịch chung: bước tổng hợp sẽ gộp.`,
      `Không lấy chủ đề hay ý đã giao cho phần khác.`],
    result:'danh sách sản phẩm đã làm (tên · kênh · chủ đề), đường dẫn file của phần',
    merge:[`Gộp mọi phần thành bộ nội dung hoàn chỉnh (và lịch đăng nếu có yêu cầu).`,
      `Soát giọng văn thống nhất, bỏ ý trùng, kiểm tra thông điệp chính có đủ.`,
      `Phần nào báo LỖI hoặc thiếu: tự làm bổ sung.`]}
};
// Which kind of split a team/role/agent text fits, or null (dev work and teams of no listed kind are never split)
export function splitKind(text){
  const s=String(text||'');if(DEV_RE.test(s))return null;
  return Object.keys(SPLIT_KINDS).find(k=>SPLIT_KINDS[k].re.test(s))||null;
}
// Prompt part for a step that may split: mates = the other members of its team [{name, level}], max = most parts
export function splitGuide(mates,max,kind='qa'){
  const K=SPLIT_KINDS[kind]||SPLIT_KINDS.qa,ex=K.example;
  return `
CHIA VIỆC CHẠY SONG SONG: đội của bạn còn ${mates.length} người (${mates.map(m=>`${m.name} · ${LEVELS[m.level]||m.level}`).join(', ')}). Nếu bước này là ${K.when} thì ĐỪNG tự làm hết; chia cho cả đội làm cùng lúc:
1. ${K.how}, chia thành 2–${max} phần có khối lượng gần bằng nhau. Các phần phải làm độc lập: ${K.indep}.
2. Việc chung mà mọi phần đều cần (${K.first}) thì làm xong TRƯỚC khi chia, để các phần dùng lại.
3. Trả lời ngắn cách chia và lý do, rồi đặt ở CUỐI CÙNG (sau phần "Kết quả:") đúng một khối:
\`\`\`split
{"parts":[{"title":"${ex.title}","task":"${ex.task}"}],"merge":"${ex.merge}"}
\`\`\`
"task" của mỗi phần phải tự đủ để người nhận làm ngay, không cần hỏi lại (người nhận không thấy cuộc trao đổi của bạn). Hệ thống giao mỗi phần cho một đồng đội, rồi giao lại cho bạn bước tổng hợp trong chính phiên làm việc này. ${K.small} thì tự làm luôn, không chia.
`;
}
// What a part is told after its own task: it runs next to its teammates, and how it must answer
export function partNote(kind,no,count,stepTitle,by){
  const K=SPLIT_KINDS[kind]||SPLIT_KINDS.qa;
  return `ĐÂY LÀ PHẦN ${no}/${count} của bước "${stepTitle}" do ${by} chia ra; các phần còn lại do đồng đội làm CÙNG LÚC trên cùng máy, cùng thư mục làm việc. Quy tắc khi làm song song:
${K.rules(no).map(r=>`- ${r}`).join('\n')}
Kết quả trả lời: ${K.result}.`;
}
// The merge step's task: count = number of parts, extra = what the splitter asked for the merge
export function mergeTask(kind,count,stepTitle,extra,original){
  const K=SPLIT_KINDS[kind]||SPLIT_KINDS.qa;
  return `Các đồng đội đã làm xong ${count} phần bạn chia (kết quả từng phần ở "Kết quả các bước trước"). Tổng hợp thành kết quả của cả bước "${stepTitle}":
${K.merge.map(r=>`- ${r}`).join('\n')}${extra?`
- Yêu cầu tổng hợp bạn đặt ra khi chia: ${extra}`:''}
Việc gốc của bước: ${original}`;
}
// The split block of a step's answer: {parts:[{title, task}], merge, clean: the answer without the block} or null
export function parseSplit(text){
  const m=String(text||'').match(/```split\s*([\s\S]*?)```/i);if(!m)return null;
  let j;try{j=JSON.parse(m[1])}catch{return null}
  const parts=(Array.isArray(j?.parts)?j.parts:[]).map(p=>({title:String(p?.title||'').trim().slice(0,80),task:String(p?.task||'').trim().slice(0,4000)})).filter(p=>p.task).slice(0,MAX_SPLIT);
  return {parts,merge:String(j?.merge||'').trim().slice(0,2000),clean:String(text).replace(m[0],'').trim()};
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
2–5 lựa chọn ngắn, cụ thể (người dùng cũng có thể tự nhập câu trả lời khác). Lựa chọn nào cần người dùng gõ thêm thông tin (URL, tài khoản, số liệu, đường dẫn…) thì viết bắt đầu bằng "Nhập …" (ví dụ "Nhập URL môi trường UAT"): giao diện sẽ mở ô cho họ nhập giá trị đó; các lựa chọn khác phải là câu trả lời hoàn chỉnh dùng được ngay. Gộp mọi điều cần hỏi vào một câu hỏi. Nếu có thể tự giả định hợp lý thì cứ làm và ghi rõ giả định trong phần kết quả, không hỏi.
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
