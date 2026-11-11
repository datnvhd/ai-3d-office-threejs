// Large popup with one agent's work: its task list on the left, the selected task's live progress on the right
// (request, machine/folder/permissions, elapsed time, step-by-step log, result or error). Real tasks refresh from
// /api/machine/tasks/:id while running; simulated ones only show their progress bar.
import {setHTML} from './dom-keep.js';
import {downloadList,linkFiles,fileUrl,optionButtons,toggleFill,fillPlaceholder,composeAnswer} from './ui-text.js';
const ICON={init:'🚀',tool:'🔧',out:'↳',denied:'⛔',text:'💬',ask:'❓'};
const KIND={init:'Khởi động',tool:'Công cụ',out:'Đầu ra',denied:'Bị chặn',text:'AI',ask:'Hỏi thêm'};
const pad=n=>String(n).padStart(2,'0');
const dur=ms=>{const s=Math.max(0,Math.round(ms/1000));return s>=3600?`${Math.floor(s/3600)}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`:`${pad(Math.floor(s/60))}:${pad(s%60)}`};

const TODO_ICON={completed:'✓',in_progress:'◐',pending:'○'};
const DIFF_KIND={added:'Mới',deleted:'Xóa',modified:'Sửa'};

export function createProgressView({agentOf,allJobs,machineApi,md,esc,hex,STATUS,GROUP,onCancel,onRetry,onAssign,onAsk,onAnswer,onPerm,onDesignMark,onDesignHandoff,toast=()=>{},loginBox,onLogin,onSkill}){
  const modal=document.createElement('div');modal.className='modal hidden pv';
  modal.innerHTML='<div class="pv-box"><button class="close" data-pv="close">✕</button><div class="pv-head"></div><div class="pv-main"><aside class="pv-list"></aside><section class="pv-detail"></section></div></div>';
  document.getElementById('app').appendChild(modal);
  const head=modal.querySelector('.pv-head'),list=modal.querySelector('.pv-list'),detail=modal.querySelector('.pv-detail');
  let agentId=null,jobKey=null,full=null,shots=[],timer=null,lastList='',lastDetail='',lastLogLen=-1,focusedQ='',shownKey=null,toBottom=false;
  // the diff of the selected task, loaded when the user opens it: {key,sig,open,loading,files,err}
  let diff={key:null};
  const changeSig=t=>JSON.stringify([(t?.changes||[]).map(c=>[c.path,c.b?.h,c.a?.h]),t?.undone?.at||'']);
  async function loadDiff(j,t){
    const sig=changeSig(t);diff={key:j.key,sig,open:true,loading:true};render();
    try{const r=await machineApi(`/tasks/${j.rid}/diff`);if(diff.key===j.key&&diff.sig===sig)diff={...diff,loading:false,files:r.files}}
    catch(e){if(diff.key===j.key)diff={...diff,loading:false,err:e.message}}
    lastDetail='';render();
  }
  // Agent's checklist (TodoWrite / TaskCreate) with done count
  function todoBlock(todos){
    const list=(todos||[]).filter(x=>x.status!=='deleted');if(!list.length)return '';
    const done=list.filter(x=>x.status==='completed').length;
    return `<div class="section-title">DANH SÁCH VIỆC CỦA AGENT <span>${done}/${list.length} xong</span></div><div class="pv-todos">${list.map(x=>`<div class="todo t-${x.status}"><i>${TODO_ICON[x.status]||'○'}</i><span>${esc(x.status==='in_progress'&&x.active?x.active:x.text)}</span></div>`).join('')}</div>`;
  }
  // Tool calls outside the allowed rules wait here for the user's yes/no
  function permBlock(a,perms){
    if(!perms?.length)return '';
    return `<div class="section-title">CẦN BẠN CHO PHÉP <span>${perms.length} yêu cầu</span></div>${perms.map(p=>`<div class="qbox permbox"><b>🔐 ${esc(a.name)} xin phép: ${esc(p.desc)}</b>${p.detail?`<pre>${esc(p.detail)}</pre>`:''}<div class="qopts"><button class="qopt ok" data-pv-perm="${p.id}|1">✓ Cho phép</button><button class="qopt" data-pv-perm="${p.id}|2" title="Không hỏi lại ${esc(p.ruleLabel)} trong việc này">✓ Luôn cho phép ${esc(p.ruleLabel)}</button><button class="qopt no" data-pv-perm="${p.id}|0">✕ Từ chối</button></div></div>`).join('')}`;
  }
  // Files the task changed, the diff on demand, and the undo button
  function changeBlock(j,t,live){
    const ch=t?.changes||[];if(!ch.length)return '';
    const sig=changeSig(t),mine=diff.key===j.key&&diff.sig===sig,u=t.undone;
    const count=k=>ch.filter(c=>(k==='added'?!c.b:k==='deleted'?!c.a:c.b&&c.a)).length;
    const summary=['added','modified','deleted'].map(k=>count(k)?`${count(k)} ${DIFF_KIND[k].toLowerCase()}`:'').filter(Boolean).join(' · ');
    const files=mine&&diff.files?`<div class="pv-diff" data-keep="diff-${j.key}-${esc(sig.length+':'+sig.slice(-40))}">${diff.files.map(f=>`<details class="dfile"${diff.files.length<=4?' open':''}><summary><span class="dst ${f.status}">${DIFF_KIND[f.status]}</span><code>${esc(f.path)}</code><em class="dadd">+${f.add}</em><em class="ddel">−${f.del}</em></summary>${f.big?'<p class="claude-note">File lớn hơn 1MB: chỉ biết có thay đổi, không hiện nội dung.</p>':f.binary?'<p class="claude-note">File nhị phân (ảnh, tệp nén…).</p>':f.missing?'<p class="claude-note">Không còn bản lưu để so sánh.</p>':`<pre class="dcode">${f.hunks.map(h=>`<span class="dh">@@ -${h.oldStart} +${h.newStart} @@</span>${h.lines.map(([k,s])=>`<span class="${k==='+'?'da':k==='-'?'dd':'dc'}">${k==='='?' ':k==='-'?'−':'+'} ${esc(s)}</span>`).join('')}`).join('')}</pre>${f.truncated?'<p class="claude-note">…diff dài, đã rút gọn.</p>':''}`}</details>`).join('')}</div>`
      :mine&&diff.loading?'<p class="claude-note"><span class="spinner"></span> Đang so sánh…</p>':mine&&diff.err?`<p class="claude-err">${esc(diff.err)}</p>`:'';
    const open=mine&&diff.open;
    return `<div class="section-title">THAY ĐỔI FILE <span>${ch.length} file · ${summary}</span></div>
      ${u?`<div class="pv-undone">↩ Đã hoàn tác ${u.restored} file lúc ${new Date(u.at).toLocaleTimeString('vi-VN')}${u.skipped?.length?`. Bỏ qua ${u.skipped.length} file: ${u.skipped.map(s=>`<code>${esc(s.path)}</code> (${esc(s.why)})`).join(', ')}`:''}</div>`:''}
      <div class="pv-chlist">${ch.slice(0,12).map(c=>`<span class="dst ${!c.b?'added':!c.a?'deleted':'modified'}">${DIFF_KIND[!c.b?'added':!c.a?'deleted':'modified']}</span>${c.a&&!u?`<a class="dlink" href="${fileUrl(j.rid,c.path)}" download title="Tải file này về"><code>${esc(c.path)}</code> ⬇</a>`:`<code>${esc(c.path)}</code>`}`).join('<br>')}${ch.length>12?`<br><em>… và ${ch.length-12} file khác</em>`:''}</div>
      <div class="pv-actions left"><button class="ghost" data-pv="diff">${open?'▴ Ẩn diff':'▾ Xem diff từng dòng'}</button>${!u&&!live?'<button class="ghost danger" data-pv="undo">↩ Hoàn tác thay đổi của việc này</button>':''}${live?'<span class="claude-note">Hoàn tác được khi việc dừng hoặc xong.</span>':''}</div>
      ${open?files:''}`;
  }

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
    if(lh!==lastList&&setHTML(list,lh))lastList=lh;
    if(!j){detail.innerHTML=lastDetail=`<div class="pv-empty"><p>${esc(a.name)} chưa có việc nào.</p><button class="assign" data-pv="assign">✦ Giao việc cho ${esc(a.name)}</button></div>`;lastLogLen=-1;return}
    const t=j.remote&&full&&full.id===j.rid?full:null,live=GROUP[j.status]==='running',isAsk=!!(t?.asking||j.asking)&&live;
    const asking=t?.asking?t.thread?.at(-1):null,started=asking?Date.parse(asking.started||asking.at):t?.started?Date.parse(t.started):null,end=asking||!t?.finished?Date.now():Date.parse(t.finished);
    const chips=j.remote?[`💻 ${esc(j.host||'Máy cá nhân')}`,`📁 <span title="${esc(j.cwd)}">${esc(j.cwd)}</span>`,`🔒 ${j.mode==='acceptEdits'?'Được sửa file':'Chỉ đọc'}`,j.web?`🌐 Trình duyệt${j.siteLabels?.length?' · 🔑 '+esc(j.siteLabels.join(', ')):''}`:'',started?`⏱ ${dur(end-started)}`:'⏱ chưa bắt đầu',`🔧 ${j.steps} bước`,j.turns!=null?`${j.turns} lượt`:'',j.costUsd!=null?`$${j.costUsd.toFixed(3)}`:''].filter(Boolean):['🎲 Mô phỏng',`Tiến độ ${j.progress}%`];
    const log=t?.log||[],t0=log[0]?.at||started;
    // keep the user's scroll position in the log unless they were following the bottom
    const box=detail.querySelector('.pv-log'),follow=!box||box.scrollHeight-box.scrollTop-box.clientHeight<40,keepTop=box?.scrollTop;
    const html=`<div class="pv-top"><span class="badge ${live?'running':j.status==='done'?'done':'error'}">${STATUS[j.status]}</span><span class="pv-prio">${esc(j.priority)}</span><span class="pv-time">Giao lúc ${j.created.toLocaleString('vi-VN')}</span></div>
      <div class="pv-task">${esc(j.text)}</div>
      <div class="pv-chips">${chips.map(c=>`<span>${c}</span>`).join('')}</div>
      ${j.status==='waiting'?`<div class="pv-now pv-waitq">❓ ${esc(a.name)} đang chờ bạn trả lời câu hỏi bên dưới và sẽ không làm tiếp cho đến khi bạn trả lời.</div>`:live&&!isAsk?`<div class="pv-now">${j.status==='queued'?'⏳ Đang chờ đến lượt chạy…':`<span class="spinner"></span> ${esc(j.remote?j.activity||'Đang xử lý…':'Đang xử lý (mô phỏng)…')}`}</div><div class="progress ${j.remote?'live':''}"><i style="width:${j.progress}%"></i></div>`:''}
      ${live&&!isAsk?permBlock(a,t?.perms||j.perms):''}${todoBlock(t?.todos||j.todos)}
      ${j.remote?`<div class="section-title">NHẬT KÝ THỰC HIỆN <span>${log.length} mục</span></div><div class="pv-log">${log.length?log.map(e=>`<div class="pv-row k-${e.kind}"><time>+${dur(e.at-t0)}</time><i title="${KIND[e.kind]||''}">${ICON[e.kind]||'•'}</i><div>${e.kind==='text'?md(e.text):esc(e.text)}</div></div>`).join(''):`<p class="empty">${t?'Chưa có bước nào.':'Đang tải nhật ký…'}</p>`}${live&&j.status!=='queued'&&j.status!=='waiting'?'<div class="pv-row k-wait"><time></time><i><span class="spinner"></span></i><div>Đang chờ bước tiếp theo…</div></div>':''}</div>`:'<p class="claude-note">Việc mô phỏng không có nhật ký thật. Chọn nơi thực thi “Máy cá nhân” để xem từng bước Claude Code thực hiện.</p>'}
      ${j.web?`<div class="section-title">ẢNH CHỤP TRÌNH DUYỆT <span>${shots.length} ảnh</span></div>${shots.length?`<div class="pv-shots">${shots.map(s=>{const u=`/api/machine/tasks/${j.rid}/shots/${encodeURIComponent(s.name)}`;return `<a href="${u}" target="_blank" rel="noopener" title="${esc(new Date(s.at).toLocaleTimeString('vi-VN'))}"><img src="${u}" alt="Ảnh chụp" loading="lazy"><span>${esc(new Date(s.at).toLocaleTimeString('vi-VN'))}</span></a>`}).join('')}</div>`:'<p class="claude-note">Chưa có ảnh chụp nào.</p>'}`:''}
      ${j.status==='waiting'&&(t?.question||j.question)?.kind==='login'&&loginBox?`<div class="section-title">CẦN TÀI KHOẢN ĐĂNG NHẬP</div>${loginBox({...j,question:t?.question||j.question})}`:j.status==='waiting'?`<div class="section-title">CẦN BẠN TRẢ LỜI</div><div class="qbox pv-q-box"><p>${esc((t?.question||j.question)?.q||'')}</p>${((t?.question||j.question)?.options||[]).length?`<div class="qopts">${optionButtons(j.key,(t?.question||j.question).options,'data-pv-answer',esc)}</div>`:''}<form class="pv-ask pv-answer"><textarea data-keep="ans-${j.key}" rows="2" maxlength="4000" placeholder="${esc(fillPlaceholder(j.key,'Hoặc tự nhập câu trả lời / thông tin bổ sung… (Enter gửi, / chọn skill)'))}"></textarea><button type="button" class="ghost pv-skill" data-pv-skill title="Chọn skill (hoặc gõ / trong ô)">🧩</button><button class="assign" type="submit">Gửi</button></form></div>`:''}
      ${(t?.clarify||j.clarify||[]).length?`<div class="section-title">ĐÃ TRAO ĐỔI <span>${(t?.clarify||j.clarify).length} câu</span></div><div class="pv-thread">${(t?.clarify||j.clarify).map(x=>`<div class="pv-a"><b>❓ ${esc(x.q)}</b></div><div class="pv-q">${esc(x.answer)}</div>`).join('')}</div>`:''}
      ${(t?.designs||j.designs||[]).length?designBlock(j,t?.designs||j.designs):''}
      ${j.rework?`<div class="pv-rework">↩ Đã trả lại cho <b>${esc(j.rework.to.join(', '))}</b> để sửa: ${esc(j.rework.reason)}</div>`:''}
      ${j.status==='done'||isAsk&&j.result?`<div class="section-title">KẾT QUẢ</div><div class="jobresult pv-result"><div class="restext md">${j.remote?linkFiles(md(j.result),j.rid,j.outFiles):esc(j.result)}</div></div>${j.remote?downloadList(j.rid,j.outFiles):''}`:''}
      ${j.remote?changeBlock(j,t,live):''}
      ${j.remote&&j.kind!=='plan'&&(j.status==='done'||t?.thread?.length)?askBlock(a,j,t,isAsk):''}
      ${GROUP[j.status]==='error'?`<div class="section-title">${j.status==='cancelled'?'ĐÃ DỪNG':'LỖI'}</div><div class="joberr">${esc(j.error)}</div>`:''}
      <div class="pv-actions">${live&&j.remote?`<button class="ghost" data-pv="cancel">■ Dừng việc này</button>`:''}${GROUP[j.status]==='error'?`<button class="assign" data-pv="retry">⟲ Thử lại</button>`:''}<button class="ghost" data-pv="assign">✦ Giao việc mới cho ${esc(a.name)}</button></div>`;
    if(html===lastDetail)return;
    // the popup's own scroll: same task → stay where the reader is, or stay at the bottom (like a chat) when they were
    // there; content that briefly changes height (the answer arriving, images) must not pull the view up
    const same=shownKey===j.key,top=detail.scrollTop,atEnd=detail.scrollHeight-top-detail.clientHeight<48;
    // typed text, caret and focus in the answer/ask boxes survive the re-render (see dom-keep.js)
    if(!setHTML(detail,html))return;
    lastDetail=html;shownKey=j.key;
    if(toBottom||same&&atEnd&&top>0)detail.scrollTop=detail.scrollHeight;else if(same)detail.scrollTop=top;
    toBottom=false;
    // a new question from the agent: bring its answer box into view and put the cursor there
    const qa=detail.querySelector('.loginbox [data-login-user]')||detail.querySelector('.pv-answer textarea')||detail.querySelector('.pv-ask[data-q] textarea');
    const qk=qa?qa.dataset.keep+'|'+(j.status==='waiting'?(t?.question||j.question)?.q:t?.thread?.at(-1)?.question?.q):'';
    if(qa&&qk!==focusedQ){const a=document.activeElement;qa.scrollIntoView({block:'nearest'});if(!a||a===document.body||(modal.contains(a)&&!a.matches('textarea,input')))qa.focus({preventScroll:true})}
    focusedQ=qk;
    const nb=detail.querySelector('.pv-log');
    if(nb){if(follow&&(log.length!==lastLogLen||live))nb.scrollTop=nb.scrollHeight;else if(keepTop!=null)nb.scrollTop=keepTop}
    lastLogLen=log.length;
  }

  // Design images: thumbnails (click = full size), a mark per image for the developers, and a hand-over button
  function designBlock(j,ds){
    const n=ds.filter(d=>d.marked).length,url=d=>`/api/machine/tasks/${j.rid}/designs/${encodeURIComponent(d.png)}`;
    return `<div class="section-title">ẢNH THIẾT KẾ CHO DEV <span>${ds.length} ảnh · ${n} đã chọn</span></div>
      <div class="pv-designs">${ds.map(d=>`<figure class="${d.marked?'on':''}"><a href="${url(d)}" target="_blank" rel="noopener"><img src="${url(d)}" alt="${esc(d.title)}" loading="lazy"></a>
        <figcaption><b title="${esc(d.src)}">${esc(d.title)}</b><label><input type="checkbox" data-design="${esc(d.png)}" ${d.marked?'checked':''}> Dev code theo ảnh này</label></figcaption></figure>`).join('')}</div>
      <div class="pv-actions pv-dacts"><button class="ghost" data-pv="dall">${n===ds.length?'Bỏ chọn tất cả':'Chọn tất cả'}</button>${j.status==='done'&&n?`<button class="assign" data-pv="dhand">💻 Giao dev code theo ${n} ảnh đã chọn</button>`:''}</div>`;
  }
  detail.addEventListener('change',async e=>{const c=e.target.closest('[data-design]');if(!c)return;const j=current();if(j){await onDesignMark?.(j,{png:c.dataset.design,marked:c.checked});full=null;lastDetail='';tick()}});
  // Conversation after the result: each follow-up question and its answer, then a box to ask more
  function askBlock(a,j,t,isAsk){
    const th=t?.thread||[];
    const items=th.map(x=>`<div class="pv-q"><b>Bạn hỏi</b>${esc(x.q)}</div>${x.answer?`<div class="pv-a md">${md(x.answer)}</div>`:x.error?`<div class="joberr">${esc(x.error)}</div>`:`<div class="pv-a wait"><span class="spinner"></span> ${esc(isAsk&&j.status==='running'&&j.activity&&!/^Đang trả lời câu hỏi thêm/.test(j.activity)?j.activity:`${a.name} đang trả lời…`)}</div>`}`).join('');
    const q=(t?.status||j.status)==='done'?th.at(-1)?.question:null;// the agent ended its answer with a question for the user
    return `<div class="section-title">HỎI THÊM <span>${th.length?th.length+' câu':'AI nhớ ngữ cảnh của việc này'}</span></div>${items?`<div class="pv-thread">${items}</div>`:''}
      ${q?`<div class="qbox pv-q-box"><b>❓ ${esc(a.name)} cần bạn trả lời</b><p>${esc(q.q)}</p>${q.options?.length?`<div class="qopts">${optionButtons(j.key+':ask',q.options,'data-pv-ask',esc)}</div>`:''}</div>`:''}
      ${isAsk?permBlock(a,t?.perms||j.perms):''}
      ${j.status==='done'||t?.status==='done'||isAsk?`<form class="pv-ask"${q?' data-q':''}><textarea data-keep="ask-${j.key}" rows="2" maxlength="8000" placeholder="${q?esc(fillPlaceholder(j.key+':ask',`Trả lời ${a.name}… (Enter gửi, Shift+Enter xuống dòng, / chọn skill)`)):`Hỏi thêm ${esc(a.name)} về việc này, không cần mô tả lại… (Enter gửi, Shift+Enter xuống dòng, / chọn skill)`}"></textarea><button type="button" class="ghost pv-skill" data-pv-skill title="Chọn skill (hoặc gõ / trong ô)">🧩</button><button class="assign" type="submit"${isAsk?` disabled title="Chờ ${esc(a.name)} trả lời xong câu trước"`:''}>${isAsk?'Đang trả lời…':'Gửi'}</button></form>`:''}`;
  }
  detail.addEventListener('submit',async e=>{
    e.preventDefault();
    const need=()=>{toast('Nhập thông tin vào ô bên dưới rồi bấm Gửi');e.target.querySelector('textarea')?.focus()};
    if(e.target.classList.contains('pv-answer')){const box=e.target.querySelector('textarea'),j=current();if(!j)return;const text=composeAnswer(j.key,box.value);if(text===null)return need();if(text){await onAnswer?.(j,text);box.value='';full=null;lastDetail='';tick()}return}
    const box=e.target.querySelector('textarea'),btn=e.target.querySelector('button'),j=current(),q=e.target.hasAttribute('data-q')&&j?composeAnswer(j.key+':ask',box.value):box.value.trim();if(q===null)return need();
    if(!q||!j?.remote||!onAsk)return;
    btn.disabled=box.disabled=true;
    try{await onAsk(j,q);box.value='';full=null;lastDetail='';toBottom=true;tick()}catch{}finally{btn.disabled=box.disabled=false;box.focus({preventScroll:true})}
  });
  detail.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.target.matches('.pv-ask textarea, .pv-answer textarea')){e.preventDefault();if(!e.target.form.querySelector('button[type=submit]')?.disabled)e.target.form.requestSubmit()}});

  modal.addEventListener('click',async e=>{
    if(e.target===modal)return close();
    const item=e.target.closest('[data-key]');if(item){jobKey=item.dataset.key;full=null;lastLogLen=-1;lastList=lastDetail='';detail.innerHTML='';tick();return}
    const pf=e.target.closest('[data-fill]');if(pf){const k=pf.dataset.fill;toggleFill(k,pf.dataset.text);lastDetail='';render();detail.querySelector(k.endsWith(':ask')?'.pv-ask[data-q] textarea':'.pv-answer textarea')?.focus();return}
    const pa=e.target.closest('[data-pv-answer]');if(pa){const j=current();if(j){await onAnswer?.(j,pa.dataset.pvAnswer);full=null;lastDetail='';tick()}return}
    const lg=e.target.closest('[data-login]');if(lg){const j=current();if(j&&onLogin){await onLogin(j,lg.closest('.loginbox'));full=null;lastDetail='';tick()}return}
    const pp=e.target.closest('[data-pv-perm]');if(pp){const j=current(),[pid,mode]=pp.dataset.pvPerm.split('|');if(j&&onPerm){pp.closest('.permbox')?.classList.add('busy');await onPerm(j,pid,+mode);full=null;lastDetail='';tick()}return}
    const pk=e.target.closest('[data-pv-ask]');if(pk){const j=current();if(j?.remote&&onAsk)try{await onAsk(j,pk.dataset.pvAsk);full=null;lastDetail='';toBottom=true;tick()}catch{}return}
    const sk=e.target.closest('[data-pv-skill]');if(sk){const ta=sk.closest('form')?.querySelector('textarea');if(ta&&onSkill)onSkill(ta);return}
    const b=e.target.closest('[data-pv]');if(!b)return;
    const act=b.dataset.pv,j=current();
    if(act==='close')close();
    else if(act==='assign'){close();onAssign(agentId)}
    else if(act==='cancel'&&j){await onCancel(j);tick()}
    else if(act==='diff'&&j){const t=full&&full.id===j.rid?full:null;if(diff.key===j.key&&diff.sig===changeSig(t)&&diff.open){diff.open=false;lastDetail='';render()}else if(diff.key===j.key&&diff.sig===changeSig(t)&&diff.files){diff.open=true;lastDetail='';render()}else loadDiff(j,t)}
    else if(act==='undo'&&j){
      const n=full?.changes?.length||0;
      if(!confirm(`Hoàn tác ${n} file mà việc này đã thay đổi?\n\nFile mới tạo sẽ bị xóa, file bị sửa/xóa được trả về như trước khi việc chạy. File bạn đã sửa tiếp sau khi việc kết thúc sẽ được giữ nguyên.`))return;
      try{const r=await machineApi(`/tasks/${j.rid}/undo`,{method:'POST'});toast(`↩ Đã hoàn tác ${r.restored.length} file${r.skipped.length?`, bỏ qua ${r.skipped.length} file`:''}`);full=r.task;diff={key:null};lastDetail='';render()}
      catch(err){toast(err.message)}
    }
    else if(act==='dall'&&j){const ds=(full?.designs||j.designs||[]);await onDesignMark?.(j,{all:ds.some(d=>!d.marked)});full=null;lastDetail='';tick()}
    else if(act==='dhand'&&j){close();onDesignHandoff?.(j)}
    else if(act==='retry'&&j){await onRetry(j);full=null;setTimeout(tick,600)}
  });
  addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen())close()});
  return {open,close,isOpen,refresh:()=>{if(isOpen())render()}};
}
