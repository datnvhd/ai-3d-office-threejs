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
