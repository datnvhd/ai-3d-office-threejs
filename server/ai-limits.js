// Usage limits of the AI plans (Claude: 5-hour / daily / weekly; ChatGPT/Codex: 5-hour / weekly). When a run is refused
// because the plan's limit is used up, the task runner switches the work to the other engine until the limit resets,
// and tells the user when both are used up. This file only reads the CLIs' messages: is it a limit, and until when.
export const ENGINE_NAME={claude:'Claude',codex:'Codex'};

const LIMIT_RE={
  claude:/usage limit|limit reached|hit your (?:\w+ )?limit|(?:5-hour|five-hour|session|daily|weekly|opus|sonnet) limit|out of (?:extra )?usage|rate_limit_error|usage_limit|exceeded your (?:current )?quota/i,
  codex:/usage limit|usage_limit_reached|hit your (?:\w+ )?limit|rate limit reached|rate_limit_exceeded|quota exceeded|exceeded your (?:current )?quota|too many requests/i,
};
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const UNIT={d:864e5,day:864e5,days:864e5,h:36e5,hr:36e5,hrs:36e5,hour:36e5,hours:36e5,m:6e4,min:6e4,mins:6e4,minute:6e4,minutes:6e4,s:1e3,sec:1e3,secs:1e3,second:1e3,seconds:1e3};

// When the limit resets, from the message; null when it does not say
export function parseReset(text,now=Date.now()){
  const t=String(text||'');
  let m=t.match(/\|(\d{10})\b/)||t.match(/resets?_?at["'\s:=]+(\d{10})\b/i);// epoch seconds (older Claude Code, JSON fields)
  if(m)return +m[1]*1000;
  m=t.match(/resets?_in_seconds["'\s:=]+(\d+)/i);
  if(m)return now+ +m[1]*1000;
  // "try again in 2 days 3 hours 5 minutes", "resets in 4h 30m"
  m=t.match(/\bin\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+)/i);
  if(m){let ms=0;for(const [,n,u] of m[1].matchAll(/(\d+)\s*([a-z]+)/gi))ms+=(+n)*(UNIT[u.toLowerCase()]||0);if(ms)return now+ms}
  // "resets 3pm", "resets at 3:05 PM", "try again at 15:05", optionally with a date "Nov 8" / "8 Nov"
  m=t.match(/(?:resets?|try again|available again)\b[^.\n]{0,40}?(?:\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})|\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?[,\s]*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if(m&&(m[7]||m[6]!=null)){
    let h=+m[5],min=+(m[6]||0);const ap=(m[7]||'').toLowerCase();
    if(ap==='pm'&&h<12)h+=12;if(ap==='am'&&h===12)h=0;
    if(h>23||min>59)return null;
    const d=new Date(now);d.setSeconds(0,0);d.setHours(h,min);
    const mon=m[1]||m[4],day=m[2]||m[3];
    if(mon){d.setMonth(MONTHS.indexOf(mon.slice(0,3).toLowerCase()),+day);if(d.getTime()<now-864e5)d.setFullYear(d.getFullYear()+1)}
    else if(d.getTime()<=now)d.setDate(d.getDate()+1);
    return d.getTime();
  }
  return null;
}

// {until, message} when the run failed because the plan's usage limit is used up; null otherwise.
// A bare HTTP 429 without a limit message is treated as a short limit (10 minutes).
export function detectLimit(engine,{text='',status=null}={},now=Date.now()){
  const s=String(text||'');
  const hit=LIMIT_RE[engine]?.test(s);
  if(!hit&&status!==429)return null;
  const line=(s.split('\n').map(l=>l.trim()).find(l=>LIMIT_RE[engine]?.test(l))||s.trim()||`HTTP ${status}`).slice(0,300);
  const until=parseReset(s,now)??now+(hit?60:10)*6e4;
  return {until:Math.max(until,now+6e4),message:line,known:parseReset(s,now)!=null};
}
