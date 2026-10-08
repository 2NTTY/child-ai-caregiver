import { View } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthActions, GrowthViewModel } from "../../growth-view-model";
import { growthConcernAtCapacity, growthConcernCanRestore } from "../../growth-view-model";
import { AppButton } from "../ui";
import { growthStyles as s } from "./growth-styles";

export function GrowthConcernChangeNotice({ model, actions }: { model: GrowthViewModel; actions: GrowthActions }) {
  const change = model.lastConcernChange;
  const page = model.access === "lost" ? null : model.page;
  const concern = change?.action === "archive" && change.scopeKey === model.scopeKey && change.authorityVersion === page?.authorityVersion && page?.concerns?.state === "ready"
    ? page.concerns.items.find(item => item.id === change.id && item.childId === model.childId && item.version === change.version && item.status === "closed") : null;
  if (!concern || model.pending || model.busy) return null;
  return <View style={s.smallStack} testID="growth-archive-undo">
    <Text style={s.body}>剛結束「{concern.title}」</Text>
    {growthConcernAtCapacity(concern) ? <Text style={s.meta}>已達歷史容量限制</Text> : null}
    <AppButton label="撤銷結束關注" accessibilityLabel={`撤銷結束關注：${concern.title}`} variant="secondary"
      disabled={model.locked || model.dirty || !growthConcernCanRestore(concern)}
      onPress={() => actions.restoreConcern(concern.id, concern.version, page!.authorityVersion)} />
  </View>;
}
