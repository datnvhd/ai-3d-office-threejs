// `uitest`: runs a UI test script in a real Chrome/Edge with the app's own Playwright, one screenshot per step.
// An agent writes the script once and runs it in seconds, instead of one model turn per click.
//
//   uitest <script.mjs> [--out <folder>] [--base-url <url>] [--only <regex>] [--headed] [--stop-on-fail] [--task <id>]
//
// --only: run just the steps whose name matches (e.g. re-run the failed test cases); steps given {always:true}
// (login, loading test data) run anyway. --task: the task's saved logins (secret()) and its browser session, kept
// between runs of the same task so a script does not have to sign in every time.
//
// The script exports one function; everything it needs is passed in (it must not import playwright itself):
//   export default async ({page, step, check, secret, baseURL}) => {
//     await step('TC01 Mở trang đăng nhập', async () => { await page.goto(baseURL + '/login') });
//     await step('TC02 Sai mật khẩu báo lỗi', async () => {
//       await page.fill('#user', 'demo'); await page.fill('#pass', 'sai'); await page.click('button[type=submit]');
//       await check.visible(page.getByText('Sai mật khẩu'));
//     });
//   };
// Screenshots: <out>/NN-<step>.png (failed step: NN-<step>-LOI.png); summary in <out>/ket-qua.json.
// Exit code 1 when a step failed.
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,basename,extname,relative} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';

const argv=process.argv.slice(2),flag=n=>argv.includes(n),opt=n=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:null};
const file=argv.find((a,i)=>!a.startsWith('--')&&!['--out','--base-url','--task','--only'].includes(argv[i-1]));
if(!file){console.error('Cách dùng: uitest <kich-ban.mjs> [--out <thư mục ảnh>] [--base-url <url>] [--only <regex tên bước>] [--headed] [--stop-on-fail] [--task <id>]');process.exit(2)}
let only=null;try{only=opt('--only')?new RegExp(opt('--only'),'i'):null}catch(e){console.error(`--only không hợp lệ: ${e.message}`);process.exit(2)}
const script=resolve(file);
if(!existsSync(script)){console.error(`Không thấy file kịch bản: ${script}`);process.exit(2)}

const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
const out=resolve(opt('--out')||join('test-results','ui',`${basename(script,extname(script))}-${stamp}`));
mkdirSync(out,{recursive:true});

// saved logins of the task (SITE_1_PASSWORD…): read here, never printed
const secrets={};
const task=opt('--task');
// cookies and storage of this task's earlier runs (outside the project: they hold the login session)
const stateFile=task?join(homedir(),'.ai-3d-office','runs',String(task),'uitest-state.json'):null;
if(task)try{for(const l of readFileSync(join(homedir(),'.ai-3d-office','runs',String(task),'secrets.env'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)secrets[m[1]]=m[2].replace(/^"(.*)"$/,'$1')}}catch{}
const hide=s=>{s=String(s??'');for(const v of Object.values(secrets))if(v&&v.length>=3)s=s.split(v).join('***');return s};
const secret=name=>{if(!(name in secrets))throw new Error(`Không có ${name} (chạy với --task <mã việc> để dùng tài khoản đã lưu).`);return secrets[name]};

const pw=createRequire(import.meta.url)('playwright-core');
const exe=process.env.UITEST_BROWSER,firefox=process.env.UITEST_ENGINE==='firefox';
const browser=await (firefox?pw.firefox:pw.chromium).launch({headless:!flag('--headed'),...(exe&&existsSync(exe)?{executablePath:exe}:firefox?{}:{channel:'chrome'})});
const context=await browser.newContext({viewport:{width:1366,height:860},locale:'vi-VN',ignoreHTTPSErrors:true,...(stateFile&&existsSync(stateFile)?{storageState:stateFile}:{})});
const page=await context.newPage();
page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);

// what went wrong in the page during the current step
let events=[];
page.on('console',m=>{if(m.type()==='error')events.push(`console: ${m.text().slice(0,300)}`)});
page.on('pageerror',e=>events.push(`lỗi JS: ${String(e.message).slice(0,300)}`));
page.on('requestfailed',r=>/ERR_ABORTED/.test(r.failure()?.errorText||'')||events.push(`request hỏng: ${r.method()} ${r.url().slice(0,200)} (${r.failure()?.errorText||''})`));
page.on('response',r=>{if(r.status()>=400)events.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0,200)}`)});

const slug=s=>String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'buoc';
const steps=[];let stop=false,skipped=0;
async function step(name,fn,{fullPage=false,always=false}={}){
  if(stop)return;
  if(only&&!always&&!only.test(name)){skipped++;return}
  const n=String(steps.length+1).padStart(2,'0'),t0=Date.now();events=[];
  let ok=true,error=null;
  try{await fn()}catch(e){ok=false;error=hide(e?.message||e).split('\n').slice(0,6).join('\n')}
  const shot=join(out,`${n}-${slug(name)}${ok?'':'-LOI'}.png`);
  try{await page.screenshot({path:shot,fullPage})}catch{}
  const s={buoc:+n,ten:name,dat:ok,ms:Date.now()-t0,anh:relative(process.cwd(),shot).replace(/\\/g,'/'),url:page.url(),...(error?{loi:error}:{}),...(events.length?{su_co:events.slice(0,10).map(hide)}:{})};
  steps.push(s);
  console.log(`${ok?'✓':'✗'} ${n} ${name} (${s.ms} ms)${error?`\n    → ${error.replace(/\n/g,'\n      ')}`:''}${events.length?`\n    ! ${events.slice(0,3).map(hide).join('\n    ! ')}`:''}`);
  if(!ok&&flag('--stop-on-fail'))stop=true;
}
const fail=(msg,detail)=>{throw new Error(detail?`${msg}: ${detail}`:msg)};
const check={
  true:(cond,msg='Điều kiện không đúng')=>{if(!cond)fail(msg)},
  visible:async(loc,msg)=>{try{await loc.first().waitFor({state:'visible',timeout:5000})}catch{fail(msg||'Không thấy phần tử',String(loc))}},
  hidden:async(loc,msg)=>{try{await loc.first().waitFor({state:'hidden',timeout:5000})}catch{fail(msg||'Phần tử vẫn hiện',String(loc))}},
  text:async(loc,expected,msg)=>{await check.visible(loc,msg);const t=(await loc.first().innerText()).trim();if(expected instanceof RegExp?!expected.test(t):!t.includes(expected))fail(msg||'Nội dung không khớp',`muốn "${expected}", thấy "${t.replace(/\s+/g,' ').slice(0,200)}"`)},
  value:async(loc,expected,msg)=>{const v=await loc.first().inputValue();if(v!==String(expected))fail(msg||'Giá trị ô không khớp',`muốn "${expected}", thấy "${v}"`)},
  count:async(loc,n,msg)=>{const c=await loc.count();if(c!==n)fail(msg||'Số phần tử không khớp',`muốn ${n}, thấy ${c}`)},
  url:async(re,msg)=>{try{await page.waitForURL(re,{timeout:10000})}catch{fail(msg||'Địa chỉ trang không khớp',`muốn ${re}, đang ở ${page.url()}`)}}
};

const t0=Date.now();let crash=null;
try{
  const mod=await import(pathToFileURL(script).href);
  const run=mod.default||mod.run;if(typeof run!=='function')throw new Error('Kịch bản phải export default async function ({page, step, check, secret, baseURL}).');
  await run({page,context,browser,step,check,secret,baseURL:(opt('--base-url')||process.env.BASE_URL||'').replace(/\/$/,'')});
}catch(e){crash=hide(e?.message||e).split('\n').slice(0,6).join('\n');try{await page.screenshot({path:join(out,'loi-kich-ban.png')})}catch{}}
if(stateFile)try{mkdirSync(join(stateFile,'..'),{recursive:true});await context.storageState({path:stateFile})}catch{}
await browser.close().catch(()=>{});

const passed=steps.filter(s=>s.dat).length,failed=steps.length-passed;
const summary={kich_ban:relative(process.cwd(),script).replace(/\\/g,'/'),thu_muc_anh:relative(process.cwd(),out).replace(/\\/g,'/'),tong:steps.length,dat:passed,khong_dat:failed,...(skipped?{bo_qua:skipped}:{}),ms:Date.now()-t0,...(crash?{loi_kich_ban:crash}:{}),buoc:steps};
writeFileSync(join(out,'ket-qua.json'),JSON.stringify(summary,null,1));
console.log(`\n${failed||crash?'KHÔNG ĐẠT':'ĐẠT'}: ${passed}/${steps.length} bước đạt${skipped?` (bỏ qua ${skipped} bước không khớp --only)`:''} trong ${(summary.ms/1000).toFixed(1)} s${crash?`\nLỗi kịch bản: ${crash}`:''}\nẢnh và ket-qua.json: ${summary.thu_muc_anh}`);
process.exit(failed||crash?1:0);
