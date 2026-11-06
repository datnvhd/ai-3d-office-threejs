// Desktop app: serves the built office (dist/) with vite preview, on this computer only, with the same /api bridges as
// the dev server (Claude Code, Codex, task runner), and shows it in a window. Data stays in ~/.ai-3d-office as in dev.
import {app,BrowserWindow,shell,dialog} from 'electron';
import {preview} from 'vite';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {claudeBridge} from '../server/claude-bridge.js';
import {codexBridge} from '../server/codex-bridge.js';
import {machineBridge} from '../server/machine-bridge.js';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const PORT=47820;// fixed so the page's origin (and its localStorage) stays the same between runs; the next free one if taken

// Started from the desktop menu, a Linux/macOS app gets no PATH from the user's shell (nvm, npm -g), so `claude` or
// `codex` would not be found: take it from an interactive login shell (the CLI lookups run later, on first use)
if(process.platform!=='win32')try{
  const out=execFileSync(process.env.SHELL||'/bin/bash',['-ilc','printf "\\n__PATH__%s__PATH__" "$PATH"'],{encoding:'utf8',timeout:8000,stdio:['ignore','pipe','ignore']});
  const m=out.match(/__PATH__(.*)__PATH__/);if(m?.[1])process.env.PATH=m[1];
}catch{}
// Where claude, codex, node, pod, adb and maestro usually live, in case the shell profile did not add them
if(process.platform!=='win32'){
  const home=homedir(),have=new Set((process.env.PATH||'').split(':'));
  const extra=['/opt/homebrew/bin','/usr/local/bin',join(home,'.local','bin'),join(home,'.maestro','bin'),
    ...(process.platform==='darwin'?[join(home,'Library','Android','sdk','platform-tools'),join(home,'Library','Android','sdk','emulator')]:[join(home,'Android','Sdk','platform-tools'),join(home,'Android','Sdk','emulator')])]
    .filter(d=>!have.has(d)&&existsSync(d));
  if(extra.length)process.env.PATH=[process.env.PATH,...extra].filter(Boolean).join(':');
}
// AI_OFFICE_SELFTEST=1: start the server, check the page and the machine API answer, print the result and quit (CI)
const SELFTEST=!!process.env.AI_OFFICE_SELFTEST;

let win=null,server=null;
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
  app.whenReady().then(async()=>{
    try{
      server=await preview({configFile:false,root:ROOT,logLevel:'warn',plugins:[claudeBridge(),codexBridge(),machineBridge()],
        build:{outDir:'dist'},preview:{host:'127.0.0.1',port:PORT,open:false}});
    }catch(e){dialog.showErrorBox('AI 3D Office',`Không khởi động được server: ${e?.message||e}`);app.quit();return}
    const url=server.resolvedUrls.local[0],origin=new URL(url).origin;
    if(SELFTEST){
      let code=0;
      try{
        const page=await fetch(url),html=await page.text();
        const st=await (await fetch(origin+'/api/machine/status',{headers:{'X-AI-Office':'1'}})).json();
        console.log(JSON.stringify({page:page.status,title:(html.match(/<title>([^<]*)/)||[])[1]||null,os:st.host?.os,arch:st.host?.arch,claude:st.claude?.found,browser:st.browser?.channel,mobile:st.mobile||null}));
        if(page.status!==200||!st.host)code=1;
      }catch(e){console.error('SELFTEST lỗi:',e?.message||e);code=1}
      server.close();app.exit(code);return;
    }
    win=new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:600,title:'AI 3D Office',backgroundColor:'#eef0fb',autoHideMenuBar:true,
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    // The office's own links (screenshots, previews) open in a new app window; anything else in the default browser
    win.webContents.setWindowOpenHandler(({url:u})=>{
      if(u.startsWith(origin+'/'))return {action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true}};
      if(/^https?:/i.test(u))shell.openExternal(u);
      return {action:'deny'};
    });
    win.webContents.on('will-navigate',(e,u)=>{if(!u.startsWith(origin+'/')){e.preventDefault();if(/^https?:/i.test(u))shell.openExternal(u)}});
    win.on('closed',()=>{win=null});
    win.loadURL(url);
  });
  app.on('window-all-closed',()=>app.quit());
  // Closing the server also stops running tasks and sign-in processes (the bridges listen for its 'close')
  app.on('before-quit',()=>{server?.close();server=null});
}
