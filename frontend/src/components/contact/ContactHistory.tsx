import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import type {ContactActions, ContactAttempt, ContactViewModel} from '../../contact-view-model';
import {contactAttemptLabels, contactChannelLabels, contactMayAcknowledge, contactName, contactRequestLabels} from '../../contact-view-model';
import {summaryTime} from '../../summary-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {contactStyles as s} from './contact-styles';

function Attempt({attempt, model, actions, title}: {attempt: ContactAttempt; model: ContactViewModel; actions: ContactActions; title: string}) {
  const [confirm, setConfirm] = useState(false), page = model.page!;
  useEffect(() => setConfirm(false), [model.confirmationEpoch]);
  const mayAck = !model.locked && contactMayAcknowledge(attempt, model.userId);
  return <View style={s.box} testID={`contact-attempt-${attempt.id}`}><Text style={s.body}>{contactName(page, attempt.recipientUserId)} · {contactChannelLabels[attempt.channel]} · {contactAttemptLabels[attempt.status]}</Text>
    <Text style={s.meta}>嘗試：{summaryTime(attempt.attemptedAt)} · 授權版本 {attempt.grantVersion} · 任務版本 {attempt.taskVersion}</Text>
    {attempt.reason ? <Text style={s.meta}>記錄理由：{attempt.reason}</Text> : null}
    {attempt.acknowledgedAt ? <Text style={s.body}>本人已確認收到：{summaryTime(attempt.acknowledgedAt)}；事項完成狀態未改變。</Text> : <Text style={s.meta}>沒有收到確認；渠道接受不等於本人已讀。</Text>}
    {contactMayAcknowledge(attempt, model.userId) ? <><AppCheckbox label="我確認本人已收到這次一般提示" checked={confirm} disabled={!mayAck} onChange={setConfirm} /><AppButton label="確認本人已收到提示" variant="secondary" disabled={!mayAck || !confirm} onPress={() => {setConfirm(false); actions.save({kind: 'acknowledge', attemptId: attempt.id, input: {confirmReceived: true}}, [title, `${contactChannelLabels[attempt.channel]} · 本人確認收到`, '不改變渠道結果或任務完成狀態']);}} /></> : null}
  </View>;
}
export function ContactHistory({model, actions, onTask}: {model: ContactViewModel; actions: ContactActions; onTask: (id: string) => void}) {
  const page = model.page!, [open, setOpen] = useState<string | null>(null);
  return <SectionCard testID="contact-history"><SectionHeader density="compact" title="聯絡及收到紀錄" icon="history" subtitle="以 Server 台帳為準，手動更新。這裏不啟動發送或補發。" />
    <Text style={s.meta}>{page.historyLimited ? '僅顯示最近 50 個請求內已載入的紀錄，並非完整歷史。' : '顯示本次已載入紀錄。'}</Text>
    <Text style={s.meta}>渠道接受、本人確認收到與事項完成各自記錄；未知不當失敗，也不由前端觸發後備。</Text>
    {!page.requests.length ? <Text style={s.body}>目前沒有載入聯絡紀錄；不代表從未發送。</Text> : null}
    {page.requests.map(request => {const task = page.tasks.find(item => item.id === request.taskId), title = task?.title ?? '原任務未在目前有限清單'; return <View key={request.id} style={s.item} testID={`contact-request-${request.id}`}>
      <Text style={s.title}>{title}</Text><Text style={s.body}>{contactRequestLabels[request.state]} · {request.phase === 'initial' ? '首次聯絡' : '一次跟進'}</Text><Text style={s.meta}>{summaryTime(request.createdAt)} · 任務依據版本 {request.taskVersion}</Text>
      {request.state === 'coalesced' ? <Text style={s.meta}>普通提示已合併，不表示另一個提示已成功投遞或收到。</Text> : null}
      {request.reason ? <Text style={s.meta}>記錄理由：{request.reason}</Text> : null}
      <View style={s.row}><AppButton label={open === request.id ? '收起這次聯絡紀錄' : '查看這次聯絡紀錄'} variant="quiet" onPress={() => setOpen(value => value === request.id ? null : request.id)} /><AppButton label="查看原任務" variant="quiet" onPress={() => onTask(request.taskId)} /></View>
      {open === request.id ? <><Text selectable style={s.meta}>請求：{request.id} · 發生實例：{request.occurrenceId}</Text>{request.groupedTo ? <Text selectable style={s.meta}>合併至：{request.groupedTo}</Text> : null}{!request.attempts.length ? <Text style={s.meta}>這個請求沒有列出的投遞嘗試。</Text> : request.attempts.map(attempt => <Attempt key={attempt.id} attempt={attempt} model={model} actions={actions} title={title} />)}</> : null}
    </View>;})}
  </SectionCard>;
}
