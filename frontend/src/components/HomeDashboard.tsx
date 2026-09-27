import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { ActivityIndicator, Button, Dialog, Divider, Portal, RadioButton, Text, TextInput } from "react-native-paper";
import { AppButton, ConnectionPill, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeActions, HomeDestination, HomeRecord, HomeViewModel } from "../view-model";

const logo = require("../../assets/brand/logo-horizontal.png");
const harbourArt = require("../../assets/images/harbour-family-hero.png");
const assistantArt = require("../../assets/images/assistant.png");

const navItems: { key: "home" | HomeDestination; label: string; glyph: string }[] = [
  { key: "home", label: "主頁", glyph: "⌂" },
  { key: "chat", label: "與 Agent 對話", glyph: "✦" },
  { key: "care", label: "照顧記錄", glyph: "▤" },
  { key: "profile", label: "子女檔案", glyph: "◉" },
  { key: "family", label: "家庭協調", glyph: "◇" },
  { key: "memory", label: "記憶與話題", glyph: "◎" },
];

const kindGlyph: Record<HomeRecord["kind"], string> = {
  sleep: "☾", feeding: "◌", measurement: "↗", note: "✎", appointment: "▣",
};

function Sidebar({ actions }: { actions: HomeActions }) {
  return (
    <View style={styles.sidebar}>
      <Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={styles.logo} />
      <Text style={styles.sidebarTagline}>用資料 · 陪伴成長</Text>
      <View style={styles.navGroup}>
        {navItems.map(item => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.key === "home" ? "目前位於主頁" : item.label}
            accessibilityState={{ selected: item.key === "home" }}
            onPress={() => { if (item.key !== "home") actions.open(item.key); }}
            style={[styles.navItem, item.key === "home" && styles.navActive]}
          >
            <Text style={[styles.navGlyph, item.key === "home" && styles.navActiveText]}>{item.glyph}</Text>
            <Text style={[styles.navLabel, item.key === "home" && styles.navActiveText]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.sidebarBottom}>
        <View style={styles.sidebarArtFrame}>
          <Image source={assistantArt} resizeMode="contain" accessibilityLabel="育伴港照顧資料插圖" style={styles.sidebarArt} />
        </View>
        <Text style={styles.sidebarBottomTitle}>陪你梳理日常</Text>
        <Text style={styles.sidebarBottomText}>先記下可靠資料，再慢慢看清下一步。</Text>
      </View>
    </View>
  );
}

function ChildPicker({ model, actions, compact, tiny }: { model: HomeViewModel; actions: HomeActions; compact: boolean; tiny: boolean }) {
  const [visible, setVisible] = useState(false);
  const selected = model.children.find(child => child.id === model.selectedChildId);
  return (
    <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`選擇孩子，目前${selected?.displayName ?? "尚未有孩子"}`}
          accessibilityState={{ expanded: visible, disabled: model.children.length === 0 }}
          onPress={() => setVisible(true)}
          disabled={model.children.length === 0}
          style={[styles.childPicker, compact && styles.childPickerCompact, tiny && styles.childPickerTiny]}
        >
          <View style={styles.childAvatar}><Text style={styles.childAvatarText}>{selected?.displayName.slice(0, 1) ?? "育"}</Text></View>
          <View style={styles.childPickerText}>
            <Text numberOfLines={1} style={styles.childPickerName}>{selected?.displayName ?? "尚未有孩子"}</Text>
            {!compact && selected ? <Text numberOfLines={1} style={styles.childPickerAge}>{selected.ageLabel}</Text> : null}
          </View>
          <Text style={styles.childPickerArrow}>⌄</Text>
        </Pressable>
      <Portal>
        <Dialog visible={visible} onDismiss={() => setVisible(false)}>
          <Dialog.Title>選擇孩子</Dialog.Title>
          <Dialog.Content>
            {model.children.map(child => (
              <RadioButton.Item
                key={child.id}
                label={`${child.displayName} · ${child.ageLabel}`}
                value={child.id}
                status={child.id === model.selectedChildId ? "checked" : "unchecked"}
                onPress={() => { setVisible(false); actions.selectChild(child.id); }}
              />
            ))}
          </Dialog.Content>
          <Dialog.Actions><Button onPress={() => setVisible(false)}>關閉</Button></Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

function HeaderMeta({ label }: { label: string }) {
  return <View style={styles.headerMeta}><Text numberOfLines={1} style={styles.headerMetaText}>{label}</Text></View>;
}

function Header({ model, actions, compact, tiny, wide }: { model: HomeViewModel; actions: HomeActions; compact: boolean; tiny: boolean; wide: boolean }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const recordCount = model.records.filter(item => item.childId === model.selectedChildId).length;
  return (
    <View style={[styles.header, compact && styles.headerCompact, tiny && styles.headerTiny]}>
      {compact ? <Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={[styles.headerLogo, tiny && styles.headerLogoTiny]} /> : null}
      <View style={styles.headerStart}>
        <ChildPicker model={model} actions={actions} compact={compact} tiny={tiny} />
        {wide ? <>
          <HeaderMeta label={`⌖ ${child?.regionLabel ?? "地區未提供"}`} />
          <HeaderMeta label={child?.profileConfirmed ? "◉ 檔案已確認" : "◉ 檔案待核對"} />
          <HeaderMeta label={model.recordsLoad === "ready" ? `▤ 已載入記錄 ${recordCount} 項` : "▤ 記錄讀取中"} />
          {model.lastReadLabel ? <HeaderMeta label={`最近讀取：${model.lastReadLabel}`} /> : null}
        </> : null}
        {!compact && !wide ? <Text style={styles.headerDivider}>/</Text> : null}
        {!compact && !wide ? <Text style={styles.headerContext}>今天，照顧有條理一點</Text> : null}
      </View>
      <View style={styles.headerEnd}>
        {!compact ? <ConnectionPill state={model.connection} /> : null}
        <View accessibilityLabel={`照顧者：${model.caregiverName}`} style={[styles.caregiverAvatar, tiny && styles.caregiverAvatarTiny]}>
          <Text style={styles.caregiverInitial}>{model.caregiverName.slice(0, 1)}</Text>
        </View>
      </View>
    </View>
  );
}

function MobileHero({ actions }: { actions: HomeActions }) {
  return (
    <View style={styles.heroCard}>
      <Image source={harbourArt} resizeMode="cover" accessibilityLabel="照顧者與孩子在香港海旁同行" style={styles.heroMobileImage} />
      <View style={styles.heroTextCompact}>
      <View style={styles.heroEyebrow}><Text style={styles.heroEyebrowText}>✦  育伴港 · 你的照顧整理空間</Text></View>
      <Text accessibilityRole="header" style={[styles.heroTitle, styles.heroTitleCompact]}>把每天的細節，{"\n"}慢慢整理清楚。</Text>
      <Text style={styles.heroSubtitle}>記錄孩子的日常，分清已確認與仍待核對的事。需要時，從可靠資料開始討論下一步。</Text>
      <View style={styles.heroActions}>
        <AppButton label="查看照顧記錄" onPress={() => actions.open("care")} />
        <AppButton label="了解基本聊天" variant="secondary" onPress={() => actions.open("chat")} />
      </View>
      </View>
    </View>
  );
}

function DesktopAssistant({ actions }: { actions: HomeActions }) {
  return (
    <SectionCard style={styles.agentCard}>
      <View style={styles.agentHeadingRow}>
        <View style={styles.agentMark}><Text style={styles.agentMarkText}>✦</Text></View>
        <View style={styles.agentHeadingCopy}>
          <Text accessibilityRole="header" style={styles.agentTitle}>育伴港 · 基本聊天</Text>
          <Text style={styles.agentDescription}>由孩子的已確認資料開始，整理你想討論的問題與下一步。</Text>
        </View>
        <TextLink label="前往聊天頁" onPress={() => actions.open("chat")} />
      </View>
      <View style={styles.agentPromptRow}>
        <Text style={styles.agentPromptText}>有照顧問題想討論？請在已接通的基本聊天頁輸入。</Text>
        <AppButton label="開啟基本聊天" onPress={() => actions.open("chat")} />
      </View>
      <View style={styles.agentSuggestionRow}>
        <Text style={styles.agentSuggestionLabel}>從資料開始：</Text>
        <Pressable accessibilityRole="button" onPress={() => actions.open("care")} style={styles.agentSuggestion}><Text style={styles.agentSuggestionText}>查看已確認記錄</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => actions.open("profile")} style={styles.agentSuggestion}><Text style={styles.agentSuggestionText}>核對孩子檔案</Text></Pressable>
      </View>
    </SectionCard>
  );
}

function Highlight({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const selected = model.children.find(child => child.id === model.selectedChildId);
  const state = model.operation.state;
  const title = !selected ? "先建立第一位孩子的檔案" : state === "none" ? "目前沒有待確認內容" : model.operation.title;
  const detail = !selected ? "有了孩子的稱呼，才可以把記錄放到正確的資料空間。" : state === "none" ? "有新的候選內容時，會先讓你核對原文和時間，再決定是否確認。" : model.operation.detail;
  const actionLabel = !selected ? "查看子女檔案" : state === "unknown" ? "查核原操作" : state === "needs_confirmation" ? "查看待確認內容" : state === "failed" ? "返回原操作" : "查看照顧記錄";
  const canAct = state !== "saving";
  return (
    <SectionCard style={state === "unknown" ? styles.highlightUnknown : state === "failed" ? styles.highlightFailed : state === "needs_confirmation" ? styles.highlightConfirmation : styles.highlight}>
      <View style={styles.highlightTop}>
        <View style={styles.highlightHeading}>
          <Text style={styles.eyebrow}>{state === "none" || state === "needs_confirmation" ? "需要你確認" : "最近操作"}</Text>
          <Text accessibilityRole="header" style={styles.highlightTitle}>{title}</Text>
        </View>
        {selected && state !== "none" ? <OperationPill state={state} /> : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.highlightDetail}>{detail}</Text>
      <View style={styles.highlightBottom}>
        {canAct ? <AppButton label={actionLabel} onPress={() => { if (!selected) actions.open("profile"); else if (state === "unknown" || state === "needs_confirmation" || state === "failed") actions.reviewOperation(); else actions.open("care"); }} /> : <ActivityIndicator size="small" color={colors.teal} />}
        {state === "unknown" || state === "failed" ? <Text style={styles.miniNote}>如提交後未有明確結果，請先查核原操作。</Text> : null}
      </View>
    </SectionCard>
  );
}

function OverviewRow({ glyph, title, detail, end, onPress }: { glyph: string; title: string; detail: string; end: ReactNode; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}，${detail}`} onPress={onPress} style={styles.overviewRow}>
      <View style={styles.overviewGlyph}><Text style={styles.overviewGlyphText}>{glyph}</Text></View>
      <View style={styles.overviewCopy}><Text style={styles.overviewTitle}>{title}</Text><Text style={styles.overviewDetail}>{detail}</Text></View>
      <View style={styles.overviewEnd}>{end}</View>
    </Pressable>
  );
}

function DataOverview({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const visibleRecords = model.records.filter(item => item.childId === model.selectedChildId);
  return (
    <SectionCard style={styles.overviewCard}>
      <SectionHeader title="資料概況" action={<TextLink label="查看照顧記錄" onPress={() => actions.open("care")} />} />
      <View>
        <OverviewRow glyph="▤" title="最近已確認記錄" detail={model.recordsLoad === "loading" ? "正在讀取記錄" : model.recordsLoad === "error" ? "暫時讀不到記錄" : "只計此頁已載入的記錄"} end={<Text style={styles.overviewValue}>{model.recordsLoad === "ready" ? `${visibleRecords.length} 項` : "待讀取"}</Text>} onPress={() => actions.open("care")} />
        <Divider style={styles.recordDivider} />
        <OverviewRow glyph="◉" title="孩子檔案" detail={child ? `${child.displayName} · ${child.ageLabel}` : "尚未有孩子"} end={<Text style={styles.overviewValue}>{child?.profileConfirmed ? "已確認" : "待核對"}</Text>} onPress={() => actions.open("profile")} />
        <Divider style={styles.recordDivider} />
        <OverviewRow glyph="◇" title="最近操作" detail={model.operation.state === "unknown" ? "請先查核原操作" : model.operation.state === "none" ? "目前沒有待處理操作" : model.operation.title} end={<OperationPill state={model.operation.state} />} onPress={() => model.operation.state === "none" ? actions.open("care") : actions.reviewOperation()} />
      </View>
    </SectionCard>
  );
}

function RecordRow({ item, onPress }: { item: HomeRecord; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.title}，${item.detail}`} onPress={onPress} style={styles.recordRow}>
      <View style={styles.recordGlyphFrame}><Text style={styles.recordGlyph}>{kindGlyph[item.kind]}</Text></View>
      <View style={styles.recordBody}>
        <View style={styles.recordTitleRow}>
          <Text numberOfLines={1} style={styles.recordTitle}>{item.title}</Text>
          <View style={styles.confirmedTiny}><Text style={styles.confirmedTinyText}>已確認</Text></View>
        </View>
        <Text numberOfLines={2} style={styles.recordDetail}>{item.detail}</Text>
        <Text style={styles.recordTime}>{item.eventTimeLabel} · {item.confirmedAtLabel}加入</Text>
      </View>
      <Text style={styles.recordArrow}>›</Text>
    </Pressable>
  );
}

function RecentRecords({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [model.selectedChildId]);
  const selected = model.children.find(child => child.id === model.selectedChildId);
  const recent = model.records.filter(item => item.childId === model.selectedChildId);
  const filtered = recent.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK")));
  return (
    <SectionCard>
      <SectionHeader title="最近加入的已確認記錄" subtitle={model.lastReadLabel ? `最後讀取：${model.lastReadLabel}` : "只顯示已載入的記錄"} action={selected ? <TextLink label="查看記錄頁" onPress={() => actions.open("care")} /> : undefined} />
      {model.connection === "offline" ? <View style={styles.inlineWarning}><Text style={styles.inlineWarningText}>目前離線；以下可能是較早讀取的資料，不能當作最新狀態。</Text></View> : null}
      {selected && model.recordsLoad === "ready" && recent.length > 0 ? (
        <TextInput mode="outlined" dense label="篩選下方已載入的記錄" value={query} onChangeText={setQuery} style={styles.filterInput} outlineStyle={styles.filterOutline} accessibilityLabel="篩選下方已載入的記錄" />
      ) : null}
      {!selected ? <Text style={styles.emptyText}>選擇或建立孩子後，這裏會顯示相應記錄。</Text> : model.recordsLoad === "loading" ? (
        <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.emptyText}>正在讀取已確認記錄…</Text></View>
      ) : model.recordsLoad === "error" ? (
        <View style={styles.loading}><Text style={styles.emptyText}>暫時讀不到記錄，尚未能確認最新資料。</Text><AppButton label="重新讀取" variant="secondary" onPress={actions.refresh} disabled={model.connection !== "online"} /></View>
      ) : filtered.length === 0 ? (
        <Text style={styles.emptyText}>{query ? "這幾項已載入記錄中沒有符合的內容。" : "目前沒有已確認的照顧記錄。"}</Text>
      ) : filtered.map((item, index) => <View key={item.id}>{index > 0 ? <Divider style={styles.recordDivider} /> : null}<RecordRow item={item} onPress={() => actions.open("care")} /></View>)}
      <Text style={styles.miniNote}>按加入時間顯示；事件發生時間可與加入時間不同。這裏不顯示候選記錄。</Text>
    </SectionCard>
  );
}

function RecentSummary({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const recent = model.records.filter(item => item.childId === model.selectedChildId).slice(0, 3);
  return (
    <SectionCard style={styles.summaryCard}>
      <SectionHeader title="近期已確認記錄" action={<TextLink label="查看全部" onPress={() => actions.open("care")} />} />
      {model.recordsLoad === "loading" ? <Text style={styles.emptyText}>正在讀取記錄…</Text> : recent.length === 0 ? <Text style={styles.emptyText}>目前沒有已確認記錄。</Text> : recent.map((item, index) => (
        <View key={item.id}>
          {index > 0 ? <Divider style={styles.recordDivider} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.title}`} onPress={() => actions.open("care")} style={styles.summaryRow}>
            <View style={styles.summaryGlyph}><Text style={styles.summaryGlyphText}>{kindGlyph[item.kind]}</Text></View>
            <View style={styles.summaryCopy}><Text style={styles.summaryTitle}>{item.title}</Text><Text numberOfLines={2} style={styles.summaryDetail}>{item.eventTimeLabel} · {item.detail}</Text></View>
          </Pressable>
        </View>
      ))}
      {model.connection === "offline" ? <Text style={styles.miniNote}>離線時，以上可能不是最新資料。</Text> : null}
    </SectionCard>
  );
}

function QuickLink({ glyph, title, description, onPress }: { glyph: string; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.quickLink}>
      <View style={styles.quickGlyph}><Text style={styles.quickGlyphText}>{glyph}</Text></View>
      <View style={styles.quickText}><Text style={styles.quickTitle}>{title}</Text><Text style={styles.quickDescription}>{description}</Text></View>
      <Text style={styles.quickArrow}>→</Text>
    </Pressable>
  );
}

function ProfileSummary({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  return (
    <SectionCard>
      <SectionHeader title="子女資料" action={child ? <TextLink label="查看檔案" onPress={() => actions.open("profile")} /> : undefined} />
      {child ? <>
        <View style={styles.profileIdentity}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{child.displayName.slice(0, 1)}</Text></View>
          <View style={styles.profileIdentityText}><Text style={styles.profileName}>{child.displayName}</Text><Text style={styles.profileMeta}>{child.ageLabel}</Text></View>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.profileFacts}>
          <View style={styles.fact}><Text style={styles.factLabel}>地區</Text><Text style={styles.factValue}>{child.regionLabel}</Text></View>
          <View style={styles.fact}><Text style={styles.factLabel}>檔案</Text><Text style={styles.factValue}>{child.profileConfirmed ? "已確認資料" : "尚未確認"}</Text></View>
        </View>
      </> : <Text style={styles.emptyText}>尚未選擇孩子。</Text>}
    </SectionCard>
  );
}

function ConnectionSummary({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  return (
    <SectionCard>
      <SectionHeader title="資料與連線" />
      <View style={styles.statusSummaryRow}><Text style={styles.statusLabel}>網絡</Text><ConnectionPill state={model.connection} /></View>
      <View style={styles.statusSummaryRow}><Text style={styles.statusLabel}>最近操作</Text><OperationPill state={model.operation.state} /></View>
      <Text style={styles.miniNote}>網絡可用只代表可以連線；資料是否保存，以原操作的確認結果為準。</Text>
      <AppButton label="重新讀取畫面" variant="secondary" onPress={actions.refresh} disabled={model.connection !== "online"} />
    </SectionCard>
  );
}

function MobileNav({ actions }: { actions: HomeActions }) {
  return (
    <View style={styles.mobileNav}>
      {navItems.slice(0, 4).map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === "home" ? "目前位於主頁" : item.label} onPress={() => { if (item.key !== "home") actions.open(item.key); }} style={styles.mobileNavItem}>
        <Text style={[styles.mobileNavGlyph, item.key === "home" && styles.mobileNavActive]}>{item.glyph}</Text>
        <Text style={[styles.mobileNavLabel, item.key === "home" && styles.mobileNavActive]}>{item.label.replace("與 Agent 對話", "對話").replace("照顧記錄", "記錄").replace("子女檔案", "檔案")}</Text>
      </Pressable>)}
    </View>
  );
}

export function HomeDashboard({ model, actions, preview }: { model: HomeViewModel; actions: HomeActions; preview?: { message: string | null } }) {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const wide = width >= 1240;
  const tiny = width < 360;
  return (
    <View style={styles.root}>
      {!compact ? <Sidebar actions={actions} /> : null}
      <View style={styles.main}>
        <Header model={model} actions={actions} compact={compact} tiny={tiny} wide={wide} />
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, compact && styles.contentCompact]} keyboardShouldPersistTaps="handled">
          {preview && compact ? <View style={styles.previewStrip}><Text style={styles.previewStripText}>介面預覽 · 全部資料均為合成示例 · 尚未接駁 Server</Text></View> : null}
          {preview?.message ? <View accessibilityLiveRegion="polite" style={styles.previewFeedback}><Text style={styles.previewFeedbackText}>{preview.message}</Text></View> : null}
          {compact ? <View style={styles.compactConnection}><ConnectionPill state={model.connection} /><Text style={styles.compactGreeting}>你好，{model.caregiverName}</Text></View> : null}
          {compact ? <MobileHero actions={actions} /> : null}
          <View style={[styles.columns, !wide && styles.columnsStacked]}>
            <View style={[styles.primaryColumn, !wide && styles.primaryColumnStacked]}>
              {!compact ? <DesktopAssistant actions={actions} /> : null}
              <DataOverview model={model} actions={actions} />
              <Highlight model={model} actions={actions} />
              <View style={[styles.bottomGrid, !wide && styles.bottomGridStacked]}>
                <View style={styles.bottomGridItem}><RecentRecords model={model} actions={actions} /></View>
                <View style={styles.bottomGridItem}>
                  <SectionCard>
                    <SectionHeader title="常用入口" subtitle="把已有資料整理好，再按需要繼續。" />
                    <QuickLink glyph="▤" title="照顧記錄" description="查看已確認內容與原文" onPress={() => actions.open("care")} />
                    <QuickLink glyph="✦" title="基本聊天" description="與孩子相關的私人對話" onPress={() => actions.open("chat")} />
                  </SectionCard>
                </View>
              </View>
            </View>
            {wide || compact ? <View style={[styles.sideColumn, !wide && styles.sideColumnStacked]}>
              <ProfileSummary model={model} actions={actions} />
              {wide ? <RecentSummary model={model} actions={actions} /> : null}
              <ConnectionSummary model={model} actions={actions} />
              {compact ? <View style={styles.assistantCard}>
                <Image source={assistantArt} resizeMode="contain" accessibilityLabel="育伴港整理問題插圖" style={styles.assistantImage} />
                <Text style={styles.assistantTitle}>先了解，才決定下一步</Text>
                <Text style={styles.assistantText}>想梳理問題時，可先查看基本聊天；記錄仍以已確認資料為準。</Text>
              </View> : null}
            </View> : null}
          </View>
          <Text style={styles.footer}>育伴港 · 用資料陪伴成長</Text>
        </ScrollView>
        {compact ? <MobileNav actions={actions} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas, minHeight: 0 },
  sidebar: { width: 226, backgroundColor: "#F6FAF8", borderRightWidth: 1, borderRightColor: colors.line, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  logo: { width: 165, height: 50, alignSelf: "flex-start" },
  sidebarTagline: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, marginLeft: 7, marginBottom: spacing.xxl },
  navGroup: { gap: spacing.xs },
  navItem: { flexDirection: "row", alignItems: "center", minHeight: 44, borderRadius: radius.small, paddingHorizontal: spacing.md, gap: spacing.md },
  navActive: { backgroundColor: "#DCEFE9", borderLeftColor: colors.teal, borderLeftWidth: 3 },
  navGlyph: { width: 23, textAlign: "center", fontSize: 22, color: "#53736C" },
  navLabel: { fontFamily: chineseFont, color: "#4D675F", fontSize: typeScale.small, fontWeight: "600", flexShrink: 1 },
  navActiveText: { color: colors.deepTeal, fontWeight: "800" },
  sidebarBottom: { marginTop: "auto", borderRadius: radius.medium, borderWidth: 1, borderColor: colors.line, backgroundColor: "#EDF6F2", padding: spacing.md, gap: spacing.xs },
  sidebarArtFrame: { height: 100, overflow: "hidden" },
  sidebarArt: { width: "100%", height: 125 },
  sidebarBottomTitle: { fontFamily: chineseFont, color: colors.ink, fontWeight: "700", fontSize: typeScale.small, textAlign: "center" },
  sidebarBottomText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18, textAlign: "center" },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  header: { height: 70, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headerCompact: { height: 64, paddingHorizontal: spacing.lg, flexWrap: "nowrap", gap: spacing.md, paddingVertical: spacing.xs },
  headerTiny: { paddingHorizontal: spacing.md },
  headerLogo: { width: 118, height: 33, marginRight: "auto" },
  headerLogoTiny: { width: 100 },
  headerStart: { flexDirection: "row", alignItems: "center", gap: spacing.md, minWidth: 0, flexShrink: 1 },
  headerEnd: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  headerDivider: { color: colors.line, fontSize: 25 },
  headerContext: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
  headerMeta: { minHeight: 36, maxWidth: 205, paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: "#F3F8F6", justifyContent: "center" },
  headerMetaText: { fontFamily: chineseFont, color: "#4B7069", fontSize: typeScale.caption, fontWeight: "700" },
  childPicker: { minWidth: 172, maxWidth: 235, minHeight: 46, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", backgroundColor: "#F4F8F7", paddingHorizontal: spacing.sm, gap: spacing.sm },
  childPickerCompact: { minWidth: 156, maxWidth: 225, minHeight: 40 },
  childPickerTiny: { minWidth: 126, maxWidth: 126 },
  childAvatar: { width: 34, height: 34, backgroundColor: colors.sage, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  childAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontWeight: "800", fontSize: typeScale.body },
  childPickerText: { flex: 1, minWidth: 0 },
  childPickerName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  childPickerAge: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  childPickerArrow: { color: colors.teal, fontSize: 21, paddingHorizontal: 3 },
  caregiverAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.paleAmber, alignItems: "center", justifyContent: "center" },
  caregiverAvatarTiny: { width: 34, height: 34, borderRadius: 17 },
  caregiverInitial: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  scroll: { flex: 1 },
  content: { width: "100%", maxWidth: 1420, alignSelf: "center", paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  contentCompact: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  previewStrip: { backgroundColor: "#E9F1EC", borderRadius: radius.small, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  previewStripText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  previewFeedback: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md },
  previewFeedbackText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 21 },
  compactConnection: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  compactGreeting: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
  heroCard: { minHeight: 244, borderRadius: radius.large, overflow: "hidden", backgroundColor: colors.paper, justifyContent: "center" },
  heroMobileImage: { width: "100%", height: 150 },
  heroTextCompact: { width: "100%", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.md, backgroundColor: colors.paper },
  heroEyebrow: { alignSelf: "flex-start", backgroundColor: colors.paleTeal, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  heroEyebrowText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "800" },
  heroTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.hero, lineHeight: 45, fontWeight: "800" },
  heroTitleCompact: { fontSize: 25, lineHeight: 36 },
  heroSubtitle: { fontFamily: chineseFont, color: "#455D55", fontSize: typeScale.small, lineHeight: 23, maxWidth: 570 },
  heroActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  agentCard: { borderRadius: radius.medium, gap: spacing.md },
  agentHeadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  agentMark: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  agentMarkText: { color: colors.teal, fontSize: 29 },
  agentHeadingCopy: { flex: 1, minWidth: 190, gap: spacing.xs },
  agentTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" },
  agentDescription: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 20 },
  agentPromptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, borderColor: colors.line, borderWidth: 1, borderRadius: radius.small, minHeight: 62, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  agentPromptText: { flex: 1, minWidth: 180, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  agentSuggestionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  agentSuggestionLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  agentSuggestion: { borderColor: colors.line, borderWidth: 1, borderRadius: radius.small, paddingHorizontal: spacing.md, minHeight: 34, justifyContent: "center" },
  agentSuggestionText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  columnsStacked: { flexDirection: "column" },
  primaryColumn: { flex: 1, minWidth: 0, gap: spacing.lg },
  primaryColumnStacked: { width: "100%" },
  sideColumn: { width: 310, gap: spacing.lg },
  sideColumnStacked: { width: "100%" },
  bottomGrid: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  bottomGridStacked: { flexDirection: "column", alignItems: "stretch" },
  bottomGridItem: { flex: 1, minWidth: 0 },
  highlight: { backgroundColor: colors.white },
  highlightConfirmation: { backgroundColor: "#FFFAF8", borderColor: "#F2E2DD" },
  highlightUnknown: { backgroundColor: "#FFFCF7", borderColor: "#EFDBBB" },
  highlightFailed: { backgroundColor: "#FFFAF8", borderColor: "#F2D9D0" },
  highlightTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, flexWrap: "wrap" },
  highlightHeading: { flexGrow: 1, flexShrink: 1, gap: spacing.xs },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "800", letterSpacing: 1 },
  highlightTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 29, fontWeight: "800" },
  highlightDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
  highlightBottom: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md },
  miniNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18, flexShrink: 1 },
  overviewCard: { gap: spacing.sm },
  overviewRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  overviewGlyph: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  overviewGlyphText: { color: colors.deepTeal, fontSize: 23 },
  overviewCopy: { flex: 1, minWidth: 0, gap: 3 },
  overviewTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  overviewDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
  overviewEnd: { alignItems: "flex-end", justifyContent: "center" },
  overviewValue: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "800" },
  inlineWarning: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md },
  inlineWarningText: { fontFamily: chineseFont, color: "#775425", fontSize: typeScale.small, lineHeight: 20 },
  filterInput: { backgroundColor: colors.white, fontFamily: chineseFont },
  filterOutline: { borderColor: colors.line, borderRadius: radius.small },
  loading: { alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md },
  emptyText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
  recordDivider: { backgroundColor: colors.softLine },
  recordRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 90, paddingVertical: spacing.md },
  recordGlyphFrame: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  recordGlyph: { fontSize: 25, color: colors.deepTeal },
  recordBody: { flex: 1, minWidth: 0, gap: 3 },
  recordTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  recordTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800", flexShrink: 1 },
  recordDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  recordTime: { fontFamily: chineseFont, color: "#788B83", fontSize: typeScale.caption, lineHeight: 18 },
  confirmedTiny: { backgroundColor: colors.paleTeal, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  confirmedTinyText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, fontWeight: "700" },
  recordArrow: { fontSize: 25, color: colors.teal },
  summaryCard: { gap: spacing.sm },
  summaryRow: { flexDirection: "row", alignItems: "center", minHeight: 66, gap: spacing.md, paddingVertical: spacing.sm },
  summaryGlyph: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  summaryGlyphText: { fontSize: 22, color: colors.deepTeal },
  summaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  summaryTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  summaryDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
  quickLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 66, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.small, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  quickGlyph: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  quickGlyphText: { color: colors.deepTeal, fontSize: 21 },
  quickText: { flex: 1, minWidth: 0, gap: 2 },
  quickTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  quickDescription: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  quickArrow: { color: colors.teal, fontSize: 19 },
  profileIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  profileAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  profileAvatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 23, fontWeight: "800" },
  profileIdentityText: { gap: 3, flex: 1 },
  profileName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, fontWeight: "800" },
  profileMeta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
  divider: { backgroundColor: colors.softLine },
  profileFacts: { flexDirection: "row", gap: spacing.sm },
  fact: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.small, backgroundColor: "#F5F9F7", gap: 3 },
  factLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  factValue: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  statusSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  statusLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
  assistantCard: { backgroundColor: "#ECF5F1", borderRadius: radius.large, padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  assistantImage: { width: "100%", height: 132 },
  assistantTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, fontWeight: "800", textAlign: "center" },
  assistantText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19, textAlign: "center" },
  footer: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20, textAlign: "center", paddingVertical: spacing.sm },
  mobileNav: { height: 66, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", paddingHorizontal: spacing.xs },
  mobileNavItem: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 1 },
  mobileNavGlyph: { color: colors.muted, fontSize: 22 },
  mobileNavLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 11, fontWeight: "700" },
  mobileNavActive: { color: colors.deepTeal },
});
