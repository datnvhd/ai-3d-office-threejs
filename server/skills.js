// Skills (folders with a SKILL.md) the agents can use: the user's Claude Code skills (~/.claude/skills), Codex skills
// (~/.codex/skills, ~/.agents/skills) and the working folder's own (.claude/skills). Every task is told which skills
// exist, so an agent picks one up by itself when it fits; typing /name in a request or a follow-up puts that skill's
// full instructions into the prompt (Claude Code and Codex alike). Skills imported in the app (.zip, .skill or a
// SKILL.md) are saved to ~/.claude/skills, the personal skills folder Claude Code also reads on its own.
import {existsSync,mkdirSync,writeFileSync,rmSync,renameSync} from 'node:fs';
import fsp from 'node:fs/promises';
import {join,dirname,basename,extname,posix} from 'node:path';
import os from 'node:os';
import {inflateRawSync} from 'node:zlib';

const HOME=os.homedir();
export const PERSONAL_DIR=join(HOME,'.claude','skills');
const NAME=/^[a-z0-9][\w.-]{0,63}$/i;
const MAX_SKILLS=300,MAX_BODY=20000,MAX_FILES=1000,MAX_TOTAL=50*1024*1024;

// where skills are looked for, first wins on a name clash; `native` = engines that load that folder themselves
const roots=cwd=>[
  cwd&&{dir:join(cwd,'.claude','skills'),source:'project',label:'Dự án',native:['claude']},
  {dir:PERSONAL_DIR,source:'claude',label:'Cá nhân',native:['claude']},
  {dir:join(HOME,'.agents','skills'),source:'agents',label:'Agents',native:['codex']},
  {dir:join(HOME,'.codex','skills'),source:'codex',label:'Codex',native:['codex']},
].filter(Boolean);

// YAML front matter: flat `key: value` lines, plus folded/literal blocks (`description: >`) and indented continuations
export function parseSkill(text){
  const s=String(text).replace(/^﻿/,''),m=s.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/),meta={};
  if(m){const lines=m[1].split(/\r?\n/);
    for(let i=0;i<lines.length;i++){const k=lines[i].match(/^([\w-]+):\s*(.*)$/);if(!k)continue;
      let v=k[2].trim();
      if(/^[>|][+-]?$/.test(v)||!v){const more=[];while(i+1<lines.length&&/^\s+\S/.test(lines[i+1]))more.push(lines[++i].trim());v=more.join(' ')}
      meta[k[1]]=v.replace(/^(["'])([\s\S]*)\1$/,'$2').trim();
    }}
  return {meta,body:(m?s.slice(m[0].length):s).trim()};
}

// Skill lists are read in the background (fs/promises) and kept in memory. The server shares its thread with the
// desktop app's window, and on macOS a read under Documents/Desktop waits for the privacy prompt to be answered: a
// synchronous read there froze the whole app. A folder that takes too long is skipped for now and read again later.
const caches=new Map();// cwd → {at, list, loading}
const ROOT_WAIT=2500;
async function scanRoot(r){
  const out=[];let ents;try{ents=await fsp.readdir(r.dir,{withFileTypes:true})}catch{return out}
  for(const e of ents){
    if(out.length>=MAX_SKILLS)break;
    if(e.name.startsWith('.')||!(e.isDirectory()||e.isSymbolicLink()))continue;
    const dir=join(r.dir,e.name),file=join(dir,'SKILL.md');
    let text;try{text=(await fsp.readFile(file,'utf8')).slice(0,64*1024)}catch{continue}
    const {meta}=parseSkill(text),name=NAME.test(meta.name||'')?meta.name:NAME.test(e.name)?e.name:null;
    if(name)out.push({name,description:String(meta.description||'').slice(0,300),source:r.source,label:r.label,native:r.native,dir,file,text});
  }
  return out;
}
async function scan(cwd){
  const parts=await Promise.all(roots(cwd).map(r=>Promise.race([scanRoot(r),new Promise(ok=>setTimeout(ok,ROOT_WAIT,[])).then(x=>x)])));
  const seen=new Set(),list=[];
  for(const s of parts.flat()){const k=s.name.toLowerCase();if(seen.has(k)||list.length>=MAX_SKILLS)continue;seen.add(k);list.push(s)}// first root wins
  return list.sort((a,b)=>a.name.localeCompare(b.name));
}
// Fresh list (read again when older than maxAge ms)
export function loadSkills(cwd,maxAge=5000){
  const k=cwd||'',c=caches.get(k);
  if(c?.list&&Date.now()-c.at<maxAge&&!c.stale)return Promise.resolve(c.list);
  if(c?.loading)return c.loading;
  const loading=scan(cwd).then(list=>{caches.set(k,{at:Date.now(),list});return list},()=>{caches.set(k,{...c,loading:null});return c?.list||[]});
  caches.set(k,{...c,loading});return loading;
}
// What is known now, without waiting (starts a refresh when old)
export function listSkills(cwd){
  const c=caches.get(cwd||'');if(!c?.list||c.stale||Date.now()-c.at>5000)loadSkills(cwd);
  return c?.list||[];
}
const forget=()=>{for(const c of caches.values())c.stale=true};
export const findSkill=(name,cwd)=>listSkills(cwd).find(s=>s.name.toLowerCase()===String(name).toLowerCase())||null;
// what the page gets: no paths on disk
export const publicSkills=cwd=>listSkills(cwd).map(({name,description,source,label})=>({name,description,source,label}));

// Skill names typed as /name in a request or follow-up (only names that exist; "src/a" or "/api/x" are not skills)
export function skillRefs(text,cwd){
  const out=[];
  for(const m of String(text||'').matchAll(/(?:^|[\s(,;])\/([a-z0-9][\w.-]{0,63})(?=$|[\s),;:!?])/gi)){
    const s=findSkill(m[1].replace(/[.-]+$/,''),cwd);if(s&&!out.includes(s.name))out.push(s.name);if(out.length>=5)break;
  }
  return out;
}

// Prompt section for the skills the user asked for with /name: their full instructions (as read with the list)
export function skillPrompt(names,cwd){
  const parts=(names||[]).map(n=>findSkill(n,cwd)).filter(Boolean).map(s=>{
    const body=parseSkill(s.text||'').body;if(!body)return '';
    return `### Kỹ năng /${s.name}${s.description?` — ${s.description}`:''}
Thư mục của kỹ năng: ${s.dir}
----- BẮT ĐẦU SKILL.md -----
${body.length>MAX_BODY?body.slice(0,MAX_BODY)+`\n…(còn tiếp, đọc phần còn lại trong ${s.file})`:body}
----- HẾT SKILL.md -----`}).filter(Boolean);
  if(!parts.length)return '';
  return `\nKỸ NĂNG NGƯỜI DÙNG CHỌN (gõ /tên trong yêu cầu): làm việc theo đúng hướng dẫn của ${parts.length>1?'các kỹ năng':'kỹ năng'} dưới đây. File mà kỹ năng nhắc tới (scripts/, references/, assets/…) nằm trong thư mục của kỹ năng: đọc hoặc dùng khi cần.\n${parts.join('\n')}\n`;
}
// Short list of the skills the engine does not load by itself, so the agent can still use one when it fits
export function skillsAvailablePrompt(engine,cwd,skip=[]){
  const list=listSkills(cwd).filter(s=>!s.native.includes(engine)&&!skip.includes(s.name)).slice(0,40);
  if(!list.length)return '';
  return `\nKỸ NĂNG CÓ SẴN CỦA NGƯỜI DÙNG: khi một kỹ năng dưới đây khớp với việc đang làm, đọc file SKILL.md của nó rồi làm theo (không cần thì bỏ qua).\n${list.map(s=>`- ${s.name}${s.description?`: ${s.description.slice(0,160)}`:''} (${s.file})`).join('\n')}\n`;
}

// ---------- import ----------
// Every file entry of a zip: name and a reader (stored or deflated), sizes bounded
function readZip(buf){
  let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
  if(eocd<0)throw bad('Tệp không phải zip hợp lệ.');
  const count=buf.readUInt16LE(eocd+10),out=[];let p=buf.readUInt32LE(eocd+16),total=0;
  for(let i=0;i<count&&p+46<=buf.length&&buf.readUInt32LE(p)===0x02014b50;i++){
    const method=buf.readUInt16LE(p+10),comp=buf.readUInt32LE(p+20),size=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),xl=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lho=buf.readUInt32LE(p+42);
    const name=buf.toString('utf8',p+46,p+46+nl).replace(/\\/g,'/');p+=46+nl+xl+cl;
    if(name.endsWith('/')||/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(name))continue;
    if(out.length>=MAX_FILES||(total+=size)>MAX_TOTAL)throw bad('Gói skill quá lớn (tối đa 1000 file, 50MB).');
    out.push({name,read(){
      const ln=buf.readUInt16LE(lho+26),lx=buf.readUInt16LE(lho+28),start=lho+30+ln+lx,data=buf.subarray(start,start+comp);
      if(method===0)return data;if(method===8)return inflateRawSync(data,{maxOutputLength:Math.max(size,1)});
      throw bad(`Không đọc được ${name} (kiểu nén ${method}).`);
    }});
  }
  return out;
}
const bad=msg=>Object.assign(new Error(msg),{code:400});
// safe relative path inside the skill folder, or null
const safeRel=p=>{const n=posix.normalize(p).replace(/^\/+/,'');return !n||n.startsWith('..')||/^[a-z]:/i.test(n)||n.split('/').some(x=>x==='..')?null:n};
const slug=s=>String(s||'').trim().toLowerCase().replace(/[^\w.-]+/g,'-').replace(/^[^a-z0-9]+|[-.]+$/g,'').slice(0,64);

// A .zip/.skill (one or more folders with a SKILL.md) or a single SKILL.md → ~/.claude/skills/<name>/
export function importSkills(fileName,buf){
  const ext=extname(fileName).toLowerCase();let skills=[];
  if(ext==='.md'){
    const {meta}=parseSkill(buf.toString('utf8'));
    const name=slug(meta.name)||slug(basename(fileName,ext).replace(/^skill$/i,''));
    if(!name)throw bad('SKILL.md cần có "name:" ở phần đầu (front matter).');
    skills=[{name,files:[{rel:'SKILL.md',data:buf}]}];
  }else if(ext==='.zip'||ext==='.skill'){
    const entries=readZip(buf),rootsOf=entries.filter(e=>/(^|\/)SKILL\.md$/i.test(e.name)).map(e=>e.name.includes('/')?e.name.slice(0,e.name.lastIndexOf('/')+1):'').sort((a,b)=>a.length-b.length);
    if(!rootsOf.length)throw bad('Không tìm thấy SKILL.md trong gói.');
    const tops=rootsOf.filter((r,i)=>!rootsOf.slice(0,i).some(o=>r.startsWith(o)));// nested SKILL.md files belong to the outer skill
    for(const root of tops){
      const md=entries.find(e=>e.name===root+'SKILL.md'||e.name.toLowerCase()===(root+'skill.md').toLowerCase());
      const {meta}=parseSkill(md.read().toString('utf8'));
      const name=slug(meta.name)||slug(root.split('/').filter(Boolean).pop())||slug(basename(fileName,ext));
      if(!name)throw bad('Không xác định được tên skill.');
      const files=[];
      for(const e of entries){if(!e.name.startsWith(root))continue;const rel=safeRel(e.name.slice(root.length));if(!rel)continue;files.push({rel:/^skill\.md$/i.test(rel)?'SKILL.md':rel,data:e.read()})}
      skills.push({name,files});
    }
  }else throw bad('Chỉ nhận tệp .zip, .skill hoặc SKILL.md.');
  const done=[];
  for(const s of skills){
    if(!NAME.test(s.name))throw bad(`Tên skill không hợp lệ: ${s.name}`);
    // write next to the target first, then swap, so a failed import never leaves half a skill
    const dest=join(PERSONAL_DIR,s.name),tmp=dest+`.importing-${process.pid}`,replaced=existsSync(dest);
    rmSync(tmp,{recursive:true,force:true});
    try{
      for(const f of s.files){const p=join(tmp,...f.rel.split('/'));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f.data)}
      rmSync(dest,{recursive:true,force:true});renameSync(tmp,dest);
    }catch(e){rmSync(tmp,{recursive:true,force:true});throw e}
    done.push({name:s.name,files:s.files.length,replaced});
  }
  forget();return done;
}
// Only personal skills (~/.claude/skills) can be removed from the app
export function removeSkill(name,cwd){
  const s=findSkill(name,cwd);
  if(!s)throw Object.assign(new Error('Không tìm thấy skill.'),{code:404});
  if(s.source!=='claude')throw Object.assign(new Error(`Skill "${s.name}" thuộc ${s.label}, không xóa được từ app.`),{code:409});
  rmSync(s.dir,{recursive:true,force:true});forget();
}
