// Personal machine connection: status chip in the top bar + modal backed by /api/machine (server/machine-bridge.js).
// Shows this computer's info, lets the user pick the working folder and permission mode, and runs a real health check.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('vi-VN'):'—';
const gb=b=>(b/1073741824).toFixed(1)+' GB';
import {openFolderPicker} from './folder-picker.js';
import {pwField} from './pw-field.js';
import qrcode from 'qrcode-generator';
// QR code of a link as an inline SVG (dark modules on white, with the quiet zone phones need to read it)
const qrSvg=text=>{const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:4,scalable:true})};
// Which version control holds the working folder and where its code is pushed
export const vcsBadge=v=>!v?.kind?'<span class="vcsb none">Không VCS</span>':`<span class="vcsb ${v.kind}">${v.kind==='git'?'Git':'SVN'}</span>`;
export const vcsText=v=>!v?.kind?'Không quản lý phiên bản (diff/hoàn tác vẫn dùng bản chụp của app)'
  :v.kind==='git'?`Git · nhánh ${esc(v.branch||'?')}${v.rev?` @${esc(v.rev)}`:''} · ${v.remote?`đẩy lên <code>${esc(v.remote)}</code>`:'chưa có remote'}${v.dirty?` · ${v.dirty} file đang sửa`:''}`
  :`SVN${v.cli?`${v.rev?` · r${esc(v.rev)}`:''}${v.remote?` · <code>${esc(v.remote)}</code>`:''}`:' · <em class="bad">máy chưa có lệnh svn</em>: chạy lại bộ cài TortoiseSVN → Modify → chọn "command line client tools"'}`;
// ---- what is left of each AI plan (GET /api/machine/quota, server/ai-quota.js) ----
const QNAME={claude:'Claude',codex:'Codex (ChatGPT)'};
const when=ms=>{if(!ms)return '';const d=new Date(ms),now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})};
const lvl=left=>left<=10?'low':left<=30?'mid':'ok';
// One line for an engine: "Claude: còn 87% (5 giờ) · 93% (Tuần)"
export function quotaLine(q,engine){
  const x=q?.[engine];if(!x)return '';
  if(!x.ok)return `<span class="qline"><b>${QNAME[engine]}</b> <em title="${esc(x.error||'')}">chưa đọc được quota</em></span>`;
  return `<span class="qline"><b>${QNAME[engine]}</b> ${x.windows.map(w=>`<span class="qpct ${lvl(w.left)}" title="${esc(w.label)}: đã dùng ${w.used}%${w.resetsAt?`, mở lại ${when(w.resetsAt)}`:''}">còn ${w.left}% <small>${esc(w.label)}</small></span>`).join(' · ')}</span>`;
}
// Bars per usage window, plus the agents that run on that engine
export function quotaHtml(q,agents=[],{loading=false}={}){
  const block=e=>{
    const x=q?.[e],who=agents.filter(a=>a.engine===e||a.engine==='both');
    const bars=!x?`<p class="claude-note">${loading?'<span class="spinner"></span> Đang đọc quota…':'Chưa đọc.'}</p>`
      :!x.ok?`<p class="claude-err">${esc(x.error||'Không đọc được quota.')}</p>`
      :x.windows.map(w=>`<div class="qbar ${lvl(w.left)}"><span>${esc(w.label)}</span><i><b style="width:${w.used}%"></b></i><em>còn <b>${w.left}%</b>${w.resetsAt?` · mở lại ${esc(when(w.resetsAt))}`:''}</em></div>`).join('');
    return `<div class="qblock"><div class="qhead"><b>${QNAME[e]}</b>${x?.plan?`<span class="qplan">gói ${esc(String(x.plan).toUpperCase())}</span>`:''}${x?.limited?'<span class="qplan bad">đang hết hạn mức</span>':''}${x?.resetCredits?`<span class="qplan" title="Lượt làm mới hạn mức miễn phí của ChatGPT (dùng trong Codex)">${x.resetCredits} lượt reset</span>`:''}</div>
      ${bars}<div class="qwho">${who.length?`Agent dùng: ${who.map(a=>`<span class="qagent"><span class="tagdot" style="background:#${(a.color??0x9aa3b5).toString(16).padStart(6,'0')}"></span>${esc(a.name)}</span>`).join('')}`:'<em>Chưa agent nào dùng</em>'}</div></div>`;
  };
  return `<div class="qgrid">${block('claude')}${block('codex')}</div>${q?.claude?.at||q?.codex?.at?`<p class="claude-note">Đọc lúc ${when(Math.max(q.claude?.at||0,q.codex?.at||0))}. Claude được đọc bằng một yêu cầu rất nhỏ (Haiku, 1 token); Codex do chính Codex CLI báo.</p>`:''}`;
}
// Pick a folder and make it the working folder; returns the new status or null
export async function pickWorkdir(start){
  const dir=await openFolderPicker({start});if(!dir)return null;
  return machineApi('/config',{method:'POST',body:JSON.stringify({workdir:dir})});
}
export async function machineApi(path,opt={}){
  const r=await fetch('/api/machine'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.error||`HTTP ${r.status}`),{google:d.google});
  return d;
}

export function initMachineConnect({toast,onStatus=()=>{},getTeams=()=>[],getAgents=()=>[],onQuota=()=>{}}){
  const chip=document.createElement('button');chip.id='machineChip';chip.className='claude-chip';chip.innerHTML='<span class="cdot checking"></span><span class="mtext">Máy cá nhân…</span>';
  document.querySelector('.actions').prepend(chip);
  const modal=document.createElement('div');modal.className='modal hidden';
  modal.innerHTML='<div class="guide claude-box machine-box"><button class="close">✕</button><div class="panel-kicker">KẾT NỐI · MÁY CÁ NHÂN</div><div class="mbody"></div></div>';
  document.getElementById('app').appendChild(modal);
  const body=modal.querySelector('.mbody');
  let st=null,busy=false,checking=false,editing=null,showQr=null,quota=null,quotaLoading=false;
  async function loadQuota(fresh=false){
    quotaLoading=true;if(!modal.classList.contains('hidden'))render();
    try{quota=await machineApi('/quota'+(fresh?'?fresh=1':''));onQuota(quota)}catch(e){if(fresh)toast(e.message)}
    finally{quotaLoading=false;if(!modal.classList.contains('hidden'))render()}
    return quota;
  }

  const open=()=>{modal.classList.remove('hidden');render();refresh();loadQuota()};
  chip.onclick=open;
  modal.querySelector('.close').onclick=()=>modal.classList.add('hidden');

  function setChip(){
    const dot=chip.querySelector('.cdot'),txt=chip.querySelector('.mtext');
    const s=checking||!st?'checking':st.ready&&st.lastCheck?.ok!==false?'ok':'off';
    dot.className='cdot '+s;
    txt.textContent=checking?'Đang kiểm tra máy…':!st?'Máy cá nhân…':`Máy: ${st.host.name}`+(st.limits?.both?' · hết hạn mức AI':st.running?` · ${st.running} việc đang chạy`:st.ready?'':' (chưa sẵn sàng)');
    if(st?.limits?.both)dot.className='cdot off';
    // say it once when both plans become used up (and again if it happens later)
    watchUpdates(st?.updates);
    const both=!!st?.limits?.both;if(both&&!lastBoth)toast('⛔ Đã hết hạn mức của cả gói Claude và Codex: việc mới sẽ dừng cho tới giờ mở lại (xem cửa sổ Máy cá nhân).');lastBoth=both;
  }
  let lastBoth=false;
  // Claude Code / Codex updates (server/ai-updates.js): ask once per new version per app start, show progress and the result
  const asked=new Set(),prevUpd={};let updPoll=null;
  function watchUpdates(U){
    if(!U)return;
    for(const [e,u] of Object.entries({node:U.node,...U.engines})){
      const was=prevUpd[e];prevUpd[e]=u.state;
      if(was&&was!==u.state&&u.message&&(u.state==='done'||u.state==='error'))toast((u.state==='done'?'✓ ':'⚠ ')+u.message);
      // first install of a missing tool (started by the server on its own): say so once
      if(u.state==='running'&&was!=='running'&&U.missing?.includes(e))toast(`⬇ Máy chưa có ${u.name}: app đang tự cài ngầm (không cần quyền admin)…`);
      if(e==='node')continue;
      const key=e+u.latest;
      if(U.mode==='ask'&&u.available&&!u.skipped&&u.canUpdate&&u.state==='idle'&&!asked.has(key)&&!st.remote?.viewer){
        asked.add(key);
        // after the current call stack, so the dialog does not block rendering
        setTimeout(()=>{
          if(confirm(`Có bản mới của ${u.name}: ${u.current} → ${u.latest}.\n\nCài ngay? App cài ngầm (không mở cửa sổ cmd), chờ các việc đang chạy bằng ${u.name} xong rồi mới cài, và việc tiếp theo tự dùng bản mới.\n\nOK: cập nhật ngay · Cancel: để sau (cập nhật được trong cửa sổ Máy cá nhân)`))
            updateAct({engine:e}).then(()=>toast(`Đang cập nhật ${u.name} ở chế độ chạy ngầm…`));
        },0);
      }
    }
    // follow an install that is running or waiting
    clearTimeout(updPoll);
    if([U.node,...Object.values(U.engines)].some(u=>u.state==='running'||u.state==='waiting'))updPoll=setTimeout(()=>machineApi('/status').then(s=>{st=s;onStatus(s);modal.classList.contains('hidden')?setChip():render()}).catch(()=>{}),3000);
  }
  const updateAct=async b=>{st=await machineApi('/update',{method:'POST',body:JSON.stringify(b)});onStatus(st);render()};
  const updatesHtml=U=>{
    if(!U)return '';
    const viewer=!!st.remote?.viewer;
    const row=u=>{const e=u===U.engines.claude?'claude':'codex';
      const v=u.current?esc(u.current)+(u.appCopy?' <em>(app tự cài)</em>':''):'<em>chưa cài</em>';
      const s=u.state==='running'||u.state==='waiting'?`<em><span class="spinner"></span> ${esc(u.message)}</em>`
        :u.available?`→ <b>${esc(u.latest)}</b> ${u.canUpdate&&!viewer?`<button class="linkbtn" data-act="update" data-engine="${e}">Cập nhật ngầm</button>${u.skipped?'':` <button class="linkbtn" data-act="skipUpdate" data-engine="${e}">Bỏ qua bản này</button>`}`:`<em>${esc(u.manual||'')}</em>`}`
        :u.latest?'· mới nhất':'';
      return [esc(u.name),`${v} ${s}${u.state==='error'&&u.message?`<br><em class="bad">${esc(u.message)}</em>`:''}`]};
    const n=U.node,nodeRow=[esc(n.name),n.state==='running'?`<em><span class="spinner"></span> ${esc(n.message)}</em>`:n.path?`có sẵn <em>${esc(n.path)}</em>`:n.state==='error'?`<em class="bad">${esc(n.message)}</em>`:'<em>chưa cài</em>'];
    return `<div class="section-title">CÀI ĐẶT & CẬP NHẬT NODE.JS, CLAUDE CODE, CODEX</div>
      ${rows([nodeRow,row(U.engines.claude),row(U.engines.codex)])}
      <div class="mmodes">${Object.entries(U.modes).map(([k,l])=>`<label><input type="radio" name="mUpdate" value="${k}" ${k===U.mode?'checked':''} ${viewer?'disabled':''}> ${esc(l)}${k==='ask'?' <em>(khuyên dùng)</em>':''}</label>`).join('')}</div>
      <p class="claude-note">Máy chưa có Node.js, Claude Code hoặc Codex thì app tự cài bản chính thức vào <code>~/.ai-3d-office/tools</code> khi mở (không cần quyền admin, không mở cửa sổ cmd); máy đã có thì dùng bản của máy. App tắt chế độ tự cập nhật của Claude Code và Codex (chế độ này bật cửa sổ cmd giữa lúc chạy việc). App tự kiểm tra bản mới trên npm mỗi 6 giờ, cài với cửa sổ ẩn khi không có việc nào đang chạy bằng công cụ đó, và việc tiếp theo dùng bản mới mà không cần mở lại app.${U.checkedAt?` Kiểm tra lần cuối: ${fmt(U.checkedAt)}.`:''} <button class="linkbtn" data-act="checkUpdate" ${viewer?'disabled':''}>Kiểm tra ngay</button></p>`;
  };
  const fmtLimit=l=>new Date(l.until).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
  // Per-agent auto-approval: by default every command outside the kits asks; the user can let chosen agents run them
  const autoHtml=A=>{
    if(!A)return '';
    const list=getAgents(),viewer=!!st.remote?.viewer,nAuto=list.filter(a=>A.agents[a.id]).length;
    const opt=(id,cur)=>Object.entries(A.levels).map(([k,l])=>`<option value="${k}" ${k===cur?'selected':''}>${esc(l)}</option>`).join('');
    return `<div class="section-title">QUYỀN TỰ CHẠY LỆNH CỦA TỪNG AI <span>${nAuto?`${nAuto} AI tự chạy`:'tất cả đều hỏi'}</span></div>
      <p class="claude-note">Mặc định AI phải chờ bạn bấm cho phép với mỗi lệnh nằm ngoài bộ công cụ. <b>Tự chạy lệnh</b>: lệnh dòng lệnh chạy luôn, sửa file vẫn theo quyền thực thi ở trên. <b>Tự cho phép tất cả</b>: thêm cả sửa file trong thư mục làm việc (kể cả khi đang Chỉ đọc) và các công cụ khác; sửa file ngoài thư mục vẫn hỏi. Luôn vẫn hỏi với lệnh nguy hiểm (xóa đệ quy, sudo, tải script về chạy, tắt máy…), và các lệnh luôn cấm (git push, rm -rf, npm publish…) không bao giờ chạy.${viewer?' <b>Chỉ đổi được trên máy chạy app.</b>':''}</p>
      <div class="mauto">${list.map(a=>{const cur=A.agents[a.id]||'ask';return `<label class="mauto-row ${cur!=='ask'?'on':''}"><span class="tagdot" style="background:#${(a.color??0x9aa3b5).toString(16).padStart(6,'0')}"></span><b>${esc(a.name)}</b><em>${esc(a.team)}</em><select data-auto="${esc(a.id)}" ${viewer?'disabled':''}>${opt(a.id,cur)}</select></label>`}).join('')}</div>`;
  };
  // Usage limits of the AI plans: which one is used up until when, and whether work moves to the other one
  const limitsHtml=L=>{
    if(!L)return '';
    const row=(e,name,ready)=>{const l=L[e];return [name,l?`<em class="bad">hết hạn mức đến ${l.known?'':'khoảng '}${esc(fmtLimit(l))}</em> <button class="linkbtn" data-act="clearLimit" data-engine="${e}" title="${esc(l.message||'')}">Dùng lại ngay</button>`:ready?'Còn dùng được':'<em>chưa sẵn sàng</em>']};
    return `<div class="section-title">HẠN MỨC GÓI AI <span><button class="linkbtn" data-act="quota"${quotaLoading?' disabled':''}>⟲ Kiểm tra quota</button></span></div>
      ${quotaHtml(quota,getAgents(),{loading:quotaLoading})}
      ${rows([row('claude','Claude (gói Claude)',st.claude.found&&st.claude.auth),row('codex','Codex (gói ChatGPT)',st.codex.ready)])}
      ${L.both?'<p class="claude-err">Đã hết hạn mức của cả hai gói AI. Việc mới sẽ dừng và báo lại cho tới giờ mở lại, hoặc khi bạn nâng cấp gói (bấm "Dùng lại ngay").</p>':''}
      <label class="mcheck"><input type="checkbox" id="mAutoSwitch" ${L.autoSwitch?'checked':''}> Tự chuyển sang AI còn hạn mức: Claude hết thì làm bằng Codex, Codex hết thì làm bằng Claude</label>
      <p class="claude-note">Hạn mức theo 5 giờ, ngày hoặc tuần của gói. App đọc giờ mở lại trong thông báo của Claude/Codex (không đọc được thì thử lại sau 1 giờ) và tự dùng lại khi tới giờ.</p>`;
  };
  const rows=list=>`<div class="claude-rows">${list.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  // React Native: the app found in the working folder and what this machine can run it on (server/mobile.js)
  const mobileHtml=m=>{
    if(!m)return '';
    const p=m.project;
    const proj=p?`React Native${p.expo?` · Expo ${esc(p.expoVersion||'')}`:` ${esc(p.rnVersion||'')}`}${p.rel!=='.'?` · <code>${esc(p.rel)}</code>`:''}${p.web?' · có Expo web':''}`:'<em>thư mục làm việc không phải app React Native</em>';
    const ios=m.os!=='darwin'?'<em>chỉ có trên macOS</em>':m.xcode?`${esc(m.xcode)} · ${m.simulators.length} máy ảo${m.booted.length?` · đang chạy ${esc(m.booted.join(', '))}`:''}`:'<em class="bad">chưa cài Xcode</em>';
    const android=m.android?`${m.avds.length} máy ảo${m.devices.length?` · đang kết nối ${esc(m.devices.join(', '))}`:''}`:'<em class="bad">chưa có Android SDK (adb)</em>';
    return `<div class="section-title">KIỂM THỬ APP MOBILE</div>
      ${rows([['Dự án',proj],['iOS Simulator',ios],['Android',android],['Maestro',m.maestro?esc(m.maestro):'<em>chưa cài</em> · <code>curl -fsSL "https://get.maestro.mobile.dev" | bash</code>']])}
      <p class="claude-note">Với app React Native, QA kiểm theo 3 mức: kiểm tra tĩnh (tsc, eslint, jest), Expo web trên trình duyệt khung iPhone, và máy ảo iOS/Android (Maestro, ảnh chụp app). Bộ <b>Mobile (RN)</b> tự bật cho đội có Node.js hoặc Chạy test; build và chạy máy ảo cần chế độ được sửa file.</p>`;
  };
  // Remote access: other computers on the LAN/VPN open this office with a key (server/remote-access.js)
  const remoteHtml=r=>{
    if(!r)return '';
    if(r.viewer)return `<div class="section-title">TRUY CẬP TỪ XA</div><p class="claude-note">Bạn đang mở văn phòng từ thiết bị khác. Việc vẫn chạy trên máy <b>${esc(st.host.name)}</b>. Đăng nhập Claude/Codex, mật khẩu web và cài đặt truy cập từ xa chỉ đổi được trên máy đó.</p>`;
    // a link with copy and QR buttons; the phone scans the QR code to open it
    const linkRow=(id,url,label,hint)=>`<div class="rlink"><em class="rkind">${label}</em><div class="claude-code"><input readonly value="${esc(url)}"><button class="ghost" data-act="copy" data-text="${esc(url)}">Sao chép</button><button class="ghost" data-act="qr" data-i="${id}">${showQr===id?'Ẩn QR':'Mã QR'}</button></div>${showQr===id?`<div class="rqr">${qrSvg(url)}<span>Mở camera hoặc app quét QR trên điện thoại rồi quét mã này. ${hint}</span></div>`:''}</div>`;
    const links=(r.addresses||[]).map((a,i)=>linkRow('lan'+i,a.url,`📶 ${esc(a.name)} · chỉ khi chung mạng Wi-Fi/LAN`,'Điện thoại cần chung mạng Wi-Fi với máy này.')).join('')||'<p class="claude-note">Máy chưa có địa chỉ mạng nào để máy khác kết nối.</p>';
    const P=r.public||{};
    const pubState=P.state==='on'&&P.url?linkRow('pub',P.url,'🌐 Link công khai · dùng được ở mọi mạng (4G, Wi-Fi khác)','Trên điện thoại nhập mật khẩu truy cập một lần; thiết bị được nhớ 30 ngày.')
      :P.state==='installing'||P.state==='starting'?`<p class="claude-note"><span class="spinner"></span> ${esc(P.message||'Đang tạo link công khai…')}</p>`
      :P.state==='error'?`<p class="claude-err">${esc(P.message||'Không tạo được link công khai.')}</p>`:'';
    return `<div class="section-title">TRUY CẬP TỪ XA · ĐIỆN THOẠI & MÁY KHÁC</div>
      <label class="mcheck"><input type="checkbox" id="mRemote" ${r.wanted?'checked':''}> Cùng mạng: cho điện thoại hoặc máy khác trong cùng Wi-Fi/LAN mở văn phòng này bằng mã truy cập</label>
      ${r.error?`<p class="claude-err">${esc(r.error)}</p>`:''}
      ${r.on?links:''}
      <label class="mcheck"><input type="checkbox" id="mPublic" ${P.wanted?'checked':''} ${P.hasPassword?'':'disabled'}> Mọi mạng: tạo link công khai HTTPS (Cloudflare Tunnel) để mở từ điện thoại dùng 4G hoặc mạng khác</label>
      <div class="rpass">${pwField(`id="mPubPass" placeholder="${P.hasPassword?'Đổi mật khẩu truy cập':`Đặt mật khẩu truy cập (từ ${P.minPassword||8} ký tự)`}"`)}<button class="ghost" data-act="pubPass">${P.hasPassword?'Đổi mật khẩu':'Lưu mật khẩu'}</button></div>
      ${P.hasPassword?'':'<p class="claude-note">Link công khai nằm trên Internet nên cần mật khẩu riêng: đặt mật khẩu trước rồi mới bật được.</p>'}
      ${P.wanted?pubState:''}
      ${r.on||P.wanted?`<p class="claude-note">Mã truy cập nằm sau <code>?key=</code>. Ai có link cùng mạng đều điều khiển được agent trên máy này; link công khai còn cần mật khẩu. Chỉ gửi cho người tin cậy. Link công khai đổi mỗi lần app khởi động lại hoặc mất mạng: mở lại cửa sổ này để lấy link mới. Lần đầu Windows/macOS có thể hỏi cho phép kết nối: hãy cho phép.</p>
      <div class="claude-actions"><button class="ghost" data-act="remoteKey">↻ Đổi mã (mọi link và thiết bị cũ phải mở lại)</button></div>`:''}`;
  };

  function render(){
    setChip();followPublic();
    if(!st){body.innerHTML='<p class="claude-note"><span class="spinner"></span> Đang đọc thông tin máy…</p>';return}
    const {host,claude,config,workdir,lastCheck}=st;
    const authText=claude.auth==='token'?'Token dài hạn đã lưu':'<em class="bad">chưa đăng nhập</em>';
    body.innerHTML=`<h2><span class="cdot ${st.ready?'ok':'off'}"></span> ${st.ready?'Máy cá nhân sẵn sàng nhận việc':'Máy cá nhân chưa sẵn sàng'}</h2>
      <p class="claude-note">Việc giao với nơi thực thi <b>Máy cá nhân</b> được chạy thật bằng Claude Code trên máy này, trong thư mục làm việc bên dưới.</p>
      ${rows([['Tên máy',esc(host.name)],['Hệ điều hành',esc(`${host.os} · ${host.arch}`)],['CPU',esc(`${host.cpu} · ${host.cores} luồng`)],['RAM',`${gb(host.ramFree)} trống / ${gb(host.ramTotal)}`],['Người dùng',esc(host.user)],['Claude Code',claude.found?esc(claude.version||'đã cài'):'<em class="bad">không tìm thấy</em>'],['Xác thực',authText],['Việc đang chạy',`${st.running} đang chạy · ${st.queued} đang chờ`]])}
      <div class="section-title">THƯ MỤC LÀM VIỆC</div>
      <div class="claude-code"><input id="mWorkdir" value="${esc(config.workdir)}" spellcheck="false" autocomplete="off"><button class="ghost" data-act="browse" title="Duyệt thư mục trên máy">📂 Chọn…</button><button class="assign" data-act="workdir">Lưu</button></div>
      ${workdir.writable?'':`<p class="claude-err">${esc(workdir.exists?`Không ghi được vào thư mục${workdir.error?': '+workdir.error:''}`:'Thư mục không tồn tại.')} <button class="linkbtn" data-act="create">Tạo thư mục này</button></p>`}
      <p class="claude-note mvcs">${vcsBadge(st.vcs)} ${vcsText(st.vcs)}</p>
      ${(st.recentDirs||[]).filter(d=>d!==config.workdir).length?`<div class="mrecent"><span>Gần đây:</span>${st.recentDirs.filter(d=>d!==config.workdir).map(d=>`<button class="linkbtn" data-act="recent" data-dir="${esc(d)}" title="${esc(d)}">📁 ${esc(d.split(/[\\/]/).filter(Boolean).pop())}</button>`).join('')}</div>`:''}
      <div class="section-title">QUYỀN THỰC THI</div>
      <div class="mmodes">${Object.entries(config.modes).map(([k,l])=>`<label><input type="radio" name="mMode" value="${k}" ${k===config.mode?'checked':''}> ${esc(l)}${k==='default'?' <em>(an toàn, khuyên dùng)</em>':''}</label>`).join('')}</div>
      <div class="section-title">BỘ CÔNG CỤ CHO ĐỘI IT</div>
      <p class="claude-note">Lệnh dòng lệnh mỗi đội được phép chạy. Ở chế độ <b>Chỉ đọc</b> chỉ các lệnh xem (git status/diff/log, ls, cat…) được dùng; các bộ có dấu ✎ cần chế độ được sửa file. Không bao giờ cho phép git push, xóa hàng loạt hay publish.</p>
      <div class="mkits">${getTeams().map(team=>{const on=new Set(config.teamKits[team]??config.defaultKits[team]??config.defaultKits['*']);
        return `<div class="mkit"><b>${esc(team)}</b><div>${Object.entries(config.toolkits).map(([k,v])=>`<label class="kchip ${on.has(k)?'on':''}" title="${esc(v.label)}"><input type="checkbox" data-kit="${k}" data-team="${esc(team)}" ${on.has(k)?'checked':''}>${esc(v.short)}${v.write?' ✎':''}</label>`).join('')}</div></div>`}).join('')}</div>
      ${st.video?`<p class="claude-note">🎬 Bộ công cụ <b>Video toán</b> (Manim, giọng đọc tiếng Việt, ffmpeg): ${st.video.ready?`đã sẵn sàng · Manim ${esc(st.video.manim||'')}${st.video.latex?' · có LaTeX':''}`:st.video.installing?'<span class="spinner"></span> đang cài…':st.video.error?`<em class="bad">${esc(st.video.error)}</em>`:'tự cài khi agent đội Video nhận việc đầu tiên (khoảng 1 phút, cần Internet).'}</p>`:''}
      <div class="section-title">TRÌNH DUYỆT & TÀI KHOẢN WEB</div>
      ${rows([['Công cụ trình duyệt',st.browser.mcp?'Playwright MCP đã cài':'<em class="bad">chưa cài @playwright/mcp</em>'],['Trình duyệt dùng',st.browser.channel?esc(st.browser.names?.[st.browser.channel]||st.browser.channel):'<em class="bad">không tìm thấy Chrome/Edge</em>']])}
      ${st.browser.names?`<label class="mcheck">Trình duyệt cho agent và uitest: <select id="mBrowser">${[['auto','Tự chọn (Chrome, rồi Edge)'],...Object.entries(st.browser.names)].map(([k,l])=>`<option value="${k}" ${k===st.browser.pick?'selected':''}>${esc(l)}${k!=='auto'&&!st.browser.ready[k]?(k==='firefox'?' (tải khi chọn)':/^my/.test(k)?' (cần cài tiện ích)':' (chưa cài)'):''}</option>`).join('')}</select></label>
      ${st.browser.firefox?.state==='installing'?'<p class="claude-note"><span class="spinner"></span> Đang tải Firefox cho Playwright (khoảng 100 MB)…</p>':st.browser.firefox?.state==='error'?`<p class="claude-note"><em class="bad">Không tải được Firefox: ${esc(st.browser.firefox.error)}</em></p>`:''}
      ${/^my/.test(st.browser.pick)?`<div class="claude-note"><b>Dùng trình duyệt đã đăng nhập của bạn</b>: agent điều khiển chính cửa sổ ${st.browser.pick==='mychrome'?'Chrome':'Edge'} của bạn, với mọi tài khoản đang đăng nhập (Google, email, ngân hàng…). Nên tạo một hồ sơ (profile) riêng chỉ đăng nhập tài khoản cần cho agent.
        <ol><li>${st.browser.extInstalled[st.browser.pick]?'✓ Đã cài tiện ích Playwright.':`Chưa cài tiện ích nên agent tạm dùng trình duyệt riêng. Cài tiện ích <a href="${esc(st.browser.extUrl)}" target="_blank" rel="noopener">Playwright Extension</a> vào ${st.browser.pick==='mychrome'?'Chrome':'Edge'} (vào hồ sơ dành cho agent), rồi bấm ⟲ Làm mới.`}</li>
        <li>Mỗi việc, tiện ích hỏi bạn chọn tab cho agent. Muốn agent tự kết nối không hỏi: mở tiện ích, chép mã (token) rồi dán vào đây: <input id="mExtToken" type="password" autocomplete="off" placeholder="${st.browser.extToken?'Đã lưu mã · dán mã mới hoặc để trống để xóa':'Mã của tiện ích (không bắt buộc)'}" style="width:16em"> <button class="ghost" data-act="extToken">Lưu mã</button></li>
        <li>Mỗi lúc chỉ một việc dùng trình duyệt của bạn; việc khác chờ tới lượt. Kịch bản <code>uitest</code> vẫn chạy một ${st.browser.pick==='mychrome'?'Chrome':'Edge'} riêng, không đụng tới tài khoản của bạn.</li></ol></div>`:''}
      ${st.browser.pick!=='auto'&&!/^my/.test(st.browser.pick)&&st.browser.channel!==st.browser.pick?`<p class="claude-note">${esc(st.browser.names[st.browser.pick])} chưa sẵn sàng, tạm dùng ${esc(st.browser.names[st.browser.channel]||'trình duyệt khác')}.</p>`:''}`:''}
      <label class="mcheck"><input type="checkbox" id="mVisible" ${config.browserVisible?'checked':''}> Hiện cửa sổ trình duyệt khi agent thao tác (bỏ chọn để chạy ẩn)</label>
      <div class="msites">${st.browser.sites.length?st.browser.sites.map(s=>`<div class="msite"><div><b>${esc(s.label)}</b><span>${esc(s.url)}</span><span>👤 ${esc(s.username||'—')} · 🔑 ••••••</span></div><button class="linkbtn" data-act="editSite" data-id="${s.id}">Sửa</button><button class="linkbtn" data-act="delSite" data-id="${s.id}">Xóa</button></div>`).join(''):'<p class="claude-note">Chưa lưu tài khoản nào.</p>'}</div>
      <div class="msite-form" data-id="${esc(editing?.id||'')}"><div class="msite-grid"><input id="sLabel" placeholder="Tên (ví dụ Jira Trí Nam)" value="${esc(editing?.label||'')}"><input id="sUrl" placeholder="Link (ví dụ http://pm.trinam.vn)" value="${esc(editing?.url||'')}"><input id="sUser" placeholder="Tên đăng nhập" autocomplete="off" value="${esc(editing?.username||'')}">${pwField(`id="sPass" placeholder="${editing?'Mật khẩu (để trống = giữ nguyên)':'Mật khẩu'}"`)}</div>
        <div class="claude-actions"><button class="assign" data-act="saveSite">${editing?'Lưu thay đổi':'＋ Lưu tài khoản'}</button>${editing?'<button class="ghost" data-act="cancelSite">Hủy</button>':''}</div></div>
      <p class="claude-note">Mật khẩu chỉ lưu trên máy này (<code>~/.ai-3d-office/sites.json</code>), không gửi xuống trình duyệt và không gửi cho Claude: agent gõ tên biến bí mật, Playwright tự thay bằng mật khẩu thật và che mật khẩu trong mọi nội dung trả về.</p>
      ${autoHtml(st.auto)}
      ${limitsHtml(st.limits)}
      ${updatesHtml(st.updates)}
      ${mobileHtml(st.mobile)}
      ${remoteHtml(st.remote)}
      <div class="section-title">KIỂM TRA KẾT NỐI</div>
      ${checking?'<p class="claude-note"><span class="spinner"></span> Đang chạy kiểm tra trên máy (có thể mất 10–30 giây)…</p>':lastCheck?`<ul class="check-list">${lastCheck.steps.map(s=>`<li class="${s.ok?'ok':'bad'}"><b>${s.ok?'✓':'✗'} ${esc(s.name)}</b><span>${esc(s.detail)}</span></li>`).join('')}</ul><p class="claude-note">Kiểm tra lúc ${fmt(lastCheck.at)} · ${(lastCheck.ms/1000).toFixed(1)}s</p>`:'<p class="claude-note">Chưa kiểm tra lần nào.</p>'}
      <div class="claude-actions"><button class="assign" data-act="check" ${checking?'disabled':''}>▶ Chạy kiểm tra trên máy</button><button class="ghost" data-act="refresh">⟲ Làm mới</button></div>`;
  }

  // while the public link is being made (download, tunnel start), look again every 2 s if the window is open
  let pubPoll=null;
  const followPublic=()=>{clearTimeout(pubPoll);if(['installing','starting'].includes(st?.remote?.public?.state)&&!modal.classList.contains('hidden'))pubPoll=setTimeout(()=>{if(!busy)refresh()},2000)};
  async function refresh(){try{st=await machineApi('/status');onStatus(st)}catch(e){st=null;chip.querySelector('.mtext').textContent='Máy cá nhân: lỗi kết nối';chip.querySelector('.cdot').className='cdot off'}render()}
  async function act(name,el){
    if(busy)return;busy=true;
    try{
      if(name==='refresh')await refresh();
      else if(name==='quota'){busy=false;await loadQuota(true);return}
      else if(name==='check'){checking=true;render();const r=await machineApi('/check',{method:'POST'});st=r.status;onStatus(st);toast(r.check.ok?'✓ Máy cá nhân hoạt động tốt, sẵn sàng chạy việc':'✗ Kiểm tra máy chưa đạt, xem chi tiết trong cửa sổ')}
      else if(name==='browse'){const s=await pickWorkdir(body.querySelector('#mWorkdir').value);if(s){st=s;onStatus(st);toast('Đã chọn thư mục làm việc')}}
      else if(name==='recent'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({workdir:el.dataset.dir})});onStatus(st);toast('Đã chuyển thư mục làm việc')}
      else if(name==='workdir'||name==='create'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({workdir:body.querySelector('#mWorkdir').value,create:name==='create'})});onStatus(st);toast('Đã cập nhật thư mục làm việc')}
      else if(name==='mode'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({mode:el.value})});onStatus(st);toast('Quyền thực thi: '+st.config.modes[st.config.mode])}
      else if(name==='kits'){const team=el.dataset.team,list=[...body.querySelectorAll('[data-kit]')].filter(x=>x.dataset.team===team&&x.checked).map(x=>x.dataset.kit);
        st=await machineApi('/config',{method:'POST',body:JSON.stringify({teamKits:{[team]:list}})});onStatus(st);toast(`Đã cập nhật bộ công cụ của đội ${team}`)}
      else if(name==='visible'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({browserVisible:el.checked})});onStatus(st);toast(el.checked?'Agent sẽ mở cửa sổ trình duyệt để bạn theo dõi':'Agent sẽ chạy trình duyệt ẩn')}
      else if(name==='extToken'){const v=body.querySelector('#mExtToken').value.trim();st=await machineApi('/config',{method:'POST',body:JSON.stringify({extToken:v})});onStatus(st);toast(v?'Đã lưu mã: agent sẽ tự kết nối vào trình duyệt của bạn':'Đã xóa mã: tiện ích sẽ hỏi bạn mỗi việc')}
      else if(name==='browser'){if(/^my/.test(el.value)&&!confirm('Agent sẽ điều khiển trình duyệt bạn đang đăng nhập, thấy được các tài khoản trong đó.\nNên dùng một hồ sơ trình duyệt riêng cho agent. Tiếp tục?')){el.value=st.browser.pick;return}st=await machineApi('/config',{method:'POST',body:JSON.stringify({browser:el.value})});onStatus(st);toast(el.value==='firefox'&&!st.browser.ready.firefox?'Đang tải Firefox, việc mới sẽ dùng Firefox khi tải xong':`Việc mới sẽ dùng ${el.value==='auto'?'trình duyệt tự chọn':st.browser.names[el.value]}`)
        // follow the Firefox download until it is done
        const poll=()=>setTimeout(async()=>{if(modal.classList.contains('hidden'))return;if(!busy)await refresh();if(st?.browser?.firefox?.state==='installing')poll()},3000);if(st.browser.firefox?.state==='installing')poll()}
      else if(name==='saveSite'){
        const v=id=>body.querySelector('#'+id).value;
        await machineApi('/sites',{method:'POST',body:JSON.stringify({id:editing?.id,label:v('sLabel'),url:v('sUrl'),username:v('sUser'),password:v('sPass')})});
        toast(editing?'Đã cập nhật tài khoản':'Đã lưu tài khoản web');editing=null;await refresh();
      }
      else if(name==='auto'){
        const lvl=el.value,who=getAgents().find(a=>a.id===el.dataset.auto)?.name||el.dataset.auto;
        if(lvl!=='ask'&&!confirm(`Cho phép ${who} ${lvl==='all'?'tự chạy lệnh và tự sửa file trong thư mục làm việc':'tự chạy lệnh'} mà không hỏi bạn?\nLệnh nguy hiểm vẫn sẽ hỏi.`)){el.value=st.auto.agents[el.dataset.auto]||'ask';return}
        st=await machineApi('/config',{method:'POST',body:JSON.stringify({agentAuto:{[el.dataset.auto]:lvl}})});onStatus(st);toast(`${who}: ${st.auto.levels[lvl]}`)}
      else if(name==='autoSwitch'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({autoSwitch:el.checked})});onStatus(st);toast(el.checked?'Sẽ tự chuyển sang AI còn hạn mức':'Không tự chuyển: việc sẽ dừng khi gói AI hết hạn mức')}
      else if(name==='update'){await updateAct({engine:el.dataset.engine});toast('Đang cập nhật ở chế độ chạy ngầm…')}
      else if(name==='skipUpdate'){await updateAct({skip:el.dataset.engine});toast('Sẽ không hỏi lại bản này')}
      else if(name==='checkUpdate'){await updateAct({check:true});toast('Đã kiểm tra bản mới')}
      else if(name==='updateMode'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({aiUpdate:el.value})});onStatus(st);toast('Cập nhật AI: '+st.updates.modes[st.updates.mode])}
      else if(name==='clearLimit'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({clearLimit:el.dataset.engine})});onStatus(st);toast(`Việc tiếp theo sẽ thử lại ${el.dataset.engine==='claude'?'Claude':'Codex'}`)}
      else if(name==='remote'){const r=await machineApi('/remote',{method:'POST',body:JSON.stringify({on:el.checked})});st={...st,remote:r};toast(r.on?'Đã bật truy cập từ xa: gửi link cho máy cần mở':r.error||'Đã tắt truy cập từ xa')}
      else if(name==='pubPass'){const pw=body.querySelector('#mPubPass').value;const r=await machineApi('/remote',{method:'POST',body:JSON.stringify({password:pw})});st={...st,remote:r};toast('Đã lưu mật khẩu truy cập: thiết bị đã mở link công khai phải nhập lại')}
      else if(name==='public'){const r=await machineApi('/remote',{method:'POST',body:JSON.stringify({public:el.checked})});st={...st,remote:r};toast(el.checked?'Đang tạo link công khai… (lần đầu app tải Cloudflare Tunnel)':'Đã tắt link công khai')}
      else if(name==='remoteKey'){if(!confirm('Đổi mã truy cập? Các máy đang mở bằng link cũ sẽ phải nhập mã mới.'))return;const r=await machineApi('/remote',{method:'POST',body:JSON.stringify({newKey:true})});st={...st,remote:r};toast('Đã đổi mã truy cập')}
      else if(name==='qr'){const i=el.dataset.i;showQr=showQr===i?null:i}
      else if(name==='copy'){
        const done=navigator.clipboard?await navigator.clipboard.writeText(el.dataset.text).then(()=>true,()=>false):false;
        if(done)toast('Đã sao chép link');else{el.previousElementSibling?.select();toast('Đã chọn sẵn link: bấm Ctrl/Cmd+C để sao chép')}
      }
      else if(name==='editSite'){editing=st.browser.sites.find(s=>s.id===el.dataset.id)||null}
      else if(name==='cancelSite'){editing=null}
      else if(name==='delSite'){const s=st.browser.sites.find(s=>s.id===el.dataset.id);if(!confirm(`Xóa tài khoản "${s?.label}" khỏi máy?`))return;await machineApi(`/sites/${el.dataset.id}`,{method:'DELETE'});toast('Đã xóa tài khoản');await refresh()}
    }catch(e){toast(e.message)}
    finally{busy=false;checking=false;render()}
  }
  body.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act,b)});
  body.addEventListener('change',e=>{if(e.target.dataset.kit)act('kits',e.target);else if(e.target.name==='mMode')act('mode',e.target);else if(e.target.name==='mUpdate')act('updateMode',e.target);else if(e.target.id==='mVisible')act('visible',e.target);else if(e.target.id==='mBrowser')act('browser',e.target);else if(e.target.id==='mPublic')act('public',e.target);else if(e.target.id==='mRemote')act('remote',e.target);else if(e.target.id==='mAutoSwitch')act('autoSwitch',e.target);else if(e.target.dataset.auto)act('auto',e.target)});
  body.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='mWorkdir')act('workdir')});

  refresh();
  setInterval(()=>{if(!busy&&modal.classList.contains('hidden'))machineApi('/status').then(s=>{st=s;onStatus(s);setChip()}).catch(()=>{})},15000);
  loadQuota();setInterval(()=>loadQuota(),10*60e3);// numbers stay roughly current; the server caches them too
  return {open,refresh,status:()=>st,quota:()=>quota,loadQuota};
}
