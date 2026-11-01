/** One actual source Tasks owner. This context adds presentation ports, never task state. */
import {createContext,createElement,useContext,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useTasksPreview} from '../preview/useTasksPreview';
import {taskChild} from './tasks-seed.mjs';
import {routeSupport} from './route-support.mjs';
const Context=createContext(null);
const scopeKey=JSON.stringify(['preview-server','媽媽',taskChild.id,taskChild.accessRole]);
const actionNames=['selectTask','closePanel','startCreate','startChange','reviewDraft','editDraft','submitReviewed','useLatestVersion','showHistory','loadOlderHistory','loadMoreTasks'];
const recoveryNames={checkOriginalOperation:'check',retryOriginalOperation:'retryOriginal',reloadCurrent:'reloadCurrent'};
const slots=['header-actions','filters','date-list','calendar-layout'];
export function TasksOwnerProvider({mode,children}){
 if(mode!=='operation'&&mode!=='pick')throw Error('INVALID_WORKBENCH_MODE');
 const owner=useTasksPreview(taskChild,true,false,scopeKey,'tasks');
 const current=useRef(null);
 // Speculative renders must not grant authority to callbacks from the committed tree.
 useLayoutEffect(()=>{
  const committed={mode,owner};current.current=committed;
  return()=>{if(current.current===committed)current.current=null;};
 },[mode,owner]);
 const [notice,setNotice]=useState('');
 const ports=useMemo(()=>{
  const allowed=()=>current.current?.mode==='operation'&&current.current.owner.scopeReady;
  const actions=Object.fromEntries(actionNames.map(name=>[name,(...args)=>{if(allowed())return current.current.owner.actions[name](...args);} ]));
  const recovery=Object.fromEntries(Object.entries(recoveryNames).map(([name,target])=>[name,()=>{if(allowed())return current.current.owner.controller[target]();}]));
  function requestRoute(path){if(!allowed())return {status:'blocked',reason:'PICK_MODE'};const support=routeSupport(path);if(support.status==='unavailable')setNotice('此預覽未接入這個頁面；沒有傳送或保存任何內容。');return support;}
  return {actions,recovery,routeSupport,requestRoute,dismissNotice:()=>setNotice('')};
 },[]);
 const model={...owner.model,operation:{...owner.model.operation,referenceLabel:owner.model.operation.reference?`合成操作參考：${owner.model.operation.reference}；不是 Server opId。`:undefined}};
 return createElement(Context.Provider,{value:{scopeKey,model,mode,notice,...ports}},children);
}
export function useTasksOwner(){const owner=useContext(Context);if(!owner)throw Error('TASKS_OWNER_REQUIRED');return owner;}
export function useTasksSlot(slot){const owner=useTasksOwner();if(!slots.includes(slot))throw Error('UNKNOWN_TASKS_SLOT');return owner;}
