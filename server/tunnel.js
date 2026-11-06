// Public link through a Cloudflare quick tunnel: `cloudflared tunnel --url http://127.0.0.1:<port>` gives a random
// https://….trycloudflare.com address that reaches this machine from any network, without an account, an open router
// port or a fixed IP. The address changes each time the tunnel starts; the app shows the current one (and its QR code).
// cloudflared is the official build, installed into the app's tools folder when missing (ai-tools.js).
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {toolBin,installTool} from './ai-tools.js';

const URL_RE=/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// onChange() is called whenever the state changes; state(): {state: off|installing|starting|on|error, url, message}
export function createTunnel({onChange=()=>{}}={}){
  let proc=null,st={state:'off'},wantPort=null,restartTimer=null,restarts=0;
  const set=v=>{st=v;onChange()};

  async function start(port){
    wantPort=port;clearTimeout(restartTimer);
    if(proc)return;
    let bin=toolBin('cloudflared');
    if(!bin){
      set({state:'installing',message:'Đang tải Cloudflare Tunnel (cloudflared)…'});
      try{bin=(await installTool('cloudflared',(phase,p)=>{st={state:'installing',message:`${phase} Cloudflare Tunnel${p?` · ${p}%`:'…'}`}})).bin}
      catch(e){set({state:'error',message:`Không cài được Cloudflare Tunnel: ${e.message}`});return}
      if(wantPort==null)return set({state:'off'});// switched off while downloading
    }
    set({state:'starting',message:'Đang tạo link công khai…'});
    // --no-autoupdate: the app keeps cloudflared current itself; no console window on Windows
    const p=spawn(bin,['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${wantPort}`],{cwd:tmpdir(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    proc=p;let log='';
    const read=d=>{log=(log+d).slice(-6000);const m=log.match(URL_RE);if(m&&st.url!==m[0]&&proc===p){restarts=0;set({state:'on',url:m[0]})}};
    p.stdout.on('data',read);p.stderr.on('data',read);
    p.on('error',e=>{if(proc===p){proc=null;set({state:'error',message:`Không chạy được cloudflared: ${e.message}`})}});
    p.on('close',code=>{
      if(proc!==p)return;proc=null;
      if(wantPort==null)return set({state:'off'});
      // dropped (network change, Cloudflare restart): start again, a few times, with a pause; the link will be new
      const why=(log.match(/(?:ERR|error)[^\n]*/gi)||[]).pop()||`mã thoát ${code}`;
      if(restarts++<5){set({state:'starting',message:`Kết nối bị ngắt (${why.slice(0,160)}), đang tạo lại link…`});restartTimer=setTimeout(()=>start(wantPort),5000*restarts)}
      else set({state:'error',message:`Không giữ được link công khai: ${why.slice(0,300)}`});
    });
  }
  function stop(){wantPort=null;restarts=0;clearTimeout(restartTimer);const p=proc;proc=null;try{p?.kill()}catch{}set({state:'off'})}// one process: a plain kill also works while the app quits
  return {start,stop,state:()=>st};
}
