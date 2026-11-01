/** Source-only composition host: one actual Original owner, independent slot draft. */
import {createContext,createElement as h,useContext,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useTasksOwner} from './TasksOwner.mjs';
import {usePreviewNavigation} from '../preview/PreviewNavigationGuard';
import {createTasksPresentation} from './tasks-presentation.mjs';
import {bindSlotInteractions} from './tasks-slot-ports.mjs';
import {createState,setMode,pick,undo,restoreOriginal,saveDraft,loadDraft} from './draft.mjs';
import catalog from './candidate-catalog.json';
import {renderers} from './TasksRenderers.mjs';
import {OriginalDetailAperture} from './variants/original/src/workbench/OriginalDetailAperture';
/** @type {import('react').Context<import('./TasksComposition.types').TasksCompositionValue|null>} */
const Context=createContext(null);
/** @param {{children?: import('react').ReactNode}} props */
export function TasksCompositionProvider({children}){
 const owner=useTasksOwner(),leave=usePreviewNavigation();
 const [draft,setDraft]=useState(()=>createState(catalog));
 const [store]=useState(()=>createTasksPresentation());
 const presentation=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const committed=useRef(null);
 useLayoutEffect(()=>{
  committed.current={owner,draft};
  store.commitOwner({identityKey:'original-synthetic:'+owner.scopeKey,scopeKey:owner.scopeKey,mode:owner.mode,model:owner.model,actions:owner.actions,requestLeave:fn=>leave(fn,'workspace')});
 },[owner,draft,leave,store]);
 useLayoutEffect(()=>()=>{committed.current=null;store.releaseOwner();},[store]);
 /** @type {import('./TasksComposition.types').TasksCompositionCommands} */
 const commands=useMemo(()=>{
  const select=fn=>{const c=committed.current;if(!c||c.owner.mode!=='pick')return false;setDraft(current=>fn(setMode(current,'pick')));return true;};
  return {pick:(slot,id)=>select(s=>pick(s,catalog,slot,id)),undo:()=>select(s=>undo(s,catalog)),restoreOriginal:()=>select(s=>restoreOriginal(s,catalog)),save:()=>saveDraft(committed.current.draft,catalog),load:text=>select(()=>loadDraft(text,catalog))};
 },[]);
 const slots=Object.fromEntries(Object.entries(draft.slots).map(([slot,v])=>[slot,v.variantId]));
 /** @type {import('./TasksComposition.types').TasksCompositionValue} */
 const value={...commands,state:{...draft,mode:owner.mode},slots,presentation,ports:store.bind(),store,owner,
  topActions:['care','handbook'].includes(slots.filters),
  layoutAside:({wide,showPanel,tab,readUnavailable,noPendingTasks})=>showPanel||(slots['calendar-layout']!=='care'&&wide&&tab==='pending'&&!readUnavailable&&(slots['calendar-layout']!=='handbook'||!noPendingTasks)),
 };
 return h(Context.Provider,{value},children);
}
export function useTasksComposition(){const c=useContext(Context);if(!c)throw Error('TASKS_COMPOSITION_REQUIRED');return c;}
function createNode(c,props){return c.slots['header-actions']==='harbour'?h(renderers.harbour.Create,props):null;}
export function OriginalHeaderActions(props){const c=useTasksComposition();props=bindSlotInteractions(c.store,props);const variant=c.slots['header-actions'],separateCreate=c.slots.filters==='harbour';return h(renderers[variant].Header,{...props,compact:separateCreate&&props.compact,createAction:createNode(c,props)});}
export function OriginalFilters(props){const c=useTasksComposition();props={...bindSlotInteractions(c.store,props),headerActionPorts:bindSlotInteractions(c.store,props.headerActionPorts)};return h(renderers[c.slots.filters].Filters,{...props,...c.ports,route:c.presentation.route,page:c.presentation.route.page,createAction:createNode(c,props.headerActionPorts)});}
export function OriginalDateList(props){const c=useTasksComposition();props=bindSlotInteractions(c.store,props);return h(renderers[c.slots['date-list']].DateList,{...props,...c.ports,route:c.presentation.route,...(c.slots['date-list']==='handbook'?{taskHref:c.ports.taskHref}:{})});}
/** @param {import('./TasksComposition.types').OriginalCalendarLayoutProps} props */
export function OriginalCalendarLayout(props){const c=useTasksComposition();props=bindSlotInteractions(c.store,props);const variant=c.slots['calendar-layout'];const detailUnit=!props.showPanel?null:variant==='care'?h(OriginalDetailAperture,{...props,showAside:true}):props.detailUnit;return h(renderers[variant].CalendarLayout,{...props,...c.ports,detailUnit});}
export function useCommittedNavigationAuthority(){const c=useTasksComposition(),token=c.store.authority();return {isCurrent:()=>c.store.isCurrent(token)};}
export function useCompositionRouter(){const c=useTasksComposition(),ports=c.ports;return {push:href=>{if(typeof href==='object'&&href.pathname==='/tasks')return ports.openHref(href);c.owner.requestRoute(typeof href==='string'?href:'/unavailable');}};}
