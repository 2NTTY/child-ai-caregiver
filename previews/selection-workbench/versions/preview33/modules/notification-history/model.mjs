export const CHANNELS=[['web_push','網頁通知','01'],['native_push','Android 通知','02'],['telegram','Telegram','03']];
export const channelLabel=key=>CHANNELS.find(c=>c[0]===key)?.[1]??'未知渠道';
const hkDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'});
export function dateKey(value){const n=Date.parse(value);if(!Number.isFinite(n))return'';const parts=hkDate.formatToParts(new Date(n));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-')}
export function timeLabel(value){if(!Number.isFinite(Date.parse(value)))return'時間未提供';return new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}
export function validRange(from='',to=''){const valid=x=>!x||(/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(`${x}T00:00:00Z`))&&new Date(`${x}T00:00:00Z`).toISOString().slice(0,10)===x);return valid(from)&&valid(to)&&(!from||!to||from<=to)}
export const filterKey=f=>JSON.stringify([f.query??'',f.from??'',f.to??'']);
export const versionKey=m=>JSON.stringify(m.contents.map(c=>[c.channel,c.contentVersion]).sort((a,b)=>a[0].localeCompare(b[0])));
export function filterItems(items,{query='',from='',to=''}={}){const needle=query.trim().toLocaleLowerCase();return items.filter(m=>{const date=dateKey(m.sentAt);return(!from||date>=from)&&(!to||date<=to)&&(!needle||m.contents.some(c=>`${c.title??''}\n${c.body}`.toLocaleLowerCase().includes(needle)))})}
export function channelGroups(items){return CHANNELS.map(([key,label])=>({key,label,items:items.filter(m=>m.contents.some(c=>c.channel===key))})).filter(g=>g.items.length)}
export function dayGroups(items){const groups=new Map();for(const item of items){const key=dateKey(item.sentAt);if(!groups.has(key))groups.set(key,{key,label:key,items:[]});groups.get(key).items.push(item)}return[...groups.values()]}
export function selectionTuple(state,item){return JSON.stringify([state.lifetime,state.context.scope,state.window.scopeVersion,item.messageId,versionKey(item),filterKey(state.filters)])}
