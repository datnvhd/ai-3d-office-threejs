// Text helpers shared by the office (src.js) and the phone page (mobile.js): HTML escaping and the small Markdown
// renderer for the agents' answers.
export function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// Minimal Markdown for Claude's answers (escaped first, so only these tags can appear): code blocks, tables, headings, lists, inline code/bold/italic
export function md(src){
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
// ---- downloads of the files a task produced (GET /api/machine/tasks/:id/file?path= and /files.zip) ----
// The agent's checklist as shown: agents often skip ticking the last step, so a finished task shows every step done
export const todosOf=(todos,status)=>{const l=(todos||[]).filter(x=>x.status!=='deleted');return status==='done'?l.map(x=>({...x,status:'completed'})):l};
export const fileUrl=(rid,p)=>`/api/machine/tasks/${rid}/file?path=${encodeURIComponent(p)}`;
const FILE_ICON=[[/\.(mp4|webm|mov)$/i,'🎬'],[/\.(mp3|m4a|wav)$/i,'🎵'],[/\.(xlsx|xlsm|xls|csv|tsv)$/i,'📊'],[/\.(docx?|md|txt|rtf)$/i,'📝'],[/\.pdf$/i,'📕'],[/\.(pptx?|key)$/i,'📽️'],[/\.(png|jpe?g|gif|webp|svg)$/i,'🖼️'],[/\.(zip|rar|7z|gz)$/i,'🗜️']];
const iconOf=p=>FILE_ICON.find(([r])=>r.test(p))?.[1]||'📄';
// "File kết quả" box: each name downloads that file; several files also get a zip of all
export function downloadList(rid,paths){
  if(rid==null||!paths?.length)return '';
  const vid=paths.find(p=>/\.(mp4|webm)$/i.test(p));
  return `${vid?`<div class="dlvideo"><video data-keep="${escapeHTML(`video:${rid}:${vid}`)}" controls playsinline preload="metadata" src="${fileUrl(rid,vid)}&inline=1" title="${escapeHTML(vid)}"></video></div>`:''}<div class="dlfiles"><div class="dlhead">⬇ File kết quả <span>bấm tên file để tải về</span></div>${paths.map(p=>`<a class="dlfile" href="${fileUrl(rid,p)}" download title="Tải về: ${escapeHTML(p)}">${iconOf(p)} <b>${escapeHTML(p.split('/').pop())}</b>${p.includes('/')?`<em>${escapeHTML(p.slice(0,p.lastIndexOf('/')))}</em>`:''}</a>`).join('')}${paths.length>1?`<a class="dlfile all" href="/api/machine/tasks/${rid}/files.zip" download>🗜️ <b>Tải tất cả (.zip)</b></a>`:''}</div>`;
}
// In an answer rendered by md(): a `path` naming a file the task produced becomes a download link
export function linkFiles(html,rid,paths){
  if(rid==null||!paths?.length)return html;
  const unesc=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  return html.replace(/<code>([^<]{1,300})<\/code>/g,(m,c)=>{
    const n=unesc(c).trim().replace(/\\/g,'/').replace(/^\.\//,'');if(!/\.\w{1,6}$/.test(n))return m;
    const p=paths.find(p=>p===n||n.endsWith('/'+p))||(()=>{const by=paths.filter(p=>p.endsWith('/'+n));return by.length===1?by[0]:null})();
    return p?`<a class="dlink" href="${fileUrl(rid,p)}" download title="Tải về: ${escapeHTML(p)}"><code>${c}</code> ⬇</a>`:m;
  });
}
// ---- question options that need the user to type something ("Nhập URL môi trường UAT", "Khác (ghi rõ)…") ----
// Picking one opens the answer box for that value instead of sending the option's text as the answer.
const NEEDS_INPUT=/^\s*(?:nhập|điền|cung cấp|tự nhập|tự điền|ghi rõ|dán|khác|tôi sẽ (?:nhập|điền|cung cấp)|enter|type|provide|specify|paste|other)(?=[\s:,(….]|$)|(?:…|\.\.\.|:)\s*$|<[^<>]+>|\[[^\][]+\]|\(\s*(?:ghi rõ|nhập|điền)[^)]*\)/i;
export const needsInput=o=>NEEDS_INPUT.test(String(o||''));
const fills=new Map();// question box key -> picked option
export const fillOf=k=>fills.get(k)||null;
export const toggleFill=(k,o)=>{if(fills.get(k)===o)fills.delete(k);else fills.set(k,o)};
const fillLabel=o=>String(o).replace(/\s*[:…]+\s*$|\s*\.{3}\s*$/,'').trim();
export const fillPlaceholder=(k,def)=>{const f=fillOf(k);return f?`${fillLabel(f)}… (Enter để gửi)`:def};
// The text to send: the picked option + what was typed; null when an option needs a value that is still empty
export function composeAnswer(k,typed){
  const f=fillOf(k),v=String(typed||'').trim();
  if(!f)return v;if(!v)return null;
  fills.delete(k);return `${fillLabel(f)}: ${v}`;
}
// Option buttons for a question: direct answers carry `attr`, input-type ones carry data-fill
export const optionButtons=(k,options,attr,esc=escapeHTML)=>(options||[]).map(o=>needsInput(o)
  ?`<button class="qopt fill${fillOf(k)===o?' on':''}" data-fill="${esc(k)}" data-text="${esc(o)}" title="Bấm để nhập thông tin này">✎ ${esc(o)}</button>`
  :`<button class="qopt" ${attr}="${esc(o)}">${esc(o)}</button>`).join('');
// ---- tokens a task used (task.tokens from the server: input/cacheRead/cacheWrite/output/total/runs/models) ----
export const tokShort=n=>n>=1e6?(n/1e6).toFixed(n>=1e7?0:1).replace('.',',')+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1).replace('.',',')+'K':String(n||0);
const tokFull=n=>(n||0).toLocaleString('vi-VN');
// Sum of several tasks (a workflow's plan and steps)
export function sumTokens(list){
  const S={input:0,cacheRead:0,cacheWrite:0,output:0,total:0,runs:0,models:{}};let any=false;
  for(const T of list)if(T?.total){any=true;for(const k of ['input','cacheRead','cacheWrite','output','total','runs'])S[k]+=T[k]||0;for(const [m,n] of Object.entries(T.models||{}))S.models[m]=(S.models[m]||0)+n}
  return any?S:null;
}
export const tokenTitle=T=>!T?.total?'':`Tổng ${tokFull(T.total)} token · đầu vào ${tokFull(T.input)} · đọc cache ${tokFull(T.cacheRead)} · ghi cache ${tokFull(T.cacheWrite)} · đầu ra ${tokFull(T.output)} · ${T.runs} lượt chạy`;
// Short tag for cards: "🔢 12K token" with the breakdown on hover
export const tokenTag=T=>T?.total?`<span class="toktag" title="${escapeHTML(tokenTitle(T))}">🔢 ${tokShort(T.total)} token</span>`:'';
