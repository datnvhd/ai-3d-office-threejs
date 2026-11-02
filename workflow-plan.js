// Workflow planning shared by the server (machine-bridge.js) and the browser (simulation mode).
// A request becomes ordered steps for the relevant agents, e.g. a login page: design → design review → dev → test;
// a bug fix: dev → test. On the machine the Director plans with Claude (planPrompt + parsePlan);
// ruleSteps is the keyword fallback and the planner for simulated tasks.
// Step shape: {key, agent, title, task, after:[keys of steps that must finish first]}
export const MAX_STEPS=8;

const plain=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d');

export function ruleSteps(text,owner,team){
  const t=plain(text),has=id=>team.some(a=>a.id===id);
  const bug=/\b(bug|fix|loi|sua loi|hong|crash|khong (chay|hoat dong|hien|load))\b/.test(t);
  const ui=/(trang|giao dien|man hinh|page|\bui\b|form|dang nhap|dang ky|login|signup|landing|dashboard|layout|\bnut\b|button|menu|popup|frontend|responsive)/.test(t);
  const be=/(dang nhap|dang ky|login|signup|api|database|co so du lieu|csdl|server|backend|xac thuc|auth|endpoint|luu tru)/.test(t);
  const data=/(phan tich|du lieu|bao cao|thong ke|kpi|\bdata\b|doanh thu)/.test(t);
  const research=/(nghien cuu|tim hieu|so sanh|khao sat|research|thi truong)/.test(t);
  const design=/(thiet ke|logo|icon|banner|mockup|wireframe|prototype)/.test(t);
  const testOnly=/(test|kiem thu|kiem tra)/.test(t)&&!bug&&!/(tao|xay|lam|viet|dung|phat trien)/.test(t);
  const s=[];const add=(agent,title,task,after=[])=>{if(has(agent))s.push({key:'s'+(s.length+1),agent,title,task,after:after.filter(k=>s.some(x=>x.key===k))});return 's'+s.length};

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

Chỉ trả về đúng MỘT khối JSON, không kèm giải thích:
{"title":"tên ngắn của luồng","steps":[{"key":"s1","agent":"designer","title":"Thiết kế giao diện","task":"...","after":[]}]}

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
    steps.push({key,agent:x.agent,title:String(x.title||'Bước '+(steps.length+1)).slice(0,80),task:String(x.task).slice(0,4000),after:(Array.isArray(x.after)?x.after:[]).map(String).filter(k=>keys.has(k))});
    keys.add(key);
  }
  return {title:String(p.title||'').slice(0,80),steps};
}
