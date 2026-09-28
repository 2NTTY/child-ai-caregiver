import { Linking, Pressable, Text, View } from "react-native";
import { EMERGENCY_HELP } from "../shared/emergency-help.ts";

export function EmergencyHelp() {
  return <View style={{ paddingVertical: 12, gap: 8 }}>
    <Text accessibilityRole="header" style={{ fontWeight: "600" }}>緊急求助</Text>
    <Text>{EMERGENCY_HELP.text}</Text>
    {EMERGENCY_HELP.sources.map(source => <Pressable key={source.url} accessibilityRole="link"
      onPress={() => { void Linking.openURL(source.url).catch(() => {}); }}>
      <Text style={{ textDecorationLine: "underline" }}>{source.title}</Text>
    </Pressable>)}
    <Text>官方內容核對：{EMERGENCY_HELP.checkedOn}。此入口保持可見，不會自動致電或判斷緊急程度。</Text>
  </View>;
}
