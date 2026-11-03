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
  const t=plain(text),has=id=>team.some(a=>a.id===id);
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
  return s.slice(0,MAX_STEPS);
}

export function planPrompt(text,owner,team){
  const o=team.find(a=>a.id===owner);
  return `Bạn là Director, điều phối các AI agent trong văn phòng. Người dùng vừa giao yêu cầu cho "${o?.name||owner}".
Hãy lập LUỒNG CÔNG VIỆC: chia yêu cầu thành các bước, mỗi bước giao cho đúng một agent phù hợp, theo thứ tự phụ thuộc.

Đội ngũ (id · tên · vai trò):
${team.map(a=>`- ${a.id} · ${a.name} · ${a.role}`).join('\n')}

Quy tắc:
- Chỉ dùng các agent liên quan; tối đa ${MAX_STEPS} bước. Việc đơn giản chỉ cần 1–2 bước.
- "after" liệt kê key của các bước phải xong trước (chỉ được trỏ tới bước đứng trước). Các bước không phụ thuộc nhau có thể chạy song song.
- Mỗi "task" là chỉ dẫn cụ thể cho agent đó, viết bằng tiếng Việt; bước sau sẽ tự nhận kết quả của bước trước.
- Ví dụ: "Tạo trang đăng nhập" → designer thiết kế → director duyệt thiết kế → frontend dựng giao diện + backend làm API (song song) → qa kiểm thử.
- Ví dụ: "Sửa lỗi không đăng nhập được" → frontend/backend sửa lỗi → qa kiểm thử lại.
- Ví dụ: "Phân tích doanh thu quý" → analyst phân tích → director tổng hợp & duyệt.
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
