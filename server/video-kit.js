// The math video toolbox: a private Python with Manim (animation), edge-tts (Vietnamese voices) and a bundled ffmpeg,
// in ~/.ai-3d-office/video-kit/venv, plus a `mathvid` command (server/video-kit/mathvid.py) put on PATH for the agents.
// Installed the first time a video task runs: with uv when the machine has it (it also fetches Python 3.12),
// otherwise with the machine's Python 3.10–3.13 (venv + pip). Nothing outside that folder is touched.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {onPath} from './ai-tools.js';

const isWin=process.platform==='win32';
export const KIT_DIR=join(homedir(),'.ai-3d-office','video-kit');
const VENV=join(KIT_DIR,'venv'),BIN=join(KIT_DIR,'bin');
const PY=isWin?join(VENV,'Scripts','python.exe'):join(VENV,'bin','python');
export const KIT_SRC=join(dirname(fileURLToPath(import.meta.url)),'video-kit');
const PACKAGES=['manim','edge-tts','imageio-ffmpeg'];

let state={ready:false,checked:false,installing:false,error:null,info:null},pending=null;

function exec(cmd,args,{timeout=15*60e3,cwd=KIT_DIR}={}){
  return new Promise(resolve=>{
    let out='';const p=spawn(cmd,args,{cwd,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    const t=setTimeout(()=>{try{p.kill()}catch{}},timeout);
    p.stdout.on('data',d=>{out=(out+d).slice(-20000)});p.stderr.on('data',d=>{out=(out+d).slice(-20000)});
    p.on('error',e=>{clearTimeout(t);resolve({code:-1,out:e.message})});
    p.on('close',code=>{clearTimeout(t);resolve({code,out})});
  });
}
// `mathvid` for the agents' shell: a small launcher with the absolute paths of this install
function writeLauncher(){
  mkdirSync(BIN,{recursive:true});
  const script=join(KIT_SRC,'mathvid.py');
  // Windows: .cmd for cmd/PowerShell, plus the shell script for Git Bash (the shell Claude Code uses there)
  if(isWin)writeFileSync(join(BIN,'mathvid.cmd'),`@echo off\r\nset PYTHONIOENCODING=utf-8\r\n"${PY}" "${script}" %*\r\n`);
  const sh=p=>p.replace(/\\/g,'/');
  writeFileSync(join(BIN,'mathvid'),`#!/bin/sh\nexport PYTHONIOENCODING=utf-8\nexec "${sh(PY)}" "${sh(script)}" "$@"\n`,{mode:0o755});
  // every agent the server starts inherits PATH
  if(!(process.env.PATH||'').split(delimiter).includes(BIN))process.env.PATH=BIN+delimiter+(process.env.PATH||'');
}
async function check(){
  if(!existsSync(PY))return null;
  const r=await exec(PY,[join(KIT_SRC,'mathvid.py'),'check'],{timeout:120e3});
  try{const i=JSON.parse(r.out.trim().split('\n').pop());return i.manim&&i.ffmpeg&&i.edge_tts?i:null}catch{return null}
}
const uvBin=()=>onPath('uv')||[join(homedir(),'.local','bin',isWin?'uv.exe':'uv'),join(homedir(),'.cargo','bin',isWin?'uv.exe':'uv')].find(existsSync)||null;
// A Python the machine already has that Manim supports (3.10–3.13)
async function systemPython(){
  const tries=isWin?[['py',['-3.12']],['py',['-3.13']],['py',['-3.11']],['python',[]]]:[['python3.12',[]],['python3.13',[]],['python3.11',[]],['python3',[]]];
  for(const [c,a] of tries){const r=await exec(c,[...a,'-c','import sys;print(sys.version_info[:2])'],{timeout:20e3});const m=r.code===0&&r.out.match(/\((\d+), (\d+)\)/);if(m&&+m[1]===3&&+m[2]>=10&&+m[2]<=13)return [c,a]}
  return null;
}
async function install(onStep){
  mkdirSync(KIT_DIR,{recursive:true});
  const uv=uvBin();
  if(uv){
    onStep('Đang cài bộ công cụ video lần đầu: Python 3.12…');
    let r=await exec(uv,['venv','--python','3.12','--allow-existing',VENV]);if(r.code!==0)throw new Error('Không tạo được môi trường Python: '+r.out.trim().split('\n').pop());
    onStep('Đang cài bộ công cụ video lần đầu: Manim, giọng đọc, ffmpeg (khoảng 1 phút)…');
    r=await exec(uv,['pip','install','--python',PY,...PACKAGES]);if(r.code!==0)throw new Error('Không cài được Manim: '+r.out.trim().split('\n').slice(-3).join(' '));
  }else{
    const py=await systemPython();
    if(!py)throw new Error('Máy chưa có Python 3.10–3.13 (hoặc uv) để cài bộ công cụ video. Cài Python 3.12 từ python.org hoặc uv (https://docs.astral.sh/uv/), rồi chạy lại việc.');
    onStep('Đang cài bộ công cụ video lần đầu: môi trường Python…');
    rmSync(VENV,{recursive:true,force:true});
    let r=await exec(py[0],[...py[1],'-m','venv',VENV]);if(r.code!==0)throw new Error('Không tạo được môi trường Python: '+r.out.trim().split('\n').pop());
    onStep('Đang cài bộ công cụ video lần đầu: Manim, giọng đọc, ffmpeg (vài phút)…');
    r=await exec(PY,['-m','pip','install','--disable-pip-version-check','-q',...PACKAGES]);if(r.code!==0)throw new Error('Không cài được Manim: '+r.out.trim().split('\n').slice(-3).join(' ')+(isWin?'':' (Linux/macOS cần thư viện cairo và pango: sudo apt install libcairo2-dev libpango1.0-dev, hoặc brew install cairo pango)'));
  }
}

// {ok, info} when the kit works (installs it the first time), {ok:false, error} otherwise
export function ensureVideoKit(onStep=()=>{}){
  if(state.ready)return Promise.resolve({ok:true,info:state.info});
  return pending||=(async()=>{
    try{
      let info=await check();
      if(!info){state.installing=true;await install(onStep);info=await check();if(!info)throw new Error('Đã cài nhưng bộ công cụ video chưa chạy được (mathvid check thất bại).')}
      writeLauncher();Object.assign(state,{ready:true,checked:true,info,error:null});
      return {ok:true,info};
    }catch(e){Object.assign(state,{ready:false,checked:true,error:e.message});return {ok:false,error:e.message}}
    finally{state.installing=false;pending=null}
  })();
}
export const videoKitState=()=>({ready:state.ready,installing:state.installing,error:state.error,manim:state.info?.manim||null,latex:!!state.info?.latex});
// already installed: put `mathvid` on PATH at start without waiting for a video task
if(existsSync(PY)){writeLauncher();setTimeout(()=>ensureVideoKit().catch(()=>{}),4000).unref?.()}
