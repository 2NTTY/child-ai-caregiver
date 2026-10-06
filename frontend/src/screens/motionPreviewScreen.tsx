import { brand } from "../branding";
import { useMotionPreferences } from "../motion";
import { useId, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { Switch } from "../components/AppSwitch";
import Animated, { FadeIn, FadeInDown, FadeInRight, FadeInUp, FadeOut, ReduceMotion, ZoomIn } from "react-native-reanimated";
import { PageFrame } from "../components/PageFrame";
import { AppIcon } from "../components/AppIcon";
import { AppButton, AppTabPanel, OperationPill, SectionCard, SectionHeader, UnderlineTabs } from "../components/ui";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

type MotionOption = "calm" | "guided" | "warm";

const options: { key: MotionOption; label: string }[] = [
  { key: "calm", label: "A · 安靜" },
  { key: "guided", label: "B · 導向" },
  { key: "warm", label: "C · 活潑" },
];

const optionDetails: Record<MotionOption, { title: string; description: string; tempo: string; placement: string }> = {
  calm: {
    title: "安靜回應",
    description: "以淡入及清楚的狀態更新為主。畫面穩定，適合經常閱讀記錄和處理照護資料。",
    tempo: "淡入 180ms；展開 200ms；沒有自動循環。",
    placement: "孩子切換、記錄載入、詳情展開；按鈕沿用 Paper 的原有按壓回饋。",
  },
  guided: {
    title: "路徑導向",
    description: "短距離橫向／向上進場，讓使用者知道資料是切換了對象，還是展開了下一層。",
    tempo: "切換 240ms；展開 220ms；位移保持在 12–20px。",
    placement: "孩子切換、內容區進場、右資訊欄開關；待確認內容只動容器，不動畫狀態文字。",
  },
  warm: {
    title: "溫暖微動",
    description: "卡片有輕微錯峰進場，圖示柔和放大，讓首頁更有親和力；不使用無限呼吸動畫。",
    tempo: "卡片 340ms，彼此相隔 70ms；圖示 260ms；最多三項錯峰。",
    placement: "首次進入首頁、引導步驟、空狀態；密集記錄及錯誤／結果未知維持簡潔。",
  },
};

const motion = {
  calm: {
    child: FadeIn.duration(180).reduceMotion(ReduceMotion.System),
    card: FadeIn.duration(180).reduceMotion(ReduceMotion.System),
    detail: FadeIn.duration(200).reduceMotion(ReduceMotion.System),
    mark: FadeIn.duration(180).reduceMotion(ReduceMotion.System),
  },
  guided: {
    child: FadeInRight.duration(240).withInitialValues({ translateX: 16 }).reduceMotion(ReduceMotion.System),
    card: FadeInUp.duration(240).withInitialValues({ translateY: 12 }).reduceMotion(ReduceMotion.System),
    detail: FadeInRight.duration(220).withInitialValues({ translateX: 20 }).reduceMotion(ReduceMotion.System),
    mark: FadeIn.duration(180).reduceMotion(ReduceMotion.System),
  },
  warm: {
    child: FadeInDown.duration(340).withInitialValues({ translateY: -12 }).reduceMotion(ReduceMotion.System),
    card: FadeInDown.duration(340).withInitialValues({ translateY: -12 }).reduceMotion(ReduceMotion.System),
    detail: FadeInUp.duration(320).withInitialValues({ translateY: 10 }).reduceMotion(ReduceMotion.System),
    mark: ZoomIn.duration(260).reduceMotion(ReduceMotion.System),
  },
} as const;
const warmFacts = FadeInDown.duration(340).delay(70).withInitialValues({ translateY: -12 }).reduceMotion(ReduceMotion.System);
const warmRecord = FadeInDown.duration(340).delay(140).withInitialValues({ translateY: -12 }).reduceMotion(ReduceMotion.System);

const children = [
  { name: "小昕", age: "約 3 歲 2 個月", region: "香港", profile: "檔案已確認" },
  { name: "阿樂", age: "約 8 歲", region: "未提供", profile: "檔案待核對" },
] as const;

function MotionFrame({ option, childIndex, replay, detailsOpen, reduced, narrow }: {
  option: MotionOption;
  childIndex: number;
  replay: number;
  detailsOpen: boolean;
  reduced: boolean;
  narrow: boolean;
}) {
  const child = children[childIndex];
  const effect = motion[option];
  const childContent = <View style={styles.childRow}>
    <View style={styles.childAvatar}><Text style={styles.childAvatarText}>{child.name.slice(0, 1)}</Text></View>
    <View style={styles.flexText}><Text style={styles.childName}>{child.name}</Text><Text style={styles.muted}>{child.age}</Text></View>
    <AppIcon name="chevron-down" size={18} />
  </View>;
  const statusContent = <View style={styles.statusRow}>
    <View style={styles.flexText}><Text style={styles.cardTitle}>本週睡眠觀察</Text><Text style={styles.muted}>示例內容 · 尚未向 Server 提交</Text></View>
    <OperationPill state="needs_confirmation" />
  </View>;
  const factsContent = <View style={[styles.facts, narrow && styles.factsNarrow]}>
    <View style={styles.fact}><Text style={styles.factLabel}>地區</Text><Text style={styles.factValue}>{child.region}</Text></View>
    <View style={styles.fact}><Text style={styles.factLabel}>檔案</Text><Text style={styles.factValue}>{child.profile}</Text></View>
  </View>;
  return <View style={styles.scene}>
    <View style={styles.sceneEyebrow}><Text style={styles.eyebrow}>合成預覽 · 不連接 Server</Text><Text style={styles.muted}>同一內容，三種動態節奏</Text></View>
    <View style={[styles.sceneGrid, narrow && styles.sceneGridNarrow]}>
      <SectionCard style={styles.sceneCard}>
        <Text style={styles.cardTitle}>目前孩子</Text>
        {reduced ? <View key={`${childIndex}-${replay}`}>{childContent}</View>
          : <Animated.View key={`${option}-${childIndex}-${replay}`} entering={effect.child} exiting={FadeOut.duration(120)}>{childContent}</Animated.View>}
        {reduced ? <View>{factsContent}</View>
          : <Animated.View key={`${option}-facts-${childIndex}-${replay}`} entering={option === "warm" ? warmFacts : effect.card}>{factsContent}</Animated.View>}
      </SectionCard>
      {reduced ? <SectionCard style={styles.sceneCard}>{statusContent}</SectionCard>
        : <Animated.View key={`${option}-record-${replay}`} entering={option === "warm" ? warmRecord : effect.card} style={styles.animatedCard}><SectionCard style={styles.sceneCard}>
          {option === "warm" ? <Animated.View key={`mark-${replay}`} entering={effect.mark} style={styles.sparkMark}><AppIcon name="star-four-points" size={24} /></Animated.View> : null}
          {statusContent}
        </SectionCard></Animated.View>}
    </View>
    {detailsOpen ? reduced ? <View style={styles.detail}><Text style={styles.cardTitle}>觀察詳情示例</Text><Text style={styles.muted}>展開後仍維持「待確認」；動畫不代表已保存。</Text></View>
      : <Animated.View key={`${option}-detail-${replay}`} entering={effect.detail} exiting={FadeOut.duration(120)} style={styles.detail}><Text style={styles.cardTitle}>觀察詳情示例</Text><Text style={styles.muted}>展開後仍維持「待確認」；動畫不代表已保存。</Text></Animated.View> : null}
  </View>;
}

export default function MotionPreviewScreen() {
  const { width } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(900);
  const [option, setOption] = useState<MotionOption>("calm");
  const tabsId = useId();
  const [childIndex, setChildIndex] = useState(0);
  const [replay, setReplay] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [manualReduced, setManualReduced] = useState(false);
  const sharedReduced = useMotionPreferences().reducedMotion;
  const reduced = sharedReduced || manualReduced;
  const narrow = Math.min(width, containerWidth) < 680;
  const current = optionDetails[option];

  return <PageFrame title="動態方向比較" description="先選喜歡的節奏；這個比較頁只演示呈現方式，不改現有產品流程或資料狀態。" eyebrow={`${brand.name} · Web 動態預覽`}>
    <View style={styles.layout} onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}>
      <SectionCard>
        <SectionHeader title="選擇節奏" subtitle="三款沿用同一套色彩、Paper 控制項與資料語義。" />
        <UnderlineTabs id={tabsId} label="動態節奏" items={options} value={option} onChange={next => { setOption(next); setReplay(value => value + 1); }} />
        <View style={styles.controls}>
          <AppButton label="重播進場" onPress={() => setReplay(value => value + 1)} />
          <AppButton label="切換孩子" variant="secondary" onPress={() => setChildIndex(value => (value + 1) % children.length)} />
          <AppButton expanded={detailsOpen} label={detailsOpen ? "收起詳情" : "展開詳情"} variant="secondary" onPress={() => setDetailsOpen(value => !value)} />
        </View>
        <View style={styles.reduceRow}>
          <View style={styles.flexText}><Text style={styles.cardTitle}>減少動態</Text><Text style={styles.muted}>{sharedReduced ? "系統或應用偏好已要求減少動畫，示例固定為靜態。" : "可在此額外減少動態；亦會遵從系統及應用偏好。"}</Text></View>
          <Switch value={reduced} disabled={sharedReduced} onValueChange={setManualReduced} accessibilityLabel="減少動態示例" />
        </View>
      </SectionCard>
      {options.map(item => <AppTabPanel key={item.key} tabsId={tabsId} tabKey={item.key} active={option === item.key} style={styles.layout}>{option === item.key ? <>
      <MotionFrame option={option} childIndex={childIndex} replay={replay} detailsOpen={detailsOpen} reduced={reduced} narrow={narrow} />
      <SectionCard><SectionHeader title={current.title} subtitle={current.description} />
        <View style={styles.explanation}><Text style={styles.explanationLabel}>節奏</Text><Text style={styles.muted}>{current.tempo}</Text></View>
        <View style={styles.explanation}><Text style={styles.explanationLabel}>適用位置</Text><Text style={styles.muted}>{current.placement}</Text></View>
        <Text style={styles.note}>鍵盤操作不依賴動畫；320px 時卡片重排為單欄。選定方向後，才會將動態規則接到共用元件與各路由。</Text>
      </SectionCard>
      </> : null}</AppTabPanel>)}
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  layout: { gap: spacing.lg },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reduceRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  flexText: { flex: 1, minWidth: 0 },
  scene: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md, overflow: "hidden" },
  sceneEyebrow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  sceneGrid: { flexDirection: "row", alignItems: "stretch", gap: spacing.md },
  sceneGridNarrow: { flexDirection: "column" },
  sceneCard: { flex: 1, minWidth: 0 },
  animatedCard: { flex: 1, minWidth: 0 },
  childRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.quietSurface, borderRadius: radius.pill, paddingHorizontal: spacing.sm },
  childAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  childAvatarText: { color: colors.deepTeal, fontFamily: chineseFont, fontWeight: "800", fontSize: typeScale.small },
  childName: { color: colors.ink, fontFamily: chineseFont, fontWeight: "800", fontSize: typeScale.small },
  chevron: { color: colors.deepTeal, fontSize: typeScale.title },
  facts: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  factsNarrow: { flexDirection: "column" },
  fact: { flex: 1, minWidth: 110, borderRadius: radius.small, backgroundColor: colors.mintSurface, padding: spacing.sm, gap: spacing.xs },
  factLabel: { color: colors.muted, fontFamily: chineseFont, fontSize: typeScale.caption },
  factValue: { color: colors.deepTeal, fontFamily: chineseFont, fontWeight: "700", fontSize: typeScale.small },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, flexWrap: "wrap" },
  sparkMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  sparkText: { color: colors.deepTeal, fontSize: 19 },
  detail: { backgroundColor: colors.white, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.softLine, padding: spacing.md, gap: spacing.xs },
  cardTitle: { color: colors.ink, fontFamily: chineseFont, fontWeight: "800", fontSize: typeScale.small },
  muted: { color: colors.muted, fontFamily: chineseFont, fontSize: typeScale.caption, lineHeight: 19 },
  eyebrow: { color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.caption, fontWeight: "800" },
  explanation: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  explanationLabel: { width: 65, color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "800" },
  note: { color: colors.muted, fontFamily: chineseFont, fontSize: typeScale.caption, lineHeight: 19 },
});
