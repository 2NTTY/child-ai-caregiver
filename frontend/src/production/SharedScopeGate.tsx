import type { ReactNode } from 'react';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { Text } from 'react-native-paper';
import { PageFrame } from '../components/PageFrame';
import { AppButton } from '../components/ui';
import { useProduction } from './ProductionProvider';
import { sharedRouteMessage } from './shared-route-access';
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
export function SharedScopeGate({children}:{children:ReactNode}){
  const {sharedChild,owner,online,actions}=useProduction();
  const path=usePathname(),params=useGlobalSearchParams<{tab?:string|string[];category?:string|string[];view?:string|string[]}>();
  const message=sharedRouteMessage(sharedChild,path,{tab:first(params.tab),category:first(params.category),view:first(params.view)});
  if(!message)return children;
  return <PageFrame title="共享資料" density="compact">
    <Text accessibilityLiveRegion="polite">{message}</Text>
    {!sharedChild.view?<AppButton label="重新讀取" disabled={!online||sharedChild.phase==='loading'} onPress={()=>{void owner.sharedChild.refresh();}}/>:null}
    <AppButton label="管理家庭" variant="secondary" onPress={()=>actions.open('family')}/>
  </PageFrame>;
}
