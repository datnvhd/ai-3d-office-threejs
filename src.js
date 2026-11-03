import * as THREE from 'three';
import './style.css';
import {createCharacter,PRESETS} from './characters.js';
import {attachModel} from './character-models.js';
import {initClaudeConnect} from './claude-connect.js';
import {initCodexConnect} from './codex-connect.js';
import {createOffice} from './office.js';
import {createWander} from './wander.js';
import {createOutdoor} from './outdoor.js';
import {initMachineConnect,machineApi} from './machine-connect.js';
import {createProgressView} from './progress-view.js';
import {ruleSteps,MODELS,EFFORTS,modelId} from './workflow-plan.js';
import {initWebMCP} from './webmcp.js';
const app=document.querySelector('#app');
// Left column: assign work · right column: what the agents did with it (running, done with result, failed with error)
app.innerHTML=`<div id="scene"></div><div class="top"><div class="brand"><span class="logo">▦</span><div><b>My Office <i>3D</i></b><small>AI AGENT WORKSPACE</small></div></div><div class="topstats"><span><em class="dot green"></em><b id="active">0</b> AI đang làm việc</span><span><em class="dot orange"></em><b id="queued">0</b> đang xử lý</span><span><em class="dot blue"></em><b id="done">0</b> hoàn thành</span><span><em class="dot red"></em><b id="failed">0</b> lỗi</span></div><div class="actions"><button id="reset">⟲ Đặt lại góc nhìn</button><button id="help">? Hướng dẫn</button></div></div><div class="floatinglabels" id="labels"></div>
<aside class="side side-left"><div class="panel-kicker">① GIAO VIỆC</div><h2 class="side-title">Giao nhiệm vụ cho AI</h2><div class="section-title">CHỌN NHÂN VIÊN <span id="agent-count"></span></div><div class="agent-pick" id="avatars"></div><div class="profile"><div class="profile-avatar" id="profile-icon">◉</div><div class="profile-main"><h3 id="profile-name"></h3><span id="profile-role"></span><p class="profile-desc" id="profile-desc"></p></div><div class="profile-tools"><button class="ptool" id="agentEdit" title="Sửa tên, vai trò, mô tả">✎</button><button class="ptool" id="agentDel" title="Xóa agent">🗑</button></div></div><div class="status" id="profile-status"></div><div class="section-title">YÊU CẦU CÔNG VIỆC</div><textarea id="task" placeholder="Ví dụ: Phân tích báo cáo doanh thu quý III và tổng hợp 5 insight quan trọng..."></textarea><div class="opts"><div><label class="smalllabel">Mức ưu tiên</label><select id="priority"><option>Bình thường</option><option>Ưu tiên cao</option><option>Khẩn cấp</option></select></div><div><label class="smalllabel">Nơi thực thi</label><select id="runOn"><option value="machine">💻 Máy cá nhân</option><option value="sim">🎲 Mô phỏng</option></select></div><div><label class="smalllabel">Model AI</label><select id="model" title="Tự chọn: Director chọn model rẻ nhất đủ làm tốt từng bước. Giá: USD / 1 triệu token vào/ra"></select></div><div><label class="smalllabel">Mức suy luận</label><select id="effort" title="Suy luận càng sâu càng tốn token: Thấp ≈ một nửa Cao, Rất cao ≈ gấp đôi Cao"></select></div></div><label class="mcheck wfopt"><input type="checkbox" id="useWf"> 🔀 Tự tạo luồng công việc khi giao cho Director (Director chia việc cho các agent liên quan)</label><div class="webopt" id="webOpt"><label class="mcheck"><input type="checkbox" id="useWeb"> 🌐 Cho phép mở web & thao tác trình duyệt</label><select id="webSite" class="hidden"></select></div><p class="runnote" id="runNote"></p><button class="assign" id="assign">✦ Giao việc cho AI</button></aside>
<aside class="side side-right"><div class="panel-kicker">② KẾT QUẢ XỬ LÝ</div><h2 class="side-title">Kết quả từ AI</h2><div class="result-tabs" id="resultTabs"></div><div id="results" class="tasklist"></div><p class="disclaimer">💻 Máy cá nhân: chạy thật bằng Claude Code (Designer dùng Codex/ChatGPT) trên máy của bạn · 🎲 Mô phỏng: tiến độ, kết quả và lỗi chỉ là giả lập.</p></aside>
<div class="scenery" id="scenery"></div><div id="toast"></div><div class="modal hidden" id="guide"><div class="guide"><button class="close" id="closeguide">✕</button><h2>Điều khiển văn phòng</h2><p>🖱️ Kéo chuột để xoay góc nhìn 3D, cuộn để zoom. Bấm vào nhân viên, nhãn tên hoặc thẻ tên bên trái để chọn người nhận việc.</p><p>📋 Cột trái để giao việc, cột phải hiển thị việc đang xử lý, hoàn thành (kèm kết quả) hoặc gặp lỗi (có thể thử lại). Chọn nơi thực thi “Máy cá nhân” để chạy thật bằng Claude Code trên máy của bạn (bấm ô “Máy” trên thanh trên cùng để chọn thư mục làm việc, quyền và chạy kiểm tra), hoặc “Mô phỏng” để chạy thử giả lập.</p><button id="okguide" class="assign">Đã hiểu</button></div></div>`;
// Built-in agents: look and desk per id (their desk position is fixed)
const BUILTIN=[{id:'director',name:'Director',role:'Điều phối dự án',color:0x5b8def,x:0.6,z:-1.3,look:PRESETS.manager,desk:{screen:'dashboard',divider:0xf6a15c,props:['coffee','robot','notebook']}},{id:'research',name:'Research AI',role:'Nghiên cứu & tổng hợp',color:0xa78bfa,x:-4.4,z:-1.6,look:PRESETS.student,desk:{screen:'ai',props:['notebook','plant','pens']}},{id:'frontend',name:'Frontend Dev',role:'Phát triển giao diện',color:0x1e6fe8,x:-2.5,z:2.65,look:PRESETS.dev,desk:{screen:'code',laptop:true,divider:0x5b8def,props:['coffee','plant']}},{id:'backend',name:'Backend Dev',role:'API & hệ thống',color:0x7fb2ff,x:-1.0,z:2.65,desk:{screen:'code',divider:0xf28cb1,props:['coffee','pens','plant']},look:{...PRESETS.dev,top:0xf2f3f7,sleeve:0x1e6fe8,hood:0x1e6fe8,cuff:0xf2f3f7,band:0x1e6fe8,logo:'api',headphones:{on:'head',color:0x2b2f3a,accent:0x1e6fe8},pose:'idle',mouth:'grin',hairColor:0x2e221c,seed:7}},{id:'analyst',name:'Data Analyst',role:'Phân tích dữ liệu',color:0x38bdf8,x:-2.9,z:-1.6,desk:{screen:'chart',props:['notebook','plant','coffee']},look:{...PRESETS.designer,top:0x1e6fe8,hood:0xf2f3f7,band:0x1e6fe8,cuff:0x1e6fe8,logo:'chart',glasses:null,bun:false,pose:'idle',hairColor:0x2c1f1a,pants:0x3f4556,shoeAccent:0x1e6fe8,mouth:'grin'}},{id:'designer',name:'Designer',role:'Thiết kế sản phẩm',color:0xffd166,x:-4.55,z:2.65,look:PRESETS.designer,desk:{style:'wood',screen:'design'}},{id:'qa',name:'QA Tester',role:'Kiểm thử & chất lượng',color:0xc4b5fd,x:-1.4,z:-1.6,desk:{screen:'ai',laptop:'chart',props:['coffee','notebook']},look:{...PRESETS.dev,top:0xa78bfa,sleeve:0xf2f3f7,hood:0xf2f3f7,cuff:0xa78bfa,band:0xa78bfa,logo:'check',glasses:{shape:'round',color:0x2a2a30},headphones:null,pose:'wave',mouth:'open',hairColor:0x4a3226,shoeAccent:0xa78bfa,seed:13}}];
// Desks: the 7 built-in ones (with the aisle node agents step out from), then 5 desks already in the room that had nobody:
// the back row by the windows and the back-to-back desks in the glass room. Agents there stand behind the desk facing
// the room and stay put. A desk freed by deleting an agent goes to the next new agent, so the office holds 12.
const DOOR_OF={director:'cF',research:'cA',analyst:'cC',qa:'cD',frontend:'frd',backend:'bkd',designer:'dsd'};
const SLOTS=[...BUILTIN.map(b=>({x:b.x,z:b.z,door:DOOR_OF[b.id]})),{x:-4.75,z:-3.6},{x:-3.25,z:-3.6},{x:-1.75,z:-3.6},{x:-2.85,z:.97},{x:-1.35,z:.97}];
const LOOKS={dev:'Lập trình viên',designer:'Thiết kế / sáng tạo',manager:'Quản lý',student:'Trẻ trung'};
// Saved agent list (server, shared by every browser on this machine); without one, the 7 built-in agents
const savedAgents=await fetch('/api/machine/agents').then(r=>r.ok?r.json():null).then(d=>d?.agents).catch(()=>null);
const agents=(savedAgents||BUILTIN.map(b=>({id:b.id,builtin:true}))).map(v=>{
  const b=BUILTIN.find(x=>x.id===v.id);
  if(v.builtin)return b&&{...b,name:v.name||b.name,role:v.role??b.role,desc:v.desc||'',builtin:true,slot:BUILTIN.indexOf(b),door:DOOR_OF[b.id]};
  const at=SLOTS[v.slot];if(!at)return null;
  const preset=LOOKS[v.preset]?v.preset:'dev',seed=[...v.id].reduce((h,c)=>h*31+c.charCodeAt(0)|0,7)>>>0;
  return {id:v.id,name:v.name,role:v.role||'',desc:v.desc||'',color:v.color??0x9aa3b5,preset,slot:v.slot,x:at.x,z:at.z,door:at.door,
    look:{...PRESETS[preset],top:v.color??PRESETS[preset].top,seed:seed%97}};
}).filter(Boolean);
const world=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.65;document.querySelector('#scene').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(40,1,.1,100);let theta=Math.PI/4,phi=.96,dist=20.5;const focus=new THREE.Vector3(0,0,0);function updateCamera(){camera.position.set(Math.sin(theta)*Math.sin(phi)*dist,Math.cos(phi)*dist,Math.cos(theta)*Math.sin(phi)*dist);camera.lookAt(focus)}updateCamera();
const room=createOffice(world,renderer),office=room.group,pickables=[];
function agentCharacter(agent){const g=new THREE.Group();g.position.set(agent.x,0,agent.z);g.rotation.y=agent.yaw??.35;office.add(g);agent.char=createCharacter(agent.look);g.add(agent.char.group);const hit=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,2,12),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));hit.position.y=1;hit.userData.agent=agent.id;g.add(hit);pickables.push(hit);agent.group=g;agent.labelPos=new THREE.Vector3(agent.x,2.05,agent.z);const ring=new THREE.Mesh(new THREE.RingGeometry(.37,.42,32),new THREE.MeshBasicMaterial({color:agent.color,side:THREE.DoubleSide,transparent:true,opacity:0}));ring.rotation.x=-Math.PI/2;ring.position.y=.013;g.add(ring);agent.ring=ring;return g}
// Characters stand in front of their desk with the chair pushed to one side
for(const b of BUILTIN)room.workstation(b.x,b.z,b.desk);// built-in desks stay even when their agent is deleted
for(const a of agents){agentCharacter(a);attachModel(a.char,a.id,a.preset).then(n=>{if(n)console.info(`${a.name}: dùng mô hình 3D /models/${n}.glb`)})}
// Streets, houses, traffic and passers-by around the building
const outdoor=createOutdoor(world);
// Idle agents stroll around the office; agents with unfinished tasks stay at (or return to) their desk
const wander=createWander(agents,{isBusy:id=>allJobs().some(j=>j.agent===id&&(j.status==='running'||j.status==='queued'))});
const tagHTML=a=>`<span class="tagdot" style="background:#${a.color.toString(16).padStart(6,'0')}"></span>${escapeHTML(a.name)}`;
const labels=document.getElementById('labels');agents.forEach(a=>{a.el=document.createElement('button');a.el.className='tag';a.el.innerHTML=tagHTML(a);a.el.onclick=()=>openAgent(a.id);labels.appendChild(a.el)});
// Tasks run for real on the personal machine (Claude Code via /api/machine) or as a local simulation
const RESULTS={director:['Đã lập kế hoạch 3 giai đoạn, phân công cho 4 thành viên; mốc bàn giao: thứ Sáu tuần này.','Đã chốt phạm vi, rủi ro chính và lịch họp review hằng tuần với các bên liên quan.'],research:['Tổng hợp 12 nguồn tham khảo, rút ra 5 insight chính kèm trích dẫn; báo cáo 2 trang.','So sánh 4 giải pháp trên thị trường theo chi phí, tính năng và mức độ phổ biến.'],frontend:['Đã dựng 3 màn hình theo thiết kế, responsive cho mobile; bản xem thử đã sẵn sàng.','Sửa 6 lỗi giao diện, tối ưu tải trang từ 3,1s xuống 1,4s.'],backend:['Thêm 4 endpoint REST kèm 18 test tự động (pass 100%); thời gian phản hồi TB 120 ms.','Tối ưu truy vấn chính, giảm tải CPU database khoảng 35%.'],analyst:['Phân tích 24.580 dòng dữ liệu: doanh thu tăng 14% so với quý trước, nhóm khách mới đóng góp 38%.','Lập dashboard 6 chỉ số KPI, phát hiện 2 điểm bất thường cần kiểm tra.'],designer:['Bàn giao 2 phương án giao diện và bộ icon 24px; đã chú thích kích thước, màu sắc.','Cập nhật design system: 12 component mới, kiểm tra tương phản đạt chuẩn AA.'],qa:['Chạy 46 test case: 44 đạt, 2 lỗi mức thấp đã ghi nhận kèm bước tái hiện.','Kiểm thử hồi quy 5 luồng chính trên 3 trình duyệt, không phát hiện lỗi chặn.']};
const ERRORS=['Hết thời gian chờ phản hồi từ công cụ (timeout 60s).','Không có quyền truy cập vào dữ liệu nguồn được yêu cầu.','Yêu cầu chưa đủ thông tin: cần mô tả rõ phạm vi và đầu ra mong muốn.','Lỗi kết nối tới dịch vụ bên ngoài (HTTP 503).'];
const STATUS={queued:'Đang chờ',running:'Đang xử lý',done:'Hoàn thành',error:'Lỗi',cancelled:'Đã dừng'};
const GROUP={queued:'running',running:'running',done:'done',error:'error',cancelled:'error'};
let selected=agents[0],sim=[],remote=[],simId=0,filter='all',machine=null,lastSig='',syncTimer=null;const prevStatus=new Map();
let runOn='machine',useWeb=false,useWf=true,model='auto',effort='auto';try{runOn=localStorage.getItem('office-run-on')||'machine';useWeb=localStorage.getItem('office-use-web')==='1';useWf=localStorage.getItem('office-use-wf')!=='0';model=modelId(localStorage.getItem('office-model'))||'auto';effort=localStorage.getItem('office-effort')||'auto'}catch{}
// A workflow only when the job is given to the Director; a task given to another agent runs with that agent alone
const wfOn=()=>useWf&&selected.id==='director';
// Model label for a task card: which Claude model and effort ran it, and why they were picked
const modelTag=j=>{const m=MODELS[modelId(j.model)];return j.engine==='codex'||!m?'':`<span class="modeltag m-${m.family}" title="${escapeHTML(j.modelWhy||'')}">${m.label}${EFFORTS[j.effort]?` · ${EFFORTS[j.effort].toLowerCase()}`:''}</span>`};
// Model picker: auto, the recommended models, then older versions; each with its price per million tokens
const modelOption=([id,m])=>`<option value="${id}">${m.label} · $${m.price[0]}/$${m.price[1]}</option>`;
const modelOptions=`<option value="auto">✨ Tự chọn</option><optgroup label="Khuyên dùng">${Object.entries(MODELS).filter(([,m])=>m.auto).map(modelOption).join('')}</optgroup><optgroup label="Phiên bản khác">${Object.entries(MODELS).filter(([,m])=>!m.auto).map(modelOption).join('')}</optgroup>`;
const effortOptions=`<option value="auto">✨ Tự chọn</option>${Object.entries(EFFORTS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}`;
const team=()=>agents.map(a=>({id:a.id,name:a.name,role:a.role,desc:a.desc}));
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
const fromServer=t=>({key:'m'+t.id,rid:t.id,remote:true,agent:t.agent,text:t.text,priority:t.priority,status:t.status,steps:t.steps||0,activity:t.activity,started:t.started?new Date(t.started):null,result:t.result,error:t.error,created:new Date(t.created),finished:t.finished?new Date(t.finished):null,durationMs:t.durationMs,turns:t.turns,costUsd:t.costUsd,cwd:t.cwd,mode:t.mode,host:t.host,engine:t.engine||'claude',web:!!t.web,siteLabels:t.siteLabels||[],fileNames:t.fileNames||[],kind:t.kind,wf:t.wf!=null?'m'+t.wf:null,wfTitle:t.wfTitle,stepTitle:t.stepTitle,model:t.model,effort:t.effort,modelWhy:t.modelWhy,asks:t.asks||0,asking:!!t.asking,rework:t.rework||null,origin:t.origin??null,progress:t.status==='done'?100:Math.min(92,8+(t.steps||0)*9)});
function selectAgent(id){selected=agentOf(id);$('profile-name').textContent=selected.name;$('profile-role').textContent=selected.role;$('profile-desc').textContent=selected.desc||'';$('profile-desc').title=selected.desc||'';$('agentDel').classList.toggle('hidden',selected.id==='director');$('profile-icon').style.background=hex(selected.color);$('profile-icon').textContent=selected.name[0];agents.forEach(a=>a.ring.material.opacity=a.id===id?.95:0);document.querySelectorAll('.tag').forEach((e,i)=>e.classList.toggle('selected',agents[i].id===id));document.querySelectorAll('#avatars [data-agent]').forEach(e=>e.classList.toggle('on',e.dataset.agent===id));renderProfile();renderRunNote()}
// Which CLI the server runs this agent's tasks with (set in the machine config, Designer → Codex by default)
const engineOf=id=>machine?.agentEngines?.[id]==='codex'?'codex':'claude';
const engineName=id=>engineOf(id)==='codex'?'Codex (ChatGPT)':'Claude Code';
const engineReady=id=>engineOf(id)==='codex'?!!machine?.codex?.ready:!!machine?.ready;
function renderProfile(){const mine=allJobs().filter(j=>j.agent===selected.id),n=g=>mine.filter(j=>GROUP[j.status]===g).length;$('profile-status').innerHTML=(n('running')?'<span class="pulse"></span> Đang thực hiện nhiệm vụ':'<span class="pulse idle"></span> Sẵn sàng nhận việc')+(mine.length?`<em>${n('running')} đang xử lý · ${n('done')} xong · ${n('error')} lỗi</em>`:'')}
function renderRunNote(){
  $('runOn').value=runOn;const m=machine,el=$('runNote'),pick=$('webSite'),keep=pick.value;
  $('webOpt').classList.toggle('hidden',runOn!=='machine');$('useWeb').checked=useWeb;pick.classList.toggle('hidden',!useWeb);
  pick.innerHTML='<option value="auto">🔑 Tự nhận tài khoản theo link trong yêu cầu</option>'+(m?.browser?.sites||[]).map(x=>`<option value="${x.id}">🔑 ${escapeHTML(x.label)} · ${escapeHTML(x.username||'')}</option>`).join('');
  if([...pick.options].some(o=>o.value===keep))pick.value=keep;
  $('useWf').checked=useWf;$('useWf').disabled=selected.id!=='director';$('useWf').closest('label').classList.toggle('off',selected.id!=='director');$('model').value=MODELS[model]?model:'auto';$('effort').value=EFFORTS[effort]?effort:'auto';
  const ready=wfOn()&&runOn==='machine'?!!machine?.ready:engineReady(selected.id),isCodex=!wfOn()&&engineOf(selected.id)==='codex';
  el.className='runnote '+(runOn==='sim'?'sim':ready?'ok':'warn');
  el.innerHTML=runOn==='sim'?'Chỉ giả lập tiến độ và kết quả, không chạy thật.':!m?'Đang kiểm tra máy cá nhân…':ready?`${wfOn()?'🔀 Director lập kế hoạch rồi giao từng bước cho agent liên quan':`Chạy thật bằng ${engineName(selected.id)}`} trên <b>${escapeHTML(m.host.name)}</b> · ${escapeHTML(m.config.modes[m.config.mode])}${useWeb?' · 🌐 dùng trình duyệt':''}<br><code title="${escapeHTML(m.config.workdir)}">${escapeHTML(m.config.workdir)}</code> <button class="linkbtn" data-open-machine>Cài đặt</button>`:isCodex?`⚠ ${escapeHTML(selected.name)} làm việc bằng Codex nhưng Codex chưa ${m.codex?.found?'đăng nhập':'được cài'}. Bấm ô <b>Codex</b> trên thanh trên cùng để kết nối.`:`⚠ Máy cá nhân chưa sẵn sàng. <button class="linkbtn" data-open-machine>Mở cài đặt & kiểm tra</button>`;
}
function card(j){
  const a=agentOf(j.agent),live=GROUP[j.status]==='running',where=j.remote?`<span class="where" title="${escapeHTML(j.cwd||'')}">${j.web?'🌐':'💻'} ${escapeHTML(j.host||'Máy cá nhân')} · ${j.engine==='codex'?'Codex':'Claude'}</span>`:'<span class="where">🎲 Mô phỏng</span>';
  let mid='';
  if(live&&j.remote)mid=`<div class="activity">${j.status==='queued'?'Đang chờ đến lượt…':`Bước ${j.steps} · ${escapeHTML(j.activity||'Đang xử lý…')}`}</div><div class="progress live"><i style="width:${j.progress}%"></i></div><button class="ghost stop" data-cancel="${j.rid}">■ Dừng</button>`;
  else if(live)mid=`<div class="progressrow"><span>${j.priority}</span><b>${j.progress}%</b></div><div class="progress"><i style="width:${j.progress}%"></i></div>`;
  else if(j.status==='done')mid=`<div class="jobresult"><b>Kết quả</b><div class="restext md">${j.remote?md(j.result):escapeHTML(j.result)}</div></div>${j.remote&&j.kind!=='plan'?'<button class="ghost retry" data-ask>💬 Hỏi thêm</button>':''}`;
  else mid=`<div class="joberr"><b>${j.status==='cancelled'?'Đã dừng':j.remote?'Lỗi':`Lỗi tại ${j.progress}%`}</b>${escapeHTML(j.error)}</div><button class="ghost retry" data-retry="${j.key}">⟲ Thử lại</button>`;
  const stats=j.remote&&j.finished?[j.durationMs!=null&&`⏱ ${Math.round(j.durationMs/1000)}s`,j.turns!=null&&`${j.turns} lượt`,j.costUsd!=null&&`$${j.costUsd.toFixed(3)}`,j.asks&&`💬 ${j.asks} câu hỏi thêm`].filter(Boolean).join(' · '):'';
  return `<div class="job st-${j.status}" data-job="${j.key}"><div class="jobhead"><span class="tagdot" style="background:${hex(a.color)}"></span><b>${escapeHTML(a.name)}</b>${where}<span class="badge ${GROUP[j.status]==='running'?'running':j.status==='done'?'done':'error'}">${STATUS[j.status]}</span>${live?'':`<button class="delbtn" data-del="${j.key}" title="Xóa việc này">🗑</button>`}</div><div class="jobtext">${escapeHTML(j.text)}</div>${j.fileNames?.length?`<div class="jobfiles">📎 ${j.fileNames.map(escapeHTML).join(', ')}</div>`:''}${mid}<div class="jobmeta">${j.priority} · giao lúc ${clock(j.created)}${j.finished&&!live?` · ${j.status==='done'?'xong':'dừng'} lúc ${clock(j.finished)}`:''}${stats?` · ${stats}`:''}${modelTag(j)}</div></div>`;
}
// One card per workflow: its plan and steps in order, each row opens that step's progress
function wfCard(group){
  const plan=group.find(j=>j.kind==='plan')||group[0],steps=group.filter(j=>j.kind!=='plan').sort((a,b)=>(a.order??a.rid??0)-(b.order??b.rid??0));
  const done=steps.filter(j=>j.status==='done').length,bad=steps.some(j=>GROUP[j.status]==='error')||GROUP[plan.status]==='error',live=group.some(j=>GROUP[j.status]==='running');
  const st=bad?'error':live?'running':'done',label=bad?'Có bước lỗi':live?(steps.length?`${done}/${steps.length} bước`:'Đang lập kế hoạch'):'Hoàn thành';
  const row=(j,i)=>{const a=agentOf(j.agent),wait=j.status==='queued'&&j.activity;
    return `<div class="wfrow st-${j.status}${j.rework?' sentback':''}" data-job="${j.key}"><span class="wfnum">${i}</span><span class="tagdot" style="background:${hex(a.color)}"></span><div class="wfinfo"><b>${escapeHTML(a.name)}</b> · ${escapeHTML(j.stepTitle||'')}${modelTag(j)}<small>${GROUP[j.status]==='running'?escapeHTML(wait?j.activity:j.remote?(j.activity||'Đang xử lý…'):j.progress+'%'):GROUP[j.status]==='error'?escapeHTML(j.error||''):j.status==='done'?(j.rework?`↩ Trả lại ${escapeHTML(j.rework.to.join(', '))} để sửa`:'✓ Xong'+(j.finished?' lúc '+clock(j.finished):'')):''}</small></div><span class="badge ${GROUP[j.status]==='running'?'running':j.status==='done'?'done':'error'}">${wait?'Chờ':STATUS[j.status]}</span>${GROUP[j.status]==='error'?`<button class="linkbtn" data-retry="${j.key}">Thử lại</button>`:''}</div>`};
  const last=[...steps].reverse().find(j=>j.status==='done'),allDone=steps.length&&done===steps.length;
  return `<div class="job wf st-${st}"><div class="jobhead"><span class="wficon">🔀</span><b>${escapeHTML(plan.wfTitle||'Luồng công việc')}</b><span class="where">${plan.remote?'💻 Máy':'🎲 Mô phỏng'}</span><span class="badge ${st}">${label}</span>${live?'':`<button class="delbtn" data-del="${plan.key}" title="Xóa cả luồng công việc">🗑</button>`}</div><div class="jobtext">${escapeHTML(plan.text)}</div>
    <div class="wfprog"><i style="width:${steps.length?Math.round(done/steps.length*100):5}%"></i></div><div class="wfsteps">${row(plan,0)}${steps.map((j,i)=>row(j,i+1)).join('')}</div>
    ${allDone&&last?`<div class="jobresult"><b>Kết quả cuối · ${escapeHTML(agentOf(last.agent).name)}</b><div class="restext md">${last.remote?md(last.result):escapeHTML(last.result)}</div></div>`:''}<div class="jobmeta">${plan.priority} · giao lúc ${clock(plan.created)}</div></div>`;
}
// Finished tasks can be deleted; a workflow only as a whole and only when none of its steps runs or waits
const deletable=j=>GROUP[j.status]!=='running'&&!(j.wf&&allJobs().some(x=>x.wf===j.wf&&GROUP[x.status]==='running'));
async function deleteJob(j){
  const group=j.wf?allJobs().filter(x=>x.wf===j.wf):[j];
  if(j.wf&&!confirm(`Xóa cả luồng công việc (${group.length} việc)?`))return;
  if(j.remote)await machineApi(`/tasks/${j.rid}`,{method:'DELETE'});
  const keys=new Set(group.map(x=>x.key));sim=sim.filter(x=>!keys.has(x.key));remote=remote.filter(x=>!keys.has(x.key));
  toast(j.wf?'Đã xóa luồng công việc':'Đã xóa việc');updateStats();
}
async function clearFinished(){
  const list=allJobs().filter(deletable);if(!list.length)return;
  if(!confirm(`Xóa ${list.length} việc đã hoàn thành, lỗi hoặc đã dừng?`))return;
  if(list.some(j=>j.remote))await machineApi('/tasks',{method:'DELETE'});
  sim=sim.filter(j=>!deletable(j));toast(`Đã xóa ${list.length} việc`);syncRemote();updateStats();
}
function renderResults(){
  const jobs=allJobs(),count=g=>g==='all'?jobs.length:jobs.filter(j=>GROUP[j.status]===g).length;
  $('resultTabs').innerHTML=[['all','Tất cả'],['running','Đang xử lý'],['done','Hoàn thành'],['error','Lỗi']].map(([k,l])=>`<button data-filter="${k}" class="${k===filter?'on':''} f-${k}">${l} <b>${count(k)}</b></button>`).join('')+(jobs.some(deletable)?'<button class="clearbtn" data-clear title="Xóa mọi việc đã hoàn thành, lỗi hoặc đã dừng">🗑 Xóa việc đã xong</button>':'');
  const match=j=>filter==='all'||GROUP[j.status]===filter,groups=new Map(),items=[];
  for(const j of jobs){if(!j.wf){if(match(j))items.push(card(j));continue}if(!groups.has(j.wf)){groups.set(j.wf,[]);items.push(j.wf)}groups.get(j.wf).push(j)}
  const list=items.map(x=>typeof x==='string'&&groups.has(x)?(groups.get(x).some(match)?wfCard(groups.get(x)):''):x).filter(Boolean);
  const html=list.length?list.join(''):`<p class="empty">${jobs.length?'Không có việc nào ở mục này.':'Chưa có việc nào. Giao việc ở cột bên trái, kết quả sẽ hiện ở đây.'}</p>`;
  // keep scroll/selection in long results when nothing changed
  if(html!==lastSig){$('results').innerHTML=html;lastSig=html}
}
function updateStats(){const jobs=allJobs(),run=jobs.filter(j=>GROUP[j.status]==='running');$('active').textContent=new Set(run.map(j=>j.agent)).size;$('queued').textContent=run.length;$('done').textContent=jobs.filter(j=>j.status==='done').length;$('failed').textContent=jobs.filter(j=>GROUP[j.status]==='error').length;agents.forEach(a=>a.el.classList.toggle('busy',run.some(j=>j.agent===a.id)));renderResults();renderProfile();pv?.refresh()}
function renderAvatars(){
  $('agent-count').textContent=`· ${agents.length} AI`;
  $('avatars').innerHTML=agents.map(a=>`<button title="${escapeHTML(a.role)}" data-agent="${a.id}"><i style="background:${hex(a.color)}">${escapeHTML(a.name[0])}</i>${escapeHTML(a.name)}</button>`).join('')+`<button class="add-agent" data-add-agent ${freeSlot()<0?'disabled title="Văn phòng đã đủ 12 chỗ ngồi"':'title="Thêm agent mới"'}>＋ Thêm</button>`;
  document.querySelectorAll('#avatars [data-agent]').forEach(el=>el.onclick=()=>selectAgent(el.dataset.agent));
  $('avatars').querySelector('[data-add-agent]').onclick=()=>openAgentForm(null);
}
renderAvatars();
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
// Follow-up question on a finished machine task: same conversation, no need to explain the task again
const askJob=async(j,text)=>{try{await machineApi(`/tasks/${j.rid}/ask`,{method:'POST',body:JSON.stringify({text})});toast(agentOf(j.agent).name+' đang trả lời câu hỏi thêm');syncRemote()}catch(e){toast(e.message);throw e}};
const retryJob=async j=>{try{if(j.remote){await machineApi(`/tasks/${j.rid}/retry`,{method:'POST'});syncRemote()}else{start(j,.08);if(j.wf)for(const x of sim)if(x.wf===j.wf&&x.blockedBy)Object.assign(x,{status:'queued',error:null,finished:null,blockedBy:null});updateStats()}toast(agentOf(j.agent).name+' đang thử lại nhiệm vụ')}catch(e){toast(e.message)}};
var pv=createProgressView({agentOf,allJobs,machineApi,md,esc:escapeHTML,hex,STATUS,GROUP,onCancel:cancelJob,onRetry:retryJob,onAsk:askJob,onAssign:id=>{selectAgent(id);taskEl.focus()}});
function openAgent(id){selectAgent(id);pv.open(id)}
const machineUI=initMachineConnect({toast,onStatus:s=>{machine=s;renderRunNote()}});
$('useWeb').onchange=e=>{useWeb=e.target.checked;try{localStorage.setItem('office-use-web',useWeb?'1':'0')}catch{}renderRunNote()};
$('useWf').onchange=e=>{useWf=e.target.checked;try{localStorage.setItem('office-use-wf',useWf?'1':'0')}catch{}renderRunNote()};
$('runOn').onchange=e=>{runOn=e.target.value;try{localStorage.setItem('office-run-on',runOn)}catch{}renderRunNote()};
$('model').innerHTML=modelOptions;$('effort').innerHTML=effortOptions;$('model').value=MODELS[model]?model:'auto';$('effort').value=EFFORTS[effort]?effort:'auto';
$('model').onchange=e=>{model=e.target.value;try{localStorage.setItem('office-model',model)}catch{}};
$('effort').onchange=e=>{effort=e.target.value;try{localStorage.setItem('office-effort',effort)}catch{}};
$('runNote').onclick=e=>{if(e.target.closest('[data-open-machine]'))machineUI.open()};
// --- Attachments: drop PDF / Word / images onto the task box so the AI processes them with the request ---
const ATTACH_OK=/\.(pdf|docx|png|jpe?g|gif|webp|txt|md|csv)$/i;
let attachments=[];// {id,name,size,kind,status:'up'|'ok'|'err'}
const attachIds=()=>attachments.filter(a=>a.status==='ok'&&a.id).map(a=>({id:a.id,name:a.name}));
const fileIcon=k=>k==='image'?'🖼️':k==='pdf'?'📕':'📄';
const attachBar=document.createElement('div');attachBar.className='attachbar';
attachBar.innerHTML='<input type="file" id="fileInput" multiple accept=".pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv" hidden><button type="button" class="attach-add" id="attachAdd">📎 Đính kèm tệp</button><div class="attach-list" id="attachList"></div>';
taskEl.insertAdjacentElement('afterend',attachBar);
function renderAttach(){
  const el=$('attachList');
  el.innerHTML=attachments.map((a,i)=>`<span class="chip ${a.status}" data-i="${i}"><i>${a.status==='up'?'<span class="spinner"></span>':a.status==='err'?'⚠':fileIcon(a.kind)}</i><b title="${escapeHTML(a.name)}">${escapeHTML(a.name)}</b><button class="chip-x" data-rm="${i}" title="Bỏ tệp">✕</button></span>`).join('');
}
function clearAttach(){attachments=[];renderAttach()}
async function uploadFile(file){
  if(!ATTACH_OK.test(file.name)){toast('Không hỗ trợ tệp: '+file.name);return}
  if(file.size>25*1024*1024){toast('Tệp quá lớn (tối đa 25MB): '+file.name);return}
  if(attachments.length>=6){toast('Tối đa 6 tệp mỗi yêu cầu');return}
  const item={id:null,name:file.name,size:file.size,kind:'',status:'up'};attachments.push(item);renderAttach();
  try{
    const r=await fetch('/api/machine/upload',{method:'POST',headers:{'X-AI-Office':'1','X-Filename':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:file});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Tải tệp thất bại');
    Object.assign(item,{id:d.id,name:d.name,kind:d.kind,status:'ok'});
  }catch(e){item.status='err';toast(e.message)}
  renderAttach();
}
const addFiles=list=>{for(const f of list)uploadFile(f)};
$('attachAdd').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>{addFiles(e.target.files);e.target.value=''};
attachBar.addEventListener('click',e=>{const b=e.target.closest('[data-rm]');if(b){attachments.splice(+b.dataset.rm,1);renderAttach()}});
// drag & drop onto the task box
let dragN=0;const dz=taskEl;
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{if(![...e.dataTransfer.types].includes('Files'))return;e.preventDefault();dragN++;dz.classList.add('dropping')}));
['dragleave','dragend'].forEach(ev=>dz.addEventListener(ev,()=>{if(--dragN<=0){dragN=0;dz.classList.remove('dropping')}}));
dz.addEventListener('drop',e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();dragN=0;dz.classList.remove('dropping');addFiles(e.dataTransfer.files)});

// Give a task to an agent; used by the assign button and by the WebMCP tools. Returns the new job.
async function submitTask({agentId=selected.id,text,priority='Bình thường',where=runOn,model:m=model,effort:ef=effort,workflow,web=useWeb,files=[],siteIds=[]}){
  const a=agents.find(x=>x.id===agentId);if(!a)throw new Error('Không có nhân viên: '+agentId);
  text=String(text??'').trim();if(!text)throw new Error('Vui lòng nhập yêu cầu công việc');
  const wf=a.id==='director'&&(workflow??useWf);let j;
  if(where==='machine'){
    if(wf?!machine?.ready:!engineReady(a.id)){const codex=!wf&&engineOf(a.id)==='codex';throw Object.assign(new Error(codex?`${a.name} dùng Codex: hãy đăng nhập Codex (ô Codex trên thanh trên cùng)`:'Máy cá nhân chưa sẵn sàng: kiểm tra kết nối trước khi giao việc'),{openMachine:!codex})}
    const {task}=await machineApi('/tasks',{method:'POST',body:JSON.stringify({agent:a.id,name:a.name,role:a.role,desc:a.desc,text,priority,model:m,effort:ef,workflow:wf,team:team(),files,web,siteIds})});
    j=fromServer(task);remote.unshift(j);prevStatus.set(j.key,j.status);toast(wf?'🔀 Director đang lập kế hoạch và chia việc cho các agent liên quan':`Đã gửi nhiệm vụ cho ${a.name}, chạy trên máy ${task.host}`);syncTimer=setTimeout(syncRemote,800);
  }else if(wf){const k='s'+(++simId);j=start({key:k,wf:k,kind:'plan',owner:a.id,agent:'director',stepTitle:'Lập kế hoạch & phân công',text,priority,created:new Date()},0);sim.unshift(j);toast('🔀 Director đang lập kế hoạch (mô phỏng)')}
  else{j=start({key:'s'+(++simId),agent:a.id,text,priority,created:new Date()},.18);sim.unshift(j);toast('Đã giao nhiệm vụ mô phỏng cho '+a.name)}
  if(filter==='done'||filter==='error')filter='all';updateStats();return j;
}
$('assign').onclick=async()=>{
  const btn=$('assign');
  if(attachments.some(a=>a.status==='up')){toast('Đang tải tệp đính kèm, vui lòng đợi…');return}
  if(runOn!=='machine'&&attachments.length)toast('Tệp đính kèm chỉ xử lý khi chạy trên Máy cá nhân');
  btn.disabled=true;
  try{await submitTask({text:taskEl.value,priority:$('priority').value,files:runOn==='machine'?attachIds():[],siteIds:useWeb&&$('webSite').value!=='auto'?[$('webSite').value]:[]});taskEl.value='';clearAttach()}
  catch(e){toast(e.message);if(e.openMachine)machineUI.open();else if(!taskEl.value.trim())taskEl.focus()}
  finally{btn.disabled=false}
};
$('resultTabs').onclick=async e=>{if(e.target.closest('[data-clear]')){try{await clearFinished()}catch(err){toast(err.message)}return}const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;renderResults()}};
$('results').onclick=async e=>{
  const r=e.target.closest('[data-retry]'),c=e.target.closest('[data-cancel]'),d=e.target.closest('[data-del]');
  try{
    if(d){await deleteJob(allJobs().find(j=>j.key===d.dataset.del));return}
    if(c){await cancelJob(remote.find(j=>j.rid===+c.dataset.cancel));return}
    if(r){await retryJob(allJobs().find(j=>j.key===r.dataset.retry));return}
  }catch(err){toast(err.message);return}
  const k=e.target.closest('[data-job]');if(k&&!e.target.closest('.restext')){const j=allJobs().find(j=>j.key===k.dataset.job);selectAgent(j.agent);pv.open(j.agent,j.key);if(e.target.closest('[data-ask]'))setTimeout(()=>document.querySelector('.pv-ask textarea')?.focus(),500)}
};
// Simulation of send-backs: QA or the Director, reviewing for the first time, sends its inputs back 40% of the time;
// each input gets a fix step, then the reviewer checks again (round 2 always passes)
function simRework(j){
  if(j.kind!=='step'||!j.deps?.length||j.round>1||!['qa','director'].includes(j.agent)||Math.random()>.4)return false;
  const ins=j.deps.map(k=>sim.find(x=>x.key===k)).filter(Boolean);if(!ins.length)return false;
  let order=Math.max(0,...sim.filter(x=>x.wf===j.wf).map(x=>x.order??0));
  const reason=j.agent==='qa'?'Phát hiện 2 lỗi: nút gửi không phản hồi trên mobile, thiếu thông báo khi nhập sai.':'Chưa đạt tiêu chí: phần đầu trang chưa nổi bật, màu chưa đúng nhận diện thương hiệu.';
  const step=(src,over)=>({key:'s'+(++simId),wf:j.wf,kind:'step',order:++order,agent:src.agent,model:src.model,effort:src.effort,modelWhy:src.modelWhy,priority:src.priority,created:new Date(),status:'queued',progress:0,...over});
  const fixes=ins.map(d=>step(d,{stepTitle:d.stepTitle.replace(/ · sửa lại$/,'')+' · sửa lại',text:`Sửa theo yêu cầu của ${agentOf(j.agent).name}: ${reason}`,deps:[j.key],origin:d.origin||d.key}));
  const again=step(j,{stepTitle:j.stepTitle+' · vòng 2',text:j.text,deps:fixes.map(f=>f.key),round:2,origin:j.origin||j.key});
  sim.unshift(...fixes,again);
  // steps already waiting for the reviewer (or for what was fixed) now wait for the new versions
  const fresh=new Set([...fixes,again].map(x=>x.key));
  for(const x of sim)if(x.wf===j.wf&&x.status==='queued'&&!fresh.has(x.key))x.deps=(x.deps||[]).map(k=>k===j.key?again.key:fixes.find(f=>f.origin===k)?.key??k);
  Object.assign(j,{rework:{to:ins.map(d=>agentOf(d.agent).name),reason},result:`Chưa đạt, trả lại để sửa. ${reason}`});
  return true;
}
function simPlanDone(j){
  const steps=ruleSteps(j.text,j.owner,team()),keys={};j.wfTitle=j.text.length>60?j.text.slice(0,59)+'…':j.text;
  steps.forEach((s,i)=>{const key='s'+(++simId);keys[s.key]=key;sim.unshift({key,wf:j.wf,kind:'step',order:i,agent:s.agent,stepTitle:s.title,text:s.task,model:MODELS[model]?model:s.model,effort:EFFORTS[effort]?effort:MODELS[model]?null:s.effort,modelWhy:MODELS[model]||EFFORTS[effort]?'Chọn thủ công':s.why,priority:j.priority,created:new Date(),status:'queued',progress:0,deps:s.after.map(k=>keys[k])})});
  j.result=`Luồng ${steps.length} bước: ${steps.map(s=>agentOf(s.agent).name+' · '+s.title).join(' → ')}`;
}
setInterval(()=>{let changed=false;
  for(const j of [...sim].reverse()){if(j.status!=='queued')continue;const deps=(j.deps||[]).map(k=>sim.find(x=>x.key===k));
    const bad=deps.find(d=>!d||GROUP[d.status]==='error');
    if(bad){Object.assign(j,{status:'cancelled',blockedBy:bad?.key||'?',error:`Dừng vì bước trước chưa xong: ${bad?agentOf(bad.agent).name:''}`,finished:new Date()});changed=true}
    else{const w=deps.filter(d=>d.status!=='done');if(w.length)j.activity='Chờ '+w.map(d=>agentOf(d.agent).name).join(', ')+' hoàn thành';else{start(j,.1);j.activity=null;changed=true}}}
  for(const j of [...sim]){if(j.status!=='running')continue;changed=true;j.progress=Math.min(100,j.progress+Math.ceil(Math.random()*8));const a=agentOf(j.agent);
  if(j.failAt!==null&&j.progress>=j.failAt){j.progress=j.failAt;j.status='error';j.error=ERRORS[Math.random()*ERRORS.length|0];j.finished=new Date();toast(`⚠ ${a.name} gặp lỗi khi xử lý nhiệm vụ`)}
  else if(j.progress>=100){j.status='done';j.finished=new Date();if(j.kind==='plan')simPlanDone(j);else if(simRework(j)){toast(`↩ ${a.name} trả lại cho ${j.rework.to.join(', ')} để sửa`);continue}else j.result=RESULTS[a.id][Math.random()*2|0];toast(`✓ ${a.name} đã hoàn thành nhiệm vụ`)}}
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
initCodexConnect({toast,onChange:()=>machineUI.refresh()});
// ---------- Manage agents: add (up to 12 desks), edit name/role/description, delete (not the Director) ----------
function freeSlot(){const used=new Set(agents.map(a=>a.slot));return SLOTS.findIndex((_,i)=>!used.has(i))}
const agentRecord=a=>a.builtin?{id:a.id,builtin:true,name:a.name,role:a.role,desc:a.desc}:{id:a.id,name:a.name,role:a.role,desc:a.desc,color:a.color,preset:a.preset,slot:a.slot};
const saveAgents=list=>machineApi('/agents',{method:'POST',body:JSON.stringify({agents:list})});
const agentForm=document.createElement('div');agentForm.className='modal hidden';document.getElementById('app').appendChild(agentForm);
function openAgentForm(a){
  if(!a&&freeSlot()<0){toast('Văn phòng đã đủ 12 chỗ ngồi: xóa bớt agent để thêm mới');return}
  const looks=Object.entries(LOOKS).map(([k,v])=>`<option value="${k}" ${(a?.preset||'dev')===k?'selected':''}>${v}</option>`).join('');
  agentForm.innerHTML=`<form class="guide claude-box agent-form"><button type="button" class="close" data-close>✕</button><div class="panel-kicker">${a?'SỬA AGENT':'THÊM AGENT MỚI'}</div><h2>${a?escapeHTML(a.name):'Agent mới'}</h2>
    <label>Tên<input name="name" maxlength="40" required value="${escapeHTML(a?.name||'')}" placeholder="Ví dụ: SEO Specialist"></label>
    <label>Vai trò (ngắn)<input name="role" maxlength="80" value="${escapeHTML(a?.role||'')}" placeholder="Ví dụ: Tối ưu SEO & nội dung"></label>
    <label>Mô tả & cách làm việc<textarea name="desc" maxlength="2000" rows="6" placeholder="Agent này làm gì, làm theo cách nào, tiêu chuẩn đầu ra, điều cần tránh… Mô tả được gửi kèm mỗi việc giao cho agent và Director dùng nó để phân việc.">${escapeHTML(a?.desc||'')}</textarea></label>
    ${a?.builtin?'':`<div class="agent-look"><label>Ngoại hình<select name="preset">${looks}</select></label><label>Màu<input type="color" name="color" value="${hex(a?.color??(0x1000000*Math.random()|0)|0x303030)}"></label></div>`}
    <p class="agent-note">${a?'Đổi ngoại hình sẽ tải lại trang.':'Agent mới được xếp vào bàn trống tiếp theo và trang sẽ tải lại.'}${runOn==='sim'&&sim.some(j=>GROUP[j.status]==='running')&&(!a||!a.builtin)?' Việc mô phỏng đang chạy sẽ mất khi tải lại.':''}</p>
    <div class="pv-actions"><button class="assign" type="submit">${a?'Lưu':'＋ Thêm agent'}</button><button type="button" class="ghost" data-close>Hủy</button></div></form>`;
  agentForm.classList.remove('hidden');agentForm.querySelector('[name=name]').focus();
  const form=agentForm.querySelector('form');
  form.onsubmit=async e=>{
    e.preventDefault();const f=Object.fromEntries(new FormData(form)),btn=form.querySelector('[type=submit]');
    const vals={name:f.name.trim(),role:f.role.trim(),desc:f.desc.trim()};if(!vals.name)return;
    const look=a?.builtin?{}:{preset:f.preset,color:parseInt(f.color.slice(1),16)};
    let list,reload=!a;
    if(a){reload=!a.builtin&&(look.preset!==a.preset||look.color!==a.color);list=agents.map(x=>agentRecord(x===a?{...x,...vals,...look}:x))}
    else{const id='a'+Date.now().toString(36);list=[...agents.map(agentRecord),{id,...vals,...look,slot:freeSlot()}]}
    btn.disabled=true;
    try{await saveAgents(list)}catch(err){toast(err.message);btn.disabled=false;return}
    if(reload){try{localStorage.setItem('office-select',a?.id||list.at(-1).id)}catch{}location.reload();return}
    Object.assign(a,vals);a.el.innerHTML=tagHTML(a);renderAvatars();selectAgent(selected.id);agentForm.classList.add('hidden');toast('Đã lưu '+a.name);
  };
}
agentForm.addEventListener('click',e=>{if(e.target===agentForm||e.target.closest('[data-close]'))agentForm.classList.add('hidden')});
$('agentEdit').onclick=()=>openAgentForm(selected);
$('agentDel').onclick=async()=>{
  const a=selected;if(a.id==='director')return;
  if(!confirm(`Xóa agent "${a.name}"? Các việc cũ của agent vẫn được giữ.`))return;
  try{await saveAgents(agents.filter(x=>x!==a).map(agentRecord));location.reload()}catch(err){toast(err.message)}
};
try{const k=localStorage.getItem('office-select');if(k){localStorage.removeItem('office-select');if(agents.some(a=>a.id===k))selectAgent(k)}}catch{}
// Tools for in-browser AI agents (WebMCP); no-op where unsupported
initWebMCP({agents,allJobs,submitTask,cancelJob,retryJob,askJob,machineApi,scenes:room.scenes,applyScene,MODELS,EFFORTS,STATUS,GROUP});
