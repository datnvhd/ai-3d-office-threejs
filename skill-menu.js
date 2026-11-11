// "/" menu for skills: typing / at the start of a word in a task or follow-up box lists the skills on this machine
// (personal ~/.claude/skills, Codex, the working folder's .claude/skills). Arrows move, Enter/Tab pick, Esc closes.
// Picking inserts "/name " and the server puts that skill's instructions into the prompt. The menu can also import
// a skill (.zip, .skill or SKILL.md) into ~/.claude/skills and remove a personal one.
const CSS=`.skm{position:fixed;z-index:60;background:#fff;color:#1f2540;border:1px solid #dfe2f0;border-radius:12px;box-shadow:0 14px 40px #1f254033;font-size:13px;display:flex;flex-direction:column;overflow:hidden}
.skm-head{padding:8px 12px;font-size:10.5px;font-weight:700;letter-spacing:.6px;color:#8a92ad;border-bottom:1px solid #eef0f7;display:flex;justify-content:space-between;gap:8px}
.skm-list{overflow-y:auto;padding:4px}
.skm-it{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:8px;cursor:pointer}
.skm-it.on{background:#f1f3fd}
.skm-it b{font-family:Consolas,monospace;font-weight:650;color:#2b3560;white-space:nowrap}
.skm-it p{margin:1px 0 0;color:#6b7390;font-size:11.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.skm-it .skm-t{flex:1;min-width:0}
.skm-src{flex:none;font-size:10px;font-weight:650;color:#7a84b3;background:#eef1ff;border-radius:6px;padding:1px 6px;margin-top:2px}
.skm-src.project{color:#2f7a55;background:#e7f6ee}.skm-src.codex,.skm-src.agents{color:#8a5a12;background:#fbf1de}
.skm-del{flex:none;border:0;background:none;color:#a0a7c0;cursor:pointer;font-size:12px;padding:1px 4px;border-radius:5px;visibility:hidden}
.skm-it:hover .skm-del{visibility:visible}.skm-del:hover{color:#c2453a;background:#fde8e6}
.skm-head span:first-child{flex:1}.skm-head{align-items:center}
.skm-x{flex:none;border:0;background:none;color:#8a92ad;cursor:pointer;font-size:13px;line-height:1;padding:3px 5px;border-radius:6px;margin:-3px -6px -3px 0}.skm-x:hover{background:#f1f2f8;color:#3c4460}
.skm-empty{padding:12px;color:#6b7390;font-size:12px;line-height:1.5}
.skm-foot{border-top:1px solid #eef0f7;padding:6px}
.skm-imp{width:100%;text-align:left;background:none;border:0;padding:7px 9px;border-radius:8px;color:#d2652f;font-weight:650;font-size:12px;cursor:pointer}
.skm-imp:hover,.skm-imp.on{background:#fff2eb}`;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initSkillMenu({api,selector,toast=()=>{}}){
  if(!document.getElementById('skm-css')){const st=document.createElement('style');st.id='skm-css';st.textContent=CSS;document.head.appendChild(st)}
  const box=document.createElement('div');box.className='skm';box.hidden=true;document.body.appendChild(box);
  const file=document.createElement('input');file.type='file';file.accept='.zip,.skill,.md';file.multiple=true;file.hidden=true;document.body.appendChild(file);
  let skills=null,loadedAt=0,loading=null,target=null,start=-1,query='',items=[],idx=0;
  // the "/" the user closed the menu on (Esc, ✕, click away): typing on after it does not reopen it, a new "/" does
  let dismissed=null;
  // a "/" put in by the 🧩 button (removed again when the menu closes untouched), and the last close (the 🧩 button toggles)
  let autoSlash=null,lastClose={el:null,at:0};

  async function load(force){
    if(!force&&skills&&Date.now()-loadedAt<10000)return skills;
    loading||=api('/skills').then(r=>{skills=r.skills||[];loadedAt=Date.now();return skills}).catch(e=>{skills=skills||[];toast('Không tải được danh sách skill: '+e.message);return skills}).finally(()=>{loading=null});
    return loading;
  }
  // the "/word" just before the caret, or null
  function trigger(el){
    const pos=el.selectionStart;if(pos==null||pos!==el.selectionEnd)return null;
    const m=el.value.slice(0,pos).match(/(^|[\s(])\/([\w.-]{0,64})$/);
    return m?{start:pos-m[2].length-1,query:m[2]}:null;
  }
  function filter(){
    const q=query.toLowerCase(),list=skills||[];
    const pre=list.filter(s=>s.name.toLowerCase().startsWith(q)),rest=q?list.filter(s=>!s.name.toLowerCase().startsWith(q)&&(s.name+' '+s.description).toLowerCase().includes(q)):[];
    return [...pre,...rest].slice(0,60);
  }
  function render(){
    items=filter();if(idx>items.length)idx=0;// idx === items.length is the import row
    const n=(skills||[]).length;
    box.innerHTML=`<div class="skm-head"><span>SKILL${query?` · “${esc(query)}”`:''}</span><span>${skills?`${n} skill`:'Đang tải…'} · ↑↓ · Enter · Esc</span><button class="skm-x" data-close title="Đóng (Esc)">✕</button></div>
      ${items.length?`<div class="skm-list">${items.map((s,i)=>`<div class="skm-it${i===idx?' on':''}" data-i="${i}"><div class="skm-t"><b>/${esc(s.name)}</b>${s.description?`<p>${esc(s.description)}</p>`:''}</div><span class="skm-src ${esc(s.source)}" title="Nguồn: ${esc(s.label)}">${esc(s.label)}</span>${s.source==='claude'?`<button class="skm-del" data-del="${esc(s.name)}" title="Xóa skill này khỏi ~/.claude/skills">✕</button>`:''}</div>`).join('')}</div>`
        :`<div class="skm-empty">${!skills?'Đang tải danh sách skill…':n?`Không có skill nào khớp “${esc(query)}”.`:'Chưa có skill nào. Import tệp .zip / .skill / SKILL.md bên dưới, hoặc đặt thư mục skill (có SKILL.md) vào <code>~/.claude/skills</code>.'}</div>`}
      <div class="skm-foot"><button class="skm-imp${idx===items.length?' on':''}" data-imp>＋ Import skill (.zip, .skill, SKILL.md)</button></div>`;
    place();box.querySelector('.skm-it.on, .skm-imp.on')?.scrollIntoView({block:'nearest'});
  }
  function place(){
    if(!target)return;
    const r=target.getBoundingClientRect(),w=Math.min(Math.max(r.width,300),440,innerWidth-16),below=innerHeight-r.bottom-8,above=r.top-8;
    const up=below<220&&above>below,maxH=Math.max(140,Math.min(320,up?above:below));
    Object.assign(box.style,{width:w+'px',maxHeight:maxH+'px',left:Math.max(8,Math.min(r.left,innerWidth-w-8))+'px',top:up?'':(r.bottom+4)+'px',bottom:up?(innerHeight-r.top+4)+'px':''});
  }
  async function open(el,t){
    const fresh=target!==el||box.hidden;target=el;start=t.start;
    if(t.query!==query||fresh){query=t.query;idx=0}
    box.hidden=false;render();
    if(fresh||!skills){await load(fresh);if(target===el&&!box.hidden)render()}
  }
  function close(byUser){
    const el=target;
    if(byUser&&el){
      dismissed={el,start};
      // closed right after the 🧩 button opened it: take its "/" back out
      if(autoSlash?.el===el&&!query&&el.value[autoSlash.start]==='/'&&el.selectionStart===autoSlash.start+1){
        el.setRangeText('',autoSlash.start,autoSlash.start+1,'end');dismissed=null;
      }
    }
    autoSlash=null;box.hidden=true;target=null;
  }
  function pick(s){
    const el=target;if(!el)return;
    const end=el.selectionStart,before=el.value.slice(0,start),after=el.value.slice(end).replace(/^[\w.-]*/,'');
    const ins=`/${s.name}`+(/^\s/.test(after)?'':' ');
    el.value=before+ins+after;const caret=before.length+ins.length;el.setSelectionRange(caret,caret);
    close();el.focus();el.dispatchEvent(new Event('input',{bubbles:true}));
  }
  async function doImport(files){
    for(const f of files){
      try{
        const r=await fetch('/api/machine/skills/import',{method:'POST',headers:{'X-AI-Office':'1','X-Filename':encodeURIComponent(f.name),'Content-Type':'application/octet-stream'},body:f});
        const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Lỗi ${r.status}`);
        skills=d.skills;loadedAt=Date.now();
        toast(`🧩 Đã import ${d.imported.map(x=>'/'+x.name+(x.replaced?' (thay bản cũ)':'')).join(', ')}`);
      }catch(e){toast(`Import ${f.name} thất bại: ${e.message}`)}
    }
    if(target&&!box.hidden){target.focus();render()}
  }
  const matches=el=>el?.matches?.(selector);

  document.addEventListener('input',e=>{
    if(!matches(e.target))return;const t=trigger(e.target);
    if(dismissed&&(!t||dismissed.el!==e.target||dismissed.start!==t.start))dismissed=null;
    if(t&&!dismissed)open(e.target,t);else if(e.target===target)close();
  },true);
  document.addEventListener('keydown',e=>{
    if(box.hidden||e.isComposing&&e.key!=='Escape')return;
    if(e.target!==target){if(target&&!target.isConnected&&matches(e.target))target=e.target;else return}// the box was re-rendered
    const n=items.length+1;// + the import row
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){idx=(idx+(e.key==='ArrowDown'?1:n-1))%n;render()}
    else if(e.key==='Enter'||e.key==='Tab'){if(idx<items.length)pick(items[idx]);else{close();file.click()}}
    else if(e.key==='Escape')close(true);
    else return;
    e.preventDefault();e.stopImmediatePropagation();
  },true);
  // the caret left the "/word" (click, arrow keys) or the box lost focus
  document.addEventListener('selectionchange',()=>{if(!target||box.hidden)return;if(document.activeElement!==target)return;const t=trigger(target);if(!t)close();else if(t.query!==query){query=t.query;start=t.start;idx=0;render()}});
  document.addEventListener('focusout',e=>{if(e.target===target)setTimeout(()=>{if(document.activeElement!==target&&!box.matches(':hover'))close(true)},150)},true);
  // any click outside the list closes it, a click in the text box too (to keep typing without the menu)
  document.addEventListener('pointerdown',e=>{if(!box.hidden&&!box.contains(e.target)){lastClose={el:target,at:Date.now()};close(true)}},true);
  // the window lost focus (another app, a macOS privacy prompt, a file dialog)
  addEventListener('blur',()=>{if(!box.hidden)close(true)});
  addEventListener('resize',()=>{if(!box.hidden)place()});
  document.addEventListener('scroll',()=>{if(!box.hidden){if(target?.isConnected)place();else close()}},true);
  box.addEventListener('pointerdown',e=>e.preventDefault());// keep the cursor in the text box
  box.addEventListener('click',async e=>{
    if(e.target.closest('[data-close]')){const el=target;close(true);el?.focus();return}
    const d=e.target.closest('[data-del]');
    if(d){
      if(!confirm(`Xóa skill /${d.dataset.del} khỏi ~/.claude/skills?\n\nThư mục của skill trên máy sẽ bị xóa.`))return;
      try{skills=(await api(`/skills/${encodeURIComponent(d.dataset.del)}`,{method:'DELETE'})).skills;loadedAt=Date.now();toast(`Đã xóa skill /${d.dataset.del}`);render()}catch(err){toast(err.message)}
      return;
    }
    if(e.target.closest('[data-imp]')){close();file.click();return}
    const it=e.target.closest('[data-i]');if(it)pick(items[+it.dataset.i]);
  });
  file.onchange=()=>{const f=[...file.files];file.value='';if(f.length)doImport(f)};

  // Open the menu from a button: puts "/" at the caret (with a space before it when needed)
  function openFor(el){
    if(lastClose.el===el&&Date.now()-lastClose.at<500){el.focus();return}// the click that just closed it: stay closed
    if(!box.hidden&&target===el){close(true);el.focus();return}
    el.focus();const p=el.selectionStart??el.value.length,b=el.value.slice(0,p),pre=b&&!/\s$/.test(b)?' /':'/';
    el.setRangeText(pre,p,el.selectionEnd??p,'end');dismissed=null;el.dispatchEvent(new Event('input',{bubbles:true}));if(!box.hidden&&target===el)autoSlash={el,start};
  }
  return {openFor,reload:()=>load(true),importFiles:doImport};
}
