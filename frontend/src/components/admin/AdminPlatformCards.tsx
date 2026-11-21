import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { PlatformCardPreview } from '../../../../src/shared/admin-platform-cards';
import { mediaTimestamp } from '../../../../src/shared/platform-media';
import { adminError, type AdminOwner } from '../../production/AdminOwner';
import { AdminEntry } from '../../production/AdminEntry';
import { AppButton, AppSelect, AppTextField, SectionHeader } from '../ui';
import { AppCheckbox } from '../AppCheckbox';
import { spacing } from '../../theme';

export function AdminPlatformCards({ admin, locked }: { admin: AdminOwner; locked: boolean }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false);
  const [list, setList] = useState<Awaited<ReturnType<AdminOwner['platformMaterials']>>>([]);
  const [sourceId, setSourceId] = useState(''), [version, setVersion] = useState('');
  const [media, setMedia] = useState<Awaited<ReturnType<AdminOwner['platformMedia']>> | null>(null);
  const [activeEdition, setActiveEdition] = useState<Awaited<ReturnType<AdminOwner['platformActive']>>>(null);
  const [source, setSource] = useState(''), [record, setRecord] = useState(''), [checked, setChecked] = useState(false);
  const [preview, setPreview] = useState<PlatformCardPreview | null>(null), [notice, setNotice] = useState('');
  const live = useRef(true), sending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const selected = list.find(item => item.id === sourceId);
  async function run(work: () => Promise<void>) {
    if (sending.current || locked) return;
    sending.current = true; setBusy(true); setNotice('');
    try { await work(); }
    catch (error) { if (live.current) setNotice(error instanceof SyntaxError ? '請核對 JSON 格式。' : adminError(error)); }
    finally { sending.current = false; if (live.current) setBusy(false); }
  }
  async function show(id: string, edition: string) {
    const result = await admin.platformPreview(id, edition);
    if (!live.current) return;
    setVersion(edition); setPreview(result); setChecked(false);
    setRecord(JSON.stringify({
      comparedVersionId: result.baseId, comparedHash: result.baseHash, observationHash: result.observationHash,
      changes: result.changes.map(c => ({ key: c.key, oldQuote: c.oldQuote, newQuote: c.newQuote,
        meaning: c.previous === null ? 'new' : c.current === null ? 'removed' : 'changed', explanation: '' })),
      checks: { age: '', numbersAndUnits: '', timing: '', conditions: '', exceptions: '', prohibitions: '', withdrawal: '' },
      questions: [{ query: '', expectedKeys: [], reason: '' }], growthRuleImpact: 'none', growthRuleReason: '', decision: 'hold',
    }, null, 2));
  }
  const disabled = busy || locked;
  return <View style={{ gap: spacing.sm }}>
    <SectionHeader title="平台卡庫" />
    <AppButton label={opened ? '收起平台卡管理' : '管理平台卡'} variant="secondary" disabled={disabled} onPress={() => {
      if (opened) { setOpened(false); return; }
      void run(async () => { const items = await admin.platformMaterials(); if (live.current) { setList(items); setOpened(true); } });
    }} />
    {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
    {opened ? <>
      <AppSelect label="教材" value={sourceId} disabled={disabled} options={[{ value: '', label: '選擇教材' },
        ...list.map(item => ({ value: item.id, label: item.title + (item.url.endsWith('.pdf') ? ' · PDF' : '') }))]}
        onChange={id => { setSourceId(id); setPreview(null); setVersion(''); setSource(''); setMedia(null);
          setActiveEdition(null);
          if (id) void run(async () => { const [entry, active] = await Promise.all([admin.platformMedia(id), admin.platformActive(id)]);
            if (live.current) { setMedia(entry); setActiveEdition(active); if (active) setVersion(active.versionId); } }); }} />
      {selected ? <>
        <AppButton label="開啟教材原文" variant="quiet" onPress={() => { void Linking.openURL(selected.url).catch(() => setNotice('未能開啟原文。')); }} />
        {activeEdition ? <AdminEntry sourceId={sourceId} /> : null}
        {media ? <>
          <AppCheckbox label="由平台處理本卡影音" checked={media.enabled} disabled={disabled} onChange={enabled => void run(async () => {
            const entry = await admin.platformMedia(sourceId, { enabled, revision: media.revision }); if (live.current) setMedia(entry);
          })} />
          {media.links.map(url => <Text key={url} selectable>{url}</Text>)}
          {media.enabled ? (media.clips ?? []).map(clip => <AppButton key={clip.link + clip.url + clip.start + clip.end} variant="quiet"
            label={mediaTimestamp(clip.start) + '–' + mediaTimestamp(clip.end) + '　' + clip.text} disabled={!source.trim() || disabled}
            onPress={() => { try {
              const draft = JSON.parse(source), key = 'clip-' + clip.evidenceHash.slice(0, 16) + '-' + Math.round(clip.start * 1000);
              if (!Array.isArray(draft.chunks)) throw Error();
              if (draft.chunks.some((c: { key?: string }) => c.key === key)) return;
              draft.chunks.push({ key, section: '影音 ' + mediaTimestamp(clip.start) + '–' + mediaTimestamp(clip.end),
                mediaClip: clip, text: clip.text, sourceExcerpt: Array.from(clip.text).slice(0, 140).join(''), originalText: clip.text,
                keywords: [], applicability: { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: [], conditions: [] } });
              setSource(JSON.stringify(draft, null, 2)); setNotice('片段已加入草稿。請核對時間、關鍵字及適用範圍。');
            } catch { setNotice('請先建立有效的教材草稿。'); } }} />) : null}
        </> : null}
        {activeEdition ? <AppButton label="以現行版本建立草稿" disabled={disabled} onPress={() => setSource(JSON.stringify(activeEdition.source, null, 2))} /> : null}
        <AppButton label="新建平台卡" disabled={disabled} onPress={() => setSource(JSON.stringify({
          sourceId, url: selected.url, title: selected.title,
          publisher: selected.url.startsWith('https://www.fhs.gov.hk/') ? '香港特別行政區政府衞生署家庭健康服務' : '', classification: 'official_guidance',
          termsUrl: selected.url.startsWith('https://www.fhs.gov.hk/') ? 'https://www.fhs.gov.hk/english/notice/notice.html' : '',
          sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), chunks: [{
            key: 'section-1', section: '', text: '', sourceExcerpt: '', keywords: [], applicability: {
              region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [],
            },
          }],
        }, null, 2))} />
        <AppTextField label="教材草稿（JSON，請填寫原文引句、關鍵詞及適用範圍）" multiline value={source} editable={!disabled} onChangeText={setSource} />
        <AppButton label="匯入草稿" disabled={disabled || !source.trim()} onPress={() => void run(async () => {
          const document = JSON.parse(source);
          if (document.sourceId !== sourceId || document.url !== selected.url) { setNotice('草稿的來源編號和網址須與所選教材相符。'); return; }
          const binding = await admin.platformCommand({ action: 'draft', source: document }); await show(sourceId, binding.versionId);
        })} />
        <AppTextField label="候選版本編號" value={version} editable={!disabled} onChangeText={v => { setVersion(v); setPreview(null); }} />
        <AppButton label="預覽版本差異" disabled={disabled || !version} onPress={() => void run(() => show(sourceId, version))} />
      </> : null}
      {preview ? <>
        <Text selectable>{preview.title} · {preview.published ? '已上架' : preview.state === 'reviewed' ? '已審核' : '待審核'}</Text>
        <Text selectable>{preview.baseId ? '現行版本 ' + preview.baseId : '首次上架'} · {preview.changes.length} 個片段有改動</Text>
        {preview.headerChanges?.map(change => <Text selectable key={change.field}>{change.field}　{change.previous ?? '未有'} → {change.current ?? '移除'}</Text>)}
        {preview.changes.map(c => <View key={c.key}><Text selectable>{c.key}</Text>
          {c.previous ? <Text selectable>原版　{c.previous}</Text> : null}{c.current ? <Text selectable>新版　{c.current}</Text> : null}</View>)}
        {!preview.published && preview.state === 'draft' ? <>
          <AppTextField label="獨立核對紀錄（JSON）" multiline value={record} editable={!disabled} onChangeText={setRecord} />
          <AppCheckbox label="已核對原文、適用條件及發布條款" checked={checked} disabled={disabled} onChange={setChecked} />
          <AppButton label="保存審核結果" disabled={disabled || !checked} onPress={() => void run(async () => {
            await admin.platformCommand({ action: 'review', sourceId, versionId: version, versionHash: preview.versionHash,
              baseId: preview.baseId, termsChecked: true, assessment: JSON.parse(record) }); await show(sourceId, version);
          })} />
        </> : null}
        {!preview.published && preview.state === 'reviewed' ? <AppButton label="同步" disabled={disabled} onPress={() => void run(async () => {
          await admin.platformCommand({ action: 'sync', sourceId, versionId: version, versionHash: preview.versionHash, baseId: preview.baseId });
          await show(sourceId, version);
        })} /> : null}
      </> : null}
    </> : null}
  </View>;
}
