// Reads office files without extra packages: .docx / .pptx to plain text, .xlsx / .xlsm to one table per sheet.
// All three are zip files of XML; only the entries needed are inflated (each capped, so a zip bomb cannot blow up memory).
import {inflateRawSync,deflateRawSync,crc32} from 'node:zlib';

const MAX_ENTRY=200*1024*1024;

// name -> {method,compSize,lho} for every entry in the zip's central directory
function zipIndex(buf){
  let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
  if(eocd<0)return null;
  const out=new Map();let p=buf.readUInt32LE(eocd+16);const count=buf.readUInt16LE(eocd+10);
  for(let i=0;i<count&&p+46<=buf.length&&buf.readUInt32LE(p)===0x02014b50;i++){
    const nameLen=buf.readUInt16LE(p+28),extraLen=buf.readUInt16LE(p+30),commLen=buf.readUInt16LE(p+32);
    out.set(buf.toString('utf8',p+46,p+46+nameLen),{method:buf.readUInt16LE(p+10),compSize:buf.readUInt32LE(p+20),lho:buf.readUInt32LE(p+42)});
    p+=46+nameLen+extraLen+commLen;
  }
  return out;
}
function zipRead(buf,idx,name){
  const e=idx.get(name.replace(/^\//,''));if(!e)return null;
  const start=e.lho+30+buf.readUInt16LE(e.lho+26)+buf.readUInt16LE(e.lho+28),data=buf.subarray(start,start+e.compSize);
  return e.method===0?data.toString('utf8'):e.method===8?inflateRawSync(data,{maxOutputLength:MAX_ENTRY}).toString('utf8'):null;
}
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,c)=>c[0]==='#'?String.fromCodePoint(c[1]==='x'||c[1]==='X'?parseInt(c.slice(2),16):+c.slice(1)):{amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[c.toLowerCase()]);
const attr=(tag,name)=>{const m=tag.match(new RegExp(`\\s${name}="([^"]*)"`));return m?decode(m[1]):null};

export function extractDocxText(buf){
  try{const idx=zipIndex(buf),xml=idx&&zipRead(buf,idx,'word/document.xml');if(!xml)return null;
    return decode(xml.replace(/<w:tab[^>]*\/>/g,'\t').replace(/<w:br[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'')).replace(/\n{3,}/g,'\n\n').trim();
  }catch{return null}
}

export function extractPptxText(buf){
  try{const idx=zipIndex(buf);if(!idx)return null;
    const slides=[...idx.keys()].map(n=>n.match(/^ppt\/slides\/slide(\d+)\.xml$/)).filter(Boolean).sort((a,b)=>a[1]-b[1]);
    return slides.map(([n,i])=>`--- Slide ${i} ---\n`+decode(zipRead(buf,idx,n).replace(/<\/a:p>/g,'\n').replace(/<[^>]+>/g,'')).trim()).join('\n\n');
  }catch{return null}
}

// Built-in Excel number formats that show a date/time
const DATE_FMT=new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57]);
const colIndex=ref=>{let n=0;for(const c of ref.match(/^[A-Z]+/i)?.[0].toUpperCase()||'A')n=n*26+c.charCodeAt(0)-64;return n-1};
function excelDate(v,date1904){
  const ms=Math.round((v+(date1904?1462:0)-25569)*864e5),d=new Date(ms);if(isNaN(d))return String(v);
  const iso=d.toISOString();return v%1===0?iso.slice(0,10):iso.slice(0,19).replace('T',' ');
}
const textOf=x=>decode([...x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>m[1]).join(''));

// [{name, hidden, rows:[[cell,...],...]}] in workbook order; cells are strings (dates as ISO, formulas as their last value)
export function extractXlsx(buf){
  const idx=zipIndex(buf);if(!idx)throw new Error('Không đọc được tệp Excel (không phải .xlsx hợp lệ).');
  const wb=zipRead(buf,idx,'xl/workbook.xml');if(!wb)throw new Error('Tệp Excel thiếu xl/workbook.xml.');
  const rels=new Map([...(zipRead(buf,idx,'xl/_rels/workbook.xml.rels')||'').matchAll(/<Relationship\b[^>]*>/g)].map(([t])=>[attr(t,'Id'),attr(t,'Target')]));
  const shared=[...(zipRead(buf,idx,'xl/sharedStrings.xml')||'').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>textOf(m[1]));
  // styles: which cell style index shows a date
  const st=zipRead(buf,idx,'xl/styles.xml')||'',custom=new Map([...st.matchAll(/<numFmt\b[^>]*>/g)].map(([t])=>[+attr(t,'numFmtId'),attr(t,'formatCode')||'']));
  const isDateFmt=id=>DATE_FMT.has(id)||custom.has(id)&&/[dmyhs]/i.test(custom.get(id).replace(/\[[^\]]*\]|"[^"]*"|\\./g,''));
  const xfs=(st.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0]||'').match(/<xf\b[^>]*>/g)||[],dateStyle=xfs.map(t=>isDateFmt(+(attr(t,'numFmtId')||0)));
  const date1904=/date1904="(1|true)"/.test(wb);
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map(([t])=>{
    const target=rels.get(attr(t,'r:id'))||'',path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
    const xml=zipRead(buf,idx,path)||'',rows=[];
    for(const [,rAttr,body] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)){
      const r=(+attr(rAttr,'r')||rows.length+1)-1,row=[];
      for(const [,cAttr,inner=''] of (body||'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const ref=attr(cAttr,'r'),c=ref?colIndex(ref):row.length,type=attr(cAttr,'t'),v=inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val='';
        if(type==='s')val=shared[+v]??'';
        else if(type==='inlineStr')val=textOf(inner);
        else if(type==='b')val=v==='1'?'TRUE':'FALSE';
        else if(v!=null){val=decode(v);if(type!=='str'&&type!=='e'&&dateStyle[+(attr(cAttr,'s')||0)]&&isFinite(+val))val=excelDate(+val,date1904)}
        row[c]=val;
      }
      rows[r]=Array.from(row,x=>x??'');
    }
    for(let i=0;i<rows.length;i++)rows[i]??=[];
    // drop trailing empty rows
    while(rows.length&&!rows.at(-1).some(x=>x!==''))rows.pop();
    return {name:attr(t,'name')||'Sheet',hidden:!!attr(t,'state')&&attr(t,'state')!=='visible',rows};
  });
}

const csvCell=v=>/[",\n\r]/.test(v)?`"${v.replace(/"/g,'""')}"`:v;
export const toCsv=rows=>{const w=Math.max(0,...rows.map(r=>r.length));return rows.map(r=>Array.from({length:w},(_,i)=>csvCell(String(r[i]??''))).join(',')).join('\n')};
// Short text preview of a sheet for the prompt: first rows as a | table
export function sheetPreview(rows,maxRows=25,maxCols=20){
  return rows.slice(0,maxRows).map(r=>r.slice(0,maxCols).map(x=>String(x).replace(/\s+/g,' ').slice(0,60)).join(' | ')).join('\n')+(rows.length>maxRows?`\n… (${rows.length-maxRows} dòng nữa)`:'');
}

// Builds a .zip from [{name, buf}] (names with '/', UTF-8): one download for all the files a task produced
export function makeZip(entries){
  const parts=[],central=[];let off=0;
  const dos=d=>[((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1))&0xffff,(((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xffff];
  for(const {name,buf,mtime=new Date()} of entries){
    const n=Buffer.from(name,'utf8'),z=deflateRawSync(buf),[tm,dt]=dos(mtime),crc=crc32(buf);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(tm,10);h.writeUInt16LE(dt,12);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(z.length,18);h.writeUInt32LE(buf.length,22);h.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(tm,12);c.writeUInt16LE(dt,14);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(z.length,20);c.writeUInt32LE(buf.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(off,42);
    parts.push(h,n,z);central.push(c,n);off+=30+n.length+z.length;
  }
  const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(entries.length,8);e.writeUInt16LE(entries.length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(off,16);
  return Buffer.concat([...parts,cd,e]);
}
