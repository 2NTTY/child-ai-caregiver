/** Bounded synthetic shell presentation. Task state belongs only to the existing owner. */
import {createContext,createElement as h,useContext,useMemo,useState} from 'react';
import {Text} from 'react-native-paper';
import {useTasksOwner} from './TasksOwner.mjs';import {taskChild} from './tasks-seed.mjs';
import {TasksWorkspaceProvider} from '../workspaces/TasksWorkspace';
import {headerOperationHints} from '../header-operation-hints';
/** @type {import('react').Context<import('./HostPorts.types').HostPort|null>} */
const Context=createContext(null);
/** @param {{children?: import('react').ReactNode}} props */
export function HostBridge({children}){
 const task=useTasksOwner();const [chatDraft,setChatDraft]=useState('');
 /** @param {import('../view-model').HomeDestination} destination */
 const open=destination=>task.requestRoute(`/${destination}`);
 /** @type {import('../view-model').HomeActions} */
 const actions=useMemo(()=>({selectChild:id=>{if(id!==taskChild.id)return open('profile');},refresh:()=>open('profile'),open,
  reviewOperation:()=>open('profile'),openAgentPhoto:()=>open('chat'),composeCare:()=>open('chat'),prepareQuestion:()=>open('chat'),
  createChildPreview:()=>open('profile'),deleteChildPreview:()=>open('profile'),completeGuidePreview:()=>open('guide')}),[task.requestRoute]);
 /** @type {import('../view-model').HomeViewModel} */
 const home={caregiverName:'媽媽',children:[taskChild],selectedChildId:taskChild.id,connection:'online',recordsLoad:'ready',profileLoad:'ready',records:[],lastReadLabel:null,
  operation:{state:'none',title:'',detail:''},focus:{kind:'unavailable',detail:'此預覽尚未接入跨頁待辦與提醒摘要。請在待辦頁查看已載入示例。'},guideStatus:'complete'};
 /** @type {import('./HostPorts.types').HostPort} */
 const value={model:home,actions,scopeKey:task.scopeKey,identityKey:'workbench-synthetic-session',notice:task.notice,
  dismissNotice:task.dismissNotice,chatDraft,setChatDraft,openAgentDraft:()=>open('chat')};
 const workspace={scopeKey:task.scopeKey,model:{...task.model,readState:task.model.reading?'loading':'ready'},actions:task.actions,recovery:task.recovery};
 return h(Context.Provider,{value},h(TasksWorkspaceProvider,{scopeKey:task.scopeKey,value:workspace},
  h(Text,{accessibilityRole:'note',testID:'workbench-synthetic-notice'},'合成示例 · 未接駁 Server · 沒有傳送真實資料'),children));
}
export function useHomePort(){const value=useContext(Context);if(!value)throw Error('WORKBENCH_HOST_REQUIRED');return value;}
export function useProduction(){return useHomePort();}
export function useHeaderOperationHints(){const owner=useTasksOwner();return headerOperationHints([{id:'tasks',page:'待辦',state:owner.model.operation.state,onReview:()=>owner.requestRoute('/tasks')}]);}
/** @returns {import('./HostPorts.types').SwitchReadiness} */
export function useProductionSwitchReadiness(){const owner=useTasksOwner();return {key:owner.scopeKey,state:owner.model.reading?'loading':'ready'};}
/** @returns {import('./HostPorts.types').HistoryScopePort|null} */
export function usePersonalHistoryWorkspace(){return null;}
/** @param {import('./HostPorts.types').NotificationPortProps} _props */
export function PersonalNotificationContent(_props){return h(Text,null,'此待辦預覽未接入最近消息；沒有讀取或傳送通知。');}
/** @param {import('./HostPorts.types').QuickInputPortProps} _props */
export function MobileQuickInputDock(_props){return h(Text,null,'此待辦預覽未接入快速輸入。');}
