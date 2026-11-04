// Large popup with one agent's work: its task list on the left, the selected task's live progress on the right
// (request, machine/folder/permissions, elapsed time, step-by-step log, result or error). Real tasks refresh from
// /api/machine/tasks/:id while running; simulated ones only show their progress bar.
const ICON={init:'🚀',tool:'🔧',out:'↳',denied:'⛔',text:'💬',ask:'❓'};
const KIND={init:'Khởi động',tool:'Công cụ',out:'Đầu ra',denied:'Bị chặn',text:'AI',ask:'Hỏi thêm'};
const pad=n=>String(n).padStart(2,'0');
const dur=ms=>{const s=Math.max(0,Math.round(ms/1000));return s>=3600?`${Math.floor(s/3600)}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`:`${pad(Math.floor(s/60))}:${pad(s%60)}`};

export function createProgressView({agentOf,allJobs,machineApi,md,esc,hex,STATUS,GROUP,onCancel,onRetry,onAssign,onAsk,onAnswer}){
  const modal=document.createElement('div');modal.className='modal hidden pv';
  modal.innerHTML='<div class="pv-box"><button class="close" data-pv="close">✕</button><div class="pv-head"></div><div class="pv-main"><aside class="pv-list"></aside><section class="pv-detail"></section></div></div>';
  document.getElementById('app').appendChild(modal);
  const head=modal.querySelector('.pv-head'),list=modal.querySelector('.pv-list'),detail=modal.querySelector('.pv-detail');
  let agentId=null,jobKey=null,full=null,shots=[],timer=null,lastList='',lastDetail='',lastLogLen=-1;

  const isOpen=()=>!modal.classList.contains('hidden');
  const jobsOf=()=>allJobs().filter(j=>j.agent===agentId);
  const current=()=>jobsOf().find(j=>j.key===jobKey);

  function open(id,key){
    agentId=id;const jobs=jobsOf();
    jobKey=key||(jobs.find(j=>GROUP[j.status]==='running')||jobs[0])?.key||null;
    full=null;lastList=lastDetail='';lastLogLen=-1;modal.classList.remove('hidden');tick();
  }
  function close(){modal.classList.add('hidden');clearTimeout(timer)}

  async function tick(){
    clearTimeout(timer);if(!isOpen())return;
    const j=current();
    if(j?.remote&&(!full||full.id!==j.rid||GROUP[j.status]==='running'||full.status!==j.status)){
      try{full=(await machineApi(`/tasks/${j.rid}`)).task}catch{}
      if(j.web)try{shots=(await machineApi(`/tasks/${j.rid}/shots`)).shots}catch{}
    }
    if(!j?.web)shots=[];
    render();
    timer=setTimeout(tick,j&&GROUP[j.status]==='running'?1200:3000);
  }

  function render(){
    const a=agentOf(agentId),jobs=jobsOf(),j=current(),running=jobs.filter(x=>GROUP[x.status]==='running').length;
    head.innerHTML=`<div class="profile-avatar" style="background:${hex(a.color)}">${esc(a.name[0])}</div><div class="pv-who"><div class="panel-kicker">TIẾN TRÌNH · AI AGENT</div><h2>${esc(a.name)}</h2><span>${esc(a.role)}</span></div>
      <div class="pv-sum"><span>${running?`<span class="pulse"></span> ${running} việc đang xử lý`:'<span class="pulse idle"></span> Đang rảnh'}</span><em>${jobs.length} việc · ${jobs.filter(x=>x.status==='done').length} xong · ${jobs.filter(x=>GROUP[x.status]==='error').length} lỗi</em></div>`;
    const lh=jobs.length?jobs.map(x=>`<button class="pv-item ${x.key===jobKey?'on':''} st-${x.status}" data-key="${x.key}"><span class="badge ${GROUP[x.status]==='running'?'running':x.status==='done'?'done':'error'}">${STATUS[x.status]}</span><b>${esc(x.text)}</b><small>${x.remote?'💻':'🎲'} ${x.created.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}${GROUP[x.status]==='running'?` · ${x.remote?`bước ${x.steps}`:x.progress+'%'}`:''}</small></button>`).join(''):'<p class="empty">Chưa có việc nào.</p>';
    if(lh!==lastList){list.innerHTML=lh;lastList=lh}
    if(!j){detail.innerHTML=lastDetail=`<div class="pv-empty"><p>${esc(a.name)} chưa có việc nào.</p><button class="assign" data-pv="assign">✦ Giao việc cho ${esc(a.name)}</button></div>`;lastLogLen=-1;return}
    const t=j.remote&&full&&full.id===j.rid?full:null,live=GROUP[j.status]==='running';
    const asking=t?.asking?t.thread?.at(-1):null,started=asking?Date.parse(asking.started||asking.at):t?.started?Date.parse(t.started):null,end=asking||!t?.finished?Date.now():Date.parse(t.finished);
    const chips=j.remote?[`💻 ${esc(j.host||'Máy cá nhân')}`,`📁 <span title="${esc(j.cwd)}">${esc(j.cwd)}</span>`,`🔒 ${j.mode==='acceptEdits'?'Được sửa file':'Chỉ đọc'}`,j.web?`🌐 Trình duyệt${j.siteLabels?.length?' · 🔑 '+esc(j.siteLabels.join(', ')):''}`:'',started?`⏱ ${dur(end-started)}`:'⏱ chưa bắt đầu',`🔧 ${j.steps} bước`,j.turns!=null?`${j.turns} lượt`:'',j.costUsd!=null?`$${j.costUsd.toFixed(3)}`:''].filter(Boolean):['🎲 Mô phỏng',`Tiến độ ${j.progress}%`];
    const log=t?.log||[],t0=log[0]?.at||started;
    // keep the user's scroll position in the log unless they were following the bottom
    const box=detail.querySelector('.pv-log'),follow=!box||box.scrollHeight-box.scrollTop-box.clientHeight<40,keepTop=box?.scrollTop;
    const html=`<div class="pv-top"><span class="badge ${live?'running':j.status==='done'?'done':'error'}">${STATUS[j.status]}</span><span class="pv-prio">${esc(j.priority)}</span><span class="pv-time">Giao lúc ${j.created.toLocaleString('vi-VN')}</span></div>
      <div class="pv-task">${esc(j.text)}</div>
      <div class="pv-chips">${chips.map(c=>`<span>${c}</span>`).join('')}</div>
      ${live?`<div class="pv-now">${j.status==='queued'?'⏳ Đang chờ đến lượt chạy…':`<span class="spinner"></span> ${esc(j.remote?j.activity||'Đang xử lý…':'Đang xử lý (mô phỏng)…')}`}</div><div class="progress ${j.remote?'live':''}"><i style="width:${j.progress}%"></i></div>`:''}
      ${j.remote?`<div class="section-title">NHẬT KÝ THỰC HIỆN <span>${log.length} mục</span></div><div class="pv-log">${log.length?log.map(e=>`<div class="pv-row k-${e.kind}"><time>+${dur(e.at-t0)}</time><i title="${KIND[e.kind]||''}">${ICON[e.kind]||'•'}</i><div>${e.kind==='text'?md(e.text):esc(e.text)}</div></div>`).join(''):`<p class="empty">${t?'Chưa có bước nào.':'Đang tải nhật ký…'}</p>`}${live&&j.status!=='queued'?'<div class="pv-row k-wait"><time></time><i><span class="spinner"></span></i><div>Đang chờ bước tiếp theo…</div></div>':''}</div>`:'<p class="claude-note">Việc mô phỏng không có nhật ký thật. Chọn nơi thực thi “Máy cá nhân” để xem từng bước Claude Code thực hiện.</p>'}
      ${j.web?`<div class="section-title">ẢNH CHỤP TRÌNH DUYỆT <span>${shots.length} ảnh</span></div>${shots.length?`<div class="pv-shots">${shots.map(s=>{const u=`/api/machine/tasks/${j.rid}/shots/${encodeURIComponent(s.name)}`;return `<a href="${u}" target="_blank" rel="noopener" title="${esc(new Date(s.at).toLocaleTimeString('vi-VN'))}"><img src="${u}" alt="Ảnh chụp" loading="lazy"><span>${esc(new Date(s.at).toLocaleTimeString('vi-VN'))}</span></a>`}).join('')}</div>`:'<p class="claude-note">Chưa có ảnh chụp nào.</p>'}`:''}
      ${j.status==='waiting'?`<div class="section-title">CẦN BẠN TRẢ LỜI</div><div class="qbox pv-q-box"><p>${esc((t?.question||j.question)?.q||'')}</p>${((t?.question||j.question)?.options||[]).length?`<div class="qopts">${(t?.question||j.question).options.map(o=>`<button class="qopt" data-pv-answer="${esc(o)}">${esc(o)}</button>`).join('')}</div>`:''}<form class="pv-ask pv-answer"><textarea rows="2" maxlength="4000" placeholder="Hoặc tự nhập câu trả lời / thông tin bổ sung… (Enter gửi)"></textarea><button class="assign" type="submit">Gửi</button></form></div>`:''}
      ${(t?.clarify||j.clarify||[]).length?`<div class="section-title">ĐÃ TRAO ĐỔI <span>${(t?.clarify||j.clarify).length} câu</span></div><div class="pv-thread">${(t?.clarify||j.clarify).map(x=>`<div class="pv-a"><b>❓ ${esc(x.q)}</b></div><div class="pv-q">${esc(x.answer)}</div>`).join('')}</div>`:''}
      ${j.rework?`<div class="pv-rework">↩ Đã trả lại cho <b>${esc(j.rework.to.join(', '))}</b> để sửa: ${esc(j.rework.reason)}</div>`:''}
      ${j.status==='done'?`<div class="section-title">KẾT QUẢ</div><div class="jobresult pv-result"><div class="restext md">${j.remote?md(j.result):esc(j.result)}</div></div>`:''}
      ${j.remote&&j.kind!=='plan'&&(j.status==='done'||t?.thread?.length)?askBlock(a,j,t):''}
      ${GROUP[j.status]==='error'?`<div class="section-title">${j.status==='cancelled'?'ĐÃ DỪNG':'LỖI'}</div><div class="joberr">${esc(j.error)}</div>`:''}
      <div class="pv-actions">${live&&j.remote?`<button class="ghost" data-pv="cancel">■ Dừng việc này</button>`:''}${GROUP[j.status]==='error'?`<button class="assign" data-pv="retry">⟲ Thử lại</button>`:''}<button class="ghost" data-pv="assign">✦ Giao việc mới cho ${esc(a.name)}</button></div>`;
    if(html===lastDetail)return;
    // keep a half-typed follow-up question across re-renders
    const draft=detail.querySelector('.pv-ask textarea'),draftVal=draft?.value,draftFocus=draft&&document.activeElement===draft;
    detail.innerHTML=lastDetail=html;
    const nd=detail.querySelector('.pv-ask textarea');if(nd&&draftVal){nd.value=draftVal;if(draftFocus)nd.focus()}
    const nb=detail.querySelector('.pv-log');
    if(nb){if(follow&&(log.length!==lastLogLen||live))nb.scrollTop=nb.scrollHeight;else if(keepTop!=null)nb.scrollTop=keepTop}
    lastLogLen=log.length;
  }

  // Conversation after the result: each follow-up question and its answer, then a box to ask more
  function askBlock(a,j,t){
    const th=t?.thread||[];
    const items=th.map(x=>`<div class="pv-q"><b>Bạn hỏi</b>${esc(x.q)}</div>${x.answer?`<div class="pv-a md">${md(x.answer)}</div>`:x.error?`<div class="joberr">${esc(x.error)}</div>`:`<div class="pv-a wait"><span class="spinner"></span> ${esc(a.name)} đang trả lời…</div>`}`).join('');
    return `<div class="section-title">HỎI THÊM <span>${th.length?th.length+' câu':'AI nhớ ngữ cảnh của việc này'}</span></div>${items?`<div class="pv-thread">${items}</div>`:''}
      ${(t?.status||j.status)==='done'?`<form class="pv-ask"><textarea rows="2" maxlength="8000" placeholder="Hỏi thêm ${esc(a.name)} về việc này, không cần mô tả lại… (Enter gửi, Shift+Enter xuống dòng)"></textarea><button class="assign" type="submit">Gửi</button></form>`:''}`;
  }
  detail.addEventListener('submit',async e=>{
    e.preventDefault();
    if(e.target.classList.contains('pv-answer')){const box=e.target.querySelector('textarea'),j=current();if(box.value.trim()&&j){await onAnswer?.(j,box.value);box.value='';full=null;lastDetail='';tick()}return}const box=e.target.querySelector('textarea'),btn=e.target.querySelector('button'),q=box.value.trim(),j=current();
    if(!q||!j?.remote||!onAsk)return;
    btn.disabled=box.disabled=true;
    try{await onAsk(j,q);box.value='';full=null;lastDetail='';tick()}catch{}finally{btn.disabled=box.disabled=false}
  });
  detail.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.target.matches('.pv-ask textarea, .pv-answer textarea')){e.preventDefault();e.target.form.requestSubmit()}});

  modal.addEventListener('click',async e=>{
    if(e.target===modal)return close();
    const item=e.target.closest('[data-key]');if(item){jobKey=item.dataset.key;full=null;lastLogLen=-1;lastList=lastDetail='';detail.innerHTML='';tick();return}
    const pa=e.target.closest('[data-pv-answer]');if(pa){const j=current();if(j){await onAnswer?.(j,pa.dataset.pvAnswer);full=null;lastDetail='';tick()}return}
    const b=e.target.closest('[data-pv]');if(!b)return;
    const act=b.dataset.pv,j=current();
    if(act==='close')close();
    else if(act==='assign'){close();onAssign(agentId)}
    else if(act==='cancel'&&j){await onCancel(j);tick()}
    else if(act==='retry'&&j){await onRetry(j);full=null;setTimeout(tick,600)}
  });
  addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen())close()});
  return {open,close,isOpen,refresh:()=>{if(isOpen())render()}};
}
