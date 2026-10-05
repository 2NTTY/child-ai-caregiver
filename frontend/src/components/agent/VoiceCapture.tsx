import { Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
export function VoiceCapture({ onPick: _onPick }: { onPick(attachment: AssistantAttachment): void }) {
  return <Text>原生錄音 adapter 尚未接通；沒有開啟咪高峰或裝置權限。</Text>;
}
