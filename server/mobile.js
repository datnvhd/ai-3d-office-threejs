// React Native / Expo support for the task runner: finds an RN app in the working folder, looks for the mobile tools on
// this machine (Xcode + iOS Simulator on macOS, Android SDK + emulator, Maestro) and writes the prompt part that tells
// developers, QA and designers how to build and check the app here. Three levels of checks, each used when possible:
//   1. static: TypeScript, ESLint, Jest (+ @testing-library/react-native) — any OS
//   2. Expo web: the app in a real browser through Playwright — any OS, close to but not the same as native
//   3. native: iOS Simulator (macOS only) / Android emulator, screenshots, Maestro flows
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {join,relative} from 'node:path';
import os from 'node:os';

const isWin=process.platform==='win32',isMac=process.platform==='darwin';
const readJson=f=>{try{return JSON.parse(readFileSync(f,'utf8'))}catch{return null}};

// ---------- project ----------
const projCache=new Map();// dir -> {key, info}
function inspect(dir){
  const pkg=readJson(join(dir,'package.json'));if(!pkg)return null;
  const deps={...pkg.dependencies,...pkg.devDependencies};
  if(!deps['react-native']&&!deps.expo)return null;
  const appJson=readJson(join(dir,'app.json'))?.expo||{};
  return {dir,name:pkg.name||appJson.name||null,expo:!!deps.expo,expoVersion:deps.expo||null,rnVersion:deps['react-native']||null,
    web:!!(deps['react-native-web']&&deps['react-dom']),ios:existsSync(join(dir,'ios')),android:existsSync(join(dir,'android')),
    router:!!deps['expo-router'],maestro:existsSync(join(dir,'.maestro')),jest:!!(deps.jest||deps['jest-expo']),rntl:!!deps['@testing-library/react-native'],
    ts:existsSync(join(dir,'tsconfig.json')),eslint:!!deps.eslint,scheme:appJson.scheme||null,bundleId:appJson.ios?.bundleIdentifier||null,androidPackage:appJson.android?.package||null,
    scripts:Object.keys(pkg.scripts||{}).slice(0,30)};
}
// The RN app in `cwd`: the folder itself, or one level down (mobile/, app/) or in a monorepo's apps/ and packages/
export function rnProject(cwd){
  if(!cwd||!existsSync(cwd))return null;
  let key='';try{key=String(statSync(join(cwd,'package.json')).mtimeMs)}catch{}
  try{key+='|'+readdirSync(cwd).length}catch{}
  const c=projCache.get(cwd);if(c&&c.key===key&&Date.now()-c.at<60000)return c.info;
  let info=inspect(cwd);
  if(!info){
    const subs=[];
    try{for(const e of readdirSync(cwd,{withFileTypes:true}))if(e.isDirectory()&&!/^(\.|node_modules$)/.test(e.name)){
      if(/^(apps|packages)$/.test(e.name))try{for(const f of readdirSync(join(cwd,e.name),{withFileTypes:true}))if(f.isDirectory())subs.push(join(cwd,e.name,f.name))}catch{}
      else subs.push(join(cwd,e.name));
    }}catch{}
    for(const d of subs.slice(0,60)){info=inspect(d);if(info)break}
  }
  if(info)info.rel=relative(cwd,info.dir)||'.';
  projCache.set(cwd,{key,info,at:Date.now()});
  return info;
}

// ---------- tools on this machine ----------
const sh=(bin,args,timeout=8000)=>new Promise(r=>execFile(bin,args,{timeout,windowsHide:true,maxBuffer:4<<20},(e,out)=>r(e?null:String(out))));
const onPath=names=>{for(const d of (process.env.PATH||'').split(isWin?';':':'))for(const n of names)if(d&&existsSync(join(d,n)))return join(d,n);return null};
function androidSdk(){
  const list=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,isWin?join(process.env.LOCALAPPDATA||'','Android','Sdk'):isMac?join(os.homedir(),'Library','Android','sdk'):join(os.homedir(),'Android','Sdk')];
  return list.find(d=>d&&existsSync(d))||null;
}
const exe=n=>isWin?`${n}.exe`:n;
export function mobileBins(){
  const sdk=androidSdk();
  return {
    adb:onPath([exe('adb')])||(sdk&&existsSync(join(sdk,'platform-tools',exe('adb')))?join(sdk,'platform-tools',exe('adb')):null),
    emulator:onPath([exe('emulator')])||(sdk&&existsSync(join(sdk,'emulator',exe('emulator')))?join(sdk,'emulator',exe('emulator')):null),
    maestro:onPath(isWin?['maestro.bat','maestro.cmd','maestro']:['maestro'])||[join(os.homedir(),'.maestro','bin',isWin?'maestro.bat':'maestro')].find(existsSync)||null,
    sdk,
  };
}
let envCache=null,envAt=0;
// What can be used for checks on this machine; cached for a minute (the window polls status)
export async function mobileEnv(force=false){
  if(!force&&envCache&&Date.now()-envAt<60000)return envCache;
  const b=mobileBins(),out={os:process.platform,xcode:null,simulators:[],booted:[],android:null,avds:[],devices:[],maestro:null};
  if(isMac){
    const v=await sh('xcodebuild',['-version']);
    if(v){out.xcode=v.split('\n')[0].trim();
      const j=await sh('xcrun',['simctl','list','devices','available','-j'],15000);
      try{for(const [rt,list] of Object.entries(JSON.parse(j).devices||{}))if(/iOS/.test(rt))for(const d of list){out.simulators.push(d.name);if(d.state==='Booted')out.booted.push(d.name)}}catch{}
      out.simulators=[...new Set(out.simulators)].slice(0,20);
    }
  }
  if(b.adb){
    out.android=b.adb;
    const d=await sh(b.adb,['devices']);if(d)out.devices=d.split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(p=>p[1]==='device').map(p=>p[0]);
  }
  if(b.emulator){const a=await sh(b.emulator,['-list-avds']);if(a)out.avds=a.split('\n').map(s=>s.trim()).filter(s=>s&&!/^(INFO|WARNING)/.test(s)).slice(0,20)}
  if(b.maestro)out.maestro=isWin?b.maestro:((await sh(b.maestro,['--version'],20000))||'').trim().split('\n').pop()||b.maestro;
  envCache=out;envAt=Date.now();return out;
}
// Last result without waiting (prompts are built synchronously; launch() refreshes it before an RN task starts)
export const mobileEnvCached=()=>envCache||{os:process.platform,xcode:null,simulators:[],booted:[],android:null,avds:[],devices:[],maestro:null};
export const mobileSummary=e=>[
  isMac?(e.xcode?`${e.xcode} · ${e.simulators.length} iOS Simulator${e.booted.length?` (đang chạy: ${e.booted.join(', ')})`:''}`:'Chưa có Xcode (cần để chạy iOS Simulator)'):'iOS Simulator: chỉ có trên macOS',
  e.android?`Android SDK · ${e.avds.length} máy ảo${e.devices.length?` · đang kết nối: ${e.devices.join(', ')}`:''}`:'Chưa có Android SDK (adb)',
  e.maestro?`Maestro ${e.maestro}`:'Chưa có Maestro (kịch bản kiểm thử UI)',
];

// ---------- toolkit ----------
// cmds work in read-only mode (they look, run tests or take screenshots); writeCmds build, install or start the app
export const MOBILE_KIT={short:'Mobile (RN)',label:'React Native / Expo: Metro, Expo web, iOS Simulator (macOS), Android emulator, Maestro, chụp màn hình app (tự bật khi thư mục là app React Native)',
  cmds:['xcrun simctl list','xcrun simctl io','xcrun simctl openurl','xcodebuild -version','xcodebuild -list','adb devices','adb shell','adb exec-out screencap','adb logcat','emulator -list-avds','maestro test','maestro hierarchy','maestro --version','npx expo-doctor','npx expo config'],
  writeCmds:['npx expo','npx react-native','npx pod-install','pod install','xcrun simctl','xcodebuild','adb','emulator','maestro','./gradlew','gradlew','npx eas-cli build --local']};

// ---------- prompt ----------
const isQa=t=>/qa|test|kiểm thử|tester|chất lượng/i.test(`${t.team||''} ${t.role||''} ${t.agent||''}`);
export function mobilePrompt(t,{rn,env,design,shotsDir,canEdit}){
  if(!rn)return '';
  const where=rn.rel==='.'?'thư mục làm việc':`thư mục con ${rn.rel}`;
  const head=`
DỰ ÁN APP MOBILE: ${where} là app React Native${rn.expo?` dùng Expo (${rn.expoVersion||'?'}${rn.router?', expo-router':''})`:` (bare, react-native ${rn.rnVersion||'?'})`}${rn.ts?', TypeScript':''}. ${rn.ios?'Có thư mục ios/. ':''}${rn.android?'Có thư mục android/. ':''}Chạy lệnh của app trong ${rn.dir}.
Máy này: ${mobileSummary(env).join(' · ')}.`;
  if(design)return `${head}
Thiết kế cho màn hình điện thoại: mọi file đặt tên có "mobile" (khung 390px), theo quy ước iOS/Android (vùng an toàn, thanh điều hướng, nút chạm tối thiểu 44pt). Nếu cần bản tablet, ghi rõ trong tên file.
`;
  const native=[];
  if(isMac&&env.xcode)native.push(`- iOS (macOS): ${rn.expo?'`npx expo run:ios`':'`npx react-native run-ios`'}${env.simulators[0]?` (ví dụ --device "${env.simulators[0]}")`:''} để build và mở trên iOS Simulator${rn.expo&&!rn.ios?'; lần đầu Expo sẽ tạo thư mục ios/ (prebuild)':''}${rn.ios&&!rn.expo?'; trước đó chạy `pod install` trong ios/ nếu thiếu Pods':''}. Chụp màn hình: \`xcrun simctl io booted screenshot "${shotsDir}/ios-01-<ten-man-hinh>.png"\`. Mở thẳng một màn hình: \`xcrun simctl openurl booted ${rn.scheme?`${rn.scheme}://…`:'<scheme>://…'}\`.`);
  else if(isMac)native.push('- iOS: máy chưa có Xcode nên không chạy được iOS Simulator; ghi rõ trong kết quả.');
  else native.push('- iOS: chỉ kiểm tra được trên máy macOS (iOS Simulator); máy này không phải macOS nên bỏ qua và ghi rõ trong kết quả.');
  if(env.android)native.push(`- Android: ${env.devices.length?`thiết bị/máy ảo đang kết nối: ${env.devices.join(', ')}`:env.avds.length?`mở máy ảo bằng \`emulator -avd ${env.avds[0]}\` (chạy nền) rồi chờ \`adb devices\` thấy thiết bị`:'chưa có máy ảo (AVD) nào'}; build và mở: ${rn.expo?'`npx expo run:android`':'`npx react-native run-android`'}. Chụp màn hình: \`adb exec-out screencap -p > "${shotsDir}/android-01-<ten-man-hinh>.png"\`.`);
  if(env.maestro)native.push(`- Maestro: kịch bản YAML ${rn.maestro?'có sẵn trong .maestro/':`đặt trong .maestro/ của app${canEdit?'':' (cần chế độ được sửa file để tạo mới)'}`}, chạy \`maestro test .maestro/<file>.yaml\`; dùng \`takeScreenshot\` cho các bước quan trọng rồi chép ảnh vào ${shotsDir}.`);
  const levels=`Kiểm tra theo 3 mức, làm được mức nào thì làm mức đó và ghi rõ mức nào đã chạy, mức nào bỏ qua và vì sao:
1. Tĩnh: ${rn.ts?'`npx tsc --noEmit`, ':''}${rn.eslint?'`npx eslint .`, ':''}${rn.jest?'`npx jest`':'test (chưa cài Jest: nêu đề xuất jest-expo/@testing-library/react-native)'}.
2. Expo web${rn.web?'':' (dự án chưa có react-native-web + react-dom; chỉ dùng nếu người dùng đồng ý cài: `npx expo install react-native-web react-dom`)'}: chạy NỀN \`npx expo start --web --port 8081\` (Bash với run_in_background), chờ http://localhost:8081 trả lời, rồi dùng công cụ trình duyệt để mở, thao tác và chụp màn hình (trình duyệt đã mở sẵn ở khung iPhone, có cảm ứng). Đây chỉ là gần đúng: component native, cử chỉ và quyền hệ thống phải kiểm ở mức 3.
3. Native:
${native.join('\n')}
Ảnh chụp app lưu vào ${shotsDir} để người dùng xem trong mục "Ảnh chụp". Có ảnh thiết kế thì mở cả hai bằng công cụ Read và so từng màn hình (bố cục, màu, chữ, khoảng cách). Xong việc thì dừng các tiến trình chạy nền (Metro, máy ảo do bạn mở).`;
  if(isQa(t))return `${head}
${levels}
`;
  return `${head}
Viết code React Native (View, Text, Pressable, FlatList, StyleSheet…), không dùng thẻ HTML/DOM hay CSS của web. Thư viện native mới: dùng \`npx expo install\`${rn.expo?'':' hoặc npm rồi `pod install`'} để đúng phiên bản.
Trước khi báo xong: chạy kiểm tra tĩnh (${rn.ts?'`npx tsc --noEmit`, ':''}${rn.jest?'`npx jest`':'test nếu có'}); nếu được, mở app để xem nhanh (Expo web hoặc máy ảo, như hướng dẫn dưới) và chụp màn hình vào ${shotsDir}.
${levels}
`;
}
// One line for the Director's plan: what kind of project it is and what this machine can test
export function mobilePlanNote(rn,env){
  if(!rn)return '';
  return `
DỰ ÁN: app mobile React Native${rn.expo?' (Expo)':''} trong ${rn.rel==='.'?'thư mục làm việc':rn.rel}. Máy chạy: ${mobileSummary(env).join(' · ')}. Bước của Designer là màn hình điện thoại; bước QA kiểm tra tĩnh, Expo web và máy ảo iOS/Android nếu máy có.
`;
}
