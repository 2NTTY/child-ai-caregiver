import {CATEGORIES} from './content.mjs';
export function normalizeSection(value){const first=Array.isArray(value)?value[0]:value;return CATEGORIES.some(c=>c.key===first)?first:'account'}
export function scopeNote(section){return section==='children'?'可存取的孩子':section==='assistant'?'目前孩子':'本人設定'}
export function projectSummary(summary){
 if(summary?.status==='error')return{kind:'error',title:'合成摘要讀取失敗',labels:[],note:'無法確認目前已連結方式；這不代表沒有登入方式。'};
 if(summary?.status!=='ready'||!Array.isArray(summary.providers)||summary.providers.some(p=>typeof p!=='string'||!p.trim()))return{kind:'unknown',title:'尚未確認已連結方式',labels:[],note:'目前沒有可用摘要，請勿據此推斷登入能力。'};
 const labels=[...new Set(summary.providers)].map(p=>p==='password'?'電郵及密碼':p==='google.com'?'Google':p==='apple.com'?'Apple':`未辨識方式（${p}）`);
 return labels.length?{kind:'ready',title:'已連結方式',labels,note:'僅投影合成資料，不代表可執行登入、驗證或連結操作。'}:{kind:'empty',title:'摘要沒有列出已連結方式',labels:[],note:'已讀取的合成清單是空白；不推斷帳戶的登入能力。'};
}
export function filterCategories(query){const q=String(query??'').trim().toLocaleLowerCase();return CATEGORIES.filter(c=>`${c.label} ${c.key} ${c.kicker} ${c.description}`.toLocaleLowerCase().includes(q))}
