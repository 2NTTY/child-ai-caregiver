import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField, SectionCard, SectionHeader, TextLink } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

export default function ProfilePage() {
  const { width } = useWindowDimensions();
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const [name, setName] = useState(child?.displayName ?? "");
  const [age, setAge] = useState(child?.ageLabel ?? "");
  const [region, setRegion] = useState(child?.regionLabel ?? "");
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => { setName(child?.displayName ?? ""); setAge(child?.ageLabel ?? ""); setRegion(child?.regionLabel ?? ""); setReviewed(false); }, [child?.id]);
  const stacked = width < 1200;
  return <PageFrame title="子女檔案" description="只填已知資料；約數、日期基準及未知欄位都應如實顯示。" eyebrow="育伴港 · 孩子資料">
    <View style={[styles.columns, stacked && styles.stack]}>
      <View style={styles.column}>
        <SectionCard><SectionHeader title={child ? "目前孩子" : "尚未有孩子"} action={child ? <TextLink label="查看記錄" onPress={() => actions.open("care")} /> : undefined} />
          {child ? <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{child.displayName.slice(0, 1)}</Text></View><View style={styles.identityCopy}><Text style={styles.childName}>{child.displayName}</Text><Text style={styles.body}>{child.ageLabel}</Text><Text style={styles.meta}>{child.regionLabel} · {child.profileConfirmed ? "已確認資料" : "尚待核對"}</Text></View></View> : <Text style={styles.body}>此情境沒有孩子檔案；右側可檢視建立草稿的版式，但不會建立真資料。</Text>}
        </SectionCard>
        <SectionCard><SectionHeader title="資料原則" />
          <View style={styles.rule}><Text style={styles.ruleNumber}>01</Text><Text style={styles.body}>年齡可為精確或約數；必須保留計算基準日期。</Text></View>
          <View style={styles.rule}><Text style={styles.ruleNumber}>02</Text><Text style={styles.body}>未提供的地區、照護資料應顯示「未知」，不能從截圖猜測。</Text></View>
          <View style={styles.rule}><Text style={styles.ruleNumber}>03</Text><Text style={styles.body}>確認與更正有版本歷史；刪除整個孩子需要 owner 權限。</Text></View>
        </SectionCard>
      </View>
      <View style={styles.column}>
        <SectionCard><SectionHeader title={child ? "核對檔案草稿" : "建立檔案草稿"} subtitle="只供前端預覽；尚未提交或確認。" />
          <AppTextField label="孩子稱呼" accessibilityLabel="孩子稱呼草稿" value={name} onChangeText={value => { setName(value); setReviewed(false); }} />
          <AppTextField label="年齡及基準（可填約數）" accessibilityLabel="年齡及基準草稿" value={age} onChangeText={value => { setAge(value); setReviewed(false); }} />
          <AppTextField label="地區（未知可留空）" accessibilityLabel="地區草稿" value={region} onChangeText={value => { setRegion(value); setReviewed(false); }} />
          <Text style={styles.meta}>正式版會使用 ChildProfile／AgeBasis 的結構化欄位及版本；此預覽文字不可作 API 資料。</Text>
          <View style={styles.actions}><AppButton label="預覽待確認資料" onPress={() => setReviewed(true)} disabled={!name.trim()} /><AppButton label="還原預覽" variant="quiet" onPress={() => { setName(child?.displayName ?? ""); setAge(child?.ageLabel ?? ""); setRegion(child?.regionLabel ?? ""); setReviewed(false); }} /></View>
          {reviewed ? <View style={styles.preview}><Text style={styles.previewTitle}>待確認 · 未保存</Text><Text style={styles.body}>孩子：{name}；年齡：{age || "未知"}；地區：{region || "未知"}。</Text><Text style={styles.meta}>正式確認須核對共享範圍、權限與原操作結果。</Text></View> : null}
        </SectionCard>
        <SectionCard><SectionHeader title="切換孩子" subtitle="畫面資料與草稿應按孩子分隔。" />
          {model.children.length === 0 ? <Text style={styles.body}>沒有可切換的孩子。</Text> : model.children.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`切換至${item.displayName}`} accessibilityState={{ selected: item.id === child?.id }} onPress={() => actions.selectChild(item.id)} style={({ pressed }) => [styles.childOption, item.id === child?.id && styles.childOptionActive, pressed && styles.pressed]}><Text style={styles.childOptionText}>{item.displayName} · {item.ageLabel}</Text><Text style={styles.meta}>{item.id === child?.id ? "目前" : "切換"}</Text></Pressable>)}
        </SectionCard>
      </View>
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, column: { flex: 1, width: "100%", minWidth: 0, gap: spacing.lg }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, identity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" }, avatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.heading, fontWeight: "800" }, identityCopy: { flex: 1, minWidth: 0 }, childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, rule: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md }, ruleNumber: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.small, fontWeight: "800" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, preview: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.xs }, previewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "800" }, childOption: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md }, childOptionActive: { backgroundColor: colors.selectedNav, borderColor: colors.teal }, childOptionText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
});
