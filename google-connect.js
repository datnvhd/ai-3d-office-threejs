// Google account (Drive / Sheets / Docs, read-only): status chip in the top bar + modal backed by /api/google
// (server/google-bridge.js). open(reason) is also called when a task's Google link needs an account.
import {pwField} from './pw-field.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opt={}){
  const r=await fetch('/api/google'+path,{...opt,headers:{'X-AI-Office':'1','Content-Type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}

export function initGoogleConnect({toast}){
  const chip=document.createElement('button');chip.id='googleChip';chip.className='claude-chip';chip.innerHTML='<span class="cdot checking"></span><span class="gtext">Google…</span>';
  document.querySelector('.actions').prepend(chip);
  const modal=document.createElement('div');modal.className='modal hidden';
  modal.innerHTML='<div class="guide claude-box"><button class="close">✕</button><div class="panel-kicker">KẾT NỐI · GOOGLE DRIVE / SHEETS</div><div class="xbody"></div></div>';
  document.getElementById('app').appendChild(modal);
  const body=modal.querySelector('.xbody');
  let st=null,pollTimer=null,busy=false,reason=null,editClient=false;
  const pending=()=>st&&['starting','waiting'].includes(st.login.state);

  const open=(why=null)=>{reason=why;modal.classList.remove('hidden');render();refresh()};
  chip.onclick=()=>open();
  modal.querySelector('.close').onclick=()=>modal.classList.add('hidden');

  function setChip(){
    const s=!st?'checking':st.connected?'ok':pending()?'checking':'off';
    chip.querySelector('.cdot').className='cdot '+s;
    chip.querySelector('.gtext').textContent=!st?'Google…':st.connected?'Google: đã kết nối':s==='checking'?'Google: đang đăng nhập…':'Google: chưa kết nối';
    chip.title=st?.email||'';
  }
  const why=()=>reason?`<p class="claude-err">${esc(reason)}</p>`:'';

  function render(){
    setChip();
    if(!st){body.innerHTML='<p class="claude-note">Đang kiểm tra kết nối…</p>';return}
    const {login}=st,err=login.state==='error'?`<p class="claude-err">${esc(login.message)}</p>`:'';
    if(!st.hasClient||editClient){
      body.innerHTML=`<h2>Thiết lập đăng nhập Google</h2>${why()}
        <p class="claude-note">Tệp chia sẻ <b>"Bất kỳ ai có đường liên kết"</b> đọc được ngay, không cần bước này. Với tệp riêng tư, app cần một OAuth Client của bạn (làm một lần):</p>
        <ol class="claude-steps">
          <li>Vào <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>, chọn/tạo project, bật <b>Google Drive API</b> (và <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener noreferrer">Google Sheets API</a> để biết link đang mở sheet nào).</li>
          <li><a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener noreferrer">Google Auth Platform</a>: tạo màn hình đồng ý (External), thêm email của bạn vào <b>Test users</b>.</li>
          <li><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clients</a> → <b>Create client</b> → loại <b>Desktop app</b>, rồi dán Client ID và Client secret (hoặc cả nội dung file JSON tải về) vào đây.</li>
        </ol>
        <div class="gclient"><input id="gId" placeholder="Client ID (…apps.googleusercontent.com) hoặc nội dung JSON" autocomplete="off">${pwField('id="gSecret" placeholder="Client secret"')}</div>
        <div class="claude-actions"><button class="assign" data-act="client">Lưu</button>${st.hasClient?'<button class="ghost" data-act="back">Hủy</button>':''}</div>`;
    }else if(login.state==='starting'||login.state==='waiting'){
      body.innerHTML=`<h2>Đăng nhập Google trên trình duyệt</h2>
        <ol class="claude-steps"><li>Trình duyệt đã mở trang đăng nhập Google. Chọn tài khoản có quyền xem tệp và <b>tick ô cho phép xem tệp Google Drive</b>.</li>
        ${login.url?`<li>Không thấy trang? <a href="${esc(login.url)}" target="_blank" rel="noopener noreferrer">Mở trang đăng nhập</a> (phải mở trên chính máy này).</li>`:''}
        <li>Nếu Google báo "ứng dụng chưa được xác minh": chọn <b>Tiếp tục</b> (app là của chính bạn).</li></ol>
        <p class="claude-note"><span class="spinner"></span> Đang chờ đăng nhập…</p>
        <button class="ghost" data-act="cancel">Hủy</button>`;
    }else if(st.connected){
      body.innerHTML=`<h2><span class="cdot ok"></span> Đã kết nối Google</h2>${why()}
        <div class="claude-rows"><div><span>Tài khoản</span><b>${esc(st.email||'(không rõ email)')}</b></div><div><span>Quyền</span><b>Chỉ xem tệp Google Drive</b></div><div><span>OAuth Client</span><b><code>${esc(st.clientId)}</code></b></div></div>
        <p class="claude-note">Dán link Google Sheets / Docs / Slides / Drive vào yêu cầu: app tải tệp về và gửi cho agent như tệp đính kèm. Với Google Sheets, mỗi sheet thành một bảng riêng, nên có thể nhắc tên sheet trong yêu cầu (ví dụ: <i>lấy dữ liệu sheet "Doanh thu"</i>).</p>
        <div class="claude-actions"><button class="assign" data-act="login">Đổi tài khoản</button><button class="ghost" data-act="logout">Đăng xuất</button></div>`;
    }else{
      body.innerHTML=`<h2>Chưa đăng nhập Google</h2>${why()}${err}
        <p class="claude-note">Đăng nhập tài khoản Google có quyền xem tệp. App chỉ xin quyền <b>xem</b> tệp Drive; mã đăng nhập lưu trên máy này, không gửi cho AI.</p>
        <div class="claude-actions"><button class="assign" data-act="login">Đăng nhập Google</button>${st.clientFromEnv?'':'<button class="ghost" data-act="edit">Đổi OAuth Client</button>'}</div>`;
    }
  }

  async function act(name){
    if(busy)return;busy=true;
    try{
      if(name==='client'){st=await api('/client',{method:'POST',body:JSON.stringify({id:body.querySelector('#gId').value,secret:body.querySelector('#gSecret').value})});editClient=false;toast('Đã lưu OAuth Client. Giờ đăng nhập tài khoản Google.')}
      else if(name==='edit'){editClient=true}
      else if(name==='back'){editClient=false}
      else if(name==='login'){st=await api('/login',{method:'POST'});poll()}
      else if(name==='cancel')st=await api('/login/cancel',{method:'POST'});
      else if(name==='logout'){if(!confirm('Đăng xuất tài khoản Google trên máy này?'))return;st=await api('/logout',{method:'POST'});toast('Đã đăng xuất Google')}
    }catch(e){toast(e.message)}
    finally{busy=false;render()}
  }
  body.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act)});

  async function refresh(){try{st=await api('/status');render();if(pending())poll()}catch{chip.querySelector('.gtext').textContent='Google: lỗi kiểm tra';chip.querySelector('.cdot').className='cdot off'}}
  function poll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async()=>{
      try{const prev=st?.login.state;st=await api('/status');if(prev!==st.login.state){render();if(st.login.state==='success'){reason=null;render();toast(`Đã kết nối Google${st.email?': '+st.email:''}. Giao việc lại để tải tệp.`)}}}catch{}
      if(pending())poll();
    },1500);
  }
  refresh();
  return {open};
}
