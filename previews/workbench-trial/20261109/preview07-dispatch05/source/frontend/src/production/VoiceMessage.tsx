import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {StyleSheet,View} from 'react-native';
import {Text} from 'react-native-paper';
import type {VoiceMessageReference} from '../../../src/shared/voice';
import {VoiceApiError} from '../../../src/client/voice-api';
import {useDomainEnvironment} from './useDomainEnvironment';
import {LocalAudioPreview} from '../components/agent/LocalAudioPreview';
import {voicePlayback} from '../platform/voice-playback';
import {AppButton} from '../components/ui';
import {chineseFont,colors,spacing} from '../theme';

/** Reads the original audio and transcript; neither is copied into editable chat text. */
export function VoiceMessage({messageId,voice,initialOffsetMs}:{messageId:string;voice:VoiceMessageReference;initialOffsetMs?:number}){
  const env=useDomainEnvironment(),api=env.owner.voiceApi;
  const [opened,setOpened]=useState(false),[playing,setPlaying]=useState(false),[notice,setNotice]=useState<string|null>(null);
  const [preview,setPreview]=useState<{uri:string;dispose():void}|null>(null),[seek,setSeek]=useState<{seconds:number;request:number}>();
  const previewRef=useRef(preview),request=useRef<AbortController|null>(null),live=useRef(true);
  const clear=()=>{request.current?.abort();request.current=null;previewRef.current?.dispose();previewRef.current=null;setPreview(null);};
  useEffect(()=>{live.current=true;return()=>{live.current=false;request.current?.abort();previewRef.current?.dispose();};},[env.scopeKey]);
  const read=useQuery({queryKey:['production',env.scopeKey,'voice',voice.id,voice.version],enabled:opened&&!!env.childId&&!!env.userId&&env.online,
    queryFn:async({signal})=>{
      const attachment=await api.get(env.childId!,voice.id,signal,env.userId!);
      if(attachment.state!=='ready')return {attachment,transcript:null};
      if(attachment.messageId!==messageId||attachment.version!==voice.version||attachment.sha256!==voice.sha256)throw Error('voice_changed');
      const transcript=await api.transcript(env.childId!,voice.id,signal,env.userId!);
      if(transcript.messageId!==messageId||transcript.voice.version!==voice.version||transcript.voice.sha256!==voice.sha256)throw Error('voice_changed');
      return {attachment,transcript};
    },retry:false});
  useEffect(()=>{if(read.isError||read.data&&read.data.attachment.state!=='ready')clear();
    if(read.error instanceof VoiceApiError&&[401,403].includes(read.error.status))env.accessError(read.error);
  },[read.isError,read.data,env.scopeKey]);
  async function play(offsetMs?:number){
    if(!env.current()||!env.userId||!env.childId||!env.online||request.current)return;
    const signal=new AbortController();request.current=signal;setPlaying(true);setNotice(null);
    try{
      // Recheck authorization before every new playback, including an already downloaded preview.
      const attachment=await api.get(env.childId,voice.id,signal.signal,env.userId);
      if(attachment.state!=='ready'||attachment.messageId!==messageId||attachment.version!==voice.version||attachment.sha256!==voice.sha256)throw Error('voice_changed');
      if(!previewRef.current){const content=await api.content(attachment,signal.signal,env.userId),local=await voicePlayback(content.bytes,content.mimeType);
        if(!live.current||!env.current()||signal.signal.aborted){local.dispose();return;}previewRef.current=local;setPreview(local);}
      if(live.current&&env.current()&&offsetMs!==undefined)setSeek({seconds:offsetMs/1000,request:Date.now()});
    }catch(error){if(live.current&&env.current()){clear();setNotice('未能讀取原錄音，請核對連線或權限後再試。');
      if(error instanceof VoiceApiError&&[401,403].includes(error.status))env.accessError(error);}}
    finally{if(request.current===signal)request.current=null;if(live.current&&env.current())setPlaying(false);}
  }
  const value=read.isError?undefined:read.data,transcript=value?.transcript;
  return <View style={styles.root}>
    <AppButton label={opened?'收起錄音及自動轉錄':`錄音 · ${Math.ceil(voice.durationMs/1000)} 秒`} variant="quiet" onPress={()=>{if(opened)clear();setOpened(!opened);}}/>
    {opened?<>
      {read.isPending?<Text style={styles.note}>正在讀取原錄音資料…</Text>:null}
      {read.isError?<AppButton label="重新讀取錄音資料" variant="quiet" disabled={!env.online||read.isFetching} onPress={()=>{void read.refetch();}}/>:null}
      {value?.attachment.state==='ready'?<>
        <AppButton label={preview?'重新核對原錄音':'讀取原錄音播放'} variant="quiet" loading={playing} disabled={!env.online||playing} onPress={()=>{void play(initialOffsetMs);}}/>
        {preview?<LocalAudioPreview uri={preview.uri} saved seek={seek}/>:null}
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
