import { EmptyListCard } from "../EmptyListCard";
import { AppStatusBadge } from "../AppStatusBadge";
import { useState } from "react";
import { View } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { fetchStateLabels, sourceReadiness } from "../../shared-input-view-model";
import { photoExtractionLabels } from "../../photo-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../ui";
import { validSourceExcerpt } from "./source-form";
import { sourceStyles as s } from "./source-styles";
import { MotionDisclosure, MotionFeedback, MotionReveal } from "../../motion";
import { sourceNatureOptions, sourcePurposeOptions, sourceTimeOptions } from "../../source-intake";
export function sourceTime(value: string | null) { if (!value) return "未取得"; const date = DateTime.fromISO(value).setZone("Asia/Hong_Kong"); return date.isValid ? date.toFormat("yyyy年M月d日 HH:mm") : "時間未能核對"; }

export function SourceDetails({ model, actions, onRecord, resultTrigger = null, showTools = true }: { model: SourcesViewModel; actions: SourcesActions; onRecord: (id: string) => void; resultTrigger?: number | null; showTools?: boolean }) {
  const [showText, setShowText] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const selected = model.selected;
  if (!selected) return null;
  const readiness = sourceReadiness(selected, model);
  const hasText = !!selected.text.trim(), candidate = selected.extraction.draft, direct = model.direct;
  const enabled = selected.management?.enabled !== false;
  const canManage = selected.canManage && model.access === "editable";
  const canConsent = enabled && model.fresh && canManage && (direct ? direct.checked : model.canFetch || model.canExtract);
  const scopeKey = JSON.stringify([model.scopeKey, selected.id, model.access]);
  const resultReady = model.online && model.load === 'ready' && !model.busy && model.operation.state === 'saved';
  const candidateEligible = resultReady && model.operation.phase === 'extract' && selected.extraction.state === 'available';
  const textEligible = resultReady && model.operation.phase === 'fetch' && selected.fetchState === 'ready' && showText;
  const candidateTrigger = !model.busy && !candidateEligible ? null : resultTrigger;
  const textTrigger = !model.busy && !textEligible ? null : resultTrigger;
  return <>
    <SectionCard surface="plain" style={s.workflowSection} testID="source-details"><SectionHeader density="compact" title={selected.sourceLabel} subtitle="本人私人來源" icon="link-variant" />
      <Text style={s.body}>來源日期原文：{selected.sourceDateText || "未提供"}</Text>
      {selected.sourceUrl ? <Text selectable style={s.body}>網址：{selected.sourceUrl}</Text> : <Text style={s.meta}>沒有來源網址。</Text>}
      {selected.sourceNotes ? <Text selectable style={s.body}>私人備註：{selected.sourceNotes}</Text> : null}
      <View style={s.row}><AppStatusBadge label={fetchStateLabels[selected.fetchState]} tone={selected.fetchState === "ready" ? "success" : selected.fetchState === "failed" ? "error" : selected.fetchState === "unknown" ? "warning" : selected.fetchState === "running" ? "info" : "neutral"} /><AppStatusBadge label={photoExtractionLabels[selected.extraction.state]} tone={selected.extraction.state === "failed" ? "error" : selected.extraction.state === "unknown" || selected.extraction.state === "available" ? "warning" : selected.extraction.state === "running" ? "info" : "neutral"} /></View>
      <View style={s.row}><AppStatusBadge label={readiness.label} tone={readiness.tone} /><AppStatusBadge label={readiness.indexLabel} /></View>
      <Text style={s.meta}>私人來源由 Agent 讀取本人授權內容，未加入公共知識索引；保存網址不等於正文可用。</Text>
      <MotionFeedback scopeKey={scopeKey} active={model.operation.state === 'saved' && model.operation.phase === 'confirm' && !!selected.recordId} triggerKey={model.operation.state === 'saved' && model.operation.phase === 'confirm' ? model.operation.reference : null} testID="source-confirmation-feedback">{selected.recordId ? <Text style={s.body}>已連結{selected.confirmationKind === "reference" ? "家庭參考備註" : "孩子實際記錄"}。來源原文、網址、日期及候選仍屬私人。</Text> : null}</MotionFeedback>
      {selected.recordId ? <AppButton label="查看照顧記錄" variant="secondary" onPress={() => onRecord(selected.recordId!)} /> : null}
      {!hasText ? <><Text style={s.warning}>連結已保存，尚未取得正文；目前沒有可提取或確認的正文。</Text>
        {selected.kind === "personal_source" ? <><Text style={s.meta}>公開可直接訪問的 HTML 才可取得。需要登入的內容請自行貼上；不會登入你的帳戶。</Text>
          {model.intake?.mode === "production" && actions.management ? <AppButton label="原地貼上正文" accessibilityLabel="原地編輯私人來源正文" variant="secondary" disabled={!enabled || !model.fresh || !canManage || !!selected.recordId || !!direct} onPress={actions.management.beginContentEdit} />
            : <AppButton label="自行貼上正文" accessibilityLabel="返回新增私人來源並自行貼上正文" variant="secondary" disabled={!model.fresh || !model.canCreate || !model.canChoose || !!direct} onPress={actions.recreateWithText} />}</> : null}
      </> : <><AppButton expanded={enabled && showText} label={showText ? "收起保存原文" : `查看完整原文（${selected.text.length.toLocaleString("en-HK")} 字）`} variant="secondary" disabled={!enabled} onPress={() => setShowText(value => !value)} />
      </>}
      {!enabled ? <Text style={s.warning}>這份來源已停用。重新啟用並保存後才可查看原文或提取。</Text> : null}
      <MotionDisclosure expanded={enabled && showText && hasText} scopeKey={scopeKey}>
        <MotionReveal value={selected.text} contentKey={selected.text} scopeKey={scopeKey} regionKey="source-original-text" triggerKey={textTrigger} eligible={textEligible} testID="source-original-motion">{shown => <ScrollView nestedScrollEnabled style={s.original} contentContainerStyle={s.originalContent}><Text selectable testID="source-full-text" style={s.reading}>{shown}</Text></ScrollView>}</MotionReveal>
      </MotionDisclosure>
      <View style={s.group}><AppButton expanded={showTechnical} label={showTechnical ? "收起來源技術資料" : "顯示來源技術資料"} variant="quiet" density="compact" onPress={() => setShowTechnical(value => !value)} />
        <MotionDisclosure expanded={showTechnical} scopeKey={scopeKey} style={s.stack}><Text style={s.meta}>資料版本：{selected.version}</Text><Text style={s.meta}>本站保存：{sourceTime(selected.createdAt)}</Text>
          <Text style={s.meta}>取得正文：{sourceTime(selected.retrievedAt)}</Text>
          <Text selectable style={s.meta}>正文 SHA-256：{selected.sha256 || "尚未有正文完整性資料"}</Text></MotionDisclosure>
      </View>
      {model.intake?.mode === "synthetic" ? <View style={s.group}>
        <Text style={s.meta}>來源原地修改與停用尚未有正式接線；不會把編輯用途草稿當成更新原文。</Text>
        <View style={s.row}><AppButton label="編輯原來源（待接線）" variant="quiet" disabled onPress={() => {}} />
          <AppButton label="停用接入（待接線）" variant="quiet" disabled onPress={() => {}} /></View>
      </View> : null}
      {model.intake?.mode === "production" && actions.management ? <View style={s.group}>
        <View style={s.row}><AppButton label="編輯來源設定" variant="quiet" disabled={model.formLocked || !!direct} onPress={() => actions.intake?.editManually()} />
          <AppButton expanded={showHistory} label={showHistory ? "收起來源修改記錄" : "查看來源修改記錄"} variant="quiet" disabled={!model.fresh || !!direct} onPress={() => {
            setShowHistory(value => !value); if (!showHistory && (!model.managementHistory || ["idle", "error"].includes(model.managementHistory.load))) actions.management!.history();
          }} /></View>
        <MotionDisclosure expanded={showHistory} scopeKey={scopeKey} style={s.stack}>
        {model.managementHistory?.load === "loading" ? <Text style={s.meta}>正在讀取來源修改記錄…</Text> : model.managementHistory?.load === "error" ? <><Text style={s.warning}>未能讀取修改記錄，請明確再讀取。</Text><AppButton label="重新讀取修改記錄" variant="quiet" disabled={!model.fresh || !!direct} onPress={actions.management.history} /></> : null}
        {model.managementHistory?.load === "ready" ? <View style={s.stack}>
          {!model.managementHistory.revisions.length ? model.online && model.fresh ? <EmptyListCard title="已載入頁面暫無來源管理修訂記錄" detail={model.managementHistory.hasMore ? "仍有修訂未載入，可繼續讀取。" : undefined} /> : <Text style={s.meta}>來源管理修訂記錄尚未重新核對。</Text> : null}
          {model.managementHistory.revisions.map(revision => <View key={revision.version} style={s.group}>
            <Text style={s.meta}>版本 {revision.version} · {sourceTime(revision.changedAt)}</Text><Text selectable style={s.body}>原因：{revision.reason}</Text>
            <Text style={s.meta}>{revision.management ? `${sourcePurposeOptions.find(option => option.value === revision.management?.purpose)?.label} · ${sourceNatureOptions.find(option => option.value === revision.management?.nature)?.label} · ${sourceTimeOptions.find(option => option.value === revision.management?.timeScope)?.label}` : "尚未有來源管理設定"}</Text>
            {revision.management?.intention ? <Text selectable style={s.meta}>用途說明：{revision.management.intention}</Text> : null}
            {revision.management?.validityText ? <Text selectable style={s.meta}>適用期間／條件：{revision.management.validityText}</Text> : null}
            {revision.management ? <Text style={s.meta}>{revision.management.enabled ? "可使用" : "已停用"} · {revision.management.modelExcerpt ? "有摘錄授權" : "沒有摘錄授權"}</Text> : null}
          </View>)}
          {model.managementHistory.hasMore ? <Text style={s.meta}>目前顯示最近 20 次修訂，還有較早記錄。</Text> : null}
        </View> : null}</MotionDisclosure>
      </View> : null}
      <AppButton label="刪除私人來源" variant="danger-secondary" disabled={!model.canDelete} onPress={actions.openDeletion} />
    </SectionCard>
    {showTools && canManage && !selected.recordId && (!hasText || selected.kind === "public_source") && selected.sourceUrl && selected.kind !== "paste" ? <SectionCard surface="plain" style={s.workflowSection}><SectionHeader density="compact" title="取得網頁正文" subtitle="只按你明確選定的來源取得，不會背景訂閱。" />
      <AppCheckbox label="我同意取得此來源的公開正文並私人保存" checked={model.fetchConsent} disabled={!canConsent || direct?.kind === "extract"} onChange={actions.setFetchConsent} />
      <AppButton label={selected.fetchState === "failed" ? "明確重新取得正文" : "取得此網頁內容"} disabled={!model.canFetch || !model.fetchConsent} onPress={actions.fetchContent} />
    </SectionCard> : null}
    {enabled && showTools && canManage && !selected.recordId && hasText ? <SectionCard surface="plain" style={s.workflowSection}><SectionHeader density="compact" title="可選的 AI 提取" subtitle="先選取連續原文，再明確同意；也可直接在下方人工整理。" icon="star-four-points" />
      {selected.text.length > 10000 ? <Text style={s.warning}>原文超過 10,000 字，請自行複製一段連續片段；沒有自動截短。</Text> : null}
      <AppTextField label="提取原文片段" accessibilityLabel="提取原文片段" multiline value={model.excerpt} disabled={model.formLocked || !!direct} onChangeText={actions.setExcerpt} />
      <Text style={validSourceExcerpt(selected.text, model.excerpt) ? s.meta : s.error}>{validSourceExcerpt(selected.text, model.excerpt) ? "片段與保存原文完全相符。" : "請提供 1–10,000 字、與原文完全相符的連續片段。"}</Text>
      <AppCheckbox label="我同意把以上原文片段交由模型提取" checked={model.modelConsent} disabled={!canConsent || !validSourceExcerpt(selected.text, model.excerpt) || direct?.kind === "fetch"} onChange={actions.setModelConsent} />
      <AppButton label="提取所選片段" disabled={!model.canExtract || !model.modelConsent || !validSourceExcerpt(selected.text, model.excerpt)} onPress={actions.extract} />
    </SectionCard> : null}
    {direct ? <SectionCard surface="plain" style={s.workflowSection}><SectionHeader density="compact" title="原次取得／提取查核" />
      <Text style={s.body}>原次{direct.kind === "fetch" ? "取得" : "提取"}採用版本 {direct.basisVersion}。明確查回會保留原版本{direct.kind === "extract" ? "及原片段" : ""}。</Text>
      {direct.kind === "extract" ? <Text selectable style={s.meta}>原次片段：{direct.excerpt}</Text> : null}
      <AppButton label="查回原次請求" accessibilityLabel="明確查回原版本及原片段" variant="secondary" disabled={!model.fresh || !direct.checked || !canManage || (direct.kind === "fetch" ? !model.fetchConsent : !model.modelConsent)} onPress={actions.retryDirect} />
      <AppButton label="結束本次查核" variant="quiet" disabled={!model.fresh || !direct.checked || (direct.kind === "fetch" ? selected.fetchState : selected.extraction.state) !== "unknown"} onPress={actions.endDirect} />
    </SectionCard> : null}
    {enabled && showTools && !selected.recordId ? <View style={s.stack}>
      <MotionReveal value={candidate} contentKey={JSON.stringify(candidate)} scopeKey={scopeKey} regionKey="source-candidate" triggerKey={candidateTrigger} eligible={candidateEligible} testID="source-candidate-motion">{shown => shown ? <SectionCard surface="plain" style={s.workflowSection}>
        <SectionHeader density="compact" title="未確認候選" subtitle="採用前請核對原文、時間、數值及不確定事項。" />
        <Text style={s.reading}>{shown.text || "未提取到文字"}</Text><Text style={s.meta}>數值：{shown.rawValue || "未知"} · 單位：{shown.unit || "未知"} · {shown.approximate ? "包含約數" : "未標記約數"}</Text>
        <Text style={s.meta}>時間原文：{shown.timeRaw || "未知"}</Text>{shown.uncertainties.map((text, index) => <Text key={index} style={s.warning}>{text}</Text>)}
      </SectionCard> : null}</MotionReveal>
      {candidate ? <AppButton label="採用候選作草稿" variant="secondary" disabled={model.formLocked} onPress={actions.adoptCandidate} /> : null}
    </View> : null}
  </>;
}
