import { Directory,File,Paths } from 'expo-file-system';
import { VOICE_LIMITS,normalizeVoiceMimeType } from '../../../src/shared/voice';
/** Only a bounded, disposable cache for an authorized download. */
export async function voicePlayback(bytes:Uint8Array<ArrayBuffer>,mime:string){
  const type=normalizeVoiceMimeType(mime);if(!type||!bytes.length||bytes.length>VOICE_LIMITS.bytes)throw Error('voice_unavailable');
  const folder=new Directory(Paths.cache,'yuyoufang-voice-playback');folder.create({intermediates:true,idempotent:true});
  for(const entry of folder.list())if(entry instanceof File&&(entry.creationTime??entry.lastModified??0)<Date.now()-86400000)entry.delete();
  if(folder.list().length>=8)throw Error('voice_cache_full');
  const extension=type==='audio/mp4'?'m4a':type==='audio/mpeg'?'mp3':type.split('/')[1];
  const file=new File(folder,crypto.randomUUID()+'.'+extension);file.create();
  try{file.write(bytes);}catch(error){if(file.exists)file.delete();throw error;}
  return {uri:file.uri,dispose:()=>{try{if(file.exists)file.delete();}catch{/* Bounded cache cleanup retries later. */}}};
}
