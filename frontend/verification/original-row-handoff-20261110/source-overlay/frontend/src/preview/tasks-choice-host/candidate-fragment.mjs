// Candidate identifiers only. This transport never carries state or grants authority.
export const CANDIDATE_SLOTS=Object.freeze(['header-actions','filters','date-list','calendar-layout']);
const PREFIX='#tasks-candidate-v1=',LIMIT=4096,VARIANTS=['harbour','care','handbook','fourth'];
function validSlots(slots){
 if(!slots||typeof slots!=='object'||Array.isArray(slots)||Object.keys(slots).length!==4||!CANDIDATE_SLOTS.every(s=>Object.hasOwn(slots,s)))return false;
 return CANDIDATE_SLOTS.every(s=>slots[s]===null||(Array.isArray(slots[s])&&slots[s].length===2&&(VARIANTS.includes(slots[s][0])||(s==='date-list'&&slots[s][0]==='original'&&slots[s][1]==='original-row-fragment01'))&&typeof slots[s][1]==='string'&&/^[a-z0-9-]{1,64}$/.test(slots[s][1])));
}
export function decodeTaskCandidateFragment(hash){
 if(hash===''||typeof hash==='string'&&!hash.startsWith('#tasks-candidate-'))return {status:'none'};
 if(typeof hash!=='string'||hash.length>LIMIT||!hash.startsWith(PREFIX))return {status:'invalid'};
 try{
  const data=JSON.parse(decodeURIComponent(hash.slice(PREFIX.length)));
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==2||data.version!==1||!Object.hasOwn(data,'slots')||!validSlots(data.slots))return {status:'invalid'};
  return {status:'valid',slots:data.slots};
 }catch{return {status:'invalid'};}
}
export function encodeTaskCandidateFragment(slots){
 if(!validSlots(slots))return null;
 const hash=PREFIX+encodeURIComponent(JSON.stringify({version:1,slots}));
 return hash.length<=LIMIT?hash:null;
}
