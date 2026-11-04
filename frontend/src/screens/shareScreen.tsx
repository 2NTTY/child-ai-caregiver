import {useSyncExternalStore} from 'react';
import {Platform,StyleSheet,View} from 'react-native';
import {Text} from 'react-native-paper';
import {useRouter} from 'expo-router';
import {PageFrame} from '../components/PageFrame';
import {ChildPicker} from '../components/ChildPicker';
import {AppButton,SectionCard} from '../components/ui';
import {useProduction} from '../production/ProductionProvider';
import {useIncomingShare} from '../production/IncomingShareProvider';
import {createProductionShareTarget} from '../production/incoming-share-target';
import {createProductionPackageShareTarget,createProductionPackageResumeTarget} from '../production/incoming-share-package-target';
import {PACKAGE_IMPORT_MAX_BYTES} from '../platform/package-import';
import {usePreviewLeaveGuard,usePreviewNavigation} from '../preview/PreviewNavigationGuard';
import {chineseFont,spacing} from '../theme';
import type {IncomingSharePayload} from '../incoming-share';

const labels:Record<IncomingSharePayload['shareType'],string>={text:'文字',url:'連結',image:'照片',audio:'錄音',video:'影片',file:'檔案'};
const attachmentLeaveCopy={message:'離開將移除未送出的附件；文字仍在本次暫存保留。',actionLabel:'移除附件並離開'};
const noPackageSubscription=()=>()=>{},noPackageSnapshot=()=>null;
export default function ShareScreen(){
  const production=useProduction(),{inbox,snapshot}=useIncomingShare(),router=useRouter(),leave=usePreviewNavigation();
  const {owner,identityKey,recordsState,selectedChildId,sharedChild,actions,model,chatDraft,agentAttachments}=production;
  const importer=Platform.OS==='android'?owner.handoverImportOwner:null;
  useSyncExternalStore(importer?.subscribe??noPackageSubscription,importer?.getSnapshot??noPackageSnapshot,importer?.getSnapshot??noPackageSnapshot);
  usePreviewLeaveGuard(agentAttachments.length>0,
    [production.voiceUpload,production.fileUpload,production.photoUpload].some(upload=>upload?.busy||upload?.unknown),
    'child',attachmentLeaveCopy);
  const personalIds=new Set(recordsState.children.map(child=>child.id));
  const children=model.children.filter(child=>personalIds.has(child.id));
  const personalChild=identityKey&&!sharedChild.target&&selectedChildId&&personalIds.has(selectedChildId);
  const target=createProductionShareTarget(owner),busy=snapshot.busyId!==null;
  const packageTarget=Platform.OS==='android'?createProductionPackageShareTarget(owner):null;
  const packageResumeTarget=Platform.OS==='android'?createProductionPackageResumeTarget(owner):null;
  const waiting=!identityKey?'請先登入，再選擇本人的孩子接收分享。':!personalChild
    ?Platform.OS==='android'?'加入聊天前，請先選擇本人的孩子。資料包可在上載後選擇接收對象。':'請先選擇本人的孩子。共享孩子的私人聊天不會接收這些內容。'
    :!target?'目前聊天有操作或草稿結果待處理，加入聊天前請先在原頁查核。':null;
  async function take(id:number){
    const current=createProductionShareTarget(owner);
    if(current&&await inbox.take(id,current))router.push('/chat');
  }
  async function takePackage(id:number){
    const current=createProductionPackageShareTarget(owner);
    if(current&&await inbox.takePackage(id,current))leave(()=>{if(current.current())router.push('/settings?section=account');},'workspace');
  }
  function viewCurrentPackage(){
    if(packageResumeTarget)leave(()=>{if(packageResumeTarget.open())router.push('/settings?section=account');},'workspace');
  }
  return <PageFrame density="compact" title="接收分享" description={Platform.OS==='android'?'先核對分享內容，再選擇加入聊天草稿或把 ZIP 作為資料包匯入。聊天仍需親自送出；資料包上載驗證後再選接收對象。':'先核對分享內容及目前孩子，再加入聊天草稿。加入後仍需親自送出。'}>
    <SectionCard><View style={styles.stack}>
      {identityKey?<ChildPicker children={children} selectedId={personalChild?selectedChildId:null} onSelect={actions.selectChild}/>:null}
      {waiting?<Text accessibilityLiveRegion="polite">{waiting}</Text>:null}
      {!identityKey?<AppButton label="前往登入" onPress={()=>router.push('/login')}/>:null}
      <Text style={styles.body}>目前的文字及附件草稿會保留；文字會接在原稿後，每則訊息最多一份附件。你可以先返回聊天處理原草稿，再回來接收。</Text>
      {chatDraft?.trim()||agentAttachments.length?<AppButton label="返回原聊天草稿" variant="secondary" onPress={()=>router.push('/chat')}/>:null}
    </View></SectionCard>
    {snapshot.error?<Text accessibilityRole="alert">{snapshot.error}</Text>:null}
    {busy?<Text accessibilityLiveRegion="polite">正在處理所選內容；請稍候，或沿原操作畫面查核狀態。</Text>:null}
    {!snapshot.items.length?<Text>目前沒有待接收的分享。</Text>:snapshot.items.map(item=><SectionCard key={item.id}>
      <View style={styles.stack}><Text style={styles.title}>{labels[item.payload.shareType]}</Text>
        {item.payload.shareType==='text'||item.payload.shareType==='url'?<Text selectable style={styles.body}>{item.payload.value}</Text>
          :<Text style={styles.body}>已收到{labels[item.payload.shareType]}。{snapshot.busyId===item.id?'正在按所選方式處理。':'選擇接收方式時才會讀取原檔。'}</Text>}
        <View style={styles.actions}><AppButton label="加入目前聊天草稿" disabled={busy||!personalChild||!target} onPress={()=>take(item.id)}/>
          {Platform.OS==='android'&&item.payload.shareType==='file'?<AppButton label="作為資料包匯入" variant="secondary" disabled={busy||!packageTarget} onPress={()=>takePackage(item.id)}/>:null}
          {Platform.OS==='android'&&item.payload.shareType==='file'&&packageResumeTarget?<AppButton label="查看目前匯入" variant="secondary" onPress={viewCurrentPackage}/>:null}
          <AppButton label="捨棄這項" variant="quiet" onPress={()=>inbox.discard(item.id)}/></View>
        {Platform.OS==='android'&&item.payload.shareType==='file'?<Text style={styles.body}>只有按「作為資料包匯入」才會讀取及上載 ZIP，最多 {PACKAGE_IMPORT_MAX_BYTES / 1024 / 1024} MiB；之後仍須選擇接收對象並開始匯入。已有上載或原請求待處理時，可按「查看目前匯入」查核；這項新分享仍未接收，不會替換原有資料包。</Text>:null}
      </View></SectionCard>)}
  </PageFrame>;
}
const styles=StyleSheet.create({stack:{gap:spacing.md},actions:{gap:spacing.sm,flexDirection:'row',flexWrap:'wrap'},
  body:{fontFamily:chineseFont,fontSize:14,lineHeight:22},title:{fontFamily:chineseFont,fontSize:16,lineHeight:24,fontWeight:'600'}});
