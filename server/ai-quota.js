// How much of each AI plan's usage window is left, for the office to show next to the agents that use it.
// Codex: `codex app-server` answers account/rateLimits/read (exact %, no usage spent; Codex reads its own login).
// Claude: the plan's limits are only sent as response headers, so one 1-token Haiku request with the saved
// Claude Code token reads them (anthropic-ratelimit-unified-5h/7d-utilization); cached so it rarely runs.
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {codexSpawn} from './codex-bridge.js';

const TTL={claude:5*60e3,codex:2*60e3},MIN_FRESH=20e3;
const cache={claude:null,codex:null},inflight={};

const win=(key,label,used,resetsAt)=>({key,label,used:Math.max(0,Math.min(100,Math.round(used))),left:Math.max(0,100-Math.round(used)),resetsAt:resetsAt||null});
const minsLabel=m=>m>=10080?'Tuần':m>=1440?`${Math.round(m/1440)} ngày`:`${Math.round(m/60)} giờ`;

async function claudeQuota(token){
  if(!token)return {ok:false,error:'Chưa đăng nhập Claude trong app.'};
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20','anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:1,messages:[{role:'user',content:'.'}]})});
  const h=k=>r.headers.get('anthropic-ratelimit-unified-'+k);
  const w=[];
  for(const [k,label] of [['5h','5 giờ'],['7d','Tuần'],['7d_opus','Tuần · Opus'],['7d_sonnet','Tuần · Sonnet']]){
    const u=h(k+'-utilization');if(u!=null)w.push(win(k,label,+u*100,+h(k+'-reset')*1000||null));
  }
  if(!w.length){
    // a refused request (limit reached) still says until when
    const body=await r.text().catch(()=>'');
    if(r.status===429||h('status')==='rejected')return {ok:true,windows:[win('5h','5 giờ',100,+h('reset')*1000||null)],limited:true};
    return {ok:false,error:r.status===401?'Token Claude hết hạn hoặc bị thu hồi: đăng nhập lại.':`Claude không trả thông tin hạn mức (HTTP ${r.status}). ${body.slice(0,120)}`};
  }
  return {ok:true,windows:w,limited:h('status')==='rejected'};
}

function codexQuota(bin){
  if(!bin)return Promise.resolve({ok:false,error:'Chưa cài Codex CLI.'});
  return new Promise(resolve=>{
    let out='',done=false;
    const [c,a,env]=codexSpawn(bin,['app-server']),p=spawn(c,a,{cwd:tmpdir(),env,windowsHide:true});
    const finish=v=>{if(done)return;done=true;clearTimeout(t);try{p.kill()}catch{}resolve(v)};
    const t=setTimeout(()=>finish({ok:false,error:'Codex không trả lời (quá 20 giây).'}),20000);
    const send=o=>{try{p.stdin.write(JSON.stringify(o)+'\n')}catch{}};
    p.on('error',e=>finish({ok:false,error:e.message}));
    p.on('close',()=>finish({ok:false,error:'Codex app-server đã dừng.'}));
    p.stdout.on('data',d=>{
      out+=d;let i;
      while((i=out.indexOf('\n'))>=0){
        const line=out.slice(0,i);out=out.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue}
        if(m.id===1){send({method:'initialized'});send({id:2,method:'account/rateLimits/read'})}
        if(m.id===2){
          if(m.error)return finish({ok:false,error:/auth|login|sign/i.test(m.error.message||'')?'Codex chưa đăng nhập ChatGPT.':m.error.message||'Codex báo lỗi.'});
          const R=m.result?.rateLimits||{},w=[];
          for(const [k,x] of [['primary',R.primary],['secondary',R.secondary]])if(x)w.push(win(k,minsLabel(x.windowDurationMins||0),x.usedPercent||0,x.resetsAt?x.resetsAt*1000:null));
          const credits=(m.result?.rateLimitResetCredits?.credits||[]).filter(c=>c.status==='available').length;
          return finish({ok:true,windows:w,plan:R.planType||null,limited:!!R.rateLimitReachedType||R.ordinaryUsageAllowed===false,resetCredits:credits});
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'ai-3d-office',version:'1.0.0'}}});
  });
}

// {ok, windows:[{key,label,used,left,resetsAt}], plan?, limited?, error?, at}; cached, fresh=true re-reads (at most every 20s)
export async function readQuota(engine,{fresh=false,token,bin}={}){
  const c=cache[engine],age=c?Date.now()-c.at:Infinity;
  if(c&&(fresh?age<MIN_FRESH:age<TTL[engine]))return c;
  return inflight[engine]||=(async()=>{
    try{const r=engine==='claude'?await claudeQuota(token):await codexQuota(bin);return cache[engine]={...r,at:Date.now()}}
    catch(e){return cache[engine]={ok:false,error:e.name==='TimeoutError'?'Hết thời gian chờ Claude trả lời.':e.message,at:Date.now()}}
    finally{delete inflight[engine]}
  })();
}
export const cachedQuota=engine=>cache[engine];
