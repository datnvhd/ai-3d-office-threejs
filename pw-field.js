// Password boxes of the office (site logins, access password, Google client secret) with an eye button to show them.
// They are text inputs masked with CSS, not type="password": the browser then does not treat the page as a login
// form and stops offering to save or fill passwords; password-manager extensions are told to ignore them too.
// Browsers without CSS masking fall back to type="password".
import {escapeHTML} from './ui-text.js';

const MASK=typeof CSS!=='undefined'&&CSS.supports?.('-webkit-text-security','disc');
const EYE='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="pw-open" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle class="pw-open" cx="12" cy="12" r="3"/><path class="pw-shut" d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.6 9.6 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/></svg>';

// Markup for one password box; attrs are the input's other attributes (id, data-*, placeholder…), already escaped
export function pwField(attrs=''){
  return `<span class="pwf"><input ${attrs} type="${MASK?'text':'password'}" class="pw" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"><button type="button" class="pw-eye" data-pw-eye tabindex="-1" title="Hiện / ẩn mật khẩu" aria-label="Hiện mật khẩu">${EYE}</button></span>`;
}
export const pwAttr=(name,value)=>`${name}="${escapeHTML(value)}"`;

// One listener for every eye button on the page
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-pw-eye]');if(!b)return;
  e.preventDefault();e.stopPropagation();
  const i=b.parentElement.querySelector('input');if(!i)return;
  const show=!i.classList.contains('show');
  i.classList.toggle('show',show);if(!MASK)i.type=show?'text':'password';
  b.setAttribute('aria-label',show?'Ẩn mật khẩu':'Hiện mật khẩu');
  i.focus({preventScroll:true});try{const n=i.value.length;i.setSelectionRange(n,n)}catch{}
},true);
