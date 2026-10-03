import { useState } from "react";
import { View } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { fetchStateLabels } from "../../shared-input-view-model";
import { photoExtractionLabels } from "../../photo-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../ui";
import { validSourceExcerpt } from "./source-form";
import { sourceStyles as s } from "./source-styles";
export function sourceTime(value: string | null) { if (!value) return "未取得"; const date = DateTime.fromISO(value).setZone("Asia/Hong_Kong"); return date.isValid ? date.toFormat("yyyy年M月d日 HH:mm") : "時間未能核對"; }

export function SourceDetails({ model, actions, onRecord }: { model: SourcesViewModel; actions: SourcesActions; onRecord: (id: string) => void }) {
  const [showText, setShowText] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const selected = model.selected;
  if (!selected) return null;
  const hasText = !!selected.text.trim(), candidate = selected.extraction.draft, direct = model.direct;
  const canManage = selected.canManage && model.access === "editable";
  const canConsent = model.fresh && canManage && (direct ? direct.checked : model.canFetch || model.canExtract);
  return <>
    <SectionCard testID="source-details"><SectionHeader density="compact" title={selected.sourceLabel} subtitle={`本人私人來源 · 版本 ${selected.version}`} icon="link-variant" />
      <Text style={s.body}>來源日期原文：{selected.sourceDateText || "未提供"}</Text>
      {selected.sourceUrl ? <Text selectable style={s.body}>網址：{selected.sourceUrl}</Text> : <Text style={s.meta}>沒有來源網址。</Text>}
      {selected.sourceNotes ? <Text selectable style={s.body}>私人備註：{selected.sourceNotes}</Text> : null}
      <View style={s.row}><Text style={s.body}>{fetchStateLabels[selected.fetchState]}</Text><Text style={s.meta}>{photoExtractionLabels[selected.extraction.state]}</Text></View>
      {selected.recordId ? <><Text style={s.body}>已連結{selected.confirmationKind === "reference" ? "家庭參考備註" : "孩子實際記錄"}。來源原文、網址、日期及候選仍屬私人。</Text><AppButton label="查看照顧記錄" variant="secondary" onPress={() => onRecord(selected.recordId!)} /></> : null}
      {!hasText ? <><Text style={s.warning}>連結已保存，尚未取得正文；目前沒有可提取或確認的正文。</Text>
        {selected.kind === "personal_source" ? <><Text style={s.meta}>公開可直接訪問的 HTML 才可取得。需要登入的內容請自行貼上；不會登入你的帳戶。</Text>
          <AppButton label="自行貼上正文" accessibilityLabel="返回新增私人來源並自行貼上正文" variant="secondary" disabled={!model.fresh || !model.canCreate || !!direct} onPress={actions.recreateWithText} /></> : null}
      </> : <><AppButton label={showText ? "收起保存原文" : `查看完整原文（${selected.text.length.toLocaleString("en-HK")} 字）`} variant="secondary" onPress={() => setShowText(value => !value)} />
        {showText ? <ScrollView nestedScrollEnabled style={s.original} contentContainerStyle={s.originalContent}><Text selectable testID="source-full-text" style={s.reading}>{selected.text}</Text></ScrollView> : null}
      </>}
      <View style={s.group}><AppButton label={showTechnical ? "收起來源技術資料" : "顯示來源技術資料"} variant="quiet" density="compact" onPress={() => setShowTechnical(value => !value)} />
        {showTechnical ? <><Text style={s.meta}>本站保存：{sourceTime(selected.createdAt)}（香港時間）</Text>
          <Text style={s.meta}>取得正文：{sourceTime(selected.retrievedAt)}{selected.retrievedAt ? "（香港時間）" : ""}</Text>
          <Text selectable style={s.meta}>正文 SHA-256：{selected.sha256 || "尚未有正文完整性資料"}</Text></> : null}
      </View>
      <AppButton label="刪除私人來源" variant="quiet" disabled={!model.canDelete} onPress={actions.openDeletion} />
    </SectionCard>
    {canManage && !selected.recordId && (!hasText || selected.kind === "public_source") && selected.sourceUrl && selected.kind !== "paste" ? <SectionCard><SectionHeader density="compact" title="取得網頁正文" subtitle="只按你明確選定的來源取得，不會背景訂閱。" />
      <AppCheckbox label="我同意取得此來源的公開正文並私人保存" checked={model.fetchConsent} disabled={!canConsent || direct?.kind === "extract"} onChange={actions.setFetchConsent} />
      <AppButton label={selected.fetchState === "failed" ? "明確重新取得正文" : "取得此網頁內容"} disabled={!model.canFetch || !model.fetchConsent} onPress={actions.fetchContent} />
    </SectionCard> : null}
    {canManage && !selected.recordId && hasText ? <SectionCard><SectionHeader density="compact" title="可選的 AI 提取" subtitle="先選取連續原文，再明確同意；也可直接在下方人工整理。" icon="star-four-points" />
      {selected.text.length > 10000 ? <Text style={s.warning}>原文超過 10,000 字，請自行複製一段連續片段；沒有自動截短。</Text> : null}
      <AppTextField label="提取原文片段" accessibilityLabel="提取原文片段" multiline value={model.excerpt} disabled={model.formLocked || !!direct} onChangeText={actions.setExcerpt} />
      <Text style={validSourceExcerpt(selected.text, model.excerpt) ? s.meta : s.error}>{validSourceExcerpt(selected.text, model.excerpt) ? "片段與保存原文完全相符。" : "請提供 1–10,000 字、與原文完全相符的連續片段。"}</Text>
      <AppCheckbox label="我同意把以上原文片段交由模型提取" checked={model.modelConsent} disabled={!canConsent || !validSourceExcerpt(selected.text, model.excerpt) || direct?.kind === "fetch"} onChange={actions.setModelConsent} />
      <AppButton label="提取所選片段" disabled={!model.canExtract || !model.modelConsent || !validSourceExcerpt(selected.text, model.excerpt)} onPress={actions.extract} />
    </SectionCard> : null}
    {direct ? <SectionCard><SectionHeader density="compact" title="原次取得／提取查核" />
      <Text style={s.body}>原次{direct.kind === "fetch" ? "取得" : "提取"}採用版本 {direct.basisVersion}。明確查回會保留原版本{direct.kind === "extract" ? "及原片段" : ""}。</Text>
      {direct.kind === "extract" ? <Text selectable style={s.meta}>原次片段：{direct.excerpt}</Text> : null}
      <AppButton label="查回原次請求" accessibilityLabel="明確查回原版本及原片段" variant="secondary" disabled={!model.fresh || !direct.checked || !canManage || (direct.kind === "fetch" ? !model.fetchConsent : !model.modelConsent)} onPress={actions.retryDirect} />
      <AppButton label="結束本次查核" variant="quiet" disabled={!model.fresh || !direct.checked || (direct.kind === "fetch" ? selected.fetchState : selected.extraction.state) !== "unknown"} onPress={actions.endDirect} />
    </SectionCard> : null}
    {candidate && !selected.recordId ? <SectionCard><SectionHeader density="compact" title="未確認候選" subtitle="採用前請核對原文、時間、數值及不確定事項。" />
      <Text style={s.reading}>{candidate.text || "未提取到文字"}</Text><Text style={s.meta}>數值：{candidate.rawValue || "未知"} · 單位：{candidate.unit || "未知"} · {candidate.approximate ? "包含約數" : "未標記約數"}</Text>
      <Text style={s.meta}>時間原文：{candidate.timeRaw || "未知"}</Text>{candidate.uncertainties.map((text, index) => <Text key={index} style={s.warning}>{text}</Text>)}
      <AppButton label="採用候選作草稿" variant="secondary" disabled={model.formLocked} onPress={actions.adoptCandidate} />
    </SectionCard> : null}
  </>;
}
