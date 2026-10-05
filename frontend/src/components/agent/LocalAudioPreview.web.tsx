export function LocalAudioPreview({ uri }: { uri: string }) {
  return <audio src={uri} controls preload="metadata" aria-label="本地音訊預覽，未上傳" style={{ width: "100%", maxWidth: "100%" }} />;
}
