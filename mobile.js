// Phone page (m.html): the office without the 3D scene, for a phone on the same Wi-Fi or on the public link.
// Only the AI list, the task box and the results, on the same machine API as the full office (/api/machine/…).
// Lean on purpose: no three.js, polls slowly when nothing runs and stops while the page is hidden.
import './mobile.css';
import {escapeHTML as esc,md} from './ui-text.js';
import {initSkillMenu} from './skill-menu.js';
import {MODELS,EFFORTS,modelId,sameTier,BUILTIN_TEAM,teamOf,levelOf,LEVELS} from './workflow-plan.js';

// The built-in staff (names and colours as in the office); saved agents (agents.json) override names, roles and teams
const BUILTIN=[['director','Director','Điều phối dự án',0x5b8def],['research','Research AI','Nghiên cứu & tổng hợp',0xa78bfa],['frontend','Frontend Dev','Phát triển giao diện',0x1e6fe8],['backend','Backend Dev','API & hệ thống',0x7fb2ff],['analyst','Data Analyst','Phân tích dữ liệu',0x38bdf8],['designer','Designer','Thiết kế sản phẩm',0xffd166],['qa','QA Tester','Kiểm thử & chất lượng',0xc4b5fd]].map(([id,name,role,color])=>({id,name,role,color}));
const STATUS={queued:'Đang chờ',running:'Đang xử lý',waiting:'Chờ bạn trả lời',done:'Hoàn thành',error:'Lỗi',cancelled:'Đã dừng'};
const GROUP={queued:'running',running:'running',waiting:'running',done:'done',error:'error',cancelled:'error'};
const PRIORITIES=['Bình thường','Ưu tiên cao','Khẩn cấp'];
const hex=c=>'#'+(c??0x9aa3b5).toString(16).padStart(6,'0');
const ago=d=>{if(!d)return '';const s=(Date.now()-Date.parse(d))/1000;return s<60?'vừa xong':s<3600?`${s/60|0} phút trước`:s<86400?`${s/3600|0} giờ trước`:new Date(d).toLocaleDateString('vi-VN')};
const store={get:(k,d)=>{try{return localStorage.getItem(k)??d}catch{return d}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}};

async function api(path,opt={}){
  const r=await fetch('/api/machine'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(r.status===401)throw Object.assign(new Error('Phiên truy cập đã hết: tải lại trang để đăng nhập lại.'),{auth:true});
  if(!r.ok)throw new Error(d.error||`Lỗi ${r.status}`);
  return d;
}

const S={agents:[],machine:null,tasks:[],sel:store.get('m-agent','director'),filter:'all',open:null,detail:null,sending:false,useWf:store.get('m-wf','1')==='1'};
const root=document.getElementById('m');
root.innerHTML=`
<header class="mh"><div class="brand"><b>My Office</b><span>AI agents</span></div><div id="mStatus" class="pill">…</div><a class="full" id="mFull" href="/">Bản 3D</a></header>
<main>
  <section class="card">
    <h2>Giao việc</h2>
    <div id="mAgents" class="agents"></div>
    <div id="mWho" class="who"></div>
    <textarea id="mText" rows="3" placeholder="Nhập yêu cầu công việc… (gõ / để dùng skill)"></textarea>
    <label class="wf" id="mWfRow"><input type="checkbox" id="mWf"> Director lập kế hoạch và chia việc cho cả đội</label>
    <div class="row"><select id="mPrio">${PRIORITIES.map(p=>`<option>${p}</option>`).join('')}</select><select id="mModel"></select></div>
    <button id="mSend" class="send">Giao việc</button>
  </section>
  <section class="card">
    <div class="rhead"><h2>Kết quả</h2><button id="mClear" class="link">Xóa việc đã xong</button></div>
    <div id="mTabs" class="tabs"></div>
    <div id="mList" class="list"></div>
  </section>
</main>
<div id="mSheet" class="sheet" hidden></div>
<div id="mToast" class="toast"></div>`;
const $=id=>document.getElementById(id);

// ---------- toast ----------
let toastT;function toast(s){const t=$('mToast');t.textContent=s;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),3200)}
// skills: type / in the request or follow-up box to pick one (skill-menu.js)
initSkillMenu({api,selector:'#mText, #sAsk, #sAns',toast});

// ---------- agents ----------
async function loadAgents(){
  const saved=(await api('/agents').catch(()=>null))?.agents;
  const list=saved||BUILTIN.map(b=>({id:b.id,builtin:true}));
  S.agents=list.map(v=>{const b=BUILTIN.find(x=>x.id===v.id);
    return b?{...b,name:v.name||b.name,role:v.role??b.role,desc:v.desc||'',team:v.team||BUILTIN_TEAM[b.id],level:v.level}:{id:v.id,name:v.name,role:v.role||'',desc:v.desc||'',color:v.color,team:v.team||v.role||'Khác',level:v.level}}).filter(a=>a.name);
  if(!S.agents.some(a=>a.id===S.sel))S.sel=S.agents[0]?.id;
  renderAgents();
}
const agentOf=id=>S.agents.find(a=>a.id===id)||{id,name:id,role:'',color:0x9aa3b5};
const busy=id=>S.tasks.some(t=>t.agent===id&&GROUP[t.status]==='running');
function renderAgents(){
  $('mAgents').innerHTML=S.agents.map(a=>`<button class="ag${a.id===S.sel?' on':''}" data-a="${esc(a.id)}"><i style="background:${hex(a.color)}">${esc(a.name[0]||'?')}</i><span>${esc(a.name)}</span>${busy(a.id)?'<b class="dot" title="Đang làm việc"></b>':''}</button>`).join('');
  const a=agentOf(S.sel);
  $('mWho').innerHTML=a?`<b>${esc(a.name)}</b> · ${esc([a.role,`${LEVELS[levelOf(a)]} · đội ${teamOf(a)}`].filter(Boolean).join(' · '))}`:'';
  $('mWfRow').hidden=S.sel!=='director';$('mWf').checked=S.useWf;
}
$('mAgents').onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;S.sel=b.dataset.a;store.set('m-agent',S.sel);renderAgents();b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'})};
$('mWf').onchange=e=>{S.useWf=e.target.checked;store.set('m-wf',S.useWf?'1':'0')};

// ---------- model picker: auto, then the recommended models of each engine ----------
$('mModel').innerHTML=`<option value="auto">✨ Model: tự chọn</option>${['claude','codex'].map(e=>`<optgroup label="${e==='claude'?'Claude':'Codex'}">${Object.entries(MODELS).filter(([,m])=>m.engine===e&&m.auto).map(([id,m])=>`<option value="${id}">${m.label}</option>`).join('')}</optgroup>`).join('')}`;
$('mModel').value=MODELS[store.get('m-model','auto')]?store.get('m-model'):'auto';
$('mModel').onchange=e=>store.set('m-model',e.target.value);

// ---------- machine status ----------
async function loadStatus(){
  try{S.machine=await api('/status')}catch(e){S.machine=null;$('mStatus').className='pill off';$('mStatus').textContent=e.auth?'Cần đăng nhập lại':'Mất kết nối';return}
  const m=S.machine,ok=m.ready||m.codex?.ready;
  $('mStatus').className='pill '+(ok?'ok':'off');
  $('mStatus').textContent=`${m.host?.name||'Máy'} · ${ok?(m.running?`${m.running} việc đang chạy`:'sẵn sàng'):'chưa sẵn sàng'}`;
}

// ---------- send ----------
$('mSend').onclick=async()=>{
  const text=$('mText').value.trim();if(!text){toast('Nhập yêu cầu công việc trước');$('mText').focus();return}
  if(S.sending)return;const a=agentOf(S.sel);
  if(!(S.machine?.ready||S.machine?.codex?.ready)){toast('Máy chưa sẵn sàng: kiểm tra đăng nhập Claude/Codex trên máy tính');return}
  S.sending=true;$('mSend').disabled=true;$('mSend').textContent='Đang gửi…';
  try{
    const workflow=a.id==='director'&&S.useWf;
    const team=S.agents.map(x=>({id:x.id,name:x.name,role:x.role,desc:x.desc,team:teamOf(x),level:levelOf(x)}));
    await api('/tasks',{method:'POST',body:JSON.stringify({agent:a.id,name:a.name,role:a.role,desc:a.desc,agentTeam:teamOf(a),level:levelOf(a),text,priority:$('mPrio').value,model:$('mModel').value,effort:'auto',workflow,team,files:[],web:false,siteIds:[]})});
    $('mText').value='';autosize();S.filter='all';
    toast(workflow?'Director đang lập kế hoạch và chia việc':`Đã giao cho ${a.name}`);
    await loadTasks();
  }catch(e){toast(e.message)}
  finally{S.sending=false;$('mSend').disabled=false;$('mSend').textContent='Giao việc'}
};
const autosize=()=>{const t=$('mText');t.style.height='auto';t.style.height=Math.min(240,t.scrollHeight+2)+'px'};
$('mText').addEventListener('input',autosize);

// ---------- results ----------
const modelTag=t=>{const id=t.model&&t.engine?sameTier(t.model,t.engine):modelId(t.model),m=MODELS[id];return m?`<span class="mt">${m.label}${EFFORTS[t.effort]?` · ${EFFORTS[t.effort].toLowerCase()}`:''}</span>`:''};
async function loadTasks(){
  try{const {tasks}=await api('/tasks');
    // say when something finished since the last look
    for(const t of tasks){const o=S.tasks.find(x=>x.id===t.id);if(o&&o.status!==t.status){if(t.status==='done')toast(`✓ ${agentOf(t.agent).name} đã xong`);else if(t.status==='error')toast(`⚠ ${agentOf(t.agent).name} gặp lỗi`);else if(t.status==='waiting')toast(`❓ ${agentOf(t.agent).name} cần bạn trả lời`)}}
    S.tasks=tasks;renderTasks();renderAgents();
  }catch(e){if(e.auth)toast(e.message)}
}
function renderTasks(){
  const n=g=>S.tasks.filter(t=>g==='all'||GROUP[t.status]===g).length;
  $('mTabs').innerHTML=[['all','Tất cả'],['running','Đang xử lý'],['done','Xong'],['error','Lỗi']].map(([k,l])=>`<button class="${S.filter===k?'on':''}" data-f="${k}">${l} <b>${n(k)}</b></button>`).join('');
  const list=S.tasks.filter(t=>S.filter==='all'||GROUP[t.status]===S.filter).slice(0,60);
  $('mList').innerHTML=list.length?list.map(t=>{const a=agentOf(t.agent),needs=t.status==='waiting'||(t.perms||[]).length;
    return `<button class="task st-${t.status}${needs?' needs':''}" data-t="${t.id}">
      <div class="th"><i style="background:${hex(a.color)}"></i><b>${esc(a.name)}</b><span class="badge ${GROUP[t.status]}">${(t.perms||[]).length?'Xin phép':STATUS[t.status]||t.status}</span></div>
      ${t.stepTitle?`<div class="step">${esc(t.stepTitle)}</div>`:''}
      <div class="tx">${esc(String(t.text||'').slice(0,160))}</div>
      <div class="tm">${GROUP[t.status]==='running'&&t.activity?`<span class="act">${esc(t.activity)}</span>`:`<span>${ago(t.finished||t.created)}</span>`}${modelTag(t)}</div>
    </button>`}).join(''):'<p class="empty">Chưa có việc nào. Giao việc ở trên, kết quả sẽ hiện ở đây.</p>';
}
$('mTabs').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;S.filter=b.dataset.f;renderTasks()};
$('mList').onclick=e=>{const b=e.target.closest('[data-t]');if(b)openTask(+b.dataset.t)};
$('mClear').onclick=async()=>{if(!confirm('Xóa các việc đã xong, lỗi hoặc đã dừng khỏi danh sách?'))return;try{const r=await api('/tasks',{method:'DELETE'});S.tasks=r.tasks;renderTasks();toast(`Đã xóa ${r.removed} việc`)}catch(e){toast(e.message)}};

// ---------- task sheet: result, question, permission requests, actions ----------
async function openTask(id){
  S.open=id;S.detail=S.tasks.find(t=>t.id===id)||null;renderSheet();
  if(history.state?.sheet!==id)history.pushState({sheet:id},'');
  await loadDetail();
}
function closeSheet(){S.open=null;S.detail=null;$('mSheet').hidden=true;document.body.classList.remove('locked')}
window.addEventListener('popstate',()=>{if(S.open!=null)closeSheet()});
async function loadDetail(){if(S.open==null)return;try{S.detail=(await api(`/tasks/${S.open}`)).task;renderSheet()}catch(e){toast(e.message)}}
function renderSheet(){
  const t=S.detail,sh=$('mSheet');if(!t){sh.hidden=true;return}
  const a=agentOf(t.agent),run=GROUP[t.status]==='running',perms=t.perms||[],q=t.status==='waiting'&&t.question&&t.question.kind!=='login'?t.question:null;
  // keep what the user is typing when the sheet refreshes
  const typed={ans:sh.querySelector('#sAns')?.value||'',ask:sh.querySelector('#sAsk')?.value||''},focus=document.activeElement?.id,caret=document.activeElement?.selectionStart;
  // and where they scrolled: the sheet is rebuilt on every refresh, which would jump back to the top
  const body=sh.querySelector('.sh-body'),same=sh.dataset.id===String(t.id),top=body?.scrollTop||0,atEnd=body&&top>0&&body.scrollHeight-top-body.clientHeight<48;
  const asking=!!t.asking&&run;// answering a follow-up: result and conversation stay, the ask box waits
  sh.hidden=false;document.body.classList.add('locked');
  sh.innerHTML=`<div class="sh-top"><button class="back" data-x="close">‹ Quay lại</button><span class="badge ${GROUP[t.status]}">${STATUS[t.status]||t.status}</span></div>
  <div class="sh-body">
    <div class="th big"><i style="background:${hex(a.color)}"></i><b>${esc(a.name)}</b>${modelTag(t)}</div>
    ${t.stepTitle?`<div class="step">${esc(t.wfTitle?`${t.wfTitle} · `:'')}${esc(t.stepTitle)}</div>`:''}
    <div class="req">${esc(t.text||'')}</div>
    ${run&&!asking&&t.activity?`<div class="act live"><span class="spin"></span>${esc(t.activity)}</div>`:''}
    ${perms.map(p=>`<div class="perm"><b>🔐 Xin phép: ${esc(p.desc||p.tool)}</b>${p.detail?`<pre>${esc(String(p.detail).slice(0,600))}</pre>`:''}
      <div class="btns"><button data-perm="${p.id}" data-m="1" class="ok">Cho phép</button><button data-perm="${p.id}" data-m="2">Luôn cho phép${p.ruleLabel?` (${esc(p.ruleLabel)})`:''}</button><button data-perm="${p.id}" data-m="0" class="no">Từ chối</button></div></div>`).join('')}
    ${t.status==='waiting'&&t.question?.kind==='login'?'<div class="q"><b>🔑 Việc này cần đăng nhập một trang web.</b><p>Hãy nhập tài khoản trên máy tính chạy app (vì lý do an toàn, không nhập được từ xa).</p></div>':''}
    ${q?`<div class="q"><b>❓ ${esc(q.q)}</b>${(q.options||[]).map(o=>`<button class="opt" data-ans="${esc(o)}">${esc(o)}</button>`).join('')}
      <textarea id="sAns" rows="2" placeholder="Hoặc tự nhập câu trả lời… (gõ / để dùng skill)">${esc(typed.ans)}</textarea><button class="send sm" data-x="answer">Gửi câu trả lời</button></div>`:''}
    ${t.error&&GROUP[t.status]==='error'?`<div class="err">${esc(t.error)}</div>`:''}
    ${t.result?`<div class="res md">${md(t.result)}</div>`:''}
    ${(t.thread||[]).map(x=>`<div class="thread"><div class="tq">Bạn hỏi: ${esc(x.q)}</div>${x.answer?`<div class="md">${md(x.answer)}</div>`:x.error?`<div class="err">${esc(x.error)}</div>`:`<div class="act live"><span class="spin"></span>${esc(asking&&t.activity?t.activity:'Đang trả lời…')}</div>`}</div>`).join('')}
    <div class="acts">
      ${run?'<button data-x="cancel" class="no">Dừng việc</button>':''}
      ${['error','cancelled'].includes(t.status)?'<button data-x="retry">Thử lại</button>':''}
    </div>
    ${t.status==='done'||asking?`<div class="q"><textarea id="sAsk" rows="2" placeholder="Hỏi thêm về kết quả này… (gõ / để dùng skill)">${esc(typed.ask)}</textarea><button class="send sm" data-x="ask"${asking?' disabled':''}>${asking?'Đang trả lời…':'Hỏi thêm'}</button></div>`:''}
    ${(t.log||[]).length?`<details class="log"${same&&sh.querySelector('details.log')?.open?' open':''}><summary>Nhật ký (${t.log.length})</summary>${t.log.slice(-30).map(l=>`<div>${esc(l.text)}</div>`).join('')}</details>`:''}
  </div>`;
  sh.dataset.id=t.id;
  const nb=sh.querySelector('.sh-body');if(same&&nb)nb.scrollTop=S.toBottom||atEnd?nb.scrollHeight:top;S.toBottom=false;
  const f=same&&focus&&sh.querySelector('#'+focus);if(f){f.focus({preventScroll:true});try{f.setSelectionRange(caret,caret)}catch{}}
}
$('mSheet').onclick=async e=>{
  const t=S.detail;if(!t)return;
  const x=e.target.closest('[data-x]')?.dataset.x,perm=e.target.closest('[data-perm]'),opt=e.target.closest('[data-ans]');
  try{
    if(x==='close'){history.back();return}
    if(perm){await api(`/tasks/${t.id}/perm/${perm.dataset.perm}/answer`,{method:'POST',body:JSON.stringify({allow:perm.dataset.m!=='0',always:perm.dataset.m==='2'})});toast(perm.dataset.m==='0'?'⛔ Đã từ chối':'✓ Đã cho phép')}
    else if(opt||x==='answer'){const text=opt?opt.dataset.ans:$('mSheet').querySelector('#sAns').value.trim();if(!text){toast('Nhập câu trả lời');return}
      await api(`/tasks/${t.id}/answer`,{method:'POST',body:JSON.stringify({text})});toast('Đã gửi câu trả lời');$('mSheet').querySelector('#sAns')&&($('mSheet').querySelector('#sAns').value='')}
    else if(x==='ask'){const el=$('mSheet').querySelector('#sAsk'),text=el.value.trim();if(!text){toast('Nhập câu hỏi');return}
      await api(`/tasks/${t.id}/ask`,{method:'POST',body:JSON.stringify({text})});el.value='';S.toBottom=true;toast(`${agentOf(t.agent).name} đang trả lời`)}
    else if(x==='cancel'){if(!confirm('Dừng việc này?'))return;await api(`/tasks/${t.id}/cancel`,{method:'POST'});toast('Đã yêu cầu dừng')}
    else if(x==='retry'){await api(`/tasks/${t.id}/retry`,{method:'POST'});toast('Đang thử lại')}
    else return;
    await Promise.all([loadDetail(),loadTasks()]);
  }catch(err){toast(err.message)}
};

// ---------- the full 3D office: only for this browser tab, the phone page comes back next time ----------
$('mFull').onclick=()=>{try{sessionStorage.setItem('office-view','full')}catch{}};

// ---------- polling: fast while something runs, slow otherwise, none while the page is hidden ----------
let pollT=null,statusAt=0;
async function tick(){
  clearTimeout(pollT);
  if(document.visibilityState==='visible'){
    await loadTasks();
    if(Date.now()-statusAt>15000){statusAt=Date.now();loadStatus()}
    if(S.open!=null&&(GROUP[S.detail?.status]==='running'||S.detail?.thread?.some(x=>!x.answer&&!x.error)||S.tasks.find(x=>x.id===S.open)?.status!==S.detail?.status))await loadDetail();
  }
  const running=S.tasks.some(t=>GROUP[t.status]==='running');
  pollT=setTimeout(tick,running?2000:7000);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')tick()});
await Promise.all([loadAgents(),loadStatus()]);statusAt=Date.now();
renderTasks();tick();
