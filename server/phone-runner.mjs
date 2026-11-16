// `apptest`: drives an app already installed on an Android phone plugged into this machine (USB debugging on), through
// adb. Made for agents: one short command per action and a compact screen listing instead of raw UI XML, so testing a
// screen costs few tokens. No app source code needed.
//
//   apptest devices                      phones connected (serial, model, Android version, state)
//   apptest apps [filter]                apps installed by the user (package names)
//   apptest launch <package>             open the app (from its launcher icon)
//   apptest restart <package>            force-stop then open again
//   apptest stop <package>               force-stop
//   apptest screen                       what is on screen: numbered elements with text, id, position
//   apptest tap <target>                 tap: "Text" | id:<resource-id> | desc:<description> | "@<n>" (from `screen`; quoted: PowerShell reads a bare @ as splatting) | <x>,<y>
//                                        not on screen: hides the keyboard, then scrolls down/up to find it
//   apptest type "<text>" [--into <target>] [--clear]   type into the focused field (or tap <target> first; --clear
//                                        empties it first); accents and emoji too, checked by reading the field back;
//                                        the keyboard is hidden afterwards (--keep-keyboard keeps it)
//   apptest hidekb                       hide the on-screen keyboard (only when it is up)
//   apptest key <back|home|enter|tab|del|menu|recent|<keycode>>
//   apptest swipe <up|down|left|right> | <x1>,<y1>,<x2>,<y2>
//   apptest wait "<text>" [--timeout <s>]      wait until the text is on screen (exit 1 when it never shows)
//   apptest shot <name> [--task <id>]    screenshot → the task's "Ảnh chụp" (or ./test-results/phone)
//   apptest log [<package>]              crashes and errors from logcat (since the last `apptest log`/`launch`)
//   apptest info <package>               version, install time, permissions asked
// Options for every command: --device <serial> (when several phones are connected).
import {execFile} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';

const argv=process.argv.slice(2);
const opt=n=>{const i=argv.indexOf(n);if(i<0)return null;const v=argv[i+1];argv.splice(i,2);return v??null};
const flag=n=>{const i=argv.indexOf(n);if(i<0)return false;argv.splice(i,1);return true};
const clear=flag('--clear'),keepKb=flag('--keep-keyboard');
const device=opt('--device')||process.env.ANDROID_SERIAL||null,task=opt('--task'),timeoutS=+(opt('--timeout')||10),into=opt('--into');
const [cmd,...rest]=argv;
const ADB=process.env.APPTEST_ADB||'adb';
const STATE=join(tmpdir(),'ai-office-apptest');mkdirSync(STATE,{recursive:true});

const die=(msg,code=2)=>{console.error(msg);process.exit(code)};
const adbRaw=(args,{timeout=30000,buffer=false}={})=>new Promise(r=>execFile(ADB,[...(device?['-s',device]:[]),...args],
  {timeout,windowsHide:true,maxBuffer:64<<20,encoding:buffer?'buffer':'utf8'},(e,out,err)=>r({e,out,err:String(err||'')})));
async function adb(args,o){
  const r=await adbRaw(args,o);
  if(r.e&&r.e.code==='ENOENT')die('Không tìm thấy adb. Cài Android SDK Platform-Tools rồi thử lại.');
  const m=(r.err||'').trim();
  // phone not reachable: stop with what to do; any other failure is thrown (a grep that matched nothing is just empty)
  if(/more than one device/i.test(m))die('Có nhiều điện thoại đang kết nối: thêm --device <serial> (xem `apptest devices`).');
  if(/no devices|device .* not found|device offline/i.test(m))die('Không thấy điện thoại nào. Cắm cáp USB, bật Gỡ lỗi USB (USB debugging) rồi chạy `apptest devices`.');
  if(/unauthorized/i.test(m))die('Điện thoại chưa cho phép máy tính này: mở khóa điện thoại và bấm "Cho phép" ở hộp thoại Gỡ lỗi USB.');
  if(r.e&&!r.out?.length&&(m||r.e.killed))throw new Error(r.e.killed?'adb không trả lời kịp (hết thời gian chờ).':m.split('\n').pop());
  return r.out||(o?.buffer?Buffer.alloc(0):'');
}
const sh=(line,o)=>adb(['shell',line],o);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=s=>`'${String(s).replace(/'/g,`'\\''`)}'`;// quoting for the phone's shell

// ---------- screen ----------
// a value holding " is written in single quotes (text='say "hi"'); emoji come as &#128512;
const ATTR=/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g;
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#10;/g,' ')
  .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&');
async function dump(){
  for(let i=0;i<3;i++){
    // straight to stdout; some phones only write to a file
    let xml=String(await adb(['exec-out','uiautomator','dump','/dev/tty'],{timeout:20000}));
    if(!xml.includes('<hierarchy')){await sh('uiautomator dump /sdcard/ai-office-ui.xml >/dev/null 2>&1');xml=String(await adb(['exec-out','cat','/sdcard/ai-office-ui.xml']))}
    const s=xml.indexOf('<hierarchy'),e=xml.lastIndexOf('</hierarchy>');
    if(s>=0&&e>s)return parse(xml.slice(s,e+12));
    await sleep(700);// "could not get idle state": the screen is still animating
  }
  die('Không đọc được màn hình (uiautomator). Mở khóa điện thoại, tắt màn hình chờ rồi thử lại.',1);
}
function parse(xml){
  const els=[];
  for(const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)){
    const a={};for(const [,k,v1,v2] of m[1].matchAll(ATTR))a[k]=unxml(v1??v2);
    const b=(a.bounds||'').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);if(!b)continue;
    const [x1,y1,x2,y2]=b.slice(1).map(Number);if(x2<=x1||y2<=y1)continue;
    const cls=(a.class||'').split('.').pop(),edit=/EditText|AutoCompleteTextView/.test(cls);
    const el={text:a.text||'',desc:a['content-desc']||'',id:(a['resource-id']||'').replace(/^[\w.]+:id\//,''),cls,pkg:a.package||'',
      x:Math.round((x1+x2)/2),y:Math.round((y1+y2)/2),box:[x1,y1,x2,y2],click:a.clickable==='true'||a['long-clickable']==='true',edit,
      scroll:a.scrollable==='true',checked:a.checkable==='true'?a.checked==='true':null,on:a.enabled!=='false',focus:a.focused==='true',pw:a.password==='true'};
    if(el.text||el.desc||el.click||el.edit||el.scroll)els.push(el);
  }
  // a tappable row or card without its own text: name it after the first text inside it (a list row → its title)
  for(const e of els)if(e.click&&!e.text&&!e.desc){
    const [x1,y1,x2,y2]=e.box,c=els.find(o=>o!==e&&(o.text||o.desc)&&o.x>=x1&&o.x<=x2&&o.y>=y1&&o.y<=y2);
    if(c)e.inner=c.text||c.desc;
  }
  return els;
}
const label=e=>e.text||e.desc;
function show(els,top){
  const lines=els.map((e,i)=>{
    const kind=e.edit?'Ô nhập':e.checked!==null?(e.checked?'☑':'☐'):e.click?/Button|ImageView/.test(e.cls)?'Nút':'Bấm được':e.scroll?'Cuộn được':'Chữ';
    const t=label(e)?`"${label(e).slice(0,80)}"`:e.inner?`[chứa "${e.inner.slice(0,60)}"]`:'';
    const extra=[e.id&&`id=${e.id}`,e.desc&&e.text&&`desc="${e.desc.slice(0,40)}"`,e.pw&&'mật khẩu',e.focus&&'đang chọn',!e.on&&'bị khóa'].filter(Boolean).join(' ');
    return `@${i} ${kind} ${t} ${extra} (${e.x},${e.y})`.replace(/\s+/g,' ').trim();
  });
  console.log(`${top}\n${lines.join('\n')||'(màn hình trống hoặc chưa tải xong)'}`);
}
async function focusApp(){
  const w=String(await sh('dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -n 2').catch(()=>''));
  // package/activity; a system window (a "not responding" dialog…) has only a title
  const m=w.match(/([\w.]+)\/([\w.$]+)/);return m?`${m[1]}/${m[2]}`:(w.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)||[])[1]||'?';
}

// tap target: @n | x,y | id:… | desc:… | text (exact first, then contains; case and accents kept)
async function find(target){
  let m;
  if((m=String(target).match(/^(\d+)\s*,\s*(\d+)$/)))return {x:+m[1],y:+m[2],name:`(${m[1]},${m[2]})`};
  if((m=String(target).match(/^@(\d+)$/))){
    let els;try{els=JSON.parse(readFileSync(join(STATE,`screen-${device||'default'}.json`),'utf8'))}catch{die('Chưa có danh sách màn hình: chạy `apptest screen` trước khi dùng @số.')}
    const e=els[+m[1]];if(!e)die(`Không có phần tử @${m[1]} (chạy lại \`apptest screen\`).`);return {...e,name:label(e)||e.id||`@${m[1]}`};
  }
  const t=String(target),low=t.toLowerCase();
  const match=els=>t.startsWith('id:')?els.find(e=>e.id===t.slice(3)||e.id.endsWith(t.slice(3))):t.startsWith('desc:')?els.find(e=>e.desc.toLowerCase().includes(t.slice(5).toLowerCase()))
    :els.find(e=>label(e)===t)||els.find(e=>label(e).toLowerCase()===low)||els.find(e=>label(e).toLowerCase().includes(low))||els.find(e=>e.id.toLowerCase().endsWith(low));
  const found=(e,how='')=>({...e,name:label(e)||e.id,how});
  // 1. a few seconds for a screen still loading
  const deadline=Date.now()+timeoutS*1000,first=Date.now()+Math.min(3,timeoutS)*1000;let els;
  for(;;){els=await dump();save(els);const e=match(els);if(e)return found(e);if(Date.now()>first)break;await sleep(700)}
  // 2. the keyboard covers the lower part of the screen: put it away and look again
  if(await hideKeyboard()){els=await dump();save(els);const e=match(els);if(e)return found(e,'ẩn bàn phím')}
  // 3. further down the page (or back up): scroll a little at a time until it shows or the page stops moving
  for(const dir of ['down','up']){
    for(let i=0;i<8;i++){
      const before=sig(els);await scroll(els,dir);els=await dump();save(els);
      const e=match(els);if(e)return found(e,`cuộn ${dir==='down'?'xuống':'lên'}`);
      if(sig(els)===before)break;// end of the page
    }
  }
  // 4. the rest of the time: it may still appear (slow network, animation)
  while(Date.now()<deadline){await sleep(800);els=await dump();save(els);const e=match(els);if(e)return found(e)}
  console.error(`Không thấy "${t}" trên màn hình (đã chờ ${timeoutS} giây, ẩn bàn phím và cuộn cả trang). Các phần tử đang có:`);show(els.slice(0,40),'');process.exit(1);
}
// what the screen shows, to tell whether a scroll moved anything
const sig=els=>els.map(e=>`${label(e)}|${e.id}|${e.y}`).join('\n');
// half a screen inside the biggest scrollable area (or the middle of the screen); down = finger moves up
async function scroll(els,dir){
  const s=els.filter(e=>e.scroll).sort((a,b)=>(b.box[2]-b.box[0])*(b.box[3]-b.box[1])-(a.box[2]-a.box[0])*(a.box[3]-a.box[1]))[0];
  const [x1,y1,x2,y2]=s?s.box:[0,300,1080,1700],x=Math.round((x1+x2)/2),h=y2-y1;
  const a=Math.round(y1+h*.72),b=Math.round(y1+h*.28);
  await sh(`input swipe ${x} ${dir==='down'?a:b} ${x} ${dir==='down'?b:a} 450`);await sleep(700);
}
// Is the on-screen keyboard up? Only fields that are false while it is hidden (mIsInputViewShown stays true on some
// phones). null when the phone does not say.
async function keyboardShown(){
  const d=String(await sh('dumpsys input_method | grep -E "mInputShown|mImeWindowVis"').catch(()=>''));
  if(/mInputShown=true/.test(d)||/mImeWindowVis=(0x)?[1-9a-f]/i.test(d))return true;
  const w=String(await sh('dumpsys window InputMethod | grep -E "isVisible="').catch(()=>''));
  if(/isVisible=true/.test(w))return true;
  return /mInputShown=false/.test(d)||/isVisible=false/.test(w)?false:null;
}
// Back closes the keyboard when it is up; when it is not, Back would leave the screen, so it is only pressed then
async function hideKeyboard(){
  if(await keyboardShown()!==true)return false;
  await sh('input keyevent 4');await sleep(500);return true;
}
const save=els=>{try{writeFileSync(join(STATE,`screen-${device||'default'}.json`),JSON.stringify(els))}catch{}};
const markLog=async()=>{const t=String(await sh('date +%m-%d\\ %H:%M:%S.000').catch(()=>'')).trim();if(t)writeFileSync(join(STATE,`log-${device||'default'}.txt`),t)};

// ---------- typing any text (server/phone-text: a small program run as the adb shell user, nothing installed) ----------
const DEX=new URL('./phone-text/apptest-text.dex',import.meta.url);
async function helper(text){
  // read here (works from inside the desktop app's archive) and pushed from a real file: adb cannot read the archive
  const bytes=readFileSync(DEX),remote=`/data/local/tmp/apptest-text-${bytes.length}.dex`;
  if(!String(await sh(`ls ${remote} 2>/dev/null`)).includes(remote)){
    const local=join(STATE,'apptest-text.dex');writeFileSync(local,bytes);await adb(['push',local,remote]);
  }
  const out=String(await sh(`CLASSPATH=${remote} app_process / AppTestText ${Buffer.from(text,'utf8').toString('base64')}`,{timeout:20000}));
  if(!/^ok/m.test(out))die(`Không gõ được chữ có dấu: ${out.trim().split('\n').pop()||'trình gõ trên điện thoại không trả lời'}`,1);
}
// The field being typed into: the one --into named, else the focused one (null when none is found)
async function field(target){
  const els=await dump();save(els);
  return (target&&els.find(e=>e.edit&&Math.abs(e.x-target.x)<3&&Math.abs(e.y-target.y)<3))||els.find(e=>e.edit&&e.focus)||null;
}

const KEYS={back:4,home:3,enter:66,tab:61,del:67,delete:67,menu:82,recent:187,up:19,down:20,left:21,right:22,space:62,search:84,power:26,escape:111};

async function main(){
  switch(cmd){
    case 'devices':{
      const out=String(await adbRaw(['devices','-l']).then(r=>{if(r.e?.code==='ENOENT')die('Không tìm thấy adb.');return r.out}));
      const list=out.split('\n').slice(1).map(l=>l.trim()).filter(Boolean).map(l=>{const [serial,state]=l.split(/\s+/);return {serial,state,model:(l.match(/model:(\S+)/)||[])[1]||''}});
      if(!list.length)return console.log('Không có điện thoại nào. Cắm cáp USB và bật Gỡ lỗi USB (Tùy chọn nhà phát triển).');
      for(const d of list){
        let ver='';if(d.state==='device')ver=String((await adbRaw(['-s',d.serial,'shell','getprop ro.build.version.release'])).out||'').trim();
        console.log(`${d.serial}  ${d.model.replace(/_/g,' ')||'?'}  ${ver?`Android ${ver}`:''}  ${d.state==='device'?'sẵn sàng':d.state==='unauthorized'?'CHƯA CHO PHÉP (bấm "Cho phép" trên điện thoại)':d.state}`);
      }
      return;
    }
    case 'apps':{
      const pk=String(await sh('pm list packages -3')).split('\n').map(l=>l.replace(/^package:/,'').trim()).filter(Boolean).sort();
      const f=(rest[0]||'').toLowerCase(),list=f?pk.filter(p=>p.toLowerCase().includes(f)):pk;
      return console.log(list.join('\n')||'(không có app nào khớp)');
    }
    case 'launch':case 'restart':{
      const p=rest[0]||die('Cách dùng: apptest launch <package>');
      if(cmd==='restart')await sh(`am force-stop ${q(p)}`);
      await markLog();
      const r=String(await sh(`monkey -p ${q(p)} -c android.intent.category.LAUNCHER 1 2>&1`));
      if(/No activities found|monkey aborted/i.test(r))die(`Không mở được ${p}: app chưa cài hoặc không có màn hình mở đầu (xem \`apptest apps\`).`,1);
      await sleep(2500);console.log(`Đã mở ${p}. Đang hiển thị: ${await focusApp()}`);return;
    }
    case 'stop':{const p=rest[0]||die('Cách dùng: apptest stop <package>');await sh(`am force-stop ${q(p)}`);return console.log(`Đã dừng ${p}`)}
    case 'screen':{const els=await dump();save(els);return show(els,`Màn hình: ${await focusApp()} · ${els.length} phần tử (bấm theo số: apptest tap "@số", có ngoặc kép)`)}
    case 'tap':{
      const e=await find(rest.join(' ')||die('Cách dùng: apptest tap "<chữ>" | id:<id> | "@<số>" | <x>,<y>'));
      await sh(`input tap ${e.x} ${e.y}`);await sleep(600);return console.log(`Đã chạm "${e.name}" tại (${e.x},${e.y})${e.how?` (tìm thấy sau khi ${e.how})`:''}`);
    }
    case 'type':{
      const text=rest.join(' ');if(!text)die('Cách dùng: apptest type "<chữ>" [--into <ô nhập>]');
      let target=null;
      if(into){target=await find(into);await sh(`input tap ${target.x} ${target.y}`);await sleep(500)}
      const where=into?` vào "${into}"`:'';
      // --clear: cursor to the end, then delete as many characters as the field holds
      if(clear){const f=await field(target);const n=f&&!f.pw?[...f.text].length:40;if(n)await sh(`input keyevent 123 ${Array(Math.min(n+2,300)).fill(67).join(' ')}`)}
      const nfc=text.normalize('NFC');
      if(!/[^\x20-\x7e]/.test(nfc)){
        // plain ASCII: `input text` (spaces as %s)
        for(const part of nfc.match(/.{1,60}/gs))await sh(`input text ${q(part.replace(/ /g,'%s'))}`);
      }else{
        // accents, emoji…: `input text` drops them, so the helper puts the text on the phone's clipboard and Paste types it
        await helper(nfc);await sh('input keyevent 279');await sleep(600);
      }
      // read the field back: the text must be in it (a password field hides it)
      const f=await field(target),ok=!f||f.pw?null:f.text.normalize('NFC').includes(nfc);
      if(ok===false)die(`Ô nhập không nhận đủ chữ${where}. Đang có: "${f.text.slice(0,120)}". Chạm vào ô (apptest tap) rồi gõ lại; ô có giới hạn độ dài hoặc tự định dạng thì kiểm tra lại dữ liệu test.`,1);
      // done typing: put the keyboard away so it does not cover the next fields and buttons (--keep-keyboard keeps it)
      const hid=!keepKb&&await hideKeyboard();
      return console.log(`Đã gõ "${text}"${where}${target?.how?` (tìm thấy ô sau khi ${target.how})`:''}${ok===null?' (ô ẩn chữ hoặc không thấy ô đang chọn: không đọc lại được để kiểm tra)':''}${/[^\x20-\x7e]/.test(nfc)?' (dán qua clipboard của điện thoại)':''}${hid?'. Đã ẩn bàn phím':''}`);
    }
    case 'hidekb':{const h=await hideKeyboard();return console.log(h?'Đã ẩn bàn phím':'Bàn phím đang không hiện')}
    case 'key':{const k=rest[0]||die('Cách dùng: apptest key <back|home|enter|tab|del|…>');const c=KEYS[k.toLowerCase()]??(/^\d+$/.test(k)?+k:null);if(c==null)die(`Không biết phím ${k}`);await sh(`input keyevent ${c}`);await sleep(400);return console.log(`Đã nhấn ${k}`)}
    case 'swipe':{
      const s=rest[0]||die('Cách dùng: apptest swipe <up|down|left|right> | x1,y1,x2,y2');
      let c=s.split(',').map(Number);
      if(c.length!==4||c.some(isNaN)){
        const [w,h]=(String(await sh('wm size')).match(/(\d+)x(\d+)(?![\s\S]*\d+x\d+)/)||[,1080,1920]).slice(1).map(Number);
        const cx=w/2,cy=h/2;c={up:[cx,h*.75,cx,h*.25],down:[cx,h*.3,cx,h*.8],left:[w*.85,cy,w*.15,cy],right:[w*.15,cy,w*.85,cy]}[s.toLowerCase()]||die(`Hướng không hợp lệ: ${s}`);
      }
      await sh(`input swipe ${c.map(Math.round).join(' ')} 350`);await sleep(600);return console.log(`Đã vuốt ${s}`);
    }
    case 'wait':{
      const text=rest.join(' ')||die('Cách dùng: apptest wait "<chữ>" [--timeout giây]');
      const end=Date.now()+timeoutS*1000,low=text.toLowerCase();
      for(;;){const els=await dump();save(els);if(els.some(e=>label(e).toLowerCase().includes(low)))return console.log(`Đã thấy "${text}"`);
        if(Date.now()>end){console.error(`Sau ${timeoutS} giây vẫn chưa thấy "${text}". Màn hình hiện tại:`);show(els.slice(0,40),'');process.exit(1)}
        await sleep(800)}
    }
    case 'shot':{
      const name=(rest.join(' ')||'man-hinh').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'man-hinh';
      const dir=task?join(process.env.APPTEST_RUNS||join(homedir(),'.ai-3d-office','runs'),String(task)):resolve('test-results','phone');mkdirSync(dir,{recursive:true});
      const n=String(readdirSync(dir).filter(f=>/^phone-\d+/.test(f)).length+1).padStart(2,'0'),file=join(dir,`phone-${n}-${name}.png`);
      const png=await adb(['exec-out','screencap','-p'],{buffer:true});
      if(!png?.length||png[0]!==0x89)die('Không chụp được màn hình (máy có thể đang khóa màn hình hoặc app chặn chụp).',1);
      writeFileSync(file,png);return console.log(`Đã lưu ảnh: ${file}`);
    }
    case 'log':{
      const p=rest[0];let since='';try{since=readFileSync(join(STATE,`log-${device||'default'}.txt`),'utf8').trim()}catch{}
      const range=since?`-T ${q(since)}`:'-t 400';
      const crash=String(await sh(`logcat -d -b crash ${range} 2>/dev/null`).catch(()=>'')).trim();
      let pid='';if(p)pid=String(await sh(`pidof ${q(p)}`).catch(()=>'')).trim().split(/\s+/)[0]||'';
      const errs=String(await sh(`logcat -d ${range} ${pid?`--pid=${pid} `:''}*:E 2>/dev/null`).catch(()=>'')).split('\n').filter(l=>!p||pid||l.includes(p)).slice(-60).join('\n').trim();
      const anr=p?String(await sh(`dumpsys activity processes | grep -i -E "notResponding|crashing" | grep ${q(p)}`).catch(()=>'')).trim():'';
      console.log(`== Crash ==\n${crash||'(không có)'}\n== Lỗi (E)${pid?` của ${p} (pid ${pid})`:p?` (app ${p} không còn chạy)`:''} ==\n${errs||'(không có)'}${anr?`\n== Treo/không phản hồi ==\n${anr}`:''}`);
      await markLog();return;
    }
    case 'info':{
      const p=rest[0]||die('Cách dùng: apptest info <package>');
      const d=String(await sh(`dumpsys package ${q(p)}`));if(!d.includes('versionName'))die(`App ${p} chưa cài trên điện thoại.`,1);
      const g=re=>(d.match(re)||[])[1]||'?';
      const perms=[...new Set([...d.matchAll(/android\.permission\.(\w+): granted=(true|false)/g)].map(m=>`${m[1]}${m[2]==='true'?'':' (chưa cấp)'}`))].slice(0,30);
      return console.log(`${p}\nPhiên bản: ${g(/versionName=(\S+)/)} (${g(/versionCode=(\d+)/)})\nCài lúc: ${g(/firstInstallTime=([^\n]+)/)} · cập nhật: ${g(/lastUpdateTime=([^\n]+)/)}\nQuyền: ${perms.join(', ')||'(không có)'}`);
    }
    default:
      console.log(readFileSync(new URL(import.meta.url),'utf8').split('\n').filter(l=>l.startsWith('//')).slice(0,20).map(l=>l.slice(3)).join('\n'));
      process.exit(cmd?2:0);
  }
}
main().catch(e=>die(String(e?.message||e),1));
