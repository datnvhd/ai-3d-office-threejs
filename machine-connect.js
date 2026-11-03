// Personal machine connection: status chip in the top bar + modal backed by /api/machine (server/machine-bridge.js).
// Shows this computer's info, lets the user pick the working folder and permission mode, and runs a real health check.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('vi-VN'):'—';
const gb=b=>(b/1073741824).toFixed(1)+' GB';
export async function machineApi(path,opt={}){
  const r=await fetch('/api/machine'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}

export function initMachineConnect({toast,onStatus=()=>{}}){
  const chip=document.createElement('button');chip.id='machineChip';chip.className='claude-chip';chip.innerHTML='<span class="cdot checking"></span><span class="mtext">Máy cá nhân…</span>';
  document.querySelector('.actions').prepend(chip);
  const modal=document.createElement('div');modal.className='modal hidden';
  modal.innerHTML='<div class="guide claude-box machine-box"><button class="close">✕</button><div class="panel-kicker">KẾT NỐI · MÁY CÁ NHÂN</div><div class="mbody"></div></div>';
  document.getElementById('app').appendChild(modal);
  const body=modal.querySelector('.mbody');
  let st=null,busy=false,checking=false,editing=null;

  const open=()=>{modal.classList.remove('hidden');render();refresh()};
  chip.onclick=open;
  modal.querySelector('.close').onclick=()=>modal.classList.add('hidden');

  function setChip(){
    const dot=chip.querySelector('.cdot'),txt=chip.querySelector('.mtext');
    const s=checking||!st?'checking':st.ready&&st.lastCheck?.ok!==false?'ok':'off';
    dot.className='cdot '+s;
    txt.textContent=checking?'Đang kiểm tra máy…':!st?'Máy cá nhân…':`Máy: ${st.host.name}`+(st.running?` · ${st.running} việc đang chạy`:st.ready?'':' (chưa sẵn sàng)');
  }
  const rows=list=>`<div class="claude-rows">${list.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;

  function render(){
    setChip();
    if(!st){body.innerHTML='<p class="claude-note"><span class="spinner"></span> Đang đọc thông tin máy…</p>';return}
    const {host,claude,config,workdir,lastCheck}=st;
    const authText=claude.auth==='token'?'Token dài hạn đã lưu':'<em class="bad">chưa đăng nhập</em>';
    body.innerHTML=`<h2><span class="cdot ${st.ready?'ok':'off'}"></span> ${st.ready?'Máy cá nhân sẵn sàng nhận việc':'Máy cá nhân chưa sẵn sàng'}</h2>
      <p class="claude-note">Việc giao với nơi thực thi <b>Máy cá nhân</b> được chạy thật bằng Claude Code trên máy này, trong thư mục làm việc bên dưới.</p>
      ${rows([['Tên máy',esc(host.name)],['Hệ điều hành',esc(`${host.os} · ${host.arch}`)],['CPU',esc(`${host.cpu} · ${host.cores} luồng`)],['RAM',`${gb(host.ramFree)} trống / ${gb(host.ramTotal)}`],['Người dùng',esc(host.user)],['Claude Code',claude.found?esc(claude.version||'đã cài'):'<em class="bad">không tìm thấy</em>'],['Xác thực',authText],['Việc đang chạy',`${st.running} đang chạy · ${st.queued} đang chờ`]])}
      <div class="section-title">THƯ MỤC LÀM VIỆC</div>
      <div class="claude-code"><input id="mWorkdir" value="${esc(config.workdir)}" spellcheck="false" autocomplete="off"><button class="assign" data-act="workdir">Lưu</button></div>
      ${workdir.writable?'':`<p class="claude-err">${esc(workdir.exists?`Không ghi được vào thư mục${workdir.error?': '+workdir.error:''}`:'Thư mục không tồn tại.')} <button class="linkbtn" data-act="create">Tạo thư mục này</button></p>`}
      <div class="section-title">QUYỀN THỰC THI</div>
      <div class="mmodes">${Object.entries(config.modes).map(([k,l])=>`<label><input type="radio" name="mMode" value="${k}" ${k===config.mode?'checked':''}> ${esc(l)}${k==='default'?' <em>(an toàn, khuyên dùng)</em>':''}</label>`).join('')}</div>
      <div class="section-title">TRÌNH DUYỆT & TÀI KHOẢN WEB</div>
      ${rows([['Công cụ trình duyệt',st.browser.mcp?'Playwright MCP đã cài':'<em class="bad">chưa cài @playwright/mcp</em>'],['Trình duyệt dùng',st.browser.channel?esc(st.browser.channel==='chrome'?'Google Chrome':'Microsoft Edge'):'<em class="bad">không tìm thấy Chrome/Edge</em>']])}
      <label class="mcheck"><input type="checkbox" id="mVisible" ${config.browserVisible?'checked':''}> Hiện cửa sổ trình duyệt khi agent thao tác (bỏ chọn để chạy ẩn)</label>
      <div class="msites">${st.browser.sites.length?st.browser.sites.map(s=>`<div class="msite"><div><b>${esc(s.label)}</b><span>${esc(s.url)}</span><span>👤 ${esc(s.username||'—')} · 🔑 ••••••</span></div><button class="linkbtn" data-act="editSite" data-id="${s.id}">Sửa</button><button class="linkbtn" data-act="delSite" data-id="${s.id}">Xóa</button></div>`).join(''):'<p class="claude-note">Chưa lưu tài khoản nào.</p>'}</div>
      <div class="msite-form" data-id="${esc(editing?.id||'')}"><div class="msite-grid"><input id="sLabel" placeholder="Tên (ví dụ Jira Trí Nam)" value="${esc(editing?.label||'')}"><input id="sUrl" placeholder="Link (ví dụ http://pm.trinam.vn)" value="${esc(editing?.url||'')}"><input id="sUser" placeholder="Tên đăng nhập" autocomplete="off" value="${esc(editing?.username||'')}"><input id="sPass" type="password" placeholder="${editing?'Mật khẩu (để trống = giữ nguyên)':'Mật khẩu'}" autocomplete="new-password"></div>
        <div class="claude-actions"><button class="assign" data-act="saveSite">${editing?'Lưu thay đổi':'＋ Lưu tài khoản'}</button>${editing?'<button class="ghost" data-act="cancelSite">Hủy</button>':''}</div></div>
      <p class="claude-note">Mật khẩu chỉ lưu trên máy này (<code>~/.ai-3d-office/sites.json</code>), không gửi xuống trình duyệt và không gửi cho Claude: agent gõ tên biến bí mật, Playwright tự thay bằng mật khẩu thật và che mật khẩu trong mọi nội dung trả về.</p>
      <div class="section-title">KIỂM TRA KẾT NỐI</div>
      ${checking?'<p class="claude-note"><span class="spinner"></span> Đang chạy kiểm tra trên máy (có thể mất 10–30 giây)…</p>':lastCheck?`<ul class="check-list">${lastCheck.steps.map(s=>`<li class="${s.ok?'ok':'bad'}"><b>${s.ok?'✓':'✗'} ${esc(s.name)}</b><span>${esc(s.detail)}</span></li>`).join('')}</ul><p class="claude-note">Kiểm tra lúc ${fmt(lastCheck.at)} · ${(lastCheck.ms/1000).toFixed(1)}s</p>`:'<p class="claude-note">Chưa kiểm tra lần nào.</p>'}
      <div class="claude-actions"><button class="assign" data-act="check" ${checking?'disabled':''}>▶ Chạy kiểm tra trên máy</button><button class="ghost" data-act="refresh">⟲ Làm mới</button></div>`;
  }

  async function refresh(){try{st=await machineApi('/status');onStatus(st)}catch(e){st=null;chip.querySelector('.mtext').textContent='Máy cá nhân: lỗi kết nối';chip.querySelector('.cdot').className='cdot off'}render()}
  async function act(name,el){
    if(busy)return;busy=true;
    try{
      if(name==='refresh')await refresh();
      else if(name==='check'){checking=true;render();const r=await machineApi('/check',{method:'POST'});st=r.status;onStatus(st);toast(r.check.ok?'✓ Máy cá nhân hoạt động tốt, sẵn sàng chạy việc':'✗ Kiểm tra máy chưa đạt, xem chi tiết trong cửa sổ')}
      else if(name==='workdir'||name==='create'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({workdir:body.querySelector('#mWorkdir').value,create:name==='create'})});onStatus(st);toast('Đã cập nhật thư mục làm việc')}
      else if(name==='mode'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({mode:el.value})});onStatus(st);toast('Quyền thực thi: '+st.config.modes[st.config.mode])}
      else if(name==='visible'){st=await machineApi('/config',{method:'POST',body:JSON.stringify({browserVisible:el.checked})});onStatus(st);toast(el.checked?'Agent sẽ mở cửa sổ trình duyệt để bạn theo dõi':'Agent sẽ chạy trình duyệt ẩn')}
      else if(name==='saveSite'){
        const v=id=>body.querySelector('#'+id).value;
        await machineApi('/sites',{method:'POST',body:JSON.stringify({id:editing?.id,label:v('sLabel'),url:v('sUrl'),username:v('sUser'),password:v('sPass')})});
        toast(editing?'Đã cập nhật tài khoản':'Đã lưu tài khoản web');editing=null;await refresh();
      }
      else if(name==='editSite'){editing=st.browser.sites.find(s=>s.id===el.dataset.id)||null}
      else if(name==='cancelSite'){editing=null}
      else if(name==='delSite'){const s=st.browser.sites.find(s=>s.id===el.dataset.id);if(!confirm(`Xóa tài khoản "${s?.label}" khỏi máy?`))return;await machineApi(`/sites/${el.dataset.id}`,{method:'DELETE'});toast('Đã xóa tài khoản');await refresh()}
    }catch(e){toast(e.message)}
    finally{busy=false;checking=false;render()}
  }
  body.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act,b)});
  body.addEventListener('change',e=>{if(e.target.name==='mMode')act('mode',e.target);else if(e.target.id==='mVisible')act('visible',e.target)});
  body.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='mWorkdir')act('workdir')});

  refresh();
  setInterval(()=>{if(!busy&&modal.classList.contains('hidden'))machineApi('/status').then(s=>{st=s;onStatus(s);setChip()}).catch(()=>{})},15000);
  return {open,refresh,status:()=>st};
}
