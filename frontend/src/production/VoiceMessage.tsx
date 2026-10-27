import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {StyleSheet,View} from 'react-native';
import {Text} from 'react-native-paper';
import type {VoiceMessageReference} from '../../../src/shared/voice';
import {VoiceApiError,type VoiceApi} from '../../../src/client/voice-api';
import {useDomainEnvironment} from './useDomainEnvironment';
import {LocalAudioPreview} from '../components/agent/LocalAudioPreview';
import {voicePlayback} from '../platform/voice-playback';
import {AppButton} from '../components/ui';
import {chineseFont,colors,spacing} from '../theme';

/** Reads the original audio and transcript; neither is copied into editable chat text. */
export function VoiceMessage({messageId,voice,initialOffsetMs,api:apiOverride}:{messageId:string|null;voice:VoiceMessageReference;initialOffsetMs?:number;api?:VoiceApi}){
  const env=useDomainEnvironment(),api=env.sharedMode?apiOverride:apiOverride??env.owner.voiceApi;
  const mayRead=env.sharedMode?!!apiOverride&&!!env.sharing&&env.allows('attachments')&&messageId===null:messageId!==null;
  const [opened,setOpened]=useState(false),[playing,setPlaying]=useState(false),[notice,setNotice]=useState<string|null>(null);
  const [preview,setPreview]=useState<{scopeKey:string;uri:string;dispose():void}|null>(null),[seek,setSeek]=useState<{seconds:number;request:number}>();
  const previewRef=useRef(preview),request=useRef<AbortController|null>(null),live=useRef(true);
  const clear=()=>{request.current?.abort();request.current=null;previewRef.current?.dispose();previewRef.current=null;setPreview(null);};
  useEffect(()=>{live.current=true;setOpened(false);setPlaying(false);setNotice(null);setPreview(null);setSeek(undefined);return()=>{live.current=false;request.current?.abort();request.current=null;previewRef.current?.dispose();previewRef.current=null;};},[env.scopeKey]);
  const matchesMessage=(value:{messageId:string|null;sharedSpaceId?:string})=>env.sharedMode
    ?!!env.sharing&&value.sharedSpaceId===env.sharing.spaceId&&value.messageId===null&&messageId===null
    :value.sharedSpaceId===undefined&&messageId!==null&&value.messageId===messageId;
  const matches=(value:Awaited<ReturnType<VoiceApi['get']>>)=>value.childId===env.childId&&value.id===voice.id
    &&value.version===voice.version&&value.sha256===voice.sha256&&matchesMessage(value);
  const read=useQuery({queryKey:['production',env.scopeKey,'voice',voice.id,voice.version],enabled:mayRead&&opened&&!!env.childId&&!!env.userId&&env.online,
    queryFn:async({signal})=>{
      if(!mayRead||!api||!env.current()||signal.aborted)throw Error('voice_scope_unavailable');
      const attachment=await api.get(env.childId!,voice.id,signal,env.userId!);
      if(!matches(attachment))throw Error('voice_changed');
      if(attachment.state!=='ready')return {attachment,transcript:null};
      if(signal.aborted||!env.current())throw Error('voice_scope_unavailable');
      const transcript=await api.transcript(env.childId!,voice.id,signal,env.userId!);
      if(!matchesMessage(transcript)||transcript.voice.id!==voice.id||transcript.voice.version!==voice.version||transcript.voice.sha256!==voice.sha256)throw Error('voice_changed');
      return {attachment,transcript};
    },retry:false});
  useEffect(()=>{if(read.isError||read.data&&read.data.attachment.state!=='ready')clear();
    if(read.error instanceof VoiceApiError&&[401,403].includes(read.error.status))env.accessError(read.error);
  },[read.isError,read.data,env.scopeKey]);
  async function play(offsetMs?:number){
    if(!mayRead||!api||!env.current()||!env.userId||!env.childId||!env.online||request.current)return;
    const signal=new AbortController();request.current=signal;setPlaying(true);setNotice(null);
    try{
      // Recheck authorization before every new playback, including an already downloaded preview.
      const attachment=await api.get(env.childId,voice.id,signal.signal,env.userId);
      if(!live.current||!env.current()||signal.signal.aborted)return;
      if(attachment.state!=='ready'||!matches(attachment))throw Error('voice_changed');
      if(!previewRef.current){const content=await api.content(attachment,signal.signal,env.userId);
        if(!live.current||!env.current()||signal.signal.aborted)return;
        const local=await voicePlayback(content.bytes,content.mimeType);
        if(!live.current||!env.current()||signal.signal.aborted){local.dispose();return;}
        const scoped={scopeKey:env.scopeKey,uri:local.uri,dispose:()=>local.dispose()};previewRef.current=scoped;setPreview(scoped);}
      if(live.current&&env.current()&&offsetMs!==undefined)setSeek({seconds:offsetMs/1000,request:Date.now()});
    }catch(error){if(live.current&&env.current()){clear();setNotice('未能讀取原錄音，請核對連線或權限後再試。');
      if(error instanceof VoiceApiError&&[401,403].includes(error.status))env.accessError(error);}}
    finally{if(request.current===signal)request.current=null;if(live.current&&env.current())setPlaying(false);}
  }
  const value=!mayRead||!env.current()||read.isError?undefined:read.data,transcript=value?.transcript;
  const visiblePreview=mayRead&&preview?.scopeKey===env.scopeKey?preview:null;
  return <View style={styles.root}>
    <AppButton label={opened?'收起錄音及自動轉錄':`錄音 · ${Math.ceil(voice.durationMs/1000)} 秒`} variant="quiet" onPress={()=>{if(opened)clear();setOpened(!opened);}}/>
    {opened?<>
      {read.isPending?<Text style={styles.note}>正在讀取原錄音資料…</Text>:null}
      {read.isError?<AppButton label="重新讀取錄音資料" variant="quiet" disabled={!mayRead||!env.online||read.isFetching} onPress={()=>{void read.refetch();}}/>:null}
      {value?.attachment.state==='ready'?<>
        <AppButton label={visiblePreview?'重新核對原錄音':'讀取原錄音播放'} variant="quiet" loading={playing} disabled={!env.online||playing} onPress={()=>{void play(initialOffsetMs);}}/>
        {visiblePreview?<LocalAudioPreview uri={visiblePreview.uri} saved seek={seek}/>:null}
        <Text style={styles.note}>自動轉錄，可能有辨識錯誤；不會再次執行錄音中的指令。</Text>
        {transcript?.content?.segments.map((segment,index)=><View key={index} style={styles.segment}>
          <Text selectable style={styles.text}>{segment.unclear?'〔部分聽不清〕':''}{segment.text}</Text>
          {segment.startMs!==null?<AppButton label={`由 ${Math.floor(segment.startMs/1000)} 秒播放`} variant="quiet" density="compact" disabled={!env.online||playing} onPress={()=>{void play(segment.startMs!);}}/>:null}
        </View>)}
        {transcript?.content&&!transcript.content.complete?<Text style={styles.note}>這份轉錄未能完整覆蓋原錄音，請以原音訊核對。</Text>:null}
        {!transcript?.content?<Text style={styles.note}>{transcript?.state==='running'?'正在轉錄':transcript?.state==='pending'?'待背景轉錄；不影響原回覆':transcript?.state==='unknown'?'轉錄結果尚未確認，不會自動重做':'暫未完成轉錄，原錄音仍可播放'}</Text>:null}
      </>:value?<Text style={styles.note}>原錄音已刪除或暫不可讀，沒有載入正文。</Text>:null}
      {notice?<Text accessibilityRole="alert" style={styles.note}>{notice}</Text>:null}
    </>:null}
  </View>;
}
const styles=StyleSheet.create({root:{gap:spacing.sm},segment:{gap:spacing.xs},text:{fontFamily:chineseFont,color:colors.ink,fontSize:14,lineHeight:22},note:{fontFamily:chineseFont,color:colors.muted,fontSize:12,lineHeight:18}});
