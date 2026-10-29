export type RouteParams = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined): string | null => typeof value === 'string' && value.length ? value : null;
function choice<const T extends readonly string[]>(value: string | string[] | undefined, values: T, fallback: T[number]): T[number] { const v=scalar(value); return v && values.includes(v) ? v : fallback; }
function page(value: string | string[] | undefined): number { const v=scalar(value); if (!v || !/^\d+$/.test(v)) return 0; const n=Number(v); return Number.isSafeInteger(n) ? n : 0; }
function day(value: string | string[] | undefined): string | null { const v=scalar(value); if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; const n=Date.parse(`${v}T00:00:00Z`); return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v?v:null; }
function month(value: string | string[] | undefined): string | null { const v=scalar(value); return v && day(`${v}-01`) ? v : null; }
const fields = (values: Record<string, string | number | null | boolean>): Record<string,string> => Object.fromEntries(Object.entries(values).filter(([,value])=>value!==null).map(([key,value])=>[key,String(value)]));
export function parseTaskRoute(p:RouteParams){return{taskId:scalar(p.taskId),tab:choice(p.tab,['pending','completed'],'pending'),filter:choice(p.filter,['near','earlier','later','all','review','unconfirmed'],'near'),page:page(p.page),day:day(p.day),month:month(p.month)};}
export type TaskRouteState=ReturnType<typeof parseTaskRoute>;
export function serializeTaskRoute(v:TaskRouteState){return fields({taskId:v.taskId,tab:v.tab,filter:v.filter,page:v.page,day:v.day,month:v.month});}
export function parseGrowthRoute(p:RouteParams){return{tab:choice(p.tab,['concerns','preparation'],'concerns'),concernId:scalar(p.concernId),documentId:scalar(p.documentId)};}
export function serializeGrowthRoute(v:ReturnType<typeof parseGrowthRoute>){return fields({tab:v.tab,concernId:v.concernId,documentId:v.documentId});}
export function parseSourceRoute(p:RouteParams){return{sourceId:scalar(p.sourceId)};}
export function serializeSourceRoute(v:ReturnType<typeof parseSourceRoute>){return fields({sourceId:v.sourceId});}
export function parsePhotoRoute(p:RouteParams){return{tab:choice(p.tab,['photos','voices','files'],'photos'),photoId:scalar(p.photoId)};}
export function serializePhotoRoute(v:ReturnType<typeof parsePhotoRoute>){return fields({tab:v.tab,photoId:v.photoId});}
export function parseMemoryRoute(p:RouteParams){return{tab:choice(p.tab,['long','short','references'],'long'),factId:scalar(p.factId)};}
export function serializeMemoryRoute(v:ReturnType<typeof parseMemoryRoute>){return fields({tab:v.tab,factId:v.factId});}
export function parseSettingsRoute(p:RouteParams){return{section:choice(p.section,['account','children','family','preferences','notifications','model','assistant','privacy'],'account')};}
export function serializeSettingsRoute(v:ReturnType<typeof parseSettingsRoute>){return fields({section:v.section});}
export function parseHistoryRoute(p:RouteParams){const from=day(p.from),to=day(p.to);return{category:choice(p.category,['tasks','preparations','review','care','profile','conversations','growth','notifications'],'tasks'),status:choice(p.status,['all','important_pending','pending','written','confirmed','skipped','not_required'],'all'),older:scalar(p.older)==='1',from:from&&to&&from>to?null:from,to:from&&to&&from>to?null:to,page:page(p.page),recordId:scalar(p.recordId)};}
export function serializeHistoryRoute(v:ReturnType<typeof parseHistoryRoute>){return fields({category:v.category,status:v.status,older:v.older?'1':null,from:v.from,to:v.to,page:v.page,recordId:v.recordId});}
export function parseSummaryRoute(p:RouteParams){return{tab:choice(p.tab,['overview','archive','preparation','legacy-preparation'],'overview'),documentId:scalar(p.documentId)};}
export function serializeSummaryRoute(v:ReturnType<typeof parseSummaryRoute>){return fields({tab:v.tab,documentId:v.documentId});}
