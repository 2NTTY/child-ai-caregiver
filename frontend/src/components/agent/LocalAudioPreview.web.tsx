import {useEffect,useRef} from 'react';
export function LocalAudioPreview({uri,saved=false,seek}:{uri:string;saved?:boolean;seek?:{seconds:number;request:number}}){
  const audio=useRef<HTMLAudioElement>(null);
  useEffect(()=>{if(!seek||!audio.current)return;const element=audio.current;
    const position=()=>{element.currentTime=seek.seconds;void element.play().catch(()=>{});};
    if(element.readyState)position();else element.addEventListener('loadedmetadata',position,{once:true});
    return()=>element.removeEventListener('loadedmetadata',position);
  },[uri,seek]);
  return <audio ref={audio} src={uri} controls preload="metadata" aria-label={saved?'已保存原錄音':'本地音訊預覽，未上傳'} style={{width:'100%',maxWidth:'100%'}}/>;
}
