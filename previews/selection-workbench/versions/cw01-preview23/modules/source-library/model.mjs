// Read-only presentation parity with pinned sourceReadiness; not a wire contract or authority.
export const fetchLabels={not_requested:'未要求取得',running:'正在取得正文',ready:'正文已保存',failed:'取得失敗',unknown:'取得結果未知'};
export const extractionLabels={not_requested:'未要求提取',running:'正在提取',available:'未確認候選',failed:'提取失敗',unknown:'提取結果未知'};
export const kindLabels={personal_source:'私人素材',paste:'貼上文字',public_source:'公共來源條目'};
export function readiness(input,model){const excerpt=input.management?.modelExcerpt;
 const state=input.management?.enabled===false?['已停用','neutral']:model.readState!=='ready'||model.access==='lost'?['來源狀態待核對','warning']:!input.text.trim()?input.fetchState==='running'?['正在取得正文','info']:input.fetchState==='failed'?['取得失敗','error']:input.fetchState==='unknown'?['取得結果待核對','warning']:['尚未取得正文','neutral']:!excerpt?.trim()?['尚未授權 Agent','neutral']:!input.sha256?['正文完整性待核對','warning']:!input.text.includes(excerpt)?['授權片段待核對','warning']:excerpt.length>6000?['授權片段超出讀取上限','warning']:['可供 Agent 讀取','success'];
 return {label:state[0],tone:state[1],indexLabel:'未建立向量索引'};
}
export const laneLabels={unknown:'原次結果待核對',failed:'處理未成功',awaiting:'等待正文',review:'候選待人工核對',reading:'正文閱讀',disabled:'已停用'};
export function lane(x){return x.management?.enabled===false?'disabled':[x.fetchState,x.extraction.state].includes('unknown')?'unknown':[x.fetchState,x.extraction.state].includes('failed')?'failed':!x.text.trim()?'awaiting':x.extraction.state==='available'&&!x.recordId?'review':'reading'}
export function filtered(s){return s.items.filter(x=>(s.filter==='all'||lane(x)===s.filter)&&(!s.query||`${x.sourceLabel} ${x.id} ${kindLabels[x.kind]}`.toLocaleLowerCase().includes(s.query.toLocaleLowerCase())))}
export function page(s){const rows=filtered(s),count=Math.max(1,Math.ceil(rows.length/s.pageSize)),index=Math.max(0,Math.min(s.page,count-1));return{rows:rows.slice(index*s.pageSize,(index+1)*s.pageSize),count,index,totalLoaded:rows.length}}
export function grouped(s){const rows=page(s).rows,keys=s.mode==='shelf'?Object.keys(kindLabels):Object.keys(laneLabels);return keys.map(key=>({key,label:(s.mode==='shelf'?kindLabels:laneLabels)[key],rows:rows.filter(x=>(s.mode==='shelf'?x.kind:lane(x))===key)})).filter(x=>x.rows.length)}
