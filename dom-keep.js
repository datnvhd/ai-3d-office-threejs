// Replaces a container's HTML without disturbing what the user is typing: elements marked data-keep="<id>" are moved
// into the new markup as the same nodes (value, caret, undo history stay), focus is given back, and the update is
// skipped while an IME composition is open or a mouse button is held inside the container (a click would be lost).
let composing=false,pressed=null,pressedAt=0;
addEventListener('compositionstart',()=>{composing=true},true);
addEventListener('compositionend',()=>{composing=false},true);
addEventListener('pointerdown',e=>{pressed=e.target;pressedAt=Date.now()},true);
for(const ev of ['pointerup','pointercancel','blur'])addEventListener(ev,()=>{pressed=null},true);

// Returns false when the update was postponed; the caller should try again on its next render.
export function setHTML(el,html){
  const act=document.activeElement,inside=act&&act!==document.body&&el.contains(act);
  if((composing&&inside)||(pressed&&Date.now()-pressedAt<3000&&el.contains(pressed)))return false;
  const kept=new Map();for(const x of el.querySelectorAll('[data-keep]'))kept.set(x.dataset.keep,x);
  let sel=null;
  if(inside&&kept.get(act.dataset?.keep)===act)try{sel=[act.selectionStart,act.selectionEnd,act.selectionDirection]}catch{}
  el.innerHTML=html;
  for(const n of el.querySelectorAll('[data-keep]')){
    const old=kept.get(n.dataset.keep);if(!old||old.tagName!==n.tagName)continue;
    if(n.placeholder!==undefined)old.placeholder=n.placeholder;
    n.replaceWith(old);
  }
  if(inside&&act.isConnected&&document.activeElement!==act){
    act.focus({preventScroll:true});
    if(sel)try{act.setSelectionRange(...sel)}catch{}
  }
  return true;
}
