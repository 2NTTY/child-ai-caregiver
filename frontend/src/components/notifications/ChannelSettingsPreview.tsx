import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { useContainerWidth } from "../useContainerWidth";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { WebPushSettingsCard, TelegramSettingsCard } from "./ChannelCards";
import { AppButton, AppSelect, SectionHeader } from "../ui";
import { PreviewWriteControls, PreviewWriteNotice } from "../PreviewWritePanel";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import type { ChannelSettingsPreviewController } from "../../preview/useChannelSettingsPreview";
import type { ChannelDeliveryState } from "../../channel-view-model";
import { channelDeliveryLabels } from "../../channel-view-model";
import type { PushScenario } from "../../preview/usePushSettingsPreview";
import type { TelegramScenario } from "../../preview/useTelegramSettingsPreview";

const pushScenarios: { value: PushScenario; label: string }[] = [
  { value: "normal", label: "一般" }, { value: "denied", label: "瀏覽器已拒絕" }, { value: "unsupported", label: "不支援" },
  { value: "unconfigured", label: "服務未配置" }, { value: "paused", label: "Worker 暫停" }, { value: "expired", label: "訂閱已失效" },
  { value: "unknown_delivery", label: "投遞結果未知" }, { value: "read_failed", label: "讀取失敗" }, { value: "loading", label: "載入中" }, { value: "session_changed", label: "身份已改變" },
];
const telegramScenarios: { value: TelegramScenario; label: string }[] = [
  { value: "normal", label: "一般" }, { value: "unconfigured", label: "服務未配置" }, { value: "paused", label: "Worker 暫停" },
  { value: "blocked", label: "渠道被封鎖" }, { value: "expired", label: "綁定連結已過期" }, { value: "unknown_delivery", label: "投遞結果未知" },
  { value: "read_failed", label: "讀取失敗" }, { value: "loading", label: "載入中" }, { value: "session_changed", label: "身份已改變" },
];
const deliveryOptions = (Object.keys(channelDeliveryLabels) as ChannelDeliveryState[]).map(value => ({ value, label: channelDeliveryLabels[value] }));

export function ChannelSettingsPreview({ controller }: { controller: ChannelSettingsPreviewController }) {
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const [tools, setTools] = useState(false);
  const { push, telegram, identity } = controller;
  return <View testID="channel-settings" style={styles.workspace}>
    <SectionCard><SectionHeader density="compact" title="本人的通知渠道" subtitle="切換孩子不會重新綁定；切換帳戶或 Server 時必須清理舊渠道及待查操作。" />
      <Text style={styles.meta}>渠道情境帳戶：{identity.name}（合成）。此處沒有登出、登入或外發。</Text>
      <View style={styles.actions}><AppButton label={tools ? "收起渠道情境工具" : "顯示渠道情境工具"} variant="quiet" onPress={() => setTools(value => !value)} />
        <AppButton label="切換渠道情境的合成帳戶" variant="secondary" onPress={controller.switchAccount} />
      </View>
    </SectionCard>
    <View key={identity.id} ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[styles.columns, width < 760 && styles.stack]}>
      <View testID="push-settings" style={[styles.column, width < 760 && styles.fullColumn]}>
        <WebPushSettingsCard scopeKey={`${identity.id}:push`} confirmedOperation={push.operation.operation.state === "saved" && !push.operation.operation.resultUnavailable && push.operation.operation.reference ? { reference: push.operation.operation.reference } : null} model={push.model} actions={push.actions} operationNotice={<PreviewWriteNotice controller={push.operation} online={push.model.online} />} />
        {tools ? <SectionCard><Text style={styles.meta}>Web Push 合成情境 · 不請求系統權限</Text>
          <AppSelect label="Web Push 情境" value={push.scenario} options={pushScenarios} onChange={push.chooseScenario} disabled={push.model.locked || !!push.model.review} />
          <AppSelect label="Web Push 投遞示例" value={push.deliveryOutcome} options={deliveryOptions} onChange={push.setDeliveryOutcome} disabled={push.model.locked || !!push.model.review} />
          <PreviewWriteControls controller={push.operation} />
        </SectionCard> : null}
      </View>
      <View testID="telegram-settings" style={[styles.column, width < 760 && styles.fullColumn]}>
        <TelegramSettingsCard scopeKey={`${identity.id}:telegram`} confirmedOperation={telegram.operation.operation.state === "saved" && !telegram.operation.operation.resultUnavailable && telegram.operation.operation.reference ? { reference: telegram.operation.operation.reference } : null} model={telegram.model} actions={telegram.actions} operationNotice={<PreviewWriteNotice controller={telegram.operation} online={telegram.model.online} />} />
        {tools ? <SectionCard><Text style={styles.meta}>Telegram 合成情境 · 不開啟真 bot</Text>
          <AppSelect label="Telegram 情境" value={telegram.scenario} options={telegramScenarios} onChange={telegram.chooseScenario} disabled={telegram.model.locked || !!telegram.model.review} />
          <AppSelect label="Telegram 投遞示例" value={telegram.deliveryOutcome} options={deliveryOptions} onChange={telegram.setDeliveryOutcome} disabled={telegram.model.locked || !!telegram.model.review} />
          <AppButton label="模擬已在 Telegram 啟動" variant="secondary" onPress={telegram.simulateBotStart} disabled={!telegram.model.online || telegram.model.locked || !!telegram.model.review || telegram.model.challenge?.state !== "waiting"} />
          <AppButton label="模擬收到本人回覆" variant="secondary" onPress={telegram.simulateAcknowledgement} disabled={!telegram.model.online || telegram.model.locked || !!telegram.model.review || !telegram.model.deliveries.length} />
          <PreviewWriteControls controller={telegram.operation} />
        </SectionCard> : null}
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  workspace: { gap: spacing.lg }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" },
  column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg }, fullColumn: { flex: undefined, flexBasis: "auto", flexGrow: 0, flexShrink: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
