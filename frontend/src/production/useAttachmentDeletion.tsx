import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { readAttachmentDeletionReceipt } from '../../../src/client/attachment-delete-receipt';
import { AppButton } from '../components/ui';
import { useDomainWriteGuard, type useDomainEnvironment } from './useDomainEnvironment';

type Original={id:string;childId:string;version:number;fileName:string|null;sharedSpaceId?:string};
type Deleter<T>={delete(value:T,opId:string,signal:AbortSignal,userId:string):Promise<{operationId:string;deleted:true;cleanupPending:boolean}>};
type Entry<T>={scope:string;item:T;opId:string;phase:'confirm'|'saving'|'checking'|'unknown'|'unconfirmed'};

/** One retained operation per library tab, even if refresh removes the item from its list. */
export function useAttachmentDeletion<T extends Original>(env:ReturnType<typeof useDomainEnvironment>,api:Deleter<T>,kind:'voices'|'files',refresh:()=>void){
  const [saved,setEntry]=useState<Entry<T>|null>(null),[notice,setNotice]=useState('');
  const entry=saved?.scope===env.scopeKey?saved:null;
  const pending=useRef(saved),request=useRef<AbortController|null>(null),latest=useRef(env),live=useRef(true),generation=useRef(0);
  latest.current=env;
  const update=(value:Entry<T>|null)=>{pending.current=value;setEntry(value);};
  const allowed=()=>latest.current.current()&&latest.current.sharedMode&&latest.current.allows('attachments')
    &&latest.current.role!==null&&latest.current.role!=='viewer'&&latest.current.online;
  useEffect(()=>{live.current=true;update(null);setNotice('');return()=>{generation.current++;live.current=false;request.current?.abort();request.current=null;};},[env.scopeKey]);
  useDomainWriteGuard(false,!!entry&&entry.phase!=='confirm','child',false,entry?.phase==='saving'?'saving':'unknown');
  async function run(check:boolean){
    const e=latest.current,original=pending.current;
    if(!original||original.scope!==e.scopeKey||request.current||!allowed()||!e.userId||(!check&&original.phase==='confirm'&&!e.canStartWrite()))return;
    if(check?!['unknown','unconfirmed'].includes(original.phase):!['confirm','unconfirmed'].includes(original.phase))return;
    const controller=new AbortController(),started=generation.current;request.current=controller;
    const timer=setTimeout(()=>controller.abort(),30000);
    const current=()=>live.current&&generation.current===started&&latest.current.scopeKey===e.scopeKey&&e.current();
    update({...original,phase:check?'checking':'saving'});setNotice('');
    try{
      if(check){
        const state=await readAttachmentDeletionReceipt(e.apiBaseUrl,e.owner.fetcher,{opId:original.opId,
          path:`/api/children/${original.item.childId}/${kind}/${original.item.id}/delete`},controller.signal,e.userId);
        if(!current())return;
        if(state==='unconfirmed'){update({...original,phase:'unconfirmed'});setNotice('原操作尚無確認結果，可明確重試同一操作。');return;}
      }
      // Accepted receipts are not proof of completed erasure; resume only the same accepted operation.
      await api.delete(original.item,original.opId,controller.signal,e.userId);
      if(!current())return;
      update(null);setNotice('刪除已確認；原附件不再可讀，實體檔案與備份按保留規則清理。');refresh();e.invalidate();
    }catch(error){
      if(!current())return;
      const failure=error as {status?:number};
      if(!check&&failure.status&&failure.status>=400&&failure.status<500){update(null);setNotice('未能刪除：權限或附件版本已改變，請重新讀取。');refresh();}
      else{update({...original,phase:'unknown'});setNotice('刪除結果未確認，請查核原操作；不會另建刪除操作。');}
      if([401,403].includes(failure.status??0))e.accessError(failure);
    }finally{clearTimeout(timer);if(request.current===controller)request.current=null;}
  }
  const canDelete=allowed();
  const busy=entry?.phase==='saving'||entry?.phase==='checking';
  return {
    remove:(item:T)=>{if(!allowed()||pending.current||item.sharedSpaceId!==env.sharing?.spaceId||item.childId!==env.childId)return;
      update({scope:env.scopeKey,item,opId:crypto.randomUUID(),phase:'confirm'});setNotice('');},
    canDelete:canDelete&&!entry,
    controls:<View>
      {entry?<><Text>{entry.item.fileName} · 版本 {entry.item.version}</Text>
        {entry.phase==='confirm'?<><Text>刪除會移除原附件，原持有人及所有共享成員將不能再讀取。</Text>
          <AppButton label="確認刪除原附件" variant="danger" disabled={!canDelete} onPress={()=>{void run(false);}}/>
          <AppButton label="取消刪除" variant="quiet" onPress={()=>update(null)}/></>:<>
          <Text>原操作：{entry.opId}</Text>
          <AppButton label="查核原刪除" loading={busy} disabled={!canDelete||busy} onPress={()=>{void run(true);}}/>
          {entry.phase==='unconfirmed'?<AppButton label="重試原刪除" disabled={!canDelete} onPress={()=>{void run(false);}}/>:null}
        </>}
      </>:null}
      {notice?<Text accessibilityRole="alert">{notice}</Text>:null}
    </View>,
  };
}
