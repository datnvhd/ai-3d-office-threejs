import * as THREE from 'three';
import './style.css';
import {createCharacter,PRESETS} from './characters.js';
import {attachModel} from './character-models.js';
import {initClaudeConnect} from './claude-connect.js';
import {initCodexConnect} from './codex-connect.js';
import {createOffice} from './office.js';
import {createWander,ROW_X} from './wander.js';
import {createOutdoor} from './outdoor.js';
import {initMachineConnect,machineApi,pickWorkdir,vcsBadge} from './machine-connect.js';
import {createProgressView} from './progress-view.js';
import {setHTML} from './dom-keep.js';
import {ruleSteps,MODELS,EFFORTS,modelId,LEVELS,BUILTIN_TEAM,teamOf,levelOf,normalizeLeaders} from './workflow-plan.js';
import {initWebMCP} from './webmcp.js';
const app=document.querySelector('#app');
// Left column: assign work · right column: what the agents did with it (running, done with result, failed with error)
app.innerHTML=`<div id="scene"></div><div class="top"><div class="brand"><span class="logo">▦</span><div><b>My Office <i>3D</i></b><small>AI AGENT WORKSPACE</small></div></div><div class="topstats"><span><em class="dot green"></em><b id="active">0</b> AI đang làm việc</span><span><em class="dot orange"></em><b id="queued">0</b> đang xử lý</span><span><em class="dot blue"></em><b id="done">0</b> hoàn thành</span><span><em class="dot red"></em><b id="failed">0</b> lỗi</span></div><div class="actions"><button id="reset">⟲ Đặt lại góc nhìn</button><button id="help">? Hướng dẫn</button></div></div><div class="floatinglabels" id="labels"></div>
<aside class="side side-left"><div class="panel-kicker">① GIAO VIỆC</div><h2 class="side-title">Giao nhiệm vụ cho AI</h2><div class="section-title">CHỌN NHÂN VIÊN <span id="agent-count"></span><span class="viewsw"><button data-view="grid" title="Xem dạng lưới">▦</button><button data-view="list" title="Xem dạng danh sách, theo đội">☰</button></span></div><div class="agent-pick" id="avatars"></div><div class="profile"><div class="profile-avatar" id="profile-icon">◉</div><div class="profile-main"><h3 id="profile-name"></h3><span id="profile-role"></span><p class="profile-desc" id="profile-desc"></p></div><div class="profile-tools"><button class="ptool" id="agentEdit" title="Sửa tên, vai trò, mô tả">✎</button><button class="ptool" id="agentDel" title="Xóa agent">🗑</button></div></div><div class="status" id="profile-status"></div><div class="section-title">YÊU CẦU CÔNG VIỆC</div><textarea id="task" placeholder="Ví dụ: Phân tích báo cáo doanh thu quý III và tổng hợp 5 insight quan trọng... (dán ảnh bằng Ctrl+V hoặc kéo file vào đây)"></textarea><div class="opts"><div><label class="smalllabel">Mức ưu tiên</label><select id="priority"><option>Bình thường</option><option>Ưu tiên cao</option><option>Khẩn cấp</option></select></div><div><label class="smalllabel">Nơi thực thi</label><select id="runOn"><option value="machine">💻 Máy cá nhân</option><option value="sim">🎲 Mô phỏng</option></select></div><div><label class="smalllabel">Model AI</label><select id="model" title="Tự chọn: Director chọn model rẻ nhất đủ làm tốt từng bước. Giá: USD / 1 triệu token vào/ra"></select></div><div><label class="smalllabel">Mức suy luận</label><select id="effort" title="Suy luận càng sâu càng tốn token: Thấp ≈ một nửa Cao, Rất cao ≈ gấp đôi Cao"></select></div></div><label class="mcheck wfopt"><input type="checkbox" id="useWf"> 🔀 Tự tạo luồng công việc khi giao cho Director (Director chia việc cho các agent liên quan)</label><div class="webopt" id="webOpt"><label class="mcheck"><input type="checkbox" id="useWeb"> 🌐 Cho phép mở web & thao tác trình duyệt</label><select id="webSite" class="hidden"></select></div><p class="runnote" id="runNote"></p><button class="assign" id="assign">✦ Giao việc cho AI</button></aside>
<aside class="side side-right"><div class="panel-kicker">② KẾT QUẢ XỬ LÝ</div><h2 class="side-title">Kết quả từ AI</h2><div class="result-tabs" id="resultTabs"></div><div id="results" class="tasklist"></div><p class="disclaimer">💻 Máy cá nhân: chạy thật bằng Claude Code (Designer dùng Codex/ChatGPT) trên máy của bạn · 🎲 Mô phỏng: tiến độ, kết quả và lỗi chỉ là giả lập.</p></aside>
<div class="scenery" id="scenery"></div><div id="toast"></div><div class="modal hidden" id="guide"><div class="guide"><button class="close" id="closeguide">✕</button><h2>Điều khiển văn phòng</h2><p>🖱️ Kéo chuột để xoay góc nhìn 3D, cuộn để zoom. Bấm vào nhân viên, nhãn tên hoặc thẻ tên bên trái để chọn người nhận việc.</p><p>📋 Cột trái để giao việc, cột phải hiển thị việc đang xử lý, hoàn thành (kèm kết quả) hoặc gặp lỗi (có thể thử lại). Chọn nơi thực thi “Máy cá nhân” để chạy thật bằng Claude Code trên máy của bạn (bấm ô “Máy” trên thanh trên cùng để chọn thư mục làm việc, quyền và chạy kiểm tra), hoặc “Mô phỏng” để chạy thử giả lập.</p><button id="okguide" class="assign">Đã hiểu</button></div></div>`;
// Built-in agents: look and desk per id (their desk position is fixed)
const BUILTIN=[{id:'director',name:'Director',role:'Điều phối dự án',color:0x5b8def,x:0.6,z:-1.3,look:PRESETS.manager,desk:{screen:'dashboard',divider:0xf6a15c,props:['coffee','robot','notebook']}},{id:'research',name:'Research AI',role:'Nghiên cứu & tổng hợp',color:0xa78bfa,x:-4.4,z:-1.6,look:PRESETS.student,desk:{screen:'ai',props:['notebook','plant','pens']}},{id:'frontend',name:'Frontend Dev',role:'Phát triển giao diện',color:0x1e6fe8,x:-2.5,z:2.65,look:PRESETS.dev,desk:{screen:'code',laptop:true,divider:0x5b8def,props:['coffee','plant']}},{id:'backend',name:'Backend Dev',role:'API & hệ thống',color:0x7fb2ff,x:-1.0,z:2.65,desk:{screen:'code',divider:0xf28cb1,props:['coffee','pens','plant']},look:{...PRESETS.dev,top:0xf2f3f7,sleeve:0x1e6fe8,hood:0x1e6fe8,cuff:0xf2f3f7,band:0x1e6fe8,logo:'api',headphones:{on:'head',color:0x2b2f3a,accent:0x1e6fe8},pose:'idle',mouth:'grin',hairColor:0x2e221c,seed:7}},{id:'analyst',name:'Data Analyst',role:'Phân tích dữ liệu',color:0x38bdf8,x:-2.9,z:-1.6,desk:{screen:'chart',props:['notebook','plant','coffee']},look:{...PRESETS.designer,top:0x1e6fe8,hood:0xf2f3f7,band:0x1e6fe8,cuff:0x1e6fe8,logo:'chart',glasses:null,bun:false,pose:'idle',hairColor:0x2c1f1a,pants:0x3f4556,shoeAccent:0x1e6fe8,mouth:'grin'}},{id:'designer',name:'Designer',role:'Thiết kế sản phẩm',color:0xffd166,x:-4.55,z:2.65,look:PRESETS.designer,desk:{style:'wood',screen:'design'}},{id:'qa',name:'QA Tester',role:'Kiểm thử & chất lượng',color:0xc4b5fd,x:-1.4,z:-1.6,desk:{screen:'ai',laptop:'chart',props:['coffee','notebook']},look:{...PRESETS.dev,top:0xa78bfa,sleeve:0xf2f3f7,hood:0xf2f3f7,cuff:0xa78bfa,band:0xa78bfa,logo:'check',glasses:{shape:'round',color:0x2a2a30},headphones:null,pose:'wave',mouth:'open',hairColor:0x4a3226,shoeAccent:0xa78bfa,seed:13}}];
// Desks: the 7 built-in ones (with the aisle node agents step out from), then 5 desks already in the room that had nobody:
// the back row by the windows and the back-to-back desks in the glass room. Agents there stand behind the desk facing
// the room and stay put. A desk freed by deleting an agent goes to the next new agent, so the office holds 12.
const DOOR_OF={director:'cF',research:'cA',analyst:'cC',qa:'cD',frontend:'frd',backend:'bkd',designer:'dsd'};
// Then 24 desks in the added space (4 rows of 6, see office.js/wander.js); their agents walk around too.
// Slot numbers are saved with custom agents, so new desks only ever get appended.
const ROW_DESKS=[{screen:'code',props:['coffee','plant']},{screen:'chart',props:['notebook','coffee']},{screen:'ai',props:['plant','pens']},{screen:'design',divider:0xf28cb1,props:['notebook']},{screen:'dashboard',divider:0x5b8def,props:['coffee','robot']},{screen:'code',laptop:true,props:['pens','plant']}];
// A workstation anchored at (x,z) (office.js): the agent stands beside the chair when idle and sits on it, facing the screen, while working
const desked=(x,z,wood)=>({x:x+.6,z:z+.1,sit:[x,z-.1,Math.PI],dx:x,dz:z,scr:wood?[x-.05,.838,z-.794,0,{rx:-.28,w:.32,h:.2}]:[x-.05,1.035,z-.7915,0]});
const SLOTS=[...BUILTIN.map(b=>({...desked(b.x,b.z,b.desk.style==='wood'),door:DOOR_OF[b.id]})),
  // the stand-still desks already have a chair on the far side, facing the room
  {x:-4.75,z:-3.6,sit:[-4.25,-3.52,0],scr:[-4.35,1.035,-2.8085,Math.PI]},{x:-3.25,z:-3.6,sit:[-2.75,-3.52,0],scr:[-2.85,1.035,-2.8085,Math.PI]},{x:-1.75,z:-3.6,sit:[-1.25,-3.52,0],scr:[-1.35,1.035,-2.8085,Math.PI]},
  {x:-2.85,z:.97,sit:[-2.35,.95,0],scr:[-2.45,1.035,1.4415,Math.PI]},{x:-1.35,z:.97,sit:[-.85,.95,0],scr:[-.95,1.035,1.4415,Math.PI]},
  ...[['rA',-1.4],['rB',2.6],['rC',6.4],['rD',10.2]].flatMap(([row,z],r)=>ROW_X.map((x,i)=>({...desked(x,z),door:row+i,desk:ROW_DESKS[(i+r*2)%ROW_DESKS.length]})))];
// New agents take a free built-in desk first, then the added rows, then the 5 stand-still desks
const SLOT_ORDER=[...SLOTS.keys()].sort((a,b)=>(a>=7&&a<12)-(b>=7&&b<12)||a-b);
const LOOKS={dev:'Lập trình viên',designer:'Thiết kế / sáng tạo',manager:'Quản lý',student:'Trẻ trung'};
// Saved agent list (server, shared by every browser on this machine); without one, the 7 built-in agents
const savedAgents=await fetch('/api/machine/agents').then(r=>r.ok?r.json():null).then(d=>d?.agents).catch(()=>null);
const agents=(savedAgents||BUILTIN.map(b=>({id:b.id,builtin:true}))).map(v=>{
  const b=BUILTIN.find(x=>x.id===v.id);
  if(v.builtin){if(!b)return null;const at=SLOTS[BUILTIN.indexOf(b)];return {...b,name:v.name||b.name,role:v.role??b.role,desc:v.desc||'',team:v.team||BUILTIN_TEAM[b.id],level:v.level,builtin:true,slot:BUILTIN.indexOf(b),door:at.door,x:at.x,z:at.z,sit:at.sit}}
  const at=SLOTS[v.slot];if(!at)return null;
  const preset=LOOKS[v.preset]?v.preset:'dev',seed=[...v.id].reduce((h,c)=>h*31+c.charCodeAt(0)|0,7)>>>0;
  return {id:v.id,name:v.name,role:v.role||'',desc:v.desc||'',color:v.color??0x9aa3b5,preset,slot:v.slot,x:at.x,z:at.z,door:at.door,sit:at.sit,team:v.team||v.role||'Khác',level:v.level,
    look:{...PRESETS[preset],top:v.color??PRESETS[preset].top,seed:seed%97}};
}).filter(Boolean);
// Custom agents at the 5 stand-still desks move to free desks in the added rows, where they walk around like the others
{const used=new Set(agents.map(a=>a.slot));
  for(const a of agents)if(!a.builtin&&a.slot>=7&&a.slot<12){const to=SLOT_ORDER.find(i=>i>=12&&!used.has(i));if(to==null)break;
    used.delete(a.slot);used.add(to);Object.assign(a,{slot:to,x:SLOTS[to].x,z:SLOTS[to].z,door:SLOTS[to].door,sit:SLOTS[to].sit})}}
normalizeLeaders(agents);
const world=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.65;document.querySelector('#scene').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(40,1,.1,240);let theta=Math.PI/4,phi=.96,dist=37;const focus=new THREE.Vector3(0,0,0);function updateCamera(){camera.position.set(Math.sin(theta)*Math.sin(phi)*dist,Math.cos(phi)*dist,Math.cos(theta)*Math.sin(phi)*dist);camera.lookAt(focus)}updateCamera();
const room=createOffice(world,renderer),office=room.group,pickables=[];
function agentCharacter(agent){const g=new THREE.Group();g.position.set(agent.x,0,agent.z);g.rotation.y=agent.yaw??.35;office.add(g);agent.char=createCharacter(agent.look);g.add(agent.char.group);const hit=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,2,12),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));hit.position.y=1;hit.userData.agent=agent.id;g.add(hit);pickables.push(hit);agent.group=g;agent.labelPos=new THREE.Vector3(agent.x,2.05,agent.z);const ring=new THREE.Mesh(new THREE.RingGeometry(.37,.42,32),new THREE.MeshBasicMaterial({color:agent.color,side:THREE.DoubleSide,transparent:true,opacity:0}));ring.rotation.x=-Math.PI/2;ring.position.y=.013;g.add(ring);agent.ring=ring;return g}
// Characters stand in front of their desk with the chair pushed to one side
for(const b of BUILTIN)room.workstation(b.x,b.z,b.desk);// built-in desks stay even when their agent is deleted
for(const d of SLOTS)if(d.desk)room.workstation(d.dx,d.dz,d.desk);
for(const a of agents){agentCharacter(a);attachModel(a.char,a.id,a.preset).then(n=>{if(n)console.info(`${a.name}: dùng mô hình 3D /models/${n}.glb`)})}
// Each agent's monitor runs (code, tests, a document or charts, by team) while they sit at their desk
const SCREEN_KIND=a=>({Frontend:'code',Backend:'code',QA:'test',BA:'doc',Research:'doc',Data:'chart',Design:'chart'})[teamOf(a)]||'chart';
for(const a of agents){const s=SLOTS[a.slot]?.scr;if(s)a.screen=room.addWorkScreen(s[0],s[1],s[2],s[3],{...s[4],kind:SCREEN_KIND(a)})}
// Streets, houses, traffic and passers-by around the building
const outdoor=createOutdoor(world);
// Idle agents stroll around the office; agents with unfinished tasks stay at (or return to) their desk
const busyAgent=id=>allJobs().some(j=>j.agent===id&&(j.status==='running'||j.status==='queued'));
const wander=createWander(agents,{isBusy:busyAgent,onEvent:(...e)=>wanderEvent(...e)});
const tagHTML=a=>`<span class="tagdot" style="background:#${a.color.toString(16).padStart(6,'0')}"></span>${escapeHTML(a.name)}`;
const labels=document.getElementById('labels');agents.forEach(a=>{a.el=document.createElement('button');a.el.className='tag';a.el.innerHTML=tagHTML(a);a.el.onclick=()=>openAgent(a.id);labels.appendChild(a.el)});
// Tasks run for real on the personal machine (Claude Code via /api/machine) or as a local simulation
const RESULTS={director:['Đã lập kế hoạch 3 giai đoạn, phân công cho 4 thành viên; mốc bàn giao: thứ Sáu tuần này.','Đã chốt phạm vi, rủi ro chính và lịch họp review hằng tuần với các bên liên quan.'],research:['Tổng hợp 12 nguồn tham khảo, rút ra 5 insight chính kèm trích dẫn; báo cáo 2 trang.','So sánh 4 giải pháp trên thị trường theo chi phí, tính năng và mức độ phổ biến.'],frontend:['Đã dựng 3 màn hình theo thiết kế, responsive cho mobile; bản xem thử đã sẵn sàng.','Sửa 6 lỗi giao diện, tối ưu tải trang từ 3,1s xuống 1,4s.'],backend:['Thêm 4 endpoint REST kèm 18 test tự động (pass 100%); thời gian phản hồi TB 120 ms.','Tối ưu truy vấn chính, giảm tải CPU database khoảng 35%.'],analyst:['Phân tích 24.580 dòng dữ liệu: doanh thu tăng 14% so với quý trước, nhóm khách mới đóng góp 38%.','Lập dashboard 6 chỉ số KPI, phát hiện 2 điểm bất thường cần kiểm tra.'],designer:['Bàn giao 2 phương án giao diện và bộ icon 24px; đã chú thích kích thước, màu sắc.','Cập nhật design system: 12 component mới, kiểm tra tương phản đạt chuẩn AA.'],qa:['Chạy 46 test case: 44 đạt, 2 lỗi mức thấp đã ghi nhận kèm bước tái hiện.','Kiểm thử hồi quy 5 luồng chính trên 3 trình duyệt, không phát hiện lỗi chặn.']};
// Simulated result: the agent's own samples, else those of the built-in agent of its team, else a generic line
const simResult=a=>{const pool=RESULTS[a.id]||RESULTS[Object.keys(BUILTIN_TEAM).find(k=>BUILTIN_TEAM[k]===teamOf(a))]||[`Đã hoàn thành phần việc của ${a.name} và bàn giao kết quả.`,`${a.name} đã xử lý xong yêu cầu, kèm ghi chú các điểm cần lưu ý.`];return pool[Math.random()*pool.length|0]};
const ERRORS=['Hết thời gian chờ phản hồi từ công cụ (timeout 60s).','Không có quyền truy cập vào dữ liệu nguồn được yêu cầu.','Yêu cầu chưa đủ thông tin: cần mô tả rõ phạm vi và đầu ra mong muốn.','Lỗi kết nối tới dịch vụ bên ngoài (HTTP 503).'];
const STATUS={queued:'Đang chờ',running:'Đang xử lý',waiting:'Chờ bạn trả lời',done:'Hoàn thành',error:'Lỗi',cancelled:'Đã dừng'};
const GROUP={queued:'running',running:'running',waiting:'running',done:'done',error:'error',cancelled:'error'};
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
const team=()=>agents.map(a=>({id:a.id,name:a.name,role:a.role,desc:a.desc,team:teamOf(a),level:levelOf(a)}));
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
    if(/^\s*([-*]|\d+\.)\s+/.test(l)){const ol=/^\s*\d+\./.test(l),items=[];while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i]))items.push(inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/,'')).replace(/^\[([ xX~\/-])\]\s*/,(m,c)=>/x/i.test(c)?'☑ ':c===' '?'☐ ':'◐ '));out.push(`<${ol?'ol':'ul'}>${items.map(x=>`<li>${x}</li>`).join('')}</${ol?'ol':'ul'}>`);continue}
    if(!l.trim()){i++;continue}
    const para=[];while(i<lines.length&&lines[i].trim()&&!/^(```|#{1,6}\s|\s*([-*]|\d+\.)\s|\s*\|.*\|\s*$)/.test(lines[i]))para.push(inline(lines[i++]));
    if(para.length)out.push(`<p>${para.join('<br>')}</p>`);else out.push(`<p>${inline(lines[i++])}</p>`);
  }
  return out.join('');
}
const fromServer=t=>({key:'m'+t.id,rid:t.id,remote:true,agent:t.agent,text:t.text,priority:t.priority,status:t.status,steps:t.steps||0,activity:t.activity,started:t.started?new Date(t.started):null,result:t.result,error:t.error,created:new Date(t.created),finished:t.finished?new Date(t.finished):null,durationMs:t.durationMs,turns:t.turns,costUsd:t.costUsd,cwd:t.cwd,mode:t.mode,host:t.host,engine:t.engine||'claude',web:!!t.web,siteLabels:t.siteLabels||[],fileNames:t.fileNames||[],kind:t.kind,wf:t.wf!=null?'m'+t.wf:null,wfTitle:t.wfTitle,stepTitle:t.stepTitle,model:t.model,effort:t.effort,modelWhy:t.modelWhy,asks:t.asks||0,perms:t.perms||[],todos:t.todos||[],changesN:t.changesN??t.changes?.length??0,undone:t.undone||null,vcs:t.vcs||null,asking:!!t.asking,deps:(t.deps||[]).map(id=>'m'+id),question:t.question||null,clarify:t.clarify||[],designs:t.designs||[],designFrom:t.designFrom,rework:t.rework||null,origin:t.origin??null,progress:t.status==='done'?100:Math.min(92,8+(t.steps||0)*9)});
function selectAgent(id){selected=agentOf(id);$('profile-name').textContent=selected.name;$('profile-role').textContent=[selected.role,`${LEVELS[levelOf(selected)]} · đội ${teamOf(selected)}`].filter(Boolean).join(' · ');$('profile-desc').textContent=selected.desc||'';$('profile-desc').title=selected.desc||'';$('agentDel').classList.toggle('hidden',selected.id==='director');$('profile-icon').style.background=hex(selected.color);$('profile-icon').textContent=selected.name[0];agents.forEach(a=>a.ring.material.opacity=a.id===id?.95:0);document.querySelectorAll('.tag').forEach((e,i)=>e.classList.toggle('selected',agents[i].id===id));document.querySelectorAll('#avatars [data-agent]').forEach(e=>e.classList.toggle('on',e.dataset.agent===id));renderProfile();renderRunNote()}
// Which CLI the server runs this agent's tasks with (set in the machine config, Designer → Codex by default)
const engineOf=id=>machine?.agentEngines?.[id]==='codex'?'codex':'claude';
const engineName=id=>engineOf(id)==='codex'?'Codex (ChatGPT)':'Claude Code';
const engineReady=id=>engineOf(id)==='codex'?!!machine?.codex?.ready:!!machine?.ready;
function renderProfile(){const mine=allJobs().filter(j=>j.agent===selected.id),n=g=>mine.filter(j=>GROUP[j.status]===g).length;$('profile-status').innerHTML=(n('running')?'<span class="pulse"></span> Đang thực hiện nhiệm vụ':'<span class="pulse idle"></span> Sẵn sàng nhận việc')+(mine.length?`<em>${n('running')} đang xử lý · ${n('done')} xong · ${n('error')} lỗi</em>`:'')}
function renderRunNote(){
  $('runOn').value=runOn;const m=machine,el=$('runNote'),pick=$('webSite'),keep=pick.value;
  $('webOpt').classList.toggle('hidden',runOn!=='machine');$('useWeb').checked=useWeb;pick.classList.toggle('hidden',!useWeb);
  // rebuilt only when the saved sites change, so an open dropdown is not closed by the status poll
  const opts='<option value="auto">🔑 Tự nhận tài khoản theo link trong yêu cầu</option>'+(m?.browser?.sites||[]).map(x=>`<option value="${x.id}">🔑 ${escapeHTML(x.label)} · ${escapeHTML(x.username||'')}</option>`).join('');
  if(pick.dataset.sig!==opts){pick.innerHTML=opts;pick.dataset.sig=opts;if([...pick.options].some(o=>o.value===keep))pick.value=keep}
  $('useWf').checked=useWf;$('useWf').disabled=selected.id!=='director';$('useWf').closest('label').classList.toggle('off',selected.id!=='director');$('model').value=MODELS[model]?model:'auto';$('effort').value=EFFORTS[effort]?effort:'auto';
  const ready=wfOn()&&runOn==='machine'?!!machine?.ready:engineReady(selected.id),isCodex=!wfOn()&&engineOf(selected.id)==='codex';
  el.className='runnote '+(runOn==='sim'?'sim':ready?'ok':'warn');
  el.innerHTML=runOn==='sim'?'Chỉ giả lập tiến độ và kết quả, không chạy thật.':!m?'Đang kiểm tra máy cá nhân…':ready?`${wfOn()?'🔀 Director lập kế hoạch rồi giao từng bước cho agent liên quan':`Chạy thật bằng ${engineName(selected.id)}`} trên <b>${escapeHTML(m.host.name)}</b> · ${escapeHTML(m.config.modes[m.config.mode])}${useWeb?' · 🌐 dùng trình duyệt':''}<br>${vcsBadge(m.vcs)} <code title="${escapeHTML(m.config.workdir)}">${escapeHTML(m.config.workdir)}</code> <button class="linkbtn" data-pick-dir>📂 Đổi</button> <button class="linkbtn" data-open-machine>Cài đặt</button>`:isCodex?`⚠ ${escapeHTML(selected.name)} làm việc bằng Codex nhưng Codex chưa ${m.codex?.found?'đăng nhập':'được cài'}. Bấm ô <b>Codex</b> trên thanh trên cùng để kết nối.`:`⚠ Máy cá nhân chưa sẵn sàng. <button class="linkbtn" data-open-machine>Mở cài đặt & kiểm tra</button>`;
}
// The agent's question with its options and a box for the user's own answer
// Tool calls waiting for the user's permission (Claude Code asks through the page)
const permBox=j=>(j.perms||[]).map(p=>`<div class="qbox permbox"><b>🔐 ${escapeHTML(agentOf(j.agent).name)} xin phép: ${escapeHTML(p.desc)}</b>${p.detail?`<pre>${escapeHTML(p.detail)}</pre>`:''}<div class="qopts"><button class="qopt ok" data-perm="${j.key}|${p.id}|1">✓ Cho phép</button><button class="qopt" data-perm="${j.key}|${p.id}|2" title="Không hỏi lại ${escapeHTML(p.ruleLabel)} trong việc này">✓ Luôn cho phép</button><button class="qopt no" data-perm="${j.key}|${p.id}|0">✕ Từ chối</button></div></div>`).join('');
const todoTag=j=>{const l=(j.todos||[]).filter(x=>x.status!=='deleted');return l.length?` · ☑ ${l.filter(x=>x.status==='completed').length}/${l.length}`:''};
// Login asked by a web task: username/password go to this computer only (saved like the logins in Máy cá nhân)
const SKIP_LOGIN='Không có tài khoản, hãy làm phần có thể làm được mà không cần đăng nhập rồi báo lại.';
const loginBox=j=>{const a=agentOf(j.agent),q=j.question||{};return `<div class="qbox loginbox" data-qjob="${j.key}"><b>🔑 ${escapeHTML(a.name)} cần tài khoản đăng nhập</b><p>${escapeHTML(q.host||'')}${q.error?` · <span class="lerr">${escapeHTML(q.error)}</span>`:''}</p>
  <div class="lgrid"><input data-keep="lu-${j.key}" data-login-user placeholder="Tên đăng nhập" autocomplete="off" value="${escapeHTML(q.username||'')}"><input data-keep="lp-${j.key}" data-login-pass type="password" placeholder="Mật khẩu" autocomplete="new-password"></div>
  <label class="lsave"><input type="checkbox" data-keep="ls-${j.key}" data-login-save checked> Lưu tài khoản này để dùng lại cho ${escapeHTML(q.host||'trang này')}</label>
  <div class="qopts"><button class="qopt ok" data-login="${j.key}">🔑 Đăng nhập & làm tiếp</button><button class="qopt" data-answer="${j.key}" data-pv-answer="${escapeHTML(SKIP_LOGIN)}" data-text="${escapeHTML(SKIP_LOGIN)}">Bỏ qua</button></div><small class="lnote">Mật khẩu chỉ lưu trên máy này; Claude không nhìn thấy, trình duyệt tự điền khi đăng nhập.</small></div>`};
async function submitLogin(box,j){
  if(!box||!j)return;const v=s=>box.querySelector(s),username=v('[data-login-user]').value.trim(),password=v('[data-login-pass]').value;
  if(!username||!password){toast('Nhập tên đăng nhập và mật khẩu');(username?v('[data-login-pass]'):v('[data-login-user]')).focus();return}
  box.classList.add('busy');
  try{await machineApi(`/tasks/${j.rid}/login`,{method:'POST',body:JSON.stringify({username,password,save:v('[data-login-save]').checked})});say(j.agent,'🔑 Cảm ơn, tôi đăng nhập và làm tiếp',6000);toast(agentOf(j.agent).name+' đang đăng nhập và làm tiếp');syncRemote()}
  catch(e){box.classList.remove('busy');toast(e.message)}
}
const qbox=j=>{if(j.question?.kind==='login')return loginBox(j);const a=agentOf(j.agent),q=j.question||{};return `<div class="qbox" data-qjob="${j.key}"><b>❓ ${escapeHTML(a.name)} cần bạn trả lời</b><p>${escapeHTML(q.q||'')}</p>
  ${(q.options||[]).length?`<div class="qopts">${q.options.map(o=>`<button class="qopt" data-answer="${j.key}" data-text="${escapeHTML(o)}">${escapeHTML(o)}</button>`).join('')}</div>`:''}
  <div class="qfree"><input data-keep="ans-${j.key}" data-answer-input="${j.key}" maxlength="4000" placeholder="Hoặc tự nhập câu trả lời / thông tin bổ sung…"><button data-answer-send="${j.key}">Gửi</button></div></div>`};
function card(j){
  const a=agentOf(j.agent),live=GROUP[j.status]==='running',where=j.remote?`<span class="where" title="${escapeHTML(j.cwd||'')}">${j.web?'🌐':'💻'} ${escapeHTML(j.host||'Máy cá nhân')} · ${j.engine==='codex'?'Codex':'Claude'}</span>`:'<span class="where">🎲 Mô phỏng</span>';
  let mid='';
  if(j.status==='waiting')mid=qbox(j)+(j.remote?`<button class="ghost stop" data-cancel="${j.rid}">■ Dừng</button>`:'');
  else if(live&&j.remote)mid=`<div class="activity">${j.status==='queued'?'Đang chờ đến lượt…':`Bước ${j.steps}${todoTag(j)} · ${escapeHTML(j.activity||'Đang xử lý…')}`}</div>${permBox(j)}<div class="progress live"><i style="width:${j.progress}%"></i></div><button class="ghost stop" data-cancel="${j.rid}">■ Dừng</button>`;
  else if(live)mid=`<div class="progressrow"><span>${j.priority}</span><b>${j.progress}%</b></div><div class="progress"><i style="width:${j.progress}%"></i></div>`;
  else if(j.status==='done')mid=`<div class="jobresult"><b>Kết quả</b><div class="restext md">${j.remote?md(j.result):escapeHTML(j.result)}</div></div>${j.remote&&j.kind!=='plan'?'<button class="ghost retry" data-ask>💬 Hỏi thêm</button>':''}`;
  else mid=`<div class="joberr"><b>${j.status==='cancelled'?'Đã dừng':j.remote?'Lỗi':`Lỗi tại ${j.progress}%`}</b>${escapeHTML(j.error)}</div><button class="ghost retry" data-retry="${j.key}">⟲ Thử lại</button>`;
  const stats=j.remote&&j.finished?[j.durationMs!=null&&`⏱ ${Math.round(j.durationMs/1000)}s`,j.turns!=null&&`${j.turns} lượt`,j.costUsd!=null&&`$${j.costUsd.toFixed(3)}`,j.asks&&`💬 ${j.asks} câu hỏi thêm`,j.designs?.length&&`🎨 ${j.designs.length} ảnh thiết kế (${j.designs.filter(d=>d.marked).length} cho dev)`,j.changesN&&`📝 ${j.changesN} file${j.undone?' (đã hoàn tác)':''}`].filter(Boolean).join(' · '):'';
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
    <div class="wfprog"><i style="width:${steps.length?Math.round(done/steps.length*100):5}%"></i></div><div class="wfsteps">${row(plan,0)}${steps.map((j,i)=>row(j,i+1)).join('')}</div>${group.filter(j=>j.status==='waiting').map(qbox).join('')}${group.map(permBox).join('')}
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
  // re-render only on change; answer boxes keep their text, caret and focus (see dom-keep.js)
  if(html!==lastSig&&setHTML($('results'),html))lastSig=html;
}
// Planning meeting: while the Director plans a workflow (and 20 s after, for the briefing), the Director and one idle
// colleague per role who can walk meet in the meeting room. Someone given a step gets busy and goes back to their desk.
const BRIEFING_MS=20000;let lastMeeting=[];
function updateMeeting(){
  const plans=allJobs().filter(j=>j.kind==='plan'&&(GROUP[j.status]==='running'||j.status==='done'&&j.finished&&Date.now()-j.finished<BRIEFING_MS));
  const ids=[...new Set(plans.map(j=>j.agent))].filter(id=>wander.canWalk(id)),roles=new Set(ids.map(id=>agentOf(id).role));
  if(plans.length)for(const a of agents){if(ids.length>=10)break;if(ids.includes(a.id)||roles.has(a.role)||!wander.canWalk(a.id)||busyAgent(a.id))continue;roles.add(a.role);ids.push(a.id)}
  wander.setMeeting(ids);lastMeeting=ids;
}
setInterval(updateMeeting,1000);
// ---------- Meeting room TV: the plan while the Director plans and briefs, otherwise a work report per team ----------
const TEAM_COLORS=['#5b8def','#f4966b','#4ade80','#a78bfa','#fbbf24','#38bdf8','#f472b6','#94a3b8'];
const teamColor=t=>TEAM_COLORS[([...String(t)].reduce((h,c)=>h*31+c.charCodeAt(0)|0,3)>>>0)%TEAM_COLORS.length];
function drawBoard(){
  const tv=room.meetingTV;if(!tv)return;const x=tv.ctx,W=1024,H=456,jobs=allJobs(),now=Date.now();
  const txt=(s,px,py,{size=18,color='#e8eefc',bold=false,max=0}={})=>{x.font=`${bold?'700 ':''}${size}px "Segoe UI",sans-serif`;x.fillStyle=color;let t=String(s);if(max)while(t.length>1&&x.measureText(t).width>max)t=t.slice(0,-2)+'…';x.fillText(t,px,py)};
  x.fillStyle='#0f1730';x.fillRect(0,0,W,H);x.fillStyle='#1a2547';x.fillRect(0,0,W,52);
  const plan=jobs.find(j=>j.kind==='plan'&&(GROUP[j.status]==='running'||j.status==='waiting'||j.status==='done'&&j.finished&&now-j.finished<BRIEFING_MS));
  if(plan){
    const steps=jobs.filter(j=>j.wf===plan.wf&&j.kind==='step').sort((a,b)=>(a.order??a.rid??0)-(b.order??b.rid??0));
    txt('📋 KẾ HOẠCH THỰC HIỆN',22,34,{size:22,bold:true,color:'#ffd29a'});txt(plan.wfTitle||plan.text,330,34,{size:19,max:670});
    if(!steps.length){
      txt(plan.status==='waiting'?'❓ Director đang chờ bạn trả lời để lập kế hoạch':'Director đang phân tích yêu cầu và chia việc'+'.'.repeat(1+Math.floor(now/500)%3),30,100,{size:22,bold:true});
      txt('Yêu cầu: '+plan.text,30,140,{size:17,color:'#aab6d6',max:960});
      txt('Thành phần cuộc họp',30,190,{size:16,bold:true,color:'#ffd29a'});
      (lastMeeting||[]).forEach((id,i)=>{const a=agentOf(id),cx=30+(i%5)*196,cy=210+(i/5|0)*62;x.fillStyle='#1d2a52';x.fillRect(cx,cy,184,50);x.fillStyle=teamColor(teamOf(a));x.fillRect(cx,cy,6,50);txt(a.name,cx+16,cy+22,{size:16,bold:true,max:160});txt(`${LEVELS[levelOf(a)]} · ${teamOf(a)}`,cx+16,cy+42,{size:13,color:'#9fb0d8',max:160})});
      for(let i=0;i<5;i++){const w=200+Math.abs(Math.sin(now/700+i))*500;x.fillStyle='#22305e';x.fillRect(30,350+i*18,760,10);x.fillStyle=TEAM_COLORS[i];x.fillRect(30,350+i*18,w,10)}
    }else{
      // Gantt by dependency depth
      const depth=new Map(),dep=j=>{if(depth.has(j.key))return depth.get(j.key);depth.set(j.key,0);const d=Math.max(0,...(j.deps||[]).map(k=>{const p=steps.find(s=>s.key===k);return p?dep(p)+1:0}));depth.set(j.key,d);return d};
      steps.forEach(dep);const cols=Math.max(...depth.values())+1,rows=steps.slice(0,9),rowH=Math.min(38,330/rows.length),gx=330,gw=420;
      txt('Bước · người phụ trách',22,80,{size:14,color:'#9fb0d8',bold:true});for(let c=0;c<cols;c++)txt('Giai đoạn '+(c+1),gx+c*gw/cols+6,80,{size:13,color:'#9fb0d8'});
      rows.forEach((j,i)=>{const a=agentOf(j.agent),y=96+i*rowH,c=depth.get(j.key);
        txt(`${i+1}. ${a.name} (${LEVELS[levelOf(a)]})`,22,y+rowH*.45,{size:14,bold:true,max:300});txt(j.stepTitle||'',22,y+rowH*.85,{size:12,color:'#aab6d6',max:300});
        x.fillStyle='#1d2a52';x.fillRect(gx,y+4,gw,rowH-10);x.fillStyle=j.status==='done'?'#4ade80':GROUP[j.status]==='error'?'#f87171':teamColor(teamOf(a));
        x.fillRect(gx+c*gw/cols+3,y+6,gw/cols-6,rowH-14)});
      const done=steps.filter(j=>j.status==='done').length,pct=done/steps.length,cx=880,cy=150;
      x.lineWidth=22;x.strokeStyle='#22305e';x.beginPath();x.arc(cx,cy,62,0,7);x.stroke();x.strokeStyle='#4ade80';x.beginPath();x.arc(cx,cy,62,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);x.stroke();
      txt(Math.round(pct*100)+'%',cx-28,cy+8,{size:26,bold:true});txt(`${done}/${steps.length} bước xong`,cx-58,cy+96,{size:14,color:'#9fb0d8'});
      const byTeam={};for(const j of steps){const t=teamOf(agentOf(j.agent));byTeam[t]=(byTeam[t]||0)+1}
      txt('Phân bổ theo đội',790,290,{size:14,bold:true,color:'#ffd29a'});Object.entries(byTeam).slice(0,5).forEach(([t,n],i)=>{x.fillStyle=teamColor(t);x.fillRect(790,302+i*28,n/steps.length*200,18);txt(`${t} · ${n}`,795+n/steps.length*200,316+i*28,{size:13})});
    }
  }else{
    // report: what each team has done and has in hand
    txt('📊 BÁO CÁO CÔNG VIỆC',22,34,{size:22,bold:true,color:'#ffd29a'});txt(new Date().toLocaleString('vi-VN'),760,34,{size:16,color:'#9fb0d8'});
    const teams={};for(const a of agents)teams[teamOf(a)]={done:0,run:0,err:0,n:(teams[teamOf(a)]?.n||0)+1};
    for(const j of jobs){const t=teamOf(agentOf(j.agent));if(!teams[t])continue;if(j.status==='done')teams[t].done++;else if(GROUP[j.status]==='running')teams[t].run++;else teams[t].err++}
    const list=Object.entries(teams),max=Math.max(1,...list.map(([,v])=>v.done+v.run+v.err)),bw=Math.min(96,820/list.length);
    list.forEach(([t,v],i)=>{const bx=60+i*(bw+14),base=370,k=250/max;let y=base;
      for(const [n,c] of [[v.done,'#4ade80'],[v.run,'#fbbf24'],[v.err,'#f87171']]){x.fillStyle=c;x.fillRect(bx,y-n*k,bw,n*k);y-=n*k}
      txt(t,bx,base+22,{size:14,bold:true,max:bw+10});txt(`${v.n} người`,bx,base+40,{size:12,color:'#9fb0d8'});txt(String(v.done+v.run+v.err),bx+bw/2-8,y-8,{size:14,bold:true})});
    [['Hoàn thành','#4ade80'],['Đang làm','#fbbf24'],['Lỗi / dừng','#f87171']].forEach(([l,c],i)=>{x.fillStyle=c;x.fillRect(760,70+i*24,14,14);txt(l,782,82+i*24,{size:14})});
  }
  tv.tex.needsUpdate=true;
}
setInterval(drawBoard,1000);
// ---------- Leaders on their rounds: a word of encouragement, sometimes a drink left on the desk ----------
const CHEER=['Tiến độ sao rồi em?','Cố lên, sắp xong rồi! 💪','Làm tốt lắm 👍','Có vướng gì cứ báo anh/chị nhé','Nhớ test kỹ trước khi bàn giao nha','Giữ phong độ nhé!'];
const REPLY_BUSY=['Dạ, em sắp xong rồi ạ!','Dạ em đang làm, ổn ạ','Em cảm ơn, em cố gắng ạ!'],REPLY_IDLE=['Dạ vâng ạ!','Em sẵn sàng nhận việc ạ','Dạ, em nắm rồi ạ'];
const pick=a=>a[Math.random()*a.length|0];
function makeCup(){const g=new THREE.Group(),m=c=>new THREE.MeshStandardMaterial({color:c,roughness:.5});
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.045,.035,.11,14),m(0xffffff));cup.position.y=.055;g.add(cup);
  const top=new THREE.Mesh(new THREE.CylinderGeometry(.043,.043,.01,14),m(0x7a4a2a));top.position.y=.106;g.add(top);
  const band=new THREE.Mesh(new THREE.CylinderGeometry(.047,.042,.035,14),m(0xf4966b));band.position.y=.05;g.add(band);return g}
function wanderEvent(type,a,b,info){
  if(type==='desk')return a.screen?.set(b);
  if(type==='pick'){a.cup?.removeFromParent();a.cup=makeCup();a.cup.position.set(.2,.82,.16);a.group.add(a.cup);return}
  if(type==='drop'){a.cup?.removeFromParent();a.cup=null;return}
  if(type==='visit'){
    const busy=busyAgent(b.id);
    if(info?.drink&&a.cup){
      a.cup.removeFromParent();const c=a.cup;a.cup=null;const [sx,sz,yaw]=b.sit,fx=Math.sin(yaw),fz=Math.cos(yaw);
      c.position.set(sx+fx*.42-fz*.3,.73,sz+fz*.42+fx*.3);office.add(c);setTimeout(()=>c.removeFromParent(),45000);
      say(a.id,pick(['☕ Nước của em đây, cố lên nhé!','☕ Uống chút nước cho tỉnh táo nè','🧋 Anh/chị mời em ly nước']),6000);
      setTimeout(()=>say(b.id,pick(['Em cảm ơn sếp! 💪','Ôi, cảm ơn anh/chị ạ ☺️','Có nước là em làm nhanh hơn liền!']),5000),1400);
    }else{say(a.id,busy?pick(CHEER):pick(['Rảnh thì xem lại việc cũ giúp anh/chị nhé','Chuẩn bị nhận việc mới nha','Ổn không em?']),6000);setTimeout(()=>say(b.id,pick(busy?REPLY_BUSY:REPLY_IDLE),5000),1400)}
  }
}
// ---------- Speech bubbles over agents: what they just took on, and who they hand over to when done ----------
const bubbleLayer=document.createElement('div');bubbleLayer.id='bubbles';document.getElementById('app').appendChild(bubbleLayer);
function say(id,text,ms=8000){
  const a=agents.find(x=>x.id===id);if(!a)return;
  if(!a.bubble){a.bubble=document.createElement('div');a.bubble.className='bubble';bubbleLayer.appendChild(a.bubble)}
  a.bubble.textContent=text;a.bubble.classList.remove('pop');void a.bubble.offsetWidth;a.bubble.classList.add('show','pop');
  clearTimeout(a.bubbleT);a.bubbleT=setTimeout(()=>a.bubble.classList.remove('show'),ms);
}
const cut=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const names=list=>{const n=[...new Set(list.map(x=>agentOf(x.agent).name))];return n.length>3?n.slice(0,3).join(', ')+'…':n.join(', ')};
// Status changes seen since the page opened (jobs already there at load are not announced)
const seenStatus=new Map(),seenPerm=new Set();let watching=false;setTimeout(()=>{for(const j of allJobs())seenStatus.set(j.key,j.status);watching=true},3500);
function watchJobs(){
  if(!watching)return;
  for(const j of allJobs()){
    for(const p of j.perms||[])if(!seenPerm.has(p.id)){seenPerm.add(p.id);say(j.agent,`🔐 Xin phép: ${cut(p.desc,80)}`,15000);toast(`🔐 ${agentOf(j.agent).name} cần bạn cho phép: ${cut(p.desc,70)}`)}
    const prev=seenStatus.get(j.key);if(prev===j.status)continue;seenStatus.set(j.key,j.status);
    if(j.status==='running')say(j.agent,`📥 Tiếp nhận: ${cut(j.stepTitle||j.text,70)}`,9000);
    else if(j.status==='error')say(j.agent,'⚠ Tôi gặp lỗi, cần xem lại',9000);
    else if(j.status==='waiting'){say(j.agent,`❓ ${cut(j.question?.q||'Tôi cần thêm thông tin',90)}`,20000);toast(`❓ ${agentOf(j.agent).name} cần bạn trả lời một câu hỏi`);
      // show the answer box; take the cursor there only when the user is not typing somewhere else
      if(!pv.isOpen()){const i=document.querySelector(`[data-qjob="${j.key}"] [data-login-user]`)||document.querySelector(`[data-answer-input="${j.key}"]`),a=document.activeElement;if(i){i.scrollIntoView({block:'nearest',behavior:'smooth'});if(!a||a===document.body)i.focus({preventScroll:true})}}}
    else if(j.status==='done'&&prev)announceDone(j);
  }
}
function announceDone(j){
  const jobs=allJobs();
  if(j.rework)return say(j.agent,`↩ Chưa đạt, trả lại ${j.rework.to.join(', ')} để sửa`,10000);
  if(j.kind==='plan'){const first=jobs.filter(x=>x.wf===j.wf&&x.kind==='step'&&!(x.deps||[]).length);return say(j.agent,first.length?`Đã lên kế hoạch, chuyển đến ${names(first)}`:'Đã lên kế hoạch',10000)}
  if(j.wf){
    const next=jobs.filter(x=>x.wf===j.wf&&x.kind==='step'&&(x.deps||[]).includes(j.key)&&x.status!=='done');
    if(next.length)return say(j.agent,`Tôi đã xong, chuyển đến ${names(next)}`,10000);
    if(jobs.some(x=>x.wf===j.wf&&GROUP[x.status]==='running'))return say(j.agent,'Tôi đã xong',8000);// other branches still going
  }
  say(j.agent,'Tôi đã xong ✅',10000);
  // everything is done: show the result (not for follow-up answers)
  if(!j.asks&&!document.querySelector('.agent-form')?.closest('.modal:not(.hidden)')){selectAgent(j.agent);pv.open(j.agent,j.key)}
}
setInterval(watchJobs,1000);
function updateStats(){const jobs=allJobs(),run=jobs.filter(j=>GROUP[j.status]==='running');$('active').textContent=new Set(run.map(j=>j.agent)).size;$('queued').textContent=run.length;$('done').textContent=jobs.filter(j=>j.status==='done').length;$('failed').textContent=jobs.filter(j=>GROUP[j.status]==='error').length;agents.forEach(a=>a.el.classList.toggle('busy',run.some(j=>j.agent===a.id)));
  document.querySelectorAll('#avatars [data-agent]').forEach(e=>{const b=run.some(j=>j.agent===e.dataset.agent),d=e.querySelector('.adot');if(d){d.classList.toggle('busy',b);d.title=b?'Đang làm việc':'Đang rảnh'}});renderResults();renderProfile();pv?.refresh()}
// The AI staff as a grid of cards or as a list grouped by team (remembered per browser); a dot shows who is working
let agentView=(()=>{try{return localStorage.getItem('office-agent-view')==='list'?'list':'grid'}catch{return 'grid'}})();
const LVL_SHORT={leader:'Lead',senior:'Sr',middle:'Mid',junior:'Jr'},LVL_ORDER={leader:0,senior:1,middle:2,junior:3};
function renderAvatars(){
  $('agent-count').textContent=`· ${agents.length} AI`;
  const box=$('avatars');box.className='agent-pick view-'+agentView;
  document.querySelectorAll('.viewsw [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===agentView));
  const face=a=>`<i style="background:${hex(a.color)}">${escapeHTML(a.name[0])}</i>`;
  const lvl=a=>`<em class="lvl lvl-${levelOf(a)}">${LVL_SHORT[levelOf(a)]}</em>`;
  const dot=a=>`<b class="adot${busyAgent(a.id)?' busy':''}" title="${busyAgent(a.id)?'Đang làm việc':'Đang rảnh'}"></b>`;
  const tip=a=>escapeHTML([a.role,`đội ${teamOf(a)}`,a.desc].filter(Boolean).join(' · '));
  const add=`<button class="add-agent" data-add-agent ${freeSlot()<0?`disabled title="Văn phòng đã đủ ${SLOTS.length} chỗ ngồi"`:'title="Thêm agent mới"'}>＋ Thêm</button>`;
  if(agentView==='list'){
    const teams=[...new Set(agents.map(teamOf))];
    box.innerHTML=teams.map(t=>{const m=agents.filter(a=>teamOf(a)===t).sort((a,b)=>LVL_ORDER[levelOf(a)]-LVL_ORDER[levelOf(b)]);
      return `<div class="ateam">${escapeHTML(t)} <span>${m.length}</span></div>`+m.map(a=>`<button class="arow" title="${tip(a)}" data-agent="${a.id}">${face(a)}<span class="ainfo"><b>${escapeHTML(a.name)}</b><small>${escapeHTML(a.role||'—')}</small></span>${lvl(a)}${dot(a)}</button>`).join('')}).join('')+add;
  }else box.innerHTML=agents.map(a=>`<button class="acard" title="${tip(a)}" data-agent="${a.id}">${dot(a)}${face(a)}<b>${escapeHTML(a.name)}</b><small>${escapeHTML(a.role||teamOf(a))}</small>${lvl(a)}</button>`).join('')+add;
  box.querySelectorAll('[data-agent]').forEach(el=>{el.onclick=()=>selectAgent(el.dataset.agent);el.classList.toggle('on',el.dataset.agent===selected?.id)});
  box.querySelector('[data-add-agent]').onclick=()=>openAgentForm(null);
}
document.querySelectorAll('.viewsw [data-view]').forEach(b=>b.onclick=e=>{e.stopPropagation();agentView=b.dataset.view;try{localStorage.setItem('office-agent-view',agentView)}catch{}renderAvatars()});
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
// Answer a permission prompt: mode 1 allow, 2 always allow (in this task), 0 deny
const permJob=async(j,pid,mode)=>{try{await machineApi(`/tasks/${j.rid}/perm/${pid}/answer`,{method:'POST',body:JSON.stringify({allow:mode>0,always:mode===2})});toast(mode?'✓ Đã cho phép':'⛔ Đã từ chối');syncRemote()}catch(e){toast(e.message)}};
var pv=createProgressView({toast,onPerm:permJob,loginBox,onLogin:(j,box)=>submitLogin(box,j),agentOf,allJobs,machineApi,md,esc:escapeHTML,hex,STATUS,GROUP,onCancel:cancelJob,onRetry:retryJob,onAsk:askJob,onAnswer:(j,t)=>answerJob(j,t),
  onDesignMark:async(j,body)=>{try{await machineApi(`/tasks/${j.rid}/designs`,{method:'POST',body:JSON.stringify(body)});syncRemote()}catch(e){toast(e.message)}},
  onDesignHandoff:j=>{const fe=agents.find(a=>teamOf(a)==='Frontend'&&levelOf(a)!=='leader'&&!busyAgent(a.id))||agents.find(a=>teamOf(a)==='Frontend')||selected;
    setDesignFrom(j);selectAgent(fe.id);if(!taskEl.value.trim())taskEl.value=`Code giao diện theo các ảnh thiết kế đã chọn (của ${agentOf(j.agent).name}): `;taskEl.focus();toast(`🎨 Việc tiếp theo sẽ code theo ${designFrom.n} ảnh thiết kế`)},onAssign:id=>{selectAgent(id);taskEl.focus()}});
function openAgent(id){selectAgent(id);pv.open(id)}
const machineUI=initMachineConnect({toast,onStatus:s=>{machine=s;renderRunNote()},getTeams:()=>[...new Set(agents.map(teamOf))]});
$('useWeb').onchange=e=>{useWeb=e.target.checked;try{localStorage.setItem('office-use-web',useWeb?'1':'0')}catch{}renderRunNote()};
$('useWf').onchange=e=>{useWf=e.target.checked;try{localStorage.setItem('office-use-wf',useWf?'1':'0')}catch{}renderRunNote()};
$('runOn').onchange=e=>{runOn=e.target.value;try{localStorage.setItem('office-run-on',runOn)}catch{}renderRunNote()};
$('model').innerHTML=modelOptions;$('effort').innerHTML=effortOptions;$('model').value=MODELS[model]?model:'auto';$('effort').value=EFFORTS[effort]?effort:'auto';
$('model').onchange=e=>{model=e.target.value;try{localStorage.setItem('office-model',model)}catch{}};
$('effort').onchange=e=>{effort=e.target.value;try{localStorage.setItem('office-effort',effort)}catch{}};
$('runNote').onclick=async e=>{if(e.target.closest('[data-open-machine]'))machineUI.open();
  else if(e.target.closest('[data-pick-dir]'))try{const st=await pickWorkdir(machine?.config?.workdir);if(st){machine=st;renderRunNote();machineUI.refresh();toast('Thư mục làm việc: '+st.config.workdir)}}catch(err){toast(err.message)}};
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
// paste screenshots or copied files into the task box (text still pastes as usual)
taskEl.addEventListener('paste',e=>{
  const items=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file'),files=items.map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;
  if(!e.clipboardData.getData('text/plain'))e.preventDefault();
  addFiles(files.map((f,i)=>!f.name||/^image\.\w+$/i.test(f.name)?new File([f],`anh-dan-${new Date().toISOString().slice(11,19).replace(/:/g,'')}-${i+1}.${(f.type.split('/')[1]||'png').replace('jpeg','jpg')}`,{type:f.type}):f));
  toast(`📎 Đã dán ${files.length} tệp vào yêu cầu`);
});
// drag & drop files anywhere on the left panel; the task box lights up
let dragN=0;const dz=document.querySelector('.side-left');
dz.addEventListener('dragenter',e=>{if(![...e.dataTransfer.types].includes('Files'))return;e.preventDefault();dragN++;taskEl.classList.add('dropping')});
dz.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault()});
['dragleave','dragend'].forEach(ev=>dz.addEventListener(ev,()=>{if(--dragN<=0){dragN=0;taskEl.classList.remove('dropping')}}));
dz.addEventListener('drop',e=>{dragN=0;taskEl.classList.remove('dropping');if(!e.dataTransfer.files.length)return;e.preventDefault();addFiles(e.dataTransfer.files)});

// Give a task to an agent; used by the assign button and by the WebMCP tools. Returns the new job.
// A design task's marked images handed over to the next task given (chip under the task box, ✕ to drop)
let designFrom=null;
function setDesignFrom(j){
  designFrom=j?{rid:j.rid,n:j.designs.filter(d=>d.marked).length,by:agentOf(j.agent).name}:null;
  document.getElementById('designChip')?.remove();
  if(designFrom){const c=document.createElement('span');c.id='designChip';c.className='chip ok';c.innerHTML=`<i>🎨</i><b>Code theo ${designFrom.n} ảnh thiết kế của ${escapeHTML(designFrom.by)}</b><button class="chip-x" title="Bỏ">✕</button>`;
    c.querySelector('button').onclick=()=>setDesignFrom(null);document.getElementById('attachList').before(c)}
}
async function submitTask({agentId=selected.id,text,priority='Bình thường',where=runOn,model:m=model,effort:ef=effort,workflow,web=useWeb,files=[],siteIds=[]}){
  const a=agents.find(x=>x.id===agentId);if(!a)throw new Error('Không có nhân viên: '+agentId);
  text=String(text??'').trim();if(!text)throw new Error('Vui lòng nhập yêu cầu công việc');
  const wf=a.id==='director'&&(workflow??useWf);let j;
  if(where==='machine'){
    if(wf?!machine?.ready:!engineReady(a.id)){const codex=!wf&&engineOf(a.id)==='codex';throw Object.assign(new Error(codex?`${a.name} dùng Codex: hãy đăng nhập Codex (ô Codex trên thanh trên cùng)`:'Máy cá nhân chưa sẵn sàng: kiểm tra kết nối trước khi giao việc'),{openMachine:!codex})}
    const {task}=await machineApi('/tasks',{method:'POST',body:JSON.stringify({agent:a.id,name:a.name,role:a.role,desc:a.desc,agentTeam:teamOf(a),level:levelOf(a),designFrom:designFrom?.rid,text,priority,model:m,effort:ef,workflow:wf,team:team(),files,web,siteIds})});
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
  try{if(designFrom&&runOn!=='machine')toast('Ảnh thiết kế chỉ dùng được khi chạy trên Máy cá nhân');
    await submitTask({text:taskEl.value,priority:$('priority').value,files:runOn==='machine'?attachIds():[],siteIds:useWeb&&$('webSite').value!=='auto'?[$('webSite').value]:[]});taskEl.value='';clearAttach();setDesignFrom(null)}
  catch(e){toast(e.message);if(e.openMachine)machineUI.open();else if(!taskEl.value.trim())taskEl.focus()}
  finally{btn.disabled=false}
};
$('resultTabs').onclick=async e=>{if(e.target.closest('[data-clear]')){try{await clearFinished()}catch(err){toast(err.message)}return}const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;renderResults()}};
// Answer a waiting task: machine tasks carry on in the same conversation; simulated ones just continue
async function answerJob(j,text){
  text=String(text||'').trim();if(!j||!text)return;
  try{
    if(j.remote){await machineApi(`/tasks/${j.rid}/answer`,{method:'POST',body:JSON.stringify({text})});syncRemote()}
    else{(j.clarify||=[]).push({q:j.question?.q,answer:text});Object.assign(j,{status:'running',question:null,asked:true,text:`${j.text} (${text})`,failAt:j.failAt!=null&&j.failAt<=j.progress+5?null:j.failAt});updateStats()}
    say(j.agent,'👍 Đã rõ, tôi làm tiếp',6000);toast(agentOf(j.agent).name+' đang tiếp tục với câu trả lời của bạn');
  }catch(e){toast(e.message)}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-login-user],[data-login-pass]')){e.preventDefault();const box=e.target.closest('.loginbox');return submitLogin(box,allJobs().find(j=>j.key===box?.dataset.qjob))}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-answer-input]')){e.preventDefault();answerJob(allJobs().find(j=>j.key===e.target.dataset.answerInput),e.target.value)}});
$('results').onclick=async e=>{
  const qa=e.target.closest('[data-answer]'),qs=e.target.closest('[data-answer-send]');
  if(qa)return answerJob(allJobs().find(j=>j.key===qa.dataset.answer),qa.dataset.text);
  if(qs)return answerJob(allJobs().find(j=>j.key===qs.dataset.answerSend),document.querySelector(`[data-answer-input="${qs.dataset.answerSend}"]`)?.value);
  const lg=e.target.closest('[data-login]');if(lg)return submitLogin(lg.closest('.loginbox'),allJobs().find(j=>j.key===lg.dataset.login));
  const pm=e.target.closest('[data-perm]');if(pm){const [k,pid,mode]=pm.dataset.perm.split('|');pm.closest('.permbox')?.classList.add('busy');return permJob(allJobs().find(j=>j.key===k),pid,+mode)}
  if(e.target.closest('.qbox'))return;
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
  if(!j.asked&&j.kind!=='step'&&j.progress>=30&&String(j.text).trim().split(/\s+/).length<6){Object.assign(j,{status:'waiting',asked:true,question:{q:`Yêu cầu "${j.text}" hơi ngắn: bạn muốn kết quả theo hướng nào?`,options:['Bản ngắn gọn, làm nhanh','Bản đầy đủ, chi tiết','Làm theo chuẩn đang dùng trong dự án']}});continue}
  if(j.failAt!==null&&j.progress>=j.failAt){j.progress=j.failAt;j.status='error';j.error=ERRORS[Math.random()*ERRORS.length|0];j.finished=new Date();toast(`⚠ ${a.name} gặp lỗi khi xử lý nhiệm vụ`)}
  else if(j.progress>=100){j.status='done';j.finished=new Date();if(j.kind==='plan')simPlanDone(j);else if(simRework(j)){toast(`↩ ${a.name} trả lại cho ${j.rework.to.join(', ')} để sửa`);continue}else j.result=simResult(a);toast(`✓ ${a.name} đã hoàn thành nhiệm vụ`)}}
  if(changed)updateStats()},2200);
selectAgent(selected.id);renderRunNote();updateStats();syncRemote();
const HOME_VIEW=[Math.PI/4,.96,37];$('reset').onclick=()=>{[theta,phi,dist]=HOME_VIEW;updateCamera()};const guide=$('guide');$('help').onclick=()=>guide.classList.remove('hidden');$('closeguide').onclick=$('okguide').onclick=()=>guide.classList.add('hidden');
let dragging=false,moved=0,px=0,py=0;renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;moved=0;px=e.clientX;py=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)});renderer.domElement.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-px,dy=e.clientY-py;moved+=Math.abs(dx)+Math.abs(dy);theta-=dx*.006;phi=Math.max(.40,Math.min(1.38,phi+dy*.005));px=e.clientX;py=e.clientY;updateCamera()});renderer.domElement.addEventListener('pointerup',e=>{dragging=false;if(moved>7)return;const p=new THREE.Vector2(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(p,camera);const hits=ray.intersectObjects(pickables);if(hits.length)openAgent(hits[0].object.userData.agent)});renderer.domElement.addEventListener('wheel',e=>{dist=Math.max(10,Math.min(60,dist+e.deltaY*.02));updateCamera()},{passive:true});let lastT=0;function animate(t){requestAnimationFrame(animate);const dt=Math.min(.1,(t-lastT)/1000);lastT=t;wander.update(dt);outdoor.update(t,dt);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();for(const a of agents){a.group.getWorldPosition(a.labelPos);a.labelPos.y=2.05;const p=a.labelPos.clone().project(camera);const visible=p.z<1;const x=(p.x*.5+.5)*innerWidth,y=(-p.y*.5+.5)*innerHeight;a.el.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px)`;a.el.style.display=visible?'flex':'none';if(a.bubble?.classList.contains('show')){a.bubble.style.transform=`translate(-50%,-100%) translate(${x}px,${y-12}px)`;a.bubble.style.visibility=visible?'visible':'hidden'}a.char.update(t)}room.update(t);renderer.render(world,camera)}requestAnimationFrame(animate);

// Outdoor scenery switcher (remembered per browser)
const sceneryEl=document.getElementById('scenery');sceneryEl.innerHTML='<span>BỐI CẢNH</span>'+Object.entries(room.scenes).map(([k,s])=>`<button data-scene="${k}" title="${s.label}"><i style="background:${s.swatch}"></i><em>${s.label}</em></button>`).join('');
function applyScene(k){room.setScenery(k);outdoor.setScene(k);sceneryEl.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.scene===k));try{localStorage.setItem('office-scene',k)}catch{}}
sceneryEl.onclick=e=>{const b=e.target.closest('[data-scene]');if(b)applyScene(b.dataset.scene)};
let savedScene='day';try{savedScene=new URLSearchParams(location.search).get('scene')||localStorage.getItem('office-scene')||'day'}catch{}applyScene(room.scenes[savedScene]?savedScene:'day');

initClaudeConnect({toast});
initCodexConnect({toast,onChange:()=>machineUI.refresh()});
// ---------- Manage agents: add (up to 12 desks), edit name/role/description, delete (not the Director) ----------
function freeSlot(){const used=new Set(agents.map(a=>a.slot));return SLOT_ORDER.find(i=>!used.has(i))??-1}
const agentRecord=a=>({...(a.builtin?{id:a.id,builtin:true}:{id:a.id,color:a.color,preset:a.preset,slot:a.slot}),name:a.name,role:a.role,desc:a.desc,team:teamOf(a),level:levelOf(a)});
const saveAgents=list=>machineApi('/agents',{method:'POST',body:JSON.stringify({agents:normalizeLeaders(list)})});
const agentForm=document.createElement('div');agentForm.className='modal hidden';document.getElementById('app').appendChild(agentForm);
function openAgentForm(a){
  if(!a&&freeSlot()<0){toast(`Văn phòng đã đủ ${SLOTS.length} chỗ ngồi: xóa bớt agent để thêm mới`);return}
  const looks=Object.entries(LOOKS).map(([k,v])=>`<option value="${k}" ${(a?.preset||'dev')===k?'selected':''}>${v}</option>`).join('');
  agentForm.innerHTML=`<form class="guide claude-box agent-form"><button type="button" class="close" data-close>✕</button><div class="panel-kicker">${a?'SỬA AGENT':'THÊM AGENT MỚI'}</div><h2>${a?escapeHTML(a.name):'Agent mới'}</h2>
    <label>Tên<input name="name" maxlength="40" required value="${escapeHTML(a?.name||'')}" placeholder="Ví dụ: SEO Specialist"></label>
    <label>Vai trò (ngắn)<input name="role" maxlength="80" value="${escapeHTML(a?.role||'')}" placeholder="Ví dụ: Tối ưu SEO & nội dung"></label>
    <div class="agent-look"><label>Đội<input name="team" maxlength="40" list="teamList" value="${escapeHTML(a?teamOf(a):'')}" placeholder="Ví dụ: Frontend"><datalist id="teamList">${[...new Set(agents.map(teamOf))].map(t=>`<option value="${escapeHTML(t)}">`).join('')}</datalist></label>
      <label>Cấp bậc<select name="level">${Object.entries(LEVELS).map(([k,v])=>`<option value="${k}" ${(a?levelOf(a):'middle')===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <label>Mô tả & cách làm việc<textarea name="desc" maxlength="2000" rows="6" placeholder="Agent này làm gì, làm theo cách nào, tiêu chuẩn đầu ra, điều cần tránh… Mô tả được gửi kèm mỗi việc giao cho agent và Director dùng nó để phân việc.">${escapeHTML(a?.desc||'')}</textarea></label>
    ${a?.builtin?'':`<div class="agent-look"><label>Ngoại hình<select name="preset">${looks}</select></label><label>Màu<input type="color" name="color" value="${hex(a?.color??(0x1000000*Math.random()|0)|0x303030)}"></label></div>`}
    <p class="agent-note">${a?'Đổi ngoại hình sẽ tải lại trang.':'Agent mới được xếp vào bàn trống tiếp theo và trang sẽ tải lại.'}${runOn==='sim'&&sim.some(j=>GROUP[j.status]==='running')&&(!a||!a.builtin)?' Việc mô phỏng đang chạy sẽ mất khi tải lại.':''}</p>
    <div class="pv-actions"><button class="assign" type="submit">${a?'Lưu':'＋ Thêm agent'}</button><button type="button" class="ghost" data-close>Hủy</button></div></form>`;
  agentForm.classList.remove('hidden');agentForm.querySelector('[name=name]').focus();
  const form=agentForm.querySelector('form');
  form.onsubmit=async e=>{
    e.preventDefault();const f=Object.fromEntries(new FormData(form)),btn=form.querySelector('[type=submit]');
    const vals={name:f.name.trim(),role:f.role.trim(),desc:f.desc.trim(),team:f.team.trim()||f.role.trim()||'Khác',level:f.level};if(!vals.name)return;
    // a new Leader replaces the team's current one (who becomes Senior)
    if(vals.level==='leader')for(const x of agents)if(x!==a&&teamOf(x)===vals.team&&levelOf(x)==='leader')x.level='senior';
    const look=a?.builtin?{}:{preset:f.preset,color:parseInt(f.color.slice(1),16)};
    let list,reload=!a;
    if(a){reload=!a.builtin&&(look.preset!==a.preset||look.color!==a.color);list=agents.map(x=>agentRecord(x===a?{...x,...vals,...look}:x))}
    else{const id='a'+Date.now().toString(36);list=[...agents.map(agentRecord),{id,...vals,...look,slot:freeSlot()}]}
    btn.disabled=true;
    try{await saveAgents(list)}catch(err){toast(err.message);btn.disabled=false;return}
    if(reload){try{localStorage.setItem('office-select',a?.id||list.at(-1).id);if(!a)localStorage.setItem('office-new',list.at(-1).id)}catch{}location.reload();return}
    Object.assign(a,vals);normalizeLeaders(agents);wander.refreshTeams();a.el.innerHTML=tagHTML(a);renderAvatars();selectAgent(selected.id);agentForm.classList.add('hidden');toast('Đã lưu '+a.name);
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
// the agent just added gets up for a first walk right away
try{const n=localStorage.getItem('office-new');if(n){localStorage.removeItem('office-new');wander.nudge(n)}}catch{}
// Tools for in-browser AI agents (WebMCP); no-op where unsupported
initWebMCP({agents,allJobs,submitTask,cancelJob,retryJob,askJob,machineApi,scenes:room.scenes,applyScene,MODELS,EFFORTS,STATUS,GROUP});
