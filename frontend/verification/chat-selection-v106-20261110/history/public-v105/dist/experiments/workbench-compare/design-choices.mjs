import {catalog} from './catalog.mjs';
import {routeAvailability} from './host-actions.mjs';

// Fingerprint of the retained catalog, not an adapter/composition acceptance receipt.
export const CATALOG_SHA256='c42b5657bb29b029f761c239a21573bc4a07ff03249316195be858f58d7b19e1';
export const TASK_PARTS=Object.freeze([
 Object.freeze({id:'header-actions',label:'頁首與操作'}),
 Object.freeze({id:'filters',label:'分類、搜尋與範圍'}),
 Object.freeze({id:'date-list',label:'日期分組與事項列'}),
 Object.freeze({id:'calendar-layout',label:'月曆布局'}),
]);
export const PAGE_LABELS=Object.freeze({index:'首頁',tasks:'待辦',care:'照顧記錄',chat:'助手',growth:'成長',memory:'記憶',guide:'指南',summary:'摘要',family:'家庭',profile:'孩子資料',photos:'照片',sources:'來源',contact:'聯絡',history:'歷史',settings:'設定',more:'更多',login:'登入畫面（不登入）',admin:'管理畫面（只讀）'});

export function resolveChoice(context,partId='page'){
 const {version,actualRoute,observation,rendered,visible}=context??{};
 if(!rendered || !visible || typeof actualRoute!=='string' || !/^\/(?!\/)/.test(actualRoute) || actualRoute.includes('\\'))return null;
 const pinned=catalog.versions.find(item=>item.id===version?.id);
 if(!pinned || ['sourceReference','main','mainSha256'].some(key=>pinned[key]!==version[key]))return null;
 let actualPath,route;
 try {
  actualPath=decodeURIComponent(new URL(actualRoute,'https://comparison.invalid').pathname);
  route=actualPath.replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index';
  if(route.startsWith('(dashboard)/'))route=route.slice(12);
 }catch{return null;}
 // Never export a free-form pathname, search term, token, fragment or case value.
 const paths=route==='index'?['/','/index','/index/','/index.html']:['/'+route,'/'+route+'/','/'+route+'.html','/(dashboard)/'+route,'/(dashboard)/'+route+'/','/(dashboard)/'+route+'.html'];
 if(!Object.hasOwn(PAGE_LABELS,route) || !paths.includes(actualPath) || !pinned.routes[route] || catalog.routeSupport[route]?.status!=='source-contract-bound-runtime-unverified')return null;
 const selectedCase=catalog.cases[catalog.routeSupport[route]?.caseKey??'ready'];
 if(!routeAvailability(observation,actualRoute,selectedCase.routes).available)return null;
 // Existing browser gaps remain viewable, but cannot be mistaken for valid picks.
 if(route==='photos' || route==='chat')return null;
 const part=partId==='page'?{id:'page',label:'整個頁面'}:route==='tasks'?TASK_PARTS.find(part=>part.id===partId):null;
 if(!part)return null;
 const payload=pinned.routes[route];
 return Object.freeze({id:`${pinned.id}:${actualPath}:${part.id}`,variantId:pinned.id,versionLabel:pinned.label,route,actualPath,pageLabel:PAGE_LABELS[route],partId:part.id,partLabel:part.label,catalogSha256:CATALOG_SHA256,baselineCommit:catalog.baselineCommit,baselineManifestSha256:catalog.baselineManifestSha256,sourceReference:pinned.sourceReference,main:pinned.main,mainSha256:pinned.mainSha256,payloadPath:payload.path,payloadSha256:payload.sha256});
}

export function createChoiceList(){
 const selected=new Map();
 return Object.freeze({
  add(context,partId='page'){
   const choice=resolveChoice(context,partId);
   if(!choice)return {status:'unavailable'};
   if(selected.has(choice.id))return {status:'duplicate',choice:selected.get(choice.id)};
   selected.set(choice.id,choice);return {status:'added',choice};
  },
  remove(id){return selected.delete(id);},
  items(){return [...selected.values()];},
  summary(){
   const selections=[...selected.values()];
   const labels=selections.map((choice,index)=>`${index+1}. ${choice.versionLabel}／${choice.pageLabel}／${choice.partLabel}`).join('\n');
   return '育伴港設計選擇\n這份清單只代表設計偏好，不是已驗組合候選，也不是完整 Original 驗收。\n貼回對話後，dot 會按這份選擇沿用設計；網頁不會自動同步。\n\n'+labels+'\n\n來源識別（無家庭或案例內容，未包含網址查詢參數）：\n'+JSON.stringify({schema:'yuy-design-choices-v1',selections},null,2);
  },
 });
}
