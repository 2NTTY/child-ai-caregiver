import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { FamilyView } from "../components/family/FamilyView";
import { PreviewWriteControls, PreviewWriteNotice } from "../components/PreviewWritePanel";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import type { FamilyPerspective, IncomingInvitationCondition } from "../family-view-model";
import { syntheticIncomingCode } from "../preview/family-fixture";
import { usePreview } from "../preview/PreviewContext";
import { useFamilyPreview } from "../preview/useFamilyPreview";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import type { HomeChild } from "../view-model";

const perspectives: { value: FamilyPerspective; label: string }[] = [
  { value: "owner", label: "擁有者" }, { value: "caregiver", label: "照顧者" }, { value: "viewer", label: "檢視者" }, { value: "access_lost", label: "權限失效" },
];
const incomingConditions: { value: IncomingInvitationCondition; label: string }[] = [
  { value: "pending", label: "待接受" }, { value: "expired", label: "已過期" }, { value: "revoked", label: "已撤銷" },
];

function FamilyWorkspace({ perspective, incomingCondition, setPerspective, setIncomingCondition, ownerName, children, online, reading, onProfile }: {
  perspective: FamilyPerspective; incomingCondition: IncomingInvitationCondition;
  setPerspective: (value: FamilyPerspective) => void; setIncomingCondition: (value: IncomingInvitationCondition) => void;
  ownerName: string; children: HomeChild[]; online: boolean; reading: boolean; onProfile: () => void;
}) {
  const preview = useFamilyPreview({ perspective, incomingCondition, ownerName, children, online, reading });
  const [controlsOpen, setControlsOpen] = useState(false);
  return <FamilyView model={preview.model} actions={{ ...preview.actions, openProfile: onProfile }}
    writeNotice={<PreviewWriteNotice controller={preview.controller} online={online} />}
    previewControls={<SectionCard>
      <SectionHeader title="合成預覽情境" subtitle="這些工具只切換示例；不屬於正式家庭操作。" />
      <AppButton label={controlsOpen ? "收起家庭情境工具" : "顯示家庭情境工具"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />
      {controlsOpen ? <View style={styles.controls}>
        <AppSelect label="本人視角" value={perspective} options={perspectives} onChange={setPerspective} />
        <AppSelect label="收到邀請情境" value={incomingCondition} options={incomingConditions} onChange={setIncomingCondition} />
        <PreviewWriteControls controller={preview.controller} conflict={preview.model.draft?.kind !== "accept"} />
        <Text style={styles.meta}>只供測試的無效輸入：{syntheticIncomingCode}</Text>
        <Text style={styles.meta}>切換視角、收到邀請情境或全頁情境，會清除舊資料、草稿、示例碼及待處理計時器。查核未知結果時只使用原合成操作參考。</Text>
      </View> : null}
    </SectionCard>} />;
}

export default function FamilyPage() {
  const { model, scenario, actions } = usePreview();
  const [perspective, setPerspective] = useState<FamilyPerspective>("owner");
  const [incomingCondition, setIncomingCondition] = useState<IncomingInvitationCondition>("pending");
  return <PageFrame title="家庭協調" description="把共享記錄與私人聊天分清楚；邀請、接受及權限更改都先核對範圍。" eyebrow="育伴港 · 家庭">
    <FamilyWorkspace key={`${scenario}:${perspective}:${incomingCondition}`} perspective={perspective} incomingCondition={incomingCondition}
      setPerspective={setPerspective} setIncomingCondition={setIncomingCondition} ownerName={model.caregiverName}
      children={model.children} online={model.connection === "online"} reading={model.recordsLoad === "loading"} onProfile={() => actions.open("profile")} />
  </PageFrame>;
}

const styles = StyleSheet.create({ controls: { gap: spacing.md, minWidth: 0 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 } });
