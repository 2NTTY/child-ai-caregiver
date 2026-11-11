import { View } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthActions, GrowthViewModel } from "../../growth-view-model";
import { AppButton } from "../ui";
import { growthStyles as s } from "./growth-styles";

export function GrowthConcernPagination({ model, actions }: { model: GrowthViewModel; actions: GrowthActions }) {
  const concerns = model.page?.concerns;
  if (model.access === "lost" || !concerns?.hasMore) return null;
  return <View style={s.stack}>
    <Text style={s.meta}>目前只顯示已載入的關注，還有更多內容。</Text>
    {concerns.pageError ? <Text style={s.warning}>{concerns.pageError}</Text> : null}
    <AppButton label={concerns.pageError ? "重試載入更多關注" : "載入更多關注"} variant="secondary"
      disabled={model.busy || model.dirty || !!model.pending || !model.online || !actions.loadMoreConcerns} onPress={() => actions.loadMoreConcerns?.()} />
    {concerns.pageError ? <AppButton label="重新讀取關注" variant="quiet" disabled={model.busy || !model.online} onPress={actions.refresh} /> : null}
  </View>;
}
