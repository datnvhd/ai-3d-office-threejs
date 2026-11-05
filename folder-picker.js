// Folder picker backed by /api/machine/fs: browse drives and sub-folders of this computer (Git/SVN folders are marked)
// and pick one as the working folder. Resolves with the chosen absolute path, or null when closed.
import {machineApi} from './machine-connect.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VCS={git:'<span class="vcsb git">Git</span>',svn:'<span class="vcsb svn">SVN</span>'};
const tail=p=>p.split(/[\\/]/).filter(Boolean).pop()||p;

export function openFolderPicker({start='',title='Chọn thư mục làm việc'}={}){
  return new Promise(done=>{
    const modal=document.createElement('div');modal.className='modal fp';
    modal.innerHTML=`<div class="guide claude-box fp-box"><button class="close" data-fp="close">✕</button><div class="panel-kicker">${esc(title)}</div>
      <div class="fp-bar"><button class="ghost" data-fp="up" title="Lên thư mục cha">⬆</button><input class="fp-path" spellcheck="false" placeholder="Gõ hoặc dán đường dẫn rồi Enter"><button class="ghost" data-fp="home" title="Ổ đĩa & thư mục hay dùng">🏠</button></div>
      <div class="fp-list"></div><div class="fp-foot"><span class="fp-info"></span><button class="ghost" data-fp="close">Hủy</button><button class="assign" data-fp="pick" disabled>Chọn thư mục này</button></div></div>`;
    document.getElementById('app').appendChild(modal);
    const list=modal.querySelector('.fp-list'),input=modal.querySelector('.fp-path'),info=modal.querySelector('.fp-info'),pickBtn=modal.querySelector('[data-fp="pick"]');
    let cur={path:'',parent:null};
    const finish=v=>{modal.remove();removeEventListener('keydown',onKey,true);done(v)};
    const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();finish(null)}};
    addEventListener('keydown',onKey,true);

    async function go(path){
      list.innerHTML='<p class="claude-note"><span class="spinner"></span> Đang đọc thư mục…</p>';
      try{cur=await machineApi('/fs?path='+encodeURIComponent(path||''))}
      catch(e){list.innerHTML=`<p class="claude-err">${esc(e.message)}</p>`;return}
      input.value=cur.path;pickBtn.disabled=!cur.path;
      if(!cur.path){
        const group=(t,items)=>items.length?`<div class="fp-group">${t}</div>${items.map(p=>`<button class="fp-item" data-go="${esc(p)}">📁 <b>${esc(p)}</b></button>`).join('')}`:'';
        list.innerHTML=group('Dùng gần đây',cur.recent||[])+group('Thư mục hay dùng',cur.quick||[])+group('Ổ đĩa',cur.roots||[]);
        info.textContent='Chọn một ổ đĩa hoặc thư mục để mở';return;
      }
      const sep=cur.path.includes('\\')?'\\':'/',baseDir=cur.path.replace(/[\\/]+$/,'');
      list.innerHTML=cur.dirs.length?cur.dirs.map(d=>`<button class="fp-item" data-go="${esc(baseDir+sep+d.name)}">📁 ${esc(d.name)} ${VCS[d.vcs]||''}</button>`).join(''):'<p class="claude-note">Không có thư mục con.</p>';
      info.innerHTML=`${cur.vcs?.kind?`${VCS[cur.vcs.kind]} thuộc bản ${cur.vcs.kind==='git'?'Git':'SVN'} tại <code>${esc(tail(cur.vcs.root))}</code>`:'Không quản lý phiên bản'}${cur.writable?'':' · <em class="bad">không ghi được</em>'}`;
      list.scrollTop=0;
    }
    modal.addEventListener('click',e=>{
      if(e.target===modal)return finish(null);
      const g=e.target.closest('[data-go]');if(g)return go(g.dataset.go);
      const b=e.target.closest('[data-fp]');if(!b)return;
      const a=b.dataset.fp;
      if(a==='close')finish(null);
      else if(a==='up')go(cur.parent??'');
      else if(a==='home')go('');
      else if(a==='pick'&&cur.path)finish(cur.path);
    });
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(input.value.trim())}});
    go(start);
  });
}
