import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Checkbox, Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

type InviteRole = "caregiver" | "viewer";
const scope = "加入後可查看這個家庭的全部孩子及共享照顧記錄；不包括其他人的私人 AI 聊天。日後新增到這個家庭的孩子及共享記錄，亦屬同一共享範圍。";

export default function FamilyPage() {
  const { width } = useWindowDimensions();
  const { model, actions } = usePreview();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("caregiver");
  const [scopeChecked, setScopeChecked] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const stacked = width < 1200;
  return <PageFrame title="家庭協調" description="把共享記錄與私人聊天分清楚，邀請與權限更改都須先確認範圍。" eyebrow="育伴港 · 家庭">
    <View style={styles.warning}><Text style={styles.warningText}>這是合成家庭預覽；沒有發送邀請、建立成員或變更任何真實權限。</Text></View>
    <View style={[styles.columns, stacked && styles.stack]}>
      <View style={styles.column}>
        <SectionCard><SectionHeader title="我的家庭" subtitle="正式身份與角色由 Server 判定。" />
          <View style={styles.member}><View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>媽</Text></View><View style={styles.memberCopy}><Text style={styles.memberName}>{model.caregiverName}（合成）</Text><Text style={styles.meta}>擁有者 · 可管理成員及孩子</Text></View><Text style={styles.role}>擁有者</Text></View>
          <View style={styles.member}><View style={styles.memberAvatarAlt}><Text style={styles.memberAvatarText}>家</Text></View><View style={styles.memberCopy}><Text style={styles.memberName}>家庭成員示例</Text><Text style={styles.meta}>照顧者 · 可管理獲授權的共享記錄</Text></View><Text style={styles.role}>照顧者</Text></View>
          <Text style={styles.body}>檢視者只能閱讀共享資料；私人聊天不會因家庭角色而自動共享。撤權後正式介面須立即清除不再可見的內容。</Text>
        </SectionCard>
        <SectionCard><SectionHeader title="共享範圍" />
          <Text style={styles.body}>{scope}</Text>
          <View style={styles.childList}><Text style={styles.childListTitle}>目前合成孩子</Text>{model.children.map(child => <Text key={child.id} style={styles.meta}>• {child.displayName} · {child.ageLabel}</Text>)}</View>
          <AppButton label="查看孩子資料" variant="secondary" onPress={() => actions.open("profile")} />
        </SectionCard>
      </View>
      <View style={styles.column}>
        <SectionCard><SectionHeader title="邀請成員" subtitle="正式一次性邀請碼由 Server 建立，且只會顯示一次。" />
          <AppTextField label="受邀人的電郵" accessibilityLabel="受邀人的電郵預覽" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={value => { setEmail(value); setReviewed(false); setScopeChecked(false); }} />
          <Text style={styles.label}>預計角色</Text>
          <View style={styles.roleChoices}>{(["caregiver", "viewer"] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={item === "caregiver" ? "照顧者" : "檢視者"} accessibilityState={{ selected: role === item }} onPress={() => { setRole(item); setReviewed(false); setScopeChecked(false); }} style={({ pressed }) => [styles.roleChoice, role === item && styles.roleChoiceActive, pressed && styles.pressed]}><Text style={[styles.roleChoiceText, role === item && styles.roleChoiceTextActive]}>{item === "caregiver" ? "照顧者" : "檢視者"}</Text></Pressable>)}</View>
          <Pressable accessibilityRole="checkbox" accessibilityLabel="我已核對家庭共享範圍" accessibilityState={{ checked: scopeChecked }} onPress={() => setScopeChecked(value => !value)} style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}><Checkbox status={scopeChecked ? "checked" : "unchecked"} /><Text style={styles.body}>我已核對上述共享範圍</Text></Pressable>
          <AppButton label="預覽邀請內容" onPress={() => setReviewed(true)} disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || !scopeChecked} />
          {reviewed ? <View style={styles.review}><Text style={styles.reviewTitle}>待確認 · 未建立邀請</Text><Text style={styles.body}>擬邀請 {email.trim()} 成為{role === "caregiver" ? "照顧者" : "檢視者"}。此預覽沒有建立邀請碼，亦沒有發送電郵。</Text></View> : null}
        </SectionCard>
        <SectionCard><SectionHeader title="收到邀請？" />
          <Text style={styles.body}>正式版須先預覽邀請的家庭、角色、到期時間及共享範圍，才能明確接受。此預覽沒有有效邀請碼，所以不提供假加入流程。</Text>
        </SectionCard>
      </View>
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 }, warning: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small }, warningText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 21 }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, column: { flex: 1, width: "100%", minWidth: 0, gap: spacing.lg }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, member: { minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md }, memberAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, memberAvatarAlt: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleAmber, alignItems: "center", justifyContent: "center" }, memberAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" }, memberCopy: { flex: 1, minWidth: 0 }, memberName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, role: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "800", backgroundColor: colors.paleTeal, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, childList: { backgroundColor: colors.quietSurface, borderRadius: radius.small, padding: spacing.md, gap: spacing.xs }, childListTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, roleChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, roleChoice: { minHeight: 42, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, justifyContent: "center" }, roleChoiceActive: { backgroundColor: colors.teal, borderColor: colors.teal }, roleChoiceText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "700" }, roleChoiceTextActive: { color: colors.white }, checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.xs }, review: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.xs }, reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "800" },
});
