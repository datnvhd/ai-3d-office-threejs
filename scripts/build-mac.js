// Builds the macOS .dmg (`npm run dist:mac`). A .dmg can only be made on a Mac (hdiutil, codesign), and the native
// modules (node-pty, esbuild, rollup) installed by `npm ci` are the ones for this Mac's chip, so one run builds one dmg:
// Apple Silicon (arm64) on an M-series Mac, Intel (x64) on an Intel Mac. GitHub Actions builds both
// (.github/workflows/build-mac.yml); from Windows/Linux, `npm run dist:mac -- --ci` starts that workflow with `gh`.
//
// Signing: a "Developer ID Application" certificate in the keychain, or CSC_LINK (+ CSC_KEY_PASSWORD), is used when
// present; otherwise the app is signed ad-hoc (it runs, but Gatekeeper asks on first open, see README).
// Notarization runs when APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (or APPLE_API_KEY + APPLE_API_KEY_ID +
// APPLE_API_ISSUER) are set.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const args=process.argv.slice(2);
const run=(cmd,a,opt={})=>{const r=spawnSync(cmd,a,{stdio:'inherit',shell:process.platform==='win32',...opt});if(r.error)console.error(r.error.message);return r.status??1};

if(args.includes('--ci')){
  // the workflow builds both chips and keeps the dmg files as the run's artifacts
  const ref=(spawnSync('git',['rev-parse','--abbrev-ref','HEAD'],{encoding:'utf8'}).stdout||'main').trim();
  console.log(`Chạy GitHub Actions "build-mac" trên nhánh ${ref} (cần gh đã đăng nhập và nhánh đã được push)…`);
  const s=run('gh',['workflow','run','build-mac.yml','--ref',ref]);
  if(s===0)console.log('Đã gửi. Xem tiến độ: gh run watch · tải file: gh run download --name ai-3d-office-macos-arm64 (hoặc -x64)');
  process.exit(s);
}
if(process.platform!=='darwin'){
  console.error(`Bộ cài .dmg chỉ build được trên macOS (máy này: ${process.platform}).
- Trên một máy Mac: git clone, npm ci, npm run dist:mac
- Hoặc build trên GitHub Actions (cả Apple Silicon và Intel): npm run dist:mac -- --ci`);
  process.exit(1);
}

// empty secrets from CI must not count as "set"
for(const k of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY','APPLE_API_KEY_ID','APPLE_API_ISSUER'])
  if(process.env[k]==='')delete process.env[k];
const env=process.env;
const arch=args.includes('--x64')?'x64':args.includes('--arm64')?'arm64':process.arch==='arm64'?'arm64':'x64';
// Building for the other chip (e.g. Apple Silicon on an Intel Mac, as CI does when no M-chip runner is free): add the
// target chip's native packages (node-pty, esbuild, rollup) at the versions in package-lock.json. The host's own ones
// stay for vite build; the packaged app picks the ones of the chip it runs on.
if(arch!==process.arch){
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8')).packages||{};
  const pkgs=Object.entries(lock).filter(([k])=>k.endsWith(`-darwin-${arch}`)).map(([k,v])=>`${k.replace(/^.*node_modules\//,'')}@${v.version}`);
  console.log(`Build ${arch} trên máy ${process.arch}: cài thêm module native của ${arch}: ${pkgs.join(', ')}`);
  const s=run('npm',['install','--no-save','--force','--no-audit','--no-fund',...pkgs]);
  if(s!==0){console.error('Không cài được module native của chip đích.');process.exit(s)}
}

const hasIdentity=!!env.CSC_LINK||/Developer ID Application/.test(spawnSync('security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'}).stdout||'');
const canNotarize=!!(env.APPLE_ID&&env.APPLE_APP_SPECIFIC_PASSWORD&&env.APPLE_TEAM_ID||env.APPLE_API_KEY&&env.APPLE_API_KEY_ID&&env.APPLE_API_ISSUER);
const cfg=[];
if(!hasIdentity){
  // ad-hoc: an Apple Silicon Mac refuses to start an app whose signature was broken by packaging, so sign it locally
  cfg.push('-c.mac.identity=-','-c.mac.hardenedRuntime=false');
  console.log('Không có chứng chỉ Developer ID: ký ad-hoc (người dùng mở lần đầu bằng chuột phải → Open, xem README).');
}else console.log('Ký bằng chứng chỉ Developer ID.');
if(hasIdentity&&canNotarize){cfg.push('-c.mac.notarize=true');console.log('Sẽ notarize với Apple.')}
else if(hasIdentity)console.log('Chưa đặt APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID: bỏ qua notarize.');

let s=run('npx',['vite','build']);
if(s===0)s=run('npx',['electron-builder','--mac','dmg',`--${arch}`,'--publish','never',...cfg]);
process.exit(s);
