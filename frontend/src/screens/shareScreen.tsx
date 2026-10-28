import {StyleSheet,View} from 'react-native';
import {Text} from 'react-native-paper';
import {useRouter} from 'expo-router';
import {PageFrame} from '../components/PageFrame';
import {ChildPicker} from '../components/ChildPicker';
import {AppButton,SectionCard} from '../components/ui';
import {useProduction} from '../production/ProductionProvider';
import {useIncomingShare} from '../production/IncomingShareProvider';
import {createProductionShareTarget} from '../production/incoming-share-target';
import {usePreviewLeaveGuard} from '../preview/PreviewNavigationGuard';
import {chineseFont,spacing} from '../theme';
import type {IncomingSharePayload} from '../incoming-share';

const labels:Record<IncomingSharePayload['shareType'],string>={text:'文字',url:'連結',image:'照片',audio:'錄音',video:'影片',file:'檔案'};
const attachmentLeaveCopy={message:'離開將移除未送出的附件；文字仍在本次暫存保留。',actionLabel:'移除附件並離開'};
export default function ShareScreen(){
  const production=useProduction(),{inbox,snapshot}=useIncomingShare(),router=useRouter();
  const {owner,identityKey,recordsState,selectedChildId,sharedChild,actions,model,chatDraft,agentAttachments}=production;
  usePreviewLeaveGuard(agentAttachments.length>0,
    [production.voiceUpload,production.fileUpload,production.photoUpload].some(upload=>upload?.busy||upload?.unknown),
    'child',attachmentLeaveCopy);
  const personalIds=new Set(recordsState.children.map(child=>child.id));
  const children=model.children.filter(child=>personalIds.has(child.id));
  const personalChild=identityKey&&!sharedChild.target&&selectedChildId&&personalIds.has(selectedChildId);
  const target=createProductionShareTarget(owner),busy=snapshot.busyId!==null;
  const waiting=!identityKey?'請先登入，再選擇本人的孩子接收分享。':!personalChild?'請先選擇本人的孩子。共享孩子的私人聊天不會接收這些內容。'
    :!target?'目前有操作或草稿結果待處理，請先在原頁查核，再加入內容。':null;
  async function take(id:number){
    const current=createProductionShareTarget(owner);
    if(current&&await inbox.take(id,current))router.push('/chat');
  }
  return <PageFrame density="compact" title="接收分享" description="先核對分享內容及目前孩子，再加入聊天草稿。加入後仍需親自送出。">
    <SectionCard><View style={styles.stack}>
      {identityKey?<ChildPicker children={children} selectedId={personalChild?selectedChildId:null} onSelect={actions.selectChild}/>:null}
      {waiting?<Text accessibilityLiveRegion="polite">{waiting}</Text>:null}
      {!identityKey?<AppButton label="前往登入" onPress={()=>router.push('/login')}/>:null}
      <Text style={styles.body}>目前的文字及附件草稿會保留；文字會接在原稿後，每則訊息最多一份附件。你可以先返回聊天處理原草稿，再回來接收。</Text>
      {chatDraft?.trim()||agentAttachments.length?<AppButton label="返回原聊天草稿" variant="secondary" onPress={()=>router.push('/chat')}/>:null}
    </View></SectionCard>
    {snapshot.error?<Text accessibilityRole="alert">{snapshot.error}</Text>:null}
    {busy?<Text accessibilityLiveRegion="polite">正在準備這份附件，尚未上載或送出。</Text>:null}
    {!snapshot.items.length?<Text>目前沒有待接收的分享。</Text>:snapshot.items.map(item=><SectionCard key={item.id}>
      <View style={styles.stack}><Text style={styles.title}>{labels[item.payload.shareType]}</Text>
        {item.payload.shareType==='text'||item.payload.shareType==='url'?<Text selectable style={styles.body}>{item.payload.value}</Text>
          :<Text style={styles.body}>已收到{labels[item.payload.shareType]}。確認加入時才會讀取原檔，尚未上載。</Text>}
        <View style={styles.actions}><AppButton label="加入目前聊天草稿" disabled={busy||!personalChild||!target} onPress={()=>take(item.id)}/>
          <AppButton label="捨棄這項" variant="quiet" onPress={()=>inbox.discard(item.id)}/></View>
      </View></SectionCard>)}
  </PageFrame>;
}
const styles=StyleSheet.create({stack:{gap:spacing.md},actions:{gap:spacing.sm,flexDirection:'row',flexWrap:'wrap'},
  body:{fontFamily:chineseFont,fontSize:14,lineHeight:22},title:{fontFamily:chineseFont,fontSize:16,lineHeight:24,fontWeight:'600'}});
