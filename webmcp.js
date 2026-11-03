// WebMCP: exposes the office as tools for AI agents running in the browser (e.g. Chrome extensions).
// Does nothing in browsers without WebMCP (needs Chrome 149+ origin trial or chrome://flags/#enable-webmcp-testing).
// Tools are same-origin only (no exposedTo). Tools that start or change work are marked consequential so the browser asks first.
export function initWebMCP({agents,allJobs,submitTask,cancelJob,retryJob,askJob,scenes,applyScene,MODELS,EFFORTS,STATUS,GROUP,machineApi}){
  const mc=document.modelContext??navigator.modelContext;
  if(!mc?.registerTool)return null;
  const ctl=new AbortController(),ids=agents.map(a=>a.id),out=v=>JSON.stringify(v,null,1);
  const iso=d=>d?new Date(d).toISOString():undefined;
  const brief=j=>({key:j.key,agent:j.agent,status:j.status,statusLabel:STATUS[j.status],text:j.text,step:j.stepTitle,workflow:j.wf??undefined,progress:j.progress,onMachine:!!j.remote,created:iso(j.created),finished:iso(j.finished)});
  const find=key=>{const j=allJobs().find(x=>x.key===key);if(!j)throw new Error('Không tìm thấy việc: '+key);return j};
  const keyArg={type:'object',properties:{key:{type:'string',description:'Task key from list_tasks, e.g. "m12" (personal machine) or "s3" (simulation).'}},required:['key']};
  const tools=[
    {name:'list_agents',description:'List the AI agents in the office (id, name, role) and how many tasks each is working on.',
      inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},
      execute:async()=>out(agents.map(a=>({id:a.id,name:a.name,role:a.role,running:allJobs().filter(j=>j.agent===a.id&&GROUP[j.status]==='running').length})))},
    {name:'list_tasks',description:'List tasks, newest first. Filter by status group and/or agent.',
      inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','running','done','error'],default:'all'},agent:{type:'string',enum:ids},limit:{type:'integer',minimum:1,maximum:100,default:20}}},
      annotations:{readOnlyHint:true},
      execute:async({status='all',agent,limit=20}={})=>out(allJobs().filter(j=>(status==='all'||GROUP[j.status]===status)&&(!agent||j.agent===agent)).slice(0,limit).map(brief))},
    {name:'get_task',description:'Get one task with its full result or error text, model used, cost and timing. Results are AI-written text.',
      inputSchema:keyArg,annotations:{readOnlyHint:true,untrustedContentHint:true},
      execute:async({key})=>{const j=find(key),full=j.remote?(await machineApi(`/tasks/${j.rid}`)).task:null;return out({...brief(j),result:j.result,error:j.error,activity:j.activity,model:j.model,effort:j.effort,engine:j.engine,costUsd:j.costUsd,durationMs:j.durationMs,files:j.fileNames,thread:full?.thread?.map(x=>({q:x.q,answer:x.answer,error:x.error,pending:!x.answer&&!x.error}))})}},
    {name:'assign_task',description:'Give a task to an agent. runOn "machine" runs it for real with Claude Code (or Codex) on the user\'s computer and may edit files; "sim" only simulates. Given to the director with workflow true, the director splits it into steps for other agents. Omitted options use the current settings in the page.',
      inputSchema:{type:'object',properties:{
        agent:{type:'string',enum:ids,description:'Agent id from list_agents.'},
        text:{type:'string',description:'What to do, in plain language.'},
        priority:{type:'string',enum:['Bình thường','Ưu tiên cao','Khẩn cấp'],default:'Bình thường'},
        runOn:{type:'string',enum:['machine','sim']},
        model:{type:'string',enum:['auto',...Object.keys(MODELS)]},
        effort:{type:'string',enum:['auto',...Object.keys(EFFORTS)]},
        workflow:{type:'boolean',description:'Only for the director: plan and split into steps.'},
        web:{type:'boolean',description:'Allow browser automation for web tasks (personal machine only).'}},required:['agent','text']},
      annotations:{consequentialHint:true},
      execute:async({agent,text,priority,runOn,model,effort,workflow,web})=>{const j=await submitTask({agentId:agent,text,priority,where:runOn,model,effort,workflow,web});return out({ok:true,...brief(j)})}},
    {name:'ask_task',description:'Ask a follow-up question about a finished personal-machine task. The agent continues the same conversation, so the question does not need to repeat the task. The answer arrives later: poll get_task and read the last item of thread.',
      inputSchema:{type:'object',properties:{key:keyArg.properties.key,text:{type:'string',description:'The follow-up question.'}},required:['key','text']},annotations:{consequentialHint:true},
      execute:async({key,text})=>{const j=find(key);if(!j.remote||j.status!=='done'||j.kind==='plan')throw new Error('Chỉ hỏi thêm được việc đã hoàn thành trên máy cá nhân');await askJob(j,String(text||''));return 'Đã gửi câu hỏi thêm cho '+key+'; xem câu trả lời bằng get_task'}},
    {name:'cancel_task',description:'Stop a running task on the personal machine.',inputSchema:keyArg,annotations:{consequentialHint:true},
      execute:async({key})=>{const j=find(key);if(!j.remote||GROUP[j.status]!=='running')throw new Error('Chỉ dừng được việc đang chạy trên máy cá nhân');await cancelJob(j);return 'Đã yêu cầu dừng '+key}},
    {name:'retry_task',description:'Run a failed or stopped task again (a workflow step also re-queues the steps after it).',inputSchema:keyArg,annotations:{consequentialHint:true},
      execute:async({key})=>{const j=find(key);if(GROUP[j.status]!=='error')throw new Error('Chỉ thử lại được việc lỗi hoặc đã dừng');await retryJob(j);return 'Đang thử lại '+key}},
    {name:'set_scene',description:'Change the scenery outside the office windows.',
      inputSchema:{type:'object',properties:{scene:{type:'string',enum:Object.keys(scenes),description:Object.entries(scenes).map(([k,s])=>`${k}: ${s.label}`).join(', ')}},required:['scene']},
      execute:async({scene})=>{if(!scenes[scene])throw new Error('Không có bối cảnh: '+scene);applyScene(scene);return 'Đã đổi bối cảnh: '+scenes[scene].label}},
  ];
  // Chrome turns a thrown error into an opaque "UnknownError"; return the message instead so the agent can correct itself
  const safe=t=>({...t,execute:async(args,opts)=>{try{return await t.execute(args??{},opts)}catch(e){return 'Lỗi: '+(e?.message||e)}}});
  for(const t of tools)Promise.resolve().then(()=>mc.registerTool(safe(t),{signal:ctl.signal})).catch(e=>console.warn('WebMCP:',t.name,e));
  console.info(`WebMCP: đã đăng ký ${tools.length} công cụ`);
  return {unregister:()=>ctl.abort()};
}
