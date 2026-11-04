// Agents leave their desk now and then, walk the office aisles to a spot (pantry counter, water dispenser, cafe table,
// bookshelf, window, lounge or a colleague's desk), hang around for a bit and walk back. Busy agents return to their desk.
// Aisle graph in office coordinates (see office.js): nodes are [x,z], edges are walkable straight segments.
// Layout: open pod back-left (agents at z=-1.6), main aisle z=-.7, glass room front-left (door at x≈.15 on z=.6),
// wooden desk by the left window, lounge in front of the TV (back right), pantry + cafe table front-right.
const N={
  // main aisle in front of the open pod
  cA:[-4.4,-.7],cB:[-3.75,-.7],cC:[-2.9,-.7],cD:[-1.4,-.7],cE:[.22,-.7],cF:[.6,-.7],
  // glass room: outside door, inside door, front lane and the two desks
  gOut:[.22,.05],gIn:[.22,1.1],g2:[.22,3.4],bkd:[-1.0,3.4],frd:[-2.5,3.4],
  // lane down to the wooden desk by the left window
  dl:[-3.75,3.4],dsd:[-4.55,3.4],
  // right half: lounge, pantry, bookshelf lane
  l0:[1.6,-.3],p0:[1.8,1.9],e0:[4.85,.35],eb:[4.85,-2.9],
  // destinations
  win:[-5.0,-.45],lounge1:[2.1,.3],lounge2:[3.9,.35],cooler:[2.6,1.9],counter:[4.2,1.9],cafe1:[3.2,2.9],cafe2:[4.6,2.9],book:[4.6,-3.05]
};
// Added space (see office.js): a spine at x=5.9 from the lounge lane down to the front, an aisle in front of each new
// desk row (A: z=.35, B: z=3.35, C: z=7.15, D: z=10.95; one node per desk), the meeting room and the break area
export const ROW_X=[6.9,8.65,10.4,12.15,13.9,15.65];
Object.assign(N,{sp0:[5.9,.35],sp1:[5.9,3.35],bk5:[5.9,4.8],sp2:[5.9,7.15],sp3:[5.9,10.95],
  bk1:[1.6,4.8],bkL:[.6,4.8],mIn:[.6,6.1],nlE:[.6,6.9],mR:[.98,8.5],flE:[.75,10.15],nlW:[-4.6,6.9],flW:[-4.6,10.15],
  bk2:[1.6,7.8],bk3:[1.6,11.0],endA:[16.45,.35],endB:[16.45,3.35],endC:[16.45,7.15],endD:[16.45,10.95],lg1:[2.3,7.8],lg2:[4.1,7.85],lg3:[2.3,11.0],lg4:[4.1,11.05],cf3:[13.95,4.4],cl2:[15.8,4.4]});
const ROWS={rA:[.35,'sp0'],rB:[3.35,'sp1'],rC:[7.15,'sp2'],rD:[10.95,'sp3']};
// Meeting room (office.js): seat 0 at the head of the table (the Director), 1–4 on the near side, 5–8 on the far side,
// 9 at the other end; a lane runs along each side of the table
const SEAT_X=[-3.6,-2.53,-1.47,-.4];
export const SEATS=[[-4.6,8.5,Math.PI/2],...SEAT_X.map(x=>[x,7.45,0]),...SEAT_X.map(x=>[x,9.55,Math.PI]),[.55,8.5,-Math.PI/2]];
SEATS.forEach(([x,z],i)=>N['seat'+i]=[x,z]);
SEAT_X.forEach((x,i)=>{N['nl'+i]=[x,6.9];N['fl'+i]=[x,10.15]});
for(const [k,[z]] of Object.entries(ROWS))ROW_X.forEach((x,i)=>N[k+i]=[x,z]);
const E=[['win','cA'],['cA','cB'],['cB','cC'],['cC','cD'],['cD','cE'],['cE','cF'],['cF','l0'],
  ['cE','gOut'],['gOut','gIn'],['gIn','g2'],['g2','bkd'],['bkd','frd'],['cB','dl'],['dl','dsd'],
  ['l0','lounge1'],['lounge1','lounge2'],['lounge2','e0'],['e0','eb'],['eb','book'],
  ['l0','p0'],['p0','cooler'],['cooler','counter'],['p0','cafe1'],['counter','cafe2'],
  ['e0','sp0'],['sp0','sp1'],['sp1','bk5'],['bk5','sp2'],['sp2','sp3'],
  ['p0','bk1'],['bk1','bk5'],['bk1','bkL'],['bkL','mIn'],['mIn','nlE'],['nlE','nl3'],['nl3','nl2'],['nl2','nl1'],['nl1','nl0'],['nl0','nlW'],['nlW','seat0'],
  ['nlE','mR'],['mR','seat9'],['mR','flE'],['flE','fl3'],['fl3','fl2'],['fl2','fl1'],['fl1','fl0'],['fl0','flW'],
  ...SEAT_X.flatMap((_,i)=>[['nl'+i,'seat'+(1+i)],['fl'+i,'seat'+(5+i)]]),
  ['rA5','endA'],['rB5','endB'],['rC5','endC'],['rD5','endD'],
  ['rB4','cf3'],['rB5','cl2'],['bk1','bk2'],['bk2','lg1'],['lg1','lg2'],['bk2','bk3'],['bk3','lg3'],['lg3','lg4'],
  ...Object.entries(ROWS).flatMap(([k,[,s]])=>[[s,k+'0'],...ROW_X.slice(1).map((_,i)=>[k+i,k+(i+1)])])];
const PI=Math.PI,HOME_YAW=.35,SPEED=.95;
const SPOTS=[['cooler',PI],['counter',PI],['cafe1',PI/2],['cafe2',-PI/2],['book',PI],['win',-PI/2],['lounge1',PI],['lounge2',PI],
  ['endA',PI/2],['endB',PI/2],['endC',PI/2],['endD',PI/2],['lg1',PI],['lg2',PI],['lg3',PI],['lg4',PI],['cf3',PI/2],['cl2',PI/2]];
const yawTo=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// Staff mostly stay at their desk; Leaders walk round their team (preferring people who are working) to check progress
// and cheer them on, sometimes bringing a drink from the pantry. onEvent(type,…) lets the app show it:
// 'desk' (agent, sitting at own desk?), 'pick' (leader took a drink), 'visit' (leader, member, {drink}), 'drop' (leader).
const DRINKS=['cooler','counter','cf3','cl2'];
export function createWander(agents,{isBusy=()=>false,onEvent=()=>{},maxOut=Math.max(3,Math.round(agents.length/4))}={}){
  const nodes={...N},adj={};
  const link=(a,b)=>{(adj[a]??=[]).push(b);(adj[b]??=[]).push(a)};
  E.forEach(([a,b])=>link(a,b));
  // agents without an aisle node (the stand-still desks) never leave their desk, but still sit down to work
  const walkers=agents.filter(a=>a.door);
  for(const a of walkers){nodes['h_'+a.id]=[a.x,a.z];link('h_'+a.id,a.door)}
  const dist=(a,b)=>Math.hypot(nodes[a][0]-nodes[b][0],nodes[a][1]-nodes[b][1]);
  function path(from,to){
    const d={[from]:0},prev={},todo=new Set([from]);
    while(todo.size){
      let u=null;for(const n of todo)if(u===null||d[n]<d[u])u=n;todo.delete(u);
      if(u===to)break;
      for(const v of adj[u]){const nd=d[u]+dist(u,v);if(d[v]===undefined||nd<d[v]){d[v]=nd;prev[v]=u;todo.add(v)}}
    }
    const out=[to];while(out[0]!==from)out.unshift(prev[out[0]]);return out.slice(1);
  }
  const taken=new Set();
  // first strolls spread over the first ~15 s whatever the office size (it used to grow with each agent's place in the list)
  // everyone starts seated at their desk, facing the screen
  const S=agents.map(a=>{const s={a,state:'home',at:'h_'+a.id,route:[],wait:2+Math.random()*13,yaw:HOME_YAW,face:HOME_YAW,spot:null,visit:null};
    if(a.sit){a.group.position.x=a.sit[0];a.group.position.z=a.sit[1];Object.assign(s,{state:'sitting',yaw:a.sit[2],face:a.sit[2]});a.char.setSit?.(true);onEvent('desk',a,true)}
    return s});
  const byId=Object.fromEntries(S.map(s=>[s.a.id,s]));
  const teamKey=a=>a.team||a.id,boss=a=>teamKey(a)==='Ban điều hành';
  // Leaders with people to look after: their own team, or every team's Leader (and a few others) for the Director
  for(const s of S)s.lead=s.a.level==='leader'&&!!s.a.door&&(boss(s.a)||S.some(o=>o!==s&&o.a.door&&teamKey(o.a)===teamKey(s.a)));
  const crew=s=>S.filter(o=>o!==s&&o.a.door&&o.a.sit&&(boss(s.a)?o.a.level==='leader'||o.a.id.length%5===0:teamKey(o.a)===teamKey(s.a)));
  const idleWait=s=>s.lead?10+Math.random()*18:120+Math.random()*180;
  for(const s of S)s.wait=s.lead?3+Math.random()*12:25+Math.random()*150;
  function patrol(s){
    const pool=crew(s).filter(o=>o.state==='sitting'&&!o.visitor&&!o.meet);if(!pool.length)return;
    const busy=pool.filter(o=>isBusy(o.a.id)),list=busy.length&&Math.random()<.75?busy:pool,o=list[Math.random()*list.length|0];
    const drinks=DRINKS.filter(k=>!taken.has(k)),drink=Math.random()<.3&&drinks.length?drinks[Math.random()*drinks.length|0]:null;
    if(drink){s.errand={to:o,spot:drink};s.spot=drink;taken.add(drink);go(s,drink,'go')}
    else{s.patrol=true;s.visit=o;s.spot=o.a.door;o.visitor=s;taken.add(s.spot);go(s,s.spot,'go')}
  }

  // Re-routing mid-segment first walks back to the last node passed so nobody cuts through furniture
  function go(s,to,state){
    const p=s.a.group.position,[x,z]=nodes[s.at];
    s.route=path(s.at,to);if(Math.hypot(p.x-x,p.z-z)>1e-3||!s.route.length)s.route.unshift(s.at);
    if(s.state==='sitting'||s.state==='tosit')onEvent('desk',s.a,false);
    s.state=state;s.a.char.setSit?.(false);s.a.char.setWalk(true);
  }
  function leave(s){
    const others=S.filter(o=>o!==s&&o.a.door&&(o.state==='home'||o.state==='sitting')&&!o.visitor);
    const free=SPOTS.filter(([k])=>!taken.has(k));
    if(others.length&&(Math.random()<.35||!free.length)){
      const o=others[Math.random()*others.length|0];
      s.visit=o;s.spot=o.a.door;o.visitor=s;
    }else if(free.length){
      const [k,yaw]=free[Math.random()*free.length|0];s.spot=k;s.face=yaw;
    }else{s.wait=3;return}
    taken.add(s.spot);go(s,s.spot,'go');
  }
  function release(s){if(s.spot)taken.delete(s.spot);if(s.visit)s.visit.visitor=null;if(s.errand?.got&&!s.errand.done)onEvent('drop',s.a);s.spot=s.visit=s.errand=null;s.patrol=false}
  function goHome(s){release(s);go(s,'h_'+s.a.id,'back')}

  // Planning meeting: id → seat index. The first id (the Director) gets the head of the table; seats are kept between calls
  let meeting=new Map();
  function setMeeting(ids){
    const next=new Map(),taken=new Set();
    for(const id of ids){if(!byId[id]||next.size>=SEATS.length)continue;const k=meeting.get(id);next.set(id,k);if(k!=null)taken.add(k)}
    for(const [id,k] of next)if(k==null){let i=0;while(taken.has(i))i++;next.set(id,i);taken.add(i)}
    meeting=next;
  }
  function update(dt){
    const out=S.filter(s=>s.state==='go'||s.state==='stay'||s.state==='back').length;
    for(const s of S){
      const g=s.a.group,busy=isBusy(s.a.id),seat=meeting.get(s.a.id);
      if(seat!=null&&s.meet!=='seat'+seat){release(s);if(s.visitor){const v=s.visitor;s.visitor=null;goHome(v)}s.meet='seat'+seat;go(s,s.meet,'meet')}
      else if(seat==null&&s.meet){s.meet=null;goHome(s)}
      if(busy&&(s.state==='go'||s.state==='stay'))goHome(s);
      const work=busy&&!s.meet&&s.a.sit;
      if(s.state==='meeting'){s.face=SEATS[+s.meet.slice(4)][2]}
      // at the desk an agent sits facing the screen (working or not); idle ones get up now and then for a stroll
      else if(s.state==='sitting'){if(!busy&&!s.visitor&&s.a.door&&(s.wait-=dt)<=0){if(out<maxOut)(s.lead?patrol:leave)(s);if(s.state==='sitting')s.wait=s.lead?4+Math.random()*6:idleWait(s)}}
      else if(s.state==='tosit'||s.state==='unsit'){
        // short straight step between the standing spot and the chair
        const [tx,tz]=s.state==='tosit'?s.a.sit:[s.a.x,s.a.z],dx=tx-g.position.x,dz=tz-g.position.z,d=Math.hypot(dx,dz),step=SPEED*.7*dt;
        if(d>1e-3)s.face=s.state==='tosit'&&d<.15?s.a.sit[2]:Math.atan2(dx,dz);
        if(d<=step){g.position.x=tx;g.position.z=tz;s.a.char.setWalk(false);
          if(s.state==='tosit'){s.state='sitting';s.face=s.a.sit[2];s.a.char.setSit?.(true);onEvent('desk',s.a,true);if(s.wait<=0)s.wait=idleWait(s)}else{s.state='home';s.face=HOME_YAW;s.wait=4+Math.random()*8}}
        else{g.position.x+=dx/d*step;g.position.z+=dz/d*step;s.a.char.setWalk(d>.25)}
        if(s.state==='unsit'&&work)s.state='tosit';
      }
      else if(s.state==='home'&&s.a.sit){s.state='tosit'}
      else if(s.state==='home'){
        // a colleague chatting at this desk gets looked at
        s.face=s.visitor&&s.visitor.state==='stay'?yawTo([g.position.x,g.position.z],nodes[s.visitor.spot]):HOME_YAW;
        if(!busy&&!s.visitor&&s.a.door&&(s.wait-=dt)<=0){if(out<maxOut)leave(s);else s.wait=2+Math.random()*3}
      }else if(s.state==='stay'){
        if(s.visit)s.face=yawTo(nodes[s.spot],[s.visit.a.group.position.x,s.visit.a.group.position.z]);
        if((s.wait-=dt)<=0)goHome(s);
      }else{
        const tgt=nodes[s.route[0]],dx=tgt[0]-g.position.x,dz=tgt[1]-g.position.z,d=Math.hypot(dx,dz),step=SPEED*dt;
        if(d>1e-4)s.face=Math.atan2(dx,dz);
        if(d<=step){
          g.position.x=tgt[0];g.position.z=tgt[1];s.at=s.route.shift();
          if(!s.route.length){
            s.a.char.setWalk(false);
            if(s.state==='meet'){s.state='meeting';s.a.char.setSit?.(true)}
            else if(s.state==='back'){s.state='home';s.face=HOME_YAW;s.wait=idleWait(s)}
            // drink picked up at the pantry: now take it to the colleague (if they are still at their desk)
            else if(s.errand&&!s.errand.got&&s.spot===s.errand.spot){
              s.errand.got=true;onEvent('pick',s.a);taken.delete(s.spot);const o=s.errand.to;
              if(o.state==='sitting'&&!o.visitor&&!o.meet){s.visit=o;s.spot=o.a.door;o.visitor=s;taken.add(s.spot);go(s,s.spot,'go')}else goHome(s)
            }
            else{s.state='stay';s.wait=s.visit?5+Math.random()*4:3+Math.random()*5;if(!s.visit)s.face=SPOTS.find(([k])=>k===s.spot)?.[1]??s.face;
              if(s.visit&&(s.patrol||s.errand?.got)){const drink=!!s.errand?.got;if(drink)s.errand.done=true;onEvent('visit',s.a,s.visit.a,{drink})}}
          }
        }else{g.position.x+=dx/d*step;g.position.z+=dz/d*step}
      }
      s.yaw+=wrap(s.face-s.yaw)*Math.min(1,dt*8);g.rotation.y=s.yaw;
    }
  }
  return {update,setMeeting,canWalk:id=>!!byId[id]?.a.door,isOut:id=>!!byId[id]&&byId[id].state!=='home'};
}
