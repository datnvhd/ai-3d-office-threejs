import * as THREE from 'three';
import './style.css';
import {createCharacter,PRESETS} from './characters.js';
import {initClaudeConnect} from './claude-connect.js';
import {createOffice} from './office.js';
import {createWander} from './wander.js';
import {createOutdoor} from './outdoor.js';
import {initMachineConnect,machineApi} from './machine-connect.js';
import {createProgressView} from './progress-view.js';
const app=document.querySelector('#app');
// Left column: assign work · right column: what the agents did with it (running, done with result, failed with error)
app.innerHTML=`<div id="scene"></div><div class="top"><div class="brand"><span class="logo">▦</span><div><b>My Office <i>3D</i></b><small>AI AGENT WORKSPACE</small></div></div><div class="topstats"><span><em class="dot green"></em><b id="active">0</b> AI đang làm việc</span><span><em class="dot orange"></em><b id="queued">0</b> đang xử lý</span><span><em class="dot blue"></em><b id="done">0</b> hoàn thành</span><span><em class="dot red"></em><b id="failed">0</b> lỗi</span></div><div class="actions"><button id="reset">⟲ Đặt lại góc nhìn</button><button id="help">? Hướng dẫn</button></div></div><div class="floatinglabels" id="labels"></div>
<aside class="side side-left"><div class="panel-kicker">① GIAO VIỆC</div><h2 class="side-title">Giao nhiệm vụ cho AI</h2><div class="section-title">CHỌN NHÂN VIÊN <span id="agent-count"></span></div><div class="agent-pick" id="avatars"></div><div class="profile"><div class="profile-avatar" id="profile-icon">◉</div><div><h3 id="profile-name"></h3><span id="profile-role"></span></div></div><div class="status" id="profile-status"></div><div class="section-title">YÊU CẦU CÔNG VIỆC</div><textarea id="task" placeholder="Ví dụ: Phân tích báo cáo doanh thu quý III và tổng hợp 5 insight quan trọng..."></textarea><div class="opts"><div><label class="smalllabel">Mức ưu tiên</label><select id="priority"><option>Bình thường</option><option>Ưu tiên cao</option><option>Khẩn cấp</option></select></div><div><label class="smalllabel">Nơi thực thi</label><select id="runOn"><option value="machine">💻 Máy cá nhân</option><option value="sim">🎲 Mô phỏng</option></select></div></div><div class="webopt" id="webOpt"><label class="mcheck"><input type="checkbox" id="useWeb"> 🌐 Cho phép mở web & thao tác trình duyệt</label><select id="webSite" class="hidden"></select></div><p class="runnote" id="runNote"></p><button class="assign" id="assign">✦ Giao việc cho AI</button></aside>
<aside class="side side-right"><div class="panel-kicker">② KẾT QUẢ XỬ LÝ</div><h2 class="side-title">Kết quả từ AI</h2><div class="result-tabs" id="resultTabs"></div><div id="results" class="tasklist"></div><p class="disclaimer">💻 Máy cá nhân: chạy thật bằng Claude Code trên máy của bạn · 🎲 Mô phỏng: tiến độ, kết quả và lỗi chỉ là giả lập.</p></aside>
<div class="scenery" id="scenery"></div><div id="toast"></div><div class="modal hidden" id="guide"><div class="guide"><button class="close" id="closeguide">✕</button><h2>Điều khiển văn phòng</h2><p>🖱️ Kéo chuột để xoay góc nhìn 3D, cuộn để zoom. Bấm vào nhân viên, nhãn tên hoặc thẻ tên bên trái để chọn người nhận việc.</p><p>📋 Cột trái để giao việc, cột phải hiển thị việc đang xử lý, hoàn thành (kèm kết quả) hoặc gặp lỗi (có thể thử lại). Chọn nơi thực thi “Máy cá nhân” để chạy thật bằng Claude Code trên máy của bạn (bấm ô “Máy” trên thanh trên cùng để chọn thư mục làm việc, quyền và chạy kiểm tra), hoặc “Mô phỏng” để chạy thử giả lập.</p><button id="okguide" class="assign">Đã hiểu</button></div></div>`;
const agents=[{id:'director',name:'Director',role:'Điều phối dự án',color:0x5b8def,x:-0.9,z:2.5,look:PRESETS.manager,desk:{screen:'dashboard',props:['coffee','robot','notebook']}},{id:'research',name:'Research AI',role:'Nghiên cứu & tổng hợp',color:0xa78bfa,x:-3.65,z:0.35,look:PRESETS.student,desk:{screen:'ai',props:['notebook','plant','pens']}},{id:'frontend',name:'Frontend Dev',role:'Phát triển giao diện',color:0x1e6fe8,x:-1.25,z:0.35,look:PRESETS.dev,desk:{screen:'code',laptop:true,props:['coffee','plant']}},{id:'backend',name:'Backend Dev',role:'API & hệ thống',color:0x7fb2ff,x:1.25,z:0.35,desk:{screen:'code',props:['coffee','pens','plant']},look:{...PRESETS.dev,top:0xf2f3f7,sleeve:0x1e6fe8,hood:0x1e6fe8,cuff:0xf2f3f7,band:0x1e6fe8,logo:'api',headphones:{on:'head',color:0x2b2f3a,accent:0x1e6fe8},pose:'idle',mouth:'grin',hairColor:0x2e221c,seed:7}},{id:'analyst',name:'Data Analyst',role:'Phân tích dữ liệu',color:0x38bdf8,x:3.7,z:0.35,desk:{screen:'chart',props:['notebook','plant','coffee']},look:{...PRESETS.designer,top:0x1e6fe8,hood:0xf2f3f7,band:0x1e6fe8,cuff:0x1e6fe8,logo:'chart',glasses:null,bun:false,pose:'idle',hairColor:0x2c1f1a,pants:0x3f4556,shoeAccent:0x1e6fe8,mouth:'grin'}},{id:'designer',name:'Designer',role:'Thiết kế sản phẩm',color:0xffd166,x:4.4,z:-2.25,look:PRESETS.designer,desk:{screen:'design',props:['pens','plant','notebook']}},{id:'qa',name:'QA Tester',role:'Kiểm thử & chất lượng',color:0xc4b5fd,x:2.4,z:-2.25,desk:{screen:'ai',laptop:'chart',props:['coffee','notebook']},look:{...PRESETS.dev,top:0xa78bfa,sleeve:0xf2f3f7,hood:0xf2f3f7,cuff:0xa78bfa,band:0xa78bfa,logo:'check',glasses:{shape:'round',color:0x2a2a30},headphones:null,pose:'wave',mouth:'open',hairColor:0x4a3226,shoeAccent:0xa78bfa,seed:13}}];
const world=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.65;document.querySelector('#scene').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(40,1,.1,100);let theta=Math.PI/4,phi=.96,dist=20.5;const focus=new THREE.Vector3(0,0,0);function updateCamera(){camera.position.set(Math.sin(theta)*Math.sin(phi)*dist,Math.cos(phi)*dist,Math.cos(theta)*Math.sin(phi)*dist);camera.lookAt(focus)}updateCamera();
const room=createOffice(world,renderer),office=room.group,pickables=[];
function agentCharacter(agent){const g=new THREE.Group();g.position.set(agent.x,0,agent.z);g.rotation.y=.35;office.add(g);agent.char=createCharacter(agent.look);g.add(agent.char.group);const hit=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,2,12),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));hit.position.y=1;hit.userData.agent=agent.id;g.add(hit);pickables.push(hit);agent.group=g;agent.labelPos=new THREE.Vector3(agent.x,2.05,agent.z);const ring=new THREE.Mesh(new THREE.RingGeometry(.37,.42,32),new THREE.MeshBasicMaterial({color:agent.color,side:THREE.DoubleSide,transparent:true,opacity:0}));ring.rotation.x=-Math.PI/2;ring.position.y=.013;g.add(ring);agent.ring=ring;return g}
// Characters stand in front of their desk with the chair pushed to one side
for(const a of agents){room.workstation(a.x,a.z,a.desk);agentCharacter(a)}
// Streets, houses, traffic and passers-by around the building
const outdoor=createOutdoor(world);
// Idle agents stroll around the office; agents with unfinished tasks stay at (or return to) their desk
const wander=createWander(agents,{isBusy:id=>allJobs().some(j=>j.agent===id&&(j.status==='running'||j.status==='queued'))});
const labels=document.getElementById('labels');agents.forEach(a=>{a.el=document.createElement('button');a.el.className='tag';a.el.innerHTML=`<span class="tagdot" style="background:#${a.color.toString(16).padStart(6,'0')}"></span>${a.name}`;a.el.onclick=()=>openAgent(a.id);labels.appendChild(a.el)});
// Tasks run for real on the personal machine (Claude Code via /api/machine) or as a local simulation
const RESULTS={director:['Đã lập kế hoạch 3 giai đoạn, phân công cho 4 thành viên; mốc bàn giao: thứ Sáu tuần này.','Đã chốt phạm vi, rủi ro chính và lịch họp review hằng tuần với các bên liên quan.'],research:['Tổng hợp 12 nguồn tham khảo, rút ra 5 insight chính kèm trích dẫn; báo cáo 2 trang.','So sánh 4 giải pháp trên thị trường theo chi phí, tính năng và mức độ phổ biến.'],frontend:['Đã dựng 3 màn hình theo thiết kế, responsive cho mobile; bản xem thử đã sẵn sàng.','Sửa 6 lỗi giao diện, tối ưu tải trang từ 3,1s xuống 1,4s.'],backend:['Thêm 4 endpoint REST kèm 18 test tự động (pass 100%); thời gian phản hồi TB 120 ms.','Tối ưu truy vấn chính, giảm tải CPU database khoảng 35%.'],analyst:['Phân tích 24.580 dòng dữ liệu: doanh thu tăng 14% so với quý trước, nhóm khách mới đóng góp 38%.','Lập dashboard 6 chỉ số KPI, phát hiện 2 điểm bất thường cần kiểm tra.'],designer:['Bàn giao 2 phương án giao diện và bộ icon 24px; đã chú thích kích thước, màu sắc.','Cập nhật design system: 12 component mới, kiểm tra tương phản đạt chuẩn AA.'],qa:['Chạy 46 test case: 44 đạt, 2 lỗi mức thấp đã ghi nhận kèm bước tái hiện.','Kiểm thử hồi quy 5 luồng chính trên 3 trình duyệt, không phát hiện lỗi chặn.']};
const ERRORS=['Hết thời gian chờ phản hồi từ công cụ (timeout 60s).','Không có quyền truy cập vào dữ liệu nguồn được yêu cầu.','Yêu cầu chưa đủ thông tin: cần mô tả rõ phạm vi và đầu ra mong muốn.','Lỗi kết nối tới dịch vụ bên ngoài (HTTP 503).'];
const STATUS={queued:'Đang chờ',running:'Đang xử lý',done:'Hoàn thành',error:'Lỗi',cancelled:'Đã dừng'};
const GROUP={queued:'running',running:'running',done:'done',error:'error',cancelled:'error'};
let selected=agents[0],sim=[],remote=[],simId=0,filter='all',machine=null,lastSig='',syncTimer=null;const prevStatus=new Map();
let runOn='machine',useWeb=false;try{runOn=localStorage.getItem('office-run-on')||'machine';useWeb=localStorage.getItem('office-use-web')==='1'}catch{}
const taskEl=document.getElementById('task'),$=id=>document.getElementById(id);
const hex=c=>'#'+c.toString(16).padStart(6,'0'),clock=d=>d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
const agentOf=id=>agents.find(a=>a.id===id)||{id,name:id,role:'',color:0x9aa3b5};
function allJobs(){return [...sim,...remote].sort((a,b)=>b.created-a.created)}
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// Minimal Markdown for Claude's answers (escaped first, so only these tags can appear): code blocks, tables, headings, lists, inline code/bold/italic
function md(src){
  const inline=s=>s.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>');
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>inline(c.trim()));
  const lines=escapeHTML(src).replace(/\r/g,'').split('\n'),out=[];let i=0;
  while(i<lines.length){
    const l=lines[i];
    if(/^```/.test(l)){const buf=[];while(++i<lines.length&&!/^```/.test(lines[i]))buf.push(lines[i]);i++;out.push(`<pre><code>${buf.join('\n')}</code></pre>`);continue}
    if(/^\s*\|.*\|\s*$/.test(l)&&/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i+1]||'')&&lines[i+1].includes('-')){
      const head=cells(l),rows=[];i+=2;while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(cells(lines[i++]));
      out.push(`<table><tr>${head.map(c=>`<th>${c}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);continue}
    const h=l.match(/^#{1,6}\s+(.*)/);if(h){out.push(`<h4>${inline(h[1])}</h4>`);i++;continue}
    if(/^\s*([-*]|\d+\.)\s+/.test(l)){const ol=/^\s*\d+\./.test(l),items=[];while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i]))items.push(inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/,'')));out.push(`<${ol?'ol':'ul'}>${items.map(x=>`<li>${x}</li>`).join('')}</${ol?'ol':'ul'}>`);continue}
    if(!l.trim()){i++;continue}
    const para=[];while(i<lines.length&&lines[i].trim()&&!/^(```|#{1,6}\s|\s*([-*]|\d+\.)\s|\s*\|.*\|\s*$)/.test(lines[i]))para.push(inline(lines[i++]));
    if(para.length)out.push(`<p>${para.join('<br>')}</p>`);else out.push(`<p>${inline(lines[i++])}</p>`);
  }
  return out.join('');
}
const fromServer=t=>({key:'m'+t.id,rid:t.id,remote:true,agent:t.agent,text:t.text,priority:t.priority,status:t.status,steps:t.steps||0,activity:t.activity,started:t.started?new Date(t.started):null,result:t.result,error:t.error,created:new Date(t.created),finished:t.finished?new Date(t.finished):null,durationMs:t.durationMs,turns:t.turns,costUsd:t.costUsd,cwd:t.cwd,mode:t.mode,host:t.host,web:!!t.web,siteLabels:t.siteLabels||[],progress:t.status==='done'?100:Math.min(92,8+(t.steps||0)*9)});
function selectAgent(id){selected=agentOf(id);$('profile-name').textContent=selected.name;$('profile-role').textContent=selected.role;$('profile-icon').style.background=hex(selected.color);$('profile-icon').textContent=selected.name[0];agents.forEach(a=>a.ring.material.opacity=a.id===id?.95:0);document.querySelectorAll('.tag').forEach((e,i)=>e.classList.toggle('selected',agents[i].id===id));document.querySelectorAll('#avatars [data-agent]').forEach(e=>e.classList.toggle('on',e.dataset.agent===id));renderProfile()}
function renderProfile(){const mine=allJobs().filter(j=>j.agent===selected.id),n=g=>mine.filter(j=>GROUP[j.status]===g).length;$('profile-status').innerHTML=(n('running')?'<span class="pulse"></span> Đang thực hiện nhiệm vụ':'<span class="pulse idle"></span> Sẵn sàng nhận việc')+(mine.length?`<em>${n('running')} đang xử lý · ${n('done')} xong · ${n('error')} lỗi</em>`:'')}
function renderRunNote(){
  $('runOn').value=runOn;const m=machine,el=$('runNote'),pick=$('webSite'),keep=pick.value;
  $('webOpt').classList.toggle('hidden',runOn!=='machine');$('useWeb').checked=useWeb;pick.classList.toggle('hidden',!useWeb);
  pick.innerHTML='<option value="auto">🔑 Tự nhận tài khoản theo link trong yêu cầu</option>'+(m?.browser?.sites||[]).map(x=>`<option value="${x.id}">🔑 ${escapeHTML(x.label)} · ${escapeHTML(x.username||'')}</option>`).join('');
  if([...pick.options].some(o=>o.value===keep))pick.value=keep;
  el.className='runnote '+(runOn==='sim'?'sim':m?.ready?'ok':'warn');
  el.innerHTML=runOn==='sim'?'Chỉ giả lập tiến độ và kết quả, không chạy thật.':!m?'Đang kiểm tra máy cá nhân…':m.ready?`Chạy thật bằng Claude Code trên <b>${escapeHTML(m.host.name)}</b> · ${escapeHTML(m.config.modes[m.config.mode])}${useWeb?' · 🌐 dùng trình duyệt':''}<br><code title="${escapeHTML(m.config.workdir)}">${escapeHTML(m.config.workdir)}</code> <button class="linkbtn" data-open-machine>Cài đặt</button>`:`⚠ Máy cá nhân chưa sẵn sàng. <button class="linkbtn" data-open-machine>Mở cài đặt & kiểm tra</button>`;
}
function card(j){
  const a=agentOf(j.agent),live=GROUP[j.status]==='running',where=j.remote?`<span class="where" title="${escapeHTML(j.cwd||'')}">${j.web?'🌐':'💻'} ${escapeHTML(j.host||'Máy cá nhân')}</span>`:'<span class="where">🎲 Mô phỏng</span>';
  let mid='';
  if(live&&j.remote)mid=`<div class="activity">${j.status==='queued'?'Đang chờ đến lượt…':`Bước ${j.steps} · ${escapeHTML(j.activity||'Đang xử lý…')}`}</div><div class="progress live"><i style="width:${j.progress}%"></i></div><button class="ghost stop" data-cancel="${j.rid}">■ Dừng</button>`;
  else if(live)mid=`<div class="progressrow"><span>${j.priority}</span><b>${j.progress}%</b></div><div class="progress"><i style="width:${j.progress}%"></i></div>`;
  else if(j.status==='done')mid=`<div class="jobresult"><b>Kết quả</b><div class="restext md">${j.remote?md(j.result):escapeHTML(j.result)}</div></div>`;
  else mid=`<div class="joberr"><b>${j.status==='cancelled'?'Đã dừng':j.remote?'Lỗi':`Lỗi tại ${j.progress}%`}</b>${escapeHTML(j.error)}</div><button class="ghost retry" data-retry="${j.key}">⟲ Thử lại</button>`;
  const stats=j.remote&&j.finished?[j.durationMs!=null&&`⏱ ${Math.round(j.durationMs/1000)}s`,j.turns!=null&&`${j.turns} lượt`,j.costUsd!=null&&`$${j.costUsd.toFixed(3)}`].filter(Boolean).join(' · '):'';
  return `<div class="job st-${j.status}" data-job="${j.key}"><div class="jobhead"><span class="tagdot" style="background:${hex(a.color)}"></span><b>${escapeHTML(a.name)}</b>${where}<span class="badge ${GROUP[j.status]==='running'?'running':j.status==='done'?'done':'error'}">${STATUS[j.status]}</span></div><div class="jobtext">${escapeHTML(j.text)}</div>${mid}<div class="jobmeta">${j.priority} · giao lúc ${clock(j.created)}${j.finished?` · ${j.status==='done'?'xong':'dừng'} lúc ${clock(j.finished)}`:''}${stats?` · ${stats}`:''}</div></div>`;
}
function renderResults(){
  const jobs=allJobs(),count=g=>g==='all'?jobs.length:jobs.filter(j=>GROUP[j.status]===g).length;
  $('resultTabs').innerHTML=[['all','Tất cả'],['running','Đang xử lý'],['done','Hoàn thành'],['error','Lỗi']].map(([k,l])=>`<button data-filter="${k}" class="${k===filter?'on':''} f-${k}">${l} <b>${count(k)}</b></button>`).join('');
  const list=jobs.filter(j=>filter==='all'||GROUP[j.status]===filter);
  const html=list.length?list.map(card).join(''):`<p class="empty">${jobs.length?'Không có việc nào ở mục này.':'Chưa có việc nào. Giao việc ở cột bên trái, kết quả sẽ hiện ở đây.'}</p>`;
  // keep scroll/selection in long results when nothing changed
  if(html!==lastSig){$('results').innerHTML=html;lastSig=html}
}
function updateStats(){const jobs=allJobs(),run=jobs.filter(j=>GROUP[j.status]==='running');$('active').textContent=new Set(run.map(j=>j.agent)).size;$('queued').textContent=run.length;$('done').textContent=jobs.filter(j=>j.status==='done').length;$('failed').textContent=jobs.filter(j=>GROUP[j.status]==='error').length;agents.forEach(a=>a.el.classList.toggle('busy',run.some(j=>j.agent===a.id)));renderResults();renderProfile();pv?.refresh()}
$('agent-count').textContent=`· ${agents.length} AI`;$('avatars').innerHTML=agents.map(a=>`<button title="${a.role}" data-agent="${a.id}"><i style="background:${hex(a.color)}">${a.name[0]}</i>${a.name}</button>`).join('');document.querySelectorAll('#avatars [data-agent]').forEach(el=>el.onclick=()=>selectAgent(el.dataset.agent));
let toastTimeout;function toast(s){const el=document.querySelector('#toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3600)}
// Simulation: ~18% of jobs fail somewhere between 25% and 90%; a retry fails less often
const start=(j,failRate)=>Object.assign(j,{status:'running',progress:0,failAt:Math.random()<failRate?25+Math.floor(Math.random()*65):null,result:null,error:null,finished:null});
// Real tasks: poll the machine fast while something runs, slowly otherwise; toast on status changes
async function syncRemote(){
  clearTimeout(syncTimer);
  try{const {tasks}=await machineApi('/tasks');remote=tasks.map(fromServer);
    for(const j of remote){const p=prevStatus.get(j.key),a=agentOf(j.agent);if(p&&p!==j.status){if(j.status==='done')toast(`✓ ${a.name} đã hoàn thành nhiệm vụ trên máy`);else if(j.status==='error')toast(`⚠ ${a.name} gặp lỗi khi xử lý trên máy`)}prevStatus.set(j.key,j.status)}
    updateStats()}catch{}
  syncTimer=setTimeout(syncRemote,remote.some(j=>GROUP[j.status]==='running')?1500:8000);
}
// Progress popup (click a character, its label or a result card)
const cancelJob=async j=>{try{await machineApi(`/tasks/${j.rid}/cancel`,{method:'POST'});toast('Đã yêu cầu dừng nhiệm vụ');syncRemote()}catch(e){toast(e.message)}};
const retryJob=async j=>{try{if(j.remote){await machineApi(`/tasks/${j.rid}/retry`,{method:'POST'});syncRemote()}else{start(j,.08);updateStats()}toast(agentOf(j.agent).name+' đang thử lại nhiệm vụ')}catch(e){toast(e.message)}};
var pv=createProgressView({agentOf,allJobs,machineApi,md,esc:escapeHTML,hex,STATUS,GROUP,onCancel:cancelJob,onRetry:retryJob,onAssign:id=>{selectAgent(id);taskEl.focus()}});
function openAgent(id){selectAgent(id);pv.open(id)}
const machineUI=initMachineConnect({toast,onStatus:s=>{machine=s;renderRunNote()}});
$('useWeb').onchange=e=>{useWeb=e.target.checked;try{localStorage.setItem('office-use-web',useWeb?'1':'0')}catch{}renderRunNote()};
$('runOn').onchange=e=>{runOn=e.target.value;try{localStorage.setItem('office-run-on',runOn)}catch{}renderRunNote()};
$('runNote').onclick=e=>{if(e.target.closest('[data-open-machine]'))machineUI.open()};
$('assign').onclick=async()=>{
  const t=taskEl.value.trim(),btn=$('assign'),priority=$('priority').value;if(!t){toast('Vui lòng nhập yêu cầu công việc');taskEl.focus();return}
  if(runOn==='machine'){
    if(!machine?.ready){toast('Máy cá nhân chưa sẵn sàng: kiểm tra kết nối trước khi giao việc');machineUI.open();return}
    btn.disabled=true;
    try{const {task}=await machineApi('/tasks',{method:'POST',body:JSON.stringify({agent:selected.id,name:selected.name,role:selected.role,text:t,priority,web:useWeb,siteIds:useWeb&&$('webSite').value!=='auto'?[$('webSite').value]:[]})});const j=fromServer(task);remote.unshift(j);prevStatus.set(j.key,j.status);toast(`Đã gửi nhiệm vụ cho ${selected.name}, chạy trên máy ${task.host}`);syncTimer=setTimeout(syncRemote,800)}
    catch(e){toast(e.message);return}finally{btn.disabled=false}
  }else{sim.unshift(start({key:'s'+(++simId),agent:selected.id,text:t,priority,created:new Date()},.18));toast('Đã giao nhiệm vụ mô phỏng cho '+selected.name)}
  taskEl.value='';if(filter==='done'||filter==='error')filter='all';updateStats();
};
$('resultTabs').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;renderResults()}};
$('results').onclick=async e=>{
  const r=e.target.closest('[data-retry]'),c=e.target.closest('[data-cancel]');
  try{
    if(c){await cancelJob(remote.find(j=>j.rid===+c.dataset.cancel));return}
    if(r){await retryJob(allJobs().find(j=>j.key===r.dataset.retry));return}
  }catch(err){toast(err.message);return}
  const k=e.target.closest('[data-job]');if(k&&!e.target.closest('.restext')){const j=allJobs().find(j=>j.key===k.dataset.job);selectAgent(j.agent);pv.open(j.agent,j.key)}
};
setInterval(()=>{let changed=false;for(const j of sim){if(j.status!=='running')continue;changed=true;j.progress=Math.min(100,j.progress+Math.ceil(Math.random()*8));const a=agentOf(j.agent);
  if(j.failAt!==null&&j.progress>=j.failAt){j.progress=j.failAt;j.status='error';j.error=ERRORS[Math.random()*ERRORS.length|0];j.finished=new Date();toast(`⚠ ${a.name} gặp lỗi khi xử lý nhiệm vụ`)}
  else if(j.progress>=100){j.status='done';j.result=RESULTS[a.id][Math.random()*2|0];j.finished=new Date();toast(`✓ ${a.name} đã hoàn thành nhiệm vụ`)}}
  if(changed)updateStats()},2200);
selectAgent(selected.id);renderRunNote();updateStats();syncRemote();
const HOME_VIEW=[Math.PI/4,.96,20.5];$('reset').onclick=()=>{[theta,phi,dist]=HOME_VIEW;updateCamera()};const guide=$('guide');$('help').onclick=()=>guide.classList.remove('hidden');$('closeguide').onclick=$('okguide').onclick=()=>guide.classList.add('hidden');
let dragging=false,moved=0,px=0,py=0;renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;moved=0;px=e.clientX;py=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)});renderer.domElement.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-px,dy=e.clientY-py;moved+=Math.abs(dx)+Math.abs(dy);theta-=dx*.006;phi=Math.max(.40,Math.min(1.38,phi+dy*.005));px=e.clientX;py=e.clientY;updateCamera()});renderer.domElement.addEventListener('pointerup',e=>{dragging=false;if(moved>7)return;const p=new THREE.Vector2(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(p,camera);const hits=ray.intersectObjects(pickables);if(hits.length)openAgent(hits[0].object.userData.agent)});renderer.domElement.addEventListener('wheel',e=>{dist=Math.max(10,Math.min(30,dist+e.deltaY*.012));updateCamera()},{passive:true});let lastT=0;function animate(t){requestAnimationFrame(animate);const dt=Math.min(.1,(t-lastT)/1000);lastT=t;wander.update(dt);outdoor.update(t,dt);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();for(const a of agents){a.labelPos.set(a.group.position.x,2.05,a.group.position.z);const p=a.labelPos.clone().project(camera);const visible=p.z<1;const x=(p.x*.5+.5)*innerWidth,y=(-p.y*.5+.5)*innerHeight;a.el.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px)`;a.el.style.display=visible?'flex':'none';a.char.update(t)}room.update(t);renderer.render(world,camera)}requestAnimationFrame(animate);

// Outdoor scenery switcher (remembered per browser)
const sceneryEl=document.getElementById('scenery');sceneryEl.innerHTML='<span>BỐI CẢNH</span>'+Object.entries(room.scenes).map(([k,s])=>`<button data-scene="${k}" title="${s.label}"><i style="background:${s.swatch}"></i><em>${s.label}</em></button>`).join('');
function applyScene(k){room.setScenery(k);outdoor.setScene(k);sceneryEl.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.scene===k));try{localStorage.setItem('office-scene',k)}catch{}}
sceneryEl.onclick=e=>{const b=e.target.closest('[data-scene]');if(b)applyScene(b.dataset.scene)};
let savedScene='day';try{savedScene=new URLSearchParams(location.search).get('scene')||localStorage.getItem('office-scene')||'day'}catch{}applyScene(room.scenes[savedScene]?savedScene:'day');

initClaudeConnect({toast});
