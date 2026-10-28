import {createContext,useContext,useEffect,useLayoutEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {StyleSheet,View} from 'react-native';
import {usePathname,useRouter} from 'expo-router';
import {createIncomingShareInbox,type IncomingShareInbox,type IncomingShareSnapshot} from '../incoming-share';
import {createIncomingSharePlatform} from '../platform/incoming-share';
import {AppButton} from '../components/ui';
import {usePreviewNavigation} from '../preview/PreviewNavigationGuard';
import {colors,spacing} from '../theme';
import type {ProductionOwner} from './ProductionOwner';

type IncomingShareContextValue={inbox:IncomingShareInbox;snapshot:IncomingShareSnapshot};
const IncomingShareContext=createContext<IncomingShareContextValue|null>(null);
export function useIncomingShare(){
  const value=useContext(IncomingShareContext);
  if(!value)throw new Error('IncomingShareProvider is required');
  return value;
}

/** One device-local inbox outlives login and dashboard routes. */
export function IncomingShareProvider({owner,children}:{owner:ProductionOwner;children:ReactNode}){
  const [{platform,inbox}]=useState(()=>{
    const platform=createIncomingSharePlatform(),inbox=createIncomingShareInbox(platform);
    const state=owner.getSnapshot();inbox.observeIdentity(state.identityKey);inbox.observeScope(state.scopeKey??null);
    return{platform,inbox};
  });
  const snapshot=useSyncExternalStore(inbox.subscribe,inbox.getSnapshot,inbox.getSnapshot);
  const router=useRouter(),pathname=usePathname(),leave=usePreviewNavigation();
  useLayoutEffect(()=>{
    const observe=()=>{const state=owner.getSnapshot();inbox.observeIdentity(state.identityKey);inbox.observeScope(state.scopeKey??null);};
    const unsubscribe=owner.subscribe(observe);observe();
    return unsubscribe;
  },[owner,inbox]);
  useEffect(()=>{
    const receive=()=>{const state=owner.getSnapshot();inbox.observeIdentity(state.identityKey);inbox.observeScope(state.scopeKey??null);inbox.receive();};
    const unsubscribe=platform.subscribe(receive);
    receive();
    return()=>{unsubscribe();inbox.clear();};
  },[owner,inbox,platform]);
  const open=()=>{
    // Chat input remains in its existing owner while the local inbox is inspected.
    if(pathname==='/chat')router.push('/share');
    else leave(()=>router.push('/share'),'workspace');
  };
  return <IncomingShareContext.Provider value={{inbox,snapshot}}>
    {snapshot.items.length>0&&pathname!=='/share'?<View style={styles.notice} testID="incoming-share-notice">
      <AppButton label={`${snapshot.items.length} 項${owner.getSnapshot().identityKey?'待接收分享':'分享待登入後接收'}`} variant="secondary" onPress={open}/>
    </View>:null}
    {children}
  </IncomingShareContext.Provider>;
}
const styles=StyleSheet.create({notice:{paddingHorizontal:spacing.md,paddingVertical:spacing.sm,backgroundColor:colors.controlSurface}});
