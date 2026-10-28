import type { SharedChildState } from '../../../src/client/shared-child-controller.ts';
import type { SharedModule,SharedRefreshSelection } from '../../../src/shared/sharing.ts';
type Params={tab?:string;category?:string;view?:string};
/** UI projection of the current grant, never a replacement for Server authorization. */
export function sharedRouteModules(path:string,params:Params={}):readonly SharedModule[]|null {
  if(['/', '/family','/classes','/teachers','/settings','/more'].includes(path))return null;
  if(path==='/profile')return ['profile'];
  if(path==='/care')return params.view==='photos'?['attachments']:['care'];
  if(path==='/tasks')return ['tasks'];
  if(path==='/memory')return ['memory'];
  if(path==='/photos')return ['attachments'];
  if(path==='/growth'||path==='/summary')return params.tab==='preparation'?['documents']
    :params.tab==='archive'?['documents']:path==='/growth'?['growth','concerns']:[];
  if(path==='/history'){
    const map:Record<string,SharedModule[]>={profile:['profile'],preparations:['documents'],growth:['growth','concerns'],care:['care'],review:['care'],tasks:['tasks']};
    return map[params.category??'tasks']??[];
  }
  return [];
}
export function sharedRouteMessage(state:SharedChildState,path:string,params:Params={}):string|null {
  if(!state.target||['/family','/classes','/teachers','/settings','/more','/share'].includes(path))return null;
  if(!state.view)return state.error??'正在核對共享孩子及模組…';
  const modules=sharedRouteModules(path,params);
  if(modules?.length&&!modules.some(module=>state.view!.modules.includes(module)))return '這個家庭沒有共享此頁面的資料。可選擇其他已共享模組，或切回本人的孩子。';
  if(modules?.length===0)return '此功能尚未接通家庭共享範圍。你可以切回本人的孩子使用；私人聊天不會因加入家庭而公開。';
  return null;
}
export function sharedStartupReads(state:SharedChildState,reads:Record<string,'loading'|'ready'|'error'>){
  if(!state.target)return reads;
  const modules=state.view?.modules??[];
  const scoped:Record<string,readonly SharedModule[]>={profile:['profile'],care:['care'],careDetail:['care'],tasks:['tasks'],taskDetail:['tasks'],
    memory:['memory'],documents:['documents'],growth:['growth','concerns'],photos:['attachments']};
  const next={...reads};
  for(const [key,required] of Object.entries(scoped))if(!required.some(module=>modules.includes(module)))next[key]='ready';
  for(const key of ['agentPending','chat','conversations','notifications','summary','sources','contact','family'])next[key]='ready';
  return next;
}
export function sharedRefreshSelections(state:SharedChildState,path:string,params:Params={},railVisible=false):SharedRefreshSelection[]|undefined{
  const view=state.view;if(!view)return undefined;
  const visible=new Set<string>(['profile',...(path==='/'?['care','tasks','growth','concerns']:sharedRouteModules(path,params)??[]),
    ...(railVisible?['tasks','growth','concerns']:[])]);
  const modules=view.modules.filter(module=>visible.has(module));
  // Even an account-only route observes a valid grant so revocation is discovered.
  return (modules.length?modules:[view.modules[0]]).map(module=>({spaceId:view.spaceId,childId:view.childId,module}));
}
