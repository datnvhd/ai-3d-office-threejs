// Claude Code connection: status chip in the top bar + login modal backed by /api/claude (server/claude-bridge.js)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('vi-VN'):'—';
async function api(path,opt={}){
  const r=await fetch('/api/claude'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}

export function initClaudeConnect({toast}){
  const chip=document.createElement('button');chip.id='claudeChip';chip.className='claude-chip';chip.innerHTML='<span class="cdot checking"></span><span id="claudeChipText">Claude Code…</span>';
  document.querySelector('.actions').prepend(chip);
  const modal=document.createElement('div');modal.className='modal hidden';modal.id='claudeModal';
  modal.innerHTML='<div class="guide claude-box"><button class="close" id="claudeClose">✕</button><div class="panel-kicker">KẾT NỐI · CLAUDE CODE</div><div id="claudeBody"></div></div>';
  document.getElementById('app').appendChild(modal);
  const body=modal.querySelector('#claudeBody');
  let st=null,pollTimer=null,busy=false;

  const open=()=>{modal.classList.remove('hidden');render()};
  chip.onclick=open;
  modal.querySelector('#claudeClose').onclick=()=>modal.classList.add('hidden');

  function setChip(){
    const dot=chip.querySelector('.cdot'),txt=chip.querySelector('#claudeChipText');
    const s=!st?'checking':st.connected?'ok':['starting','waiting','verifying'].includes(st.login.state)?'checking':'off';
    dot.className='cdot '+s;
    txt.textContent=!st?'Đang kiểm tra…':st.connected?'Claude Code: đã kết nối':s==='checking'?'Đang đăng nhập…':'Claude Code: chưa kết nối';
  }

  function rows(list){return `<div class="claude-rows">${list.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`}

  function render(){
    setChip();
    if(!st){body.innerHTML='<p class="claude-note">Đang kiểm tra kết nối…</p>';return}
    const {cli,token,login}=st;
    const cliRows=rows([['Claude Code CLI',cli.found?esc(cli.version||'đã cài'):'<em class="bad">không tìm thấy</em>']]);
    if(!cli.found){
      body.innerHTML=`<h2>Chưa có Claude Code</h2><p class="claude-note">Không tìm thấy Claude Code CLI trên máy chạy server. Cài Claude Code (hoặc đặt biến môi trường <code>CLAUDE_BIN</code> trỏ tới file chạy), khởi động lại server rồi kiểm tra lại.</p>${cliRows}<button class="assign" data-act="refresh">⟲ Kiểm tra lại</button>`;
    }else if(login.state==='starting'){
      body.innerHTML='<h2>Đang mở trang đăng nhập…</h2><p class="claude-note"><span class="spinner"></span> Đang khởi động Claude Code và mở cửa sổ trình duyệt mới.</p><button class="ghost" data-act="cancel">Hủy</button>';
    }else if(login.state==='waiting'){
      body.innerHTML=`<h2>Đăng nhập Claude trên cửa sổ mới</h2>
        <ol class="claude-steps">${login.fresh
          ?'<li>Đã mở một <b>cửa sổ trình duyệt mới, chưa đăng nhập tài khoản nào</b>. Đăng nhập tài khoản Claude muốn dùng (nhập mã xác thực gửi về email, hoặc Google) rồi bấm <b>Authorize</b>.</li><li>Không thấy cửa sổ? <button class="ghost" data-act="reopen">Mở lại cửa sổ đăng nhập</button></li>'
          :'<li>Không tìm thấy Chrome/Edge để mở cửa sổ mới. <button class="ghost" data-act="copyurl">Sao chép link đăng nhập</button> rồi dán vào một <b>cửa sổ ẩn danh</b> (Ctrl+Shift+N), đăng nhập tài khoản muốn dùng và bấm <b>Authorize</b>.</li>'}
        <li>Nếu trang hiển thị <b>mã xác thực</b>, dán vào đây:</li></ol>
        <div class="claude-code"><input id="claudeCode" placeholder="Dán mã xác thực…" autocomplete="off" spellcheck="false"><button class="assign" data-act="code">Gửi mã</button></div>
        ${login.message?`<p class="claude-err">${esc(login.message)}</p>`:''}
        <p class="claude-note"><span class="spinner"></span> Đang chờ xác thực… Token sẽ tự động được lưu và cửa sổ đăng nhập tự đóng khi hoàn tất.</p>
        <button class="ghost" data-act="cancel">Hủy đăng nhập</button>`;
    }else if(login.state==='verifying'){
      body.innerHTML='<h2>Đã nhận token</h2><p class="claude-note"><span class="spinner"></span> Đang kiểm tra token với Claude Code…</p>';
    }else if(st.connected){
      body.innerHTML=`<h2><span class="cdot ok"></span> Đã kết nối Claude Code</h2>
        ${rows([['Token',`<code>${esc(token.masked)}</code>`],['Tạo lúc',fmt(token.createdAt)],['Hết hạn (ước tính)',fmt(token.expiresAt)],['Kiểm tra gần nhất',fmt(token.verifiedAt)]])}
        ${cliRows}
        <p class="claude-note">Mọi việc chạy bằng tài khoản Claude đã đăng nhập trong ứng dụng (token này), không dùng tài khoản mặc định của Claude Code trên máy. Token được lưu tại <code>${esc(token.file)}</code> và không gửi xuống trình duyệt.</p>
        <div class="claude-actions"><button class="assign" data-act="login">✦ Đăng nhập tài khoản khác</button><button class="ghost" data-act="verify">✓ Kiểm tra lại</button><button class="ghost" data-act="logout">Ngắt kết nối</button></div>`;
    }else{
      const warn=token?.expired?'Token đã lưu đã hết hạn.':token?.lastError?`Token đã lưu không dùng được: ${token.lastError}`:'';
      const err=login.state==='error'?login.message:'';
      body.innerHTML=`<h2>Chưa kết nối Claude Code</h2>
        <p class="claude-note">Đăng nhập tài khoản Claude trên một cửa sổ trình duyệt mới (chưa đăng nhập sẵn tài khoản nào) để tạo token dài hạn (1 năm) cho ứng dụng. Token được lưu trên máy chạy server.</p>
        ${warn?`<p class="claude-err">${esc(warn)}</p>`:''}${err?`<p class="claude-err">${esc(err)}</p>`:''}
        ${cliRows}
        <div class="claude-actions"><button class="assign" data-act="login">✦ Đăng nhập qua web</button>${token?'<button class="ghost" data-act="verify">Kiểm tra lại token</button>':''}</div>`;
    }
  }

  async function act(name){
    // No re-render here, so a code already pasted into the box is kept
    if(name==='copyurl'){navigator.clipboard.writeText(st.login.url).then(()=>toast('Đã sao chép link đăng nhập'),()=>toast('Không sao chép được link đăng nhập'));return}
    if(name==='reopen'){api('/login/open',{method:'POST'}).then(s=>toast(s.login.fresh?'Đã mở lại cửa sổ đăng nhập':'Không mở được trình duyệt'),e=>toast(e.message));return}
    if(busy)return;busy=true;
    try{
      if(name==='login'){st=await api('/login',{method:'POST'});poll()}
      else if(name==='cancel')st=await api('/login/cancel',{method:'POST'});
      else if(name==='refresh')st=await api('/status');
      else if(name==='verify'){body.querySelectorAll('button').forEach(b=>b.disabled=true);st=await api('/verify',{method:'POST'});toast(st.connected?'Token Claude Code hợp lệ':'Token không dùng được')}
      else if(name==='logout'){if(!confirm('Xóa token Claude Code đã lưu trên máy?'))return;st=await api('/token',{method:'DELETE'});toast('Đã xóa token đã lưu')}
      else if(name==='code'){
        const input=body.querySelector('#claudeCode'),code=input.value.trim();
        if(!code){input.focus();return}
        await api('/login/code',{method:'POST',body:JSON.stringify({code})});input.value='';toast('Đã gửi mã xác thực');
      }
    }catch(e){toast(e.message)}
    finally{busy=false;render()}
  }
  body.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act)});
  body.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='claudeCode')act('code')});

  function poll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async()=>{
      try{
        const prev=st?.login.state;st=await api('/status');
        if(!body.querySelector('#claudeCode')||prev!==st.login.state)render();else setChip();
        if(st.login.state==='success'&&prev!=='success')toast('Đã kết nối Claude Code và lưu token');
      }catch{}
      if(st&&['starting','waiting','verifying'].includes(st.login.state))poll();
    },1500);
  }

  (async()=>{
    try{st=await api('/status')}catch(e){st=null;chip.querySelector('#claudeChipText').textContent='Claude Code: lỗi kiểm tra';chip.querySelector('.cdot').className='cdot off';return}
    render();
    if(['starting','waiting','verifying'].includes(st.login.state))poll();
    if(!st.connected){toast('Chưa kết nối Claude Code, hãy đăng nhập để tiếp tục');open()}
  })();
}
