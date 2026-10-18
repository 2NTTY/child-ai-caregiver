/** Disposable playback projection, never a second saved recording. */
export async function voicePlayback(bytes:Uint8Array<ArrayBuffer>,mimeType:string){
  const uri=URL.createObjectURL(new Blob([bytes],{type:mimeType}));return {uri,dispose:()=>URL.revokeObjectURL(uri)};
}
