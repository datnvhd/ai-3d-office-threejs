// Codex (ChatGPT) connection: status chip in the top bar + login modal backed by /api/codex (server/codex-bridge.js)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('vi-VN'):'—';
async function api(path,opt={}){
  const r=await fetch('/api/codex'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}

export function initCodexConnect({toast,onChange=()=>{}}){
  const chip=document.createElement('button');chip.className='claude-chip';chip.innerHTML='<span class="cdot checking"></span><span class="xtext">Codex…</span>';
  document.querySelector('.actions').prepend(chip);
  const modal=document.createElement('div');modal.className='modal hidden';
  modal.innerHTML='<div class="guide claude-box"><button class="close">✕</button><div class="panel-kicker">KẾT NỐI · CODEX (CHATGPT)</div><div class="xbody"></div></div>';
  document.getElementById('app').appendChild(modal);
  const body=modal.querySelector('.xbody');
  let st=null,pollTimer=null,busy=false;
  const pending=()=>st&&['starting','waiting'].includes(st.login.state);

  const open=()=>{modal.classList.remove('hidden');render()};
  chip.onclick=open;
  modal.querySelector('.close').onclick=()=>modal.classList.add('hidden');

  function setChip(){
    const s=!st?'checking':st.connected?'ok':pending()?'checking':'off';
    chip.querySelector('.cdot').className='cdot '+s;
    chip.querySelector('.xtext').textContent=!st?'Codex…':st.connected?'Codex: đã kết nối':s==='checking'?'Codex: đang đăng nhập…':'Codex: chưa kết nối';
  }
  const rows=list=>`<div class="claude-rows">${list.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;

  function render(){
    setChip();
    if(!st){body.innerHTML='<p class="claude-note">Đang kiểm tra kết nối…</p>';return}
    const {cli,login,lastTest}=st;
    const info=rows([['Codex CLI',cli.found?esc(cli.version||'đã cài'):'<em class="bad">không tìm thấy</em>'],['Đăng nhập',st.auth==='chatgpt'?'Tài khoản ChatGPT':st.auth==='apikey'?'API key OpenAI':'chưa đăng nhập'],['Agent dùng Codex','Designer']]);
    const test=lastTest?`<p class="${lastTest.ok?'claude-note':'claude-err'}">${lastTest.ok?'✓':'✗'} Chạy thử lúc ${fmt(lastTest.at)}: ${esc(lastTest.detail)}</p>`:'';
    if(!cli.found){
      body.innerHTML=`<h2>Chưa có Codex CLI</h2><p class="claude-note">Cài bằng <code>npm i -g @openai/codex</code> (hoặc đặt biến môi trường <code>CODEX_BIN</code>), khởi động lại server rồi kiểm tra lại.</p>${info}<button class="assign" data-act="refresh">⟲ Kiểm tra lại</button>`;
    }else if(login.state==='starting'){
      body.innerHTML='<h2>Đang mở trang đăng nhập…</h2><p class="claude-note"><span class="spinner"></span> Đang khởi động Codex và mở trình duyệt.</p><button class="ghost" data-act="cancel">Hủy</button>';
    }else if(login.state==='waiting'){
      body.innerHTML=`<h2>Đăng nhập ChatGPT trên trình duyệt</h2>
        <ol class="claude-steps"><li>Trình duyệt đã mở trang đăng nhập OpenAI. Đăng nhập tài khoản ChatGPT và cho phép Codex.</li>
        <li>Không thấy trang? <a href="${esc(login.url)}" target="_blank" rel="noopener noreferrer">Mở trang đăng nhập</a> (phải mở trên chính máy này).</li></ol>
        <p class="claude-note"><span class="spinner"></span> Đang chờ đăng nhập… Codex tự lưu phiên đăng nhập khi hoàn tất.</p>
        <button class="ghost" data-act="cancel">Hủy đăng nhập</button>`;
    }else if(st.connected){
      body.innerHTML=`<h2><span class="cdot ok"></span> Đã kết nối Codex</h2>${info}${test}
        <p class="claude-note">Phiên đăng nhập do Codex CLI lưu trong <code>~/.codex</code> trên máy này, không gửi xuống trình duyệt. Việc giao cho <b>Designer</b> (nơi thực thi: Máy cá nhân) sẽ chạy bằng Codex.</p>
        <div class="claude-actions"><button class="assign" data-act="verify">▶ Chạy thử</button><button class="ghost" data-act="logout">Đăng xuất</button></div>`;
    }else{
      const err=login.state==='error'?login.message:'';
      body.innerHTML=`<h2>Chưa kết nối Codex</h2>
        <p class="claude-note">Đăng nhập tài khoản ChatGPT (Plus/Pro/Business…) qua trình duyệt để agent <b>Designer</b> làm việc bằng Codex.</p>
        ${err?`<p class="claude-err">${esc(err)}</p>`:''}${info}
        <div class="claude-actions"><button class="assign" data-act="login">✦ Đăng nhập bằng ChatGPT</button><button class="ghost" data-act="refresh">⟲ Kiểm tra lại</button></div>`;
    }
  }

  const update=s=>{const was=st?.connected;st=s;if(was!==s.connected)onChange(s)};
  async function act(name){
    if(busy)return;busy=true;
    try{
      if(name==='login'){update(await api('/login',{method:'POST'}));poll()}
      else if(name==='cancel')update(await api('/login/cancel',{method:'POST'}));
      else if(name==='refresh')update(await api('/status'));
      else if(name==='verify'){body.querySelectorAll('button').forEach(b=>b.disabled=true);update(await api('/verify',{method:'POST'}));toast(st.lastTest?.ok?'✓ Codex phản hồi bình thường':'✗ Codex chạy thử thất bại')}
      else if(name==='logout'){if(!confirm('Đăng xuất Codex trên máy này?'))return;update(await api('/logout',{method:'POST'}));toast('Đã đăng xuất Codex')}
    }catch(e){toast(e.message)}
    finally{busy=false;render()}
  }
  body.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act)});

  function poll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async()=>{
      try{const prev=st?.login.state;update(await api('/status'));if(prev!==st.login.state)render();if(st.login.state==='success'&&prev!=='success')toast('Đã kết nối Codex (ChatGPT)')}catch{}
      if(pending())poll();
    },1500);
  }

  (async()=>{
    try{update(await api('/status'))}catch{chip.querySelector('.xtext').textContent='Codex: lỗi kiểm tra';chip.querySelector('.cdot').className='cdot off';return}
    render();if(pending())poll();
  })();
}
