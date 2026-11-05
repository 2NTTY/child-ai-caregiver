import {normalizeSection} from './model.mjs';
import {fixture,SCENARIOS} from './content.mjs';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
export function createHost({section,pending=false,readMethods=async scenario=>{await new Promise(r=>setTimeout(r,350));return fixture(scenario)}}={}){
 let alive=true,request=0,publication=0,routeSection=normalizeSection(section);
 let state={context:{identity:'synthetic-a',scope:'synthetic-child-a',epoch:1},lifetime:1,section:pending?'assistant':routeSection,layout:'index',query:'',pending:!!pending,reading:false,scenario:'google',summary:fixture('google')};
 const listeners=new Set();
 const getSnapshot=()=>freeze(structuredClone(state));
 // Reentrant publication is latest-state delivery, not an event log. A nested
 // emission retires the remaining notifications of the outer snapshot.
 const emit=()=>{
  const revision=++publication,snapshot=getSnapshot();
  for(const registration of [...listeners]){
   if(!alive||revision!==publication)break;
   if(listeners.has(registration))registration.fn(snapshot);
  }
 };
 const valid=n=>alive&&n===state.lifetime;
 const host={getSnapshot,subscribe(fn){if(!alive)return()=>{};const registration={fn};listeners.add(registration);return()=>listeners.delete(registration)},
  intent(n,fn){if(!valid(n))return false;fn();return true},
  select(key){if(!alive||normalizeSection(key)!==key)return false;state.section=key;emit();return true},
  setLayout(layout){if(!alive||!['index','atlas'].includes(layout))return false;state.layout=layout;emit();return true},
  setQuery(query){if(!alive)return false;state.query=String(query);emit();return true},
  setPending(value){if(!alive)return false;const next=!!value;if(next===state.pending)return false;state.pending=next;if(next)state.section='assistant';emit();return true},
  setRouteSection(value){if(!alive)return false;const next=normalizeSection(value);if(next===routeSection)return false;routeSection=next;state.section=next;emit();return true},
  setContext(patch){if(!alive)return false;const next={...state.context,...patch};if(['identity','scope','epoch'].every(k=>next[k]===state.context[k]))return false;request++;state={...state,context:next,lifetime:state.lifetime+1,summary:{status:'unknown',providers:[]},reading:false,query:''};emit();return true},
  setScenario(name){if(!alive||!SCENARIOS.some(s=>s[0]===name))return false;request++;state.scenario=name;state.summary=fixture(name);state.reading=false;emit();return true},
  async read(){if(!alive||state.reading)return false;const n=state.lifetime,id=++request,scenario=state.scenario;state.reading=true;emit();if(!valid(n)||id!==request)return false;
   try{const value=await readMethods(scenario);if(!valid(n)||id!==request)return false;state.summary=structuredClone(value)}catch{if(!valid(n)||id!==request)return false;state.summary={status:'error',providers:[]}}
   state.reading=false;emit();return true;
  },
  dispose(){alive=false;request++;listeners.clear()}
 };return host;
}
