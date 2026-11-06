// Keeps Claude Code and Codex CLI installed and up to date without console windows.
// The CLIs' own auto-update is switched off for the app's runs (DISABLE_AUTOUPDATER, check_for_update_on_startup=false),
// because on Windows it pops up a cmd window in the middle of a task. Instead:
// - on start, what the machine lacks (Node.js, Claude Code, Codex CLI) is installed into the app's tools folder (ai-tools.js);
// - every 6 hours the app looks up the newest versions, asks the user (or updates by itself when allowed) and installs
//   with a hidden window. cliGen() is bumped so every bridge finds the binary again: the next task runs on the new
//   version without restarting the app.
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {cliGen,bumpCli,installTool,isToolPath,toolBin,onPath,useToolNode,TOOL_NAMES} from './ai-tools.js';
export {cliGen};

export const UPDATE_MODES={ask:'Hỏi trước khi cập nhật',auto:'Tự cập nhật ngầm khi rảnh',off:'Không kiểm tra, không tự cài'};
const PKG={claude:'@anthropic-ai/claude-code',codex:'@openai/codex'};
const CHECK_EVERY=6*3600*1000,INSTALL_TIMEOUT=10*60*1000;
const verOf=s=>String(s||'').match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0]||null;
const newer=(a,b)=>{const p=v=>v.split(/[.-]/).slice(0,3).map(Number),x=p(a),y=p(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false};

// How a binary is updated: the app's own copy (or none yet) is installed by the app; otherwise claude's own `update`
// command or npm, as the user installed it; not by the app when it comes with an editor extension
function howToUpdate(engine,bin){
  if(!bin||isToolPath(bin))return {tool:true};
  if(/[\\/]\.(vscode|vscode-insiders|cursor)[\\/]/i.test(bin))return {manual:'Bản đi kèm extension VS Code: cập nhật extension trong VS Code'};
  if(engine==='claude')return {cmd:bin,args:['update']};
  const npm=onPath('npm');
  return npm?{cmd:npm,args:['install','-g',`${PKG.codex}@latest`]}:{tool:true};
}

// getBin(engine) → path, getVersion(engine) → version text, busy(engine) → true while a task runs on it,
// mode() → 'ask'|'auto'|'off', skipped(engine) → version the user chose to skip
export function createUpdater({getBin,getVersion,busy,mode,skipped}){
  const S={node:{},claude:{},codex:{}};
  let lastCheck=0,checking=null;

  async function latest(engine){
    const r=await fetch(`https://registry.npmjs.org/${PKG[engine].replace('/','%2f')}/latest`,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error(`npm registry HTTP ${r.status}`);
    return verOf((await r.json()).version);
  }
  // Looks up the newest versions (at most every 6 hours unless forced)
  function check(force=false){
    if(mode()==='off'&&!force)return Promise.resolve();
    if(checking)return checking;
    if(!force&&Date.now()-lastCheck<CHECK_EVERY)return Promise.resolve();
    checking=(async()=>{
      for(const e of ['claude','codex']){
        try{S[e].latest=await latest(e);S[e].error=null}catch(err){S[e].error=`Không kiểm tra được bản mới: ${err.message}`}
      }
      lastCheck=Date.now();checking=null;auto();
    })();
    return checking;
  }
  const current=e=>verOf(getVersion(e));
  const available=e=>{const c=current(e),l=S[e].latest;return !!(c&&l&&newer(l,c))};

  // Download into the app's tools folder (first install, or update of the app's own copy)
  async function toolInstall(name,verb){
    const s=S[name],from=name==='node'?null:current(name);
    Object.assign(s,{state:'running',message:`Đang ${verb} ${TOOL_NAMES[name]}…`,started:Date.now()});
    try{
      const r=await installTool(name,(phase,p)=>{s.message=`${phase} ${TOOL_NAMES[name]}${p?` · ${p}%`:'…'}`});
      Object.assign(s,{state:'done',message:verb==='cài'?`Đã cài ${TOOL_NAMES[name]} ${r.version}.`:`Đã cập nhật ${TOOL_NAMES[name]}${from?` từ ${from}`:''} lên ${r.version}. Việc tiếp theo dùng bản mới.`,at:Date.now()});
    }catch(e){Object.assign(s,{state:'error',message:`${verb==='cài'?'Cài':'Cập nhật'} ${TOOL_NAMES[name]} chưa được: ${e.message}`})}
  }

  // Hidden install; while a task runs on that engine the update waits and starts once it is idle
  function install(engine){
    const s=S[engine];
    if(s.state==='running')return;
    const how=howToUpdate(engine,getBin(engine));
    if(how.manual){Object.assign(s,{state:'error',message:how.manual});return}
    if(busy(engine)){Object.assign(s,{state:'waiting',message:`Chờ việc đang chạy bằng ${TOOL_NAMES[engine]} xong rồi cập nhật`});return}
    if(how.tool){toolInstall(engine,getBin(engine)?'cập nhật':'cài');return}
    const from=current(engine);
    Object.assign(s,{state:'running',message:`Đang cập nhật ${TOOL_NAMES[engine]}…`,started:Date.now()});
    let out='';
    // a .cmd needs cmd.exe, which splits an unquoted path at its spaces (e.g. "…\Author Software\nvm\…\npm.cmd")
    const shell=/\.(cmd|bat)$/i.test(how.cmd);
    // (the arguments are fixed words without spaces, so one command line is safe)
    const opts={cwd:tmpdir(),env:process.env,windowsHide:true,shell,stdio:['ignore','pipe','pipe']};
    const child=shell?spawn(`"${how.cmd}" ${how.args.join(' ')}`,opts):spawn(how.cmd,how.args,opts);
    const timer=setTimeout(()=>child.kill(),INSTALL_TIMEOUT);
    const take=d=>{out=(out+d).slice(-4000)};
    child.stdout.on('data',take);child.stderr.on('data',take);
    const done=(code,err)=>{
      clearTimeout(timer);
      if(code===0){bumpCli();Object.assign(s,{state:'done',message:`Đã cập nhật ${TOOL_NAMES[engine]}${from?` từ ${from}`:''}${s.latest?` lên ${s.latest}`:''}. Việc tiếp theo dùng bản mới.`,at:Date.now()})}
      else Object.assign(s,{state:'error',message:`Cập nhật ${TOOL_NAMES[engine]} chưa được: ${err||out.trim().split('\n').slice(-3).join(' ')||`mã lỗi ${code}`}`});
    };
    child.on('error',e=>done(-1,e.message));
    child.on('close',code=>{if(s.state==='running')done(code)});
  }

  // On start: install what the machine lacks, one after the other (Node.js first: agents use it for project commands).
  // A tool the user installed elsewhere is never replaced. Skipped when the user chose "Không kiểm tra, không tự cài".
  let setupDone=false;
  async function setup(){
    if(setupDone||mode()==='off')return;setupDone=true;
    useToolNode();
    if(!onPath('node')&&!toolBin('node'))await toolInstall('node','cài');
    for(const e of ['claude','codex'])if(!getBin(e))await toolInstall(e,'cài');
  }
  const missing=()=>['node','claude','codex'].filter(n=>n==='node'?!onPath('node')&&!toolBin('node'):!getBin(n));

  // 'auto' mode: install what is new as soon as the engine is idle; waiting installs start once it is idle
  function auto(){
    for(const e of ['claude','codex']){
      const s=S[e];
      if(s.state==='waiting'&&!busy(e))install(e);
      else if(mode()==='auto'&&available(e)&&s.state!=='running'&&s.state!=='error'&&!busy(e))install(e);
    }
  }
  const timer=setInterval(()=>{check().catch(()=>{});auto()},15000);timer.unref?.();

  const view=()=>({mode:mode(),modes:UPDATE_MODES,checkedAt:lastCheck||null,missing:missing(),
    node:{name:TOOL_NAMES.node,path:onPath('node'),state:S.node.state||'idle',message:S.node.message||null},
    engines:Object.fromEntries(['claude','codex'].map(e=>{const how=howToUpdate(e,getBin(e));
    return [e,{name:TOOL_NAMES[e],current:current(e),latest:S[e].latest||null,available:available(e),skipped:skipped(e)===S[e].latest,canUpdate:!how.manual,manual:how.manual||null,
      appCopy:isToolPath(getBin(e)),state:S[e].state||'idle',message:S[e].message||S[e].error||null}]}))});
  return {check,install,setup,view,auto};
}
