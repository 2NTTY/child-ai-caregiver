/** Catalog syntax only: this module does not attest source bytes or runtime wiring. */
export const VARIANTS=Object.freeze(['original','harbour','care','handbook','fourth']);
export const SLOTS=Object.freeze(['header-actions','filters','date-list','calendar-layout']);
export const MODULE_KEYS=Object.freeze(['path','sha256','version','ownerContract']);
export function need(ok,code){if(!ok)throw new Error(code);}
export function record(value,keys){
 need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'INVALID_RECORD');
 const own=Reflect.ownKeys(value);need(own.length===keys.length&&own.every(k=>keys.includes(k)),'UNKNOWN_OR_MISSING_FIELD');
 for(const k of keys)need(Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'),'ACCESSOR_NOT_JSON');
}
export function sourcePin(value){
 need(value!==null&&typeof value==='object','INVALID_SOURCE_PIN');
 const kind=Object.getOwnPropertyDescriptor(value,'kind');need(kind&&Object.hasOwn(kind,'value')&&['git-commit','composite'].includes(kind.value),'INVALID_SOURCE_KIND');
 record(value,kind.value==='git-commit'?['kind','appCommit','sourceTree']:['kind','appCommit','sourceTree','recipeSha256']);
 need(typeof value.sourceTree==='string'&&/^[a-f0-9]{40}$/.test(value.sourceTree),'INVALID_SOURCE_TREE');
 if(value.kind==='git-commit')need(typeof value.appCommit==='string'&&/^[a-f0-9]{40}$/.test(value.appCommit),'INVALID_APP_COMMIT');
 else need(value.appCommit===null&&typeof value.recipeSha256==='string'&&/^[a-f0-9]{64}$/.test(value.recipeSha256),'INVALID_COMPOSITE_RECIPE');
}
export function modulePin(value){
 record(value,MODULE_KEYS);need(typeof value.path==='string'&&value.path.length<=512&&!/[\\\x00-\x20:?#%]/.test(value.path)&&!value.path.startsWith('/')&&value.path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'INVALID_MODULE_PATH');
 need(typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256),'INVALID_MODULE_SHA');
 need(typeof value.version==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.version)&&!['latest','current'].includes(value.version),'INVALID_MODULE_VERSION');
 need(value.ownerContract==='tasks-single-owner-v1','INVALID_OWNER_CONTRACT');
}
export function validateRegistry(registry){
 record(registry,['schemaVersion','capabilities','sources']);need(registry.schemaVersion===1,'UNKNOWN_REGISTRY_SCHEMA');
 record(registry.capabilities,['runtimeReady','selectable','dataMapped']);need(Object.values(registry.capabilities).every(v=>v===false),'RUNTIME_CAPABILITY_NOT_IMPLEMENTED');
 record(registry.sources,VARIANTS);
 for(const id of VARIANTS){const row=registry.sources[id];record(row,['status','reason','source','modules','sourceVerified','receiptSha256']);
  if(row.status==='unavailable'){need(typeof row.reason==='string'&&row.reason.trim()&&row.reason.length<=256&&row.source===null&&row.modules===null&&row.sourceVerified===false&&row.receiptSha256===null,'INVALID_UNAVAILABLE_ROW');continue;}
  need(row.status==='source-verified'&&row.reason===null&&row.sourceVerified===true&&typeof row.receiptSha256==='string'&&/^[a-f0-9]{64}$/.test(row.receiptSha256),'UNKNOWN_SOURCE_STATUS');sourcePin(row.source);record(row.modules,SLOTS);for(const slot of SLOTS)if(row.modules[slot]!==null)modulePin(row.modules[slot]);
 }return registry;
}
export function validateSelection(selection,slot){
 record(selection,['variantId','slotId','source','module']);need(VARIANTS.includes(selection.variantId)&&SLOTS.includes(slot)&&selection.slotId===slot,'INVALID_SELECTION_ID');sourcePin(selection.source);modulePin(selection.module);return selection;
}
export function getSelection(registry,variantId,slotId){
 validateRegistry(registry);need(VARIANTS.includes(variantId)&&SLOTS.includes(slotId),'UNKNOWN_VARIANT_OR_SLOT');const row=registry.sources[variantId];
 need(row.status==='source-verified'&&row.modules[slotId]!==null,'UNAVAILABLE');
 return structuredClone({variantId,slotId,source:row.source,module:row.modules[slotId]});
}
export function selectionEquals(a,b){return a===null||b===null?a===b:a.variantId===b.variantId&&a.slotId===b.slotId&&a.source.kind===b.source.kind&&a.source.appCommit===b.source.appCommit&&a.source.sourceTree===b.source.sourceTree&&a.source.recipeSha256===b.source.recipeSha256&&MODULE_KEYS.every(k=>a.module[k]===b.module[k]);}
