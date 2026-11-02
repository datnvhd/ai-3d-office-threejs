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
const E=[['win','cA'],['cA','cB'],['cB','cC'],['cC','cD'],['cD','cE'],['cE','cF'],['cF','l0'],
  ['cE','gOut'],['gOut','gIn'],['gIn','g2'],['g2','bkd'],['bkd','frd'],['cB','dl'],['dl','dsd'],
  ['l0','lounge1'],['lounge1','lounge2'],['lounge2','e0'],['e0','eb'],['eb','book'],
  ['l0','p0'],['p0','cooler'],['cooler','counter'],['p0','cafe1'],['counter','cafe2']];
// Where each agent steps out from its desk (also where colleagues stand to chat with it)
const DOOR={director:'cF',research:'cA',analyst:'cC',qa:'cD',frontend:'frd',backend:'bkd',designer:'dsd'};
const PI=Math.PI,HOME_YAW=.35,SPEED=.95;
const SPOTS=[['cooler',PI],['counter',PI],['cafe1',PI/2],['cafe2',-PI/2],['book',PI],['win',-PI/2],['lounge1',PI],['lounge2',PI]];
const yawTo=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

export function createWander(agents,{isBusy=()=>false,maxOut=3}={}){
  const nodes={...N},adj={};
  const link=(a,b)=>{(adj[a]??=[]).push(b);(adj[b]??=[]).push(a)};
  E.forEach(([a,b])=>link(a,b));
  for(const a of agents){nodes['h_'+a.id]=[a.x,a.z];link('h_'+a.id,DOOR[a.id])}
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
  const S=agents.map((a,i)=>({a,state:'home',at:'h_'+a.id,route:[],wait:2+i*1.7+Math.random()*4,yaw:HOME_YAW,face:HOME_YAW,spot:null,visit:null}));
  const byId=Object.fromEntries(S.map(s=>[s.a.id,s]));

  // Re-routing mid-segment first walks back to the last node passed so nobody cuts through furniture
  function go(s,to,state){
    const p=s.a.group.position,[x,z]=nodes[s.at];
    s.route=path(s.at,to);if(Math.hypot(p.x-x,p.z-z)>1e-3||!s.route.length)s.route.unshift(s.at);
    s.state=state;s.a.char.setWalk(true);
  }
  function leave(s){
    const others=S.filter(o=>o!==s&&o.state==='home'&&!o.visitor);
    const free=SPOTS.filter(([k])=>!taken.has(k));
    if(others.length&&(Math.random()<.35||!free.length)){
      const o=others[Math.random()*others.length|0];
      s.visit=o;s.spot=DOOR[o.a.id];o.visitor=s;
    }else if(free.length){
      const [k,yaw]=free[Math.random()*free.length|0];s.spot=k;s.face=yaw;
    }else{s.wait=3;return}
    taken.add(s.spot);go(s,s.spot,'go');
  }
  function release(s){if(s.spot)taken.delete(s.spot);if(s.visit)s.visit.visitor=null;s.spot=s.visit=null}
  function goHome(s){release(s);go(s,'h_'+s.a.id,'back')}

  function update(dt){
    const out=S.filter(s=>s.state!=='home').length;
    for(const s of S){
      const g=s.a.group,busy=isBusy(s.a.id);
      if(busy&&(s.state==='go'||s.state==='stay'))goHome(s);
      if(s.state==='home'){
        // a colleague chatting at this desk gets looked at
        s.face=s.visitor&&s.visitor.state==='stay'?yawTo([g.position.x,g.position.z],nodes[s.visitor.spot]):HOME_YAW;
        if(!busy&&!s.visitor&&(s.wait-=dt)<=0){if(out<maxOut)leave(s);else s.wait=2+Math.random()*3}
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
            if(s.state==='back'){s.state='home';s.face=HOME_YAW;s.wait=6+Math.random()*10}
            else{s.state='stay';s.wait=s.visit?5+Math.random()*4:3+Math.random()*5;if(!s.visit)s.face=SPOTS.find(([k])=>k===s.spot)[1]}
          }
        }else{g.position.x+=dx/d*step;g.position.z+=dz/d*step}
      }
      s.yaw+=wrap(s.face-s.yaw)*Math.min(1,dt*8);g.rotation.y=s.yaw;
    }
  }
  return {update,isOut:id=>byId[id].state!=='home'};
}
