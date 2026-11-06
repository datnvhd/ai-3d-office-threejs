// electron-builder afterPack hook (runs after the app is laid out, before it is signed).
// Safety net for a macOS app built for the other chip (CI builds Apple Silicon on an Intel Mac): every native package
// of that chip in package-lock.json ("<name>-darwin-<arch>" or "@scope/darwin-<arch>", e.g. @esbuild/darwin-arm64)
// that scripts/build-mac.js put in node_modules but the app does not contain is copied in, before signing.
const {existsSync,cpSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
const {Arch}=require('builder-util');

exports.default=async function afterPack(ctx){
  if(ctx.electronPlatformName!=='darwin')return;
  const arch=Arch[ctx.arch];// 'arm64' | 'x64'
  const root=ctx.packager.projectDir;
  const app=join(ctx.appOutDir,`${ctx.packager.appInfo.productFilename}.app`,'Contents','Resources','app','node_modules');
  const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8')).packages||{};
  for(const key of Object.keys(lock).filter(k=>new RegExp(`[-/]darwin-${arch}$`).test(k)&&!k.includes('/node_modules/',13))){
    const name=key.replace(/^node_modules\//,''),src=join(root,'node_modules',...name.split('/')),dest=join(app,...name.split('/'));
    if(existsSync(dest))continue;
    if(!existsSync(src)){console.log(`  • afterPack: ${name} không có trong node_modules, bỏ qua`);continue}
    cpSync(src,dest,{recursive:true});
    console.log(`  • afterPack: thêm ${name} vào app (${arch})`);
  }
};
