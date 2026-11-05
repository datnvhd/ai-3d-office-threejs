// Tiny MCP server (stdio, JSON-RPC per line) that Claude Code calls through --permission-prompt-tool whenever a tool
// call is not covered by the allowed rules. It hands the request to the office server and waits until the user
// allows or denies it in the page. Started per task by machine-bridge.js with the port, task id and a one-off token.
import http from 'node:http';

const {AI_OFFICE_PORT:PORT,AI_OFFICE_TASK:TASK,AI_OFFICE_TOKEN:TOKEN}=process.env;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function api(method,path,body){
  return new Promise((ok,bad)=>{
    const data=body?JSON.stringify(body):'';
    const req=http.request({host:'127.0.0.1',port:+PORT,path:`/api/machine/tasks/${TASK}${path}`,method,timeout:15000,
      headers:{'X-AI-Office':'1','X-Perm-Token':TOKEN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
      let b='';res.on('data',c=>{b+=c});
      res.on('end',()=>{let j={};try{j=JSON.parse(b||'{}')}catch{}res.statusCode<300?ok(j):bad(Object.assign(new Error(j.error||`HTTP ${res.statusCode}`),{status:res.statusCode}))});
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',bad);req.end(data);
  });
}

async function decide({tool_name,input,tool_use_id}){
  try{
    let r=await api('POST','/perm',{tool:tool_name,input,id:tool_use_id}),fails=0;
    while(!r.decision){
      await sleep(800);
      try{r=await api('GET',`/perm/${r.id}`);fails=0}
      catch(e){if(e.status===404||++fails>20)throw e;r={id:r.id}}// a server restart or a lost request: keep asking for a while
    }
    return r.decision==='allow'?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:r.message||'Người dùng không cho phép thao tác này.'};
  }catch(e){return {behavior:'deny',message:`Không hỏi được người dùng (${e.message}); thao tác bị từ chối.`}}
}

const TOOL={name:'approve',description:'Hỏi người dùng có cho phép một thao tác hay không (hệ thống tự gọi, không dùng trực tiếp).',
  inputSchema:{type:'object',properties:{tool_name:{type:'string'},input:{type:'object'},tool_use_id:{type:'string'}},required:['tool_name','input']}};

let buf='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>{
  buf+=d;let i;
  while((i=buf.indexOf('\n'))>=0){
    const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;
    let m;try{m=JSON.parse(line)}catch{continue}
    handle(m);
  }
});
process.stdin.on('end',()=>process.exit(0));

async function handle(m){
  if(m.id===undefined)return;// notifications
  const reply=result=>send({jsonrpc:'2.0',id:m.id,result});
  if(m.method==='initialize')return reply({protocolVersion:m.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'ai-office-permission',version:'1.0.0'}});
  if(m.method==='ping')return reply({});
  if(m.method==='tools/list')return reply({tools:[TOOL]});
  if(m.method==='tools/call'&&m.params?.name==='approve')return reply({content:[{type:'text',text:JSON.stringify(await decide(m.params.arguments||{}))}]});
  send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
}
