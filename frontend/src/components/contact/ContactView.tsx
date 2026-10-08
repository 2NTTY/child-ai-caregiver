import { EmptyListCard } from "../EmptyListCard";
import { AppStatusBadge } from "../AppStatusBadge";
import { contactGrantStatus } from "./contact-status";
import { useContainerWidth } from "../useContainerWidth";
import { StatusAnnouncement } from "../StatusAnnouncement";
import {useLayoutEffect, useRef, useState} from 'react';
import {Platform, Pressable, View} from 'react-native';
import {Text} from 'react-native-paper';
import {contactChannelLabels, contactName, type ContactActions, type ContactViewModel} from '../../contact-view-model';
import type {TaskView} from '../../task-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppIcon} from '../AppIcon';
import {PageFrame} from '../PageFrame';
import {ReadStateNotice} from '../ReadStateNotice';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {ContactConsentCard} from './ContactConsentCard';
import {ContactTaskCard} from './ContactTaskCard';
import {ContactHistory} from './ContactHistory';
import {MotionDisclosure} from '../../motion';
import {contactStyles as s} from './contact-styles';

export function ContactView({model, actions, onSettings, onTask, previewTools, production = false}: {model: ContactViewModel; actions: ContactActions; onSettings: () => void; onTask: (id: string) => void; previewTools?: React.ReactNode; production?: boolean}) {
  const containerLayout = useContainerWidth();
  const wide = containerLayout.width >= 800;
  const [details, setDetails] = useState(false);
  const [selection, setSelection] = useState<{epoch: number; id: string} | null>(null);
  const taskPanel = useRef<View>(null);
  const taskRows = useRef(new Map<string, View>());
  const previousSelection = useRef<{epoch: number; id: string} | null>(null);
  const cache = useRef(new Map<string, TaskView>()), epoch = useRef(model.epoch), page = model.page;
  if (epoch.current !== model.epoch) {cache.current.clear(); epoch.current = model.epoch;}
  page?.tasks.forEach(task => cache.current.set(task.id, task));
  const tasks = [...cache.current.values()];
  const selectedId = selection?.epoch === model.epoch ? selection.id : null;
  const canRetry = model.online && !model.busy && model.load === 'ready' && model.access === 'editable' && !!page?.canManage && !!model.pending?.reviewed && !model.pending.confirmed;
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectedId ? {epoch: model.epoch, id: selectedId} : null;
    if (Platform.OS !== 'web') return;
    if (selectedId) (taskPanel.current as unknown as HTMLElement | null)?.focus({preventScroll: true});
    else if (previous?.epoch === model.epoch) (taskRows.current.get(previous.id) as unknown as HTMLElement | undefined)?.focus({preventScroll: true});
  }, [selectedId, model.epoch]);
  return <PageFrame density="compact" title="接收同意與聯絡" description={`為${model.childName}核對誰可以接收、透過甚麼渠道，以及哪項安排已獲授權。`}>
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={s.pageStack}>
      <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={model.notice} urgent={model.operation === "failed"} />
      <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權存取；舊資料及未提交內容已清除。" : ""} urgent={model.access === "lost"} />
      <View style={s.toolbar}><View style={s.copy}><Text style={s.meta}>接收同意、任務授權、渠道結果各自核對；本頁不發送通知。</Text></View>
        <AppButton label={model.pending ? '先查原收據及更新聯絡資料' : '更新聯絡資料並保留選項'} density="compact" variant="secondary" disabled={!model.online || model.busy || model.access === 'lost'} onPress={actions.refresh} />
      </View>
      {model.busy ? <Text style={s.meta}>正在讀取／提交，尚未確認最新狀態。</Text> : null}
      {!model.online ? <Text style={s.warning}>目前離線；不提交、不排隊外發。選項及原操作只留本頁。</Text> : null}
      {model.load === 'error' && page ? <Text style={s.warning}>目前顯示資料尚未重新核對，暫停新的保存。</Text> : null}
      {model.load === 'error' && !page && model.access !== 'lost' ? <ReadStateNotice state="error" title="聯絡資料未能讀取" message="沒有據此推定無任務或無紀錄；請手動更新。" /> : null}
      {model.load === 'loading' && !page ? <ReadStateNotice state="loading" message="正在讀取本人同意、可用渠道及任務授權…" /> : null}
      {model.access === 'read_only' ? <Text style={s.meta}>目前只有檢視權限，不能修改授權或確認收到。</Text> : null}
      {model.access === 'lost' ? <Text style={s.warning}>已無權存取；舊資料、選項及原操作已清除。</Text> : null}
      {model.notice ? <Text style={model.load === 'error' || !model.online || model.pending || ['failed', 'conflict', 'unknown'].includes(model.operation) ? s.warning : s.body}>{model.notice}</Text> : null}
      {model.dirty ? <AppButton label="放棄全部未提交選項並載入已保存資料" variant="quiet" disabled={!model.online || model.busy || !!model.pending || model.load !== 'ready'} onPress={actions.discard} /> : null}
      {model.pending ? <SectionCard testID="contact-pending"><SectionHeader density="compact" title="原決定待核對" icon="information-outline" />
        <AppStatusBadge label={model.pending.confirmed ? "原收據已確認 · 最新資料待讀回" : "原操作結果待核對"} tone="warning" /><Text selectable style={s.meta}>{production ? model.pending.reference ? `原操作：${model.pending.reference}` : "原操作識別由既有傳輸保留。" : `原操作：${model.pending.reference}（合成參考）`}</Text>{model.pending.labels.map((text, index) => <Text key={index} style={s.body}>{text}</Text>)}
        <AppButton expanded={details} label={details ? '收起原提交內容' : '查看原提交內容及版本'} variant="quiet" onPress={() => setDetails(value => !value)} />
        <MotionDisclosure expanded={details} scopeKey={`${model.scopeKey}:${model.pending.reference}`}><Text testID="contact-original-body" selectable style={s.meta}>{JSON.stringify(JSON.parse(model.pending.body), null, 2)}</Text></MotionDisclosure>
        <Text style={s.meta}>{model.pending.confirmed ? '原收據已確認，最新資料尚未讀回；不能重送或另建提交。' : '原識別、接收者、內容及版本保持不變；GET 本身不證明原決定成功。'}</Text>
        <AppCheckbox label="我已核對目前資料，同意以原識別內容及版本重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} /><AppButton label="明確重試原聯絡決定" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} />
      </SectionCard> : null}
      {page ? <>
        <View testID="contact-reachability" style={[s.reachability, !wide && s.reachabilityStack]}>
          <View style={s.checkpoint}><Text style={s.step}>01 · 本人同意</Text><AppStatusBadge label={page.consent.enabled ? '已允許一般提示' : '尚未允許接收'} tone={page.consent.enabled ? 'success' : 'neutral'} /><Text style={s.meta}>{page.consent.allowBackup ? '亦已同意作後備接收者' : '沒有後備接收同意'}</Text></View>
          <View style={s.checkpoint}><Text style={s.step}>02 · 本人渠道</Text><AppStatusBadge label={page.availableBindings.length ? `${page.availableBindings.length} 個可選綁定` : '尚無可選綁定'} tone={page.availableBindings.length ? 'info' : 'neutral'} /><Text style={s.meta}>{page.availableBindings.map(binding => contactChannelLabels[binding.channel]).join(' · ') || '到設定管理綁定；不會自動取得權限'}</Text></View>
          <View style={s.checkpoint}><Text style={s.step}>03 · 背景執行</Text><AppStatusBadge label={page.workerEnabled ? '開關已啟用' : '目前未啟用'} tone={page.workerEnabled ? 'info' : 'neutral'} /><Text style={s.meta}>{page.workerEnabled ? '不代表服務在線、已投遞或已讀' : '保存授權不會啟動投遞'}</Text></View>
        </View>
        <ContactConsentCard key={`${model.scopeKey}:${model.userId}`} model={model} actions={actions} onSettings={onSettings} />
        <View style={s.section}><SectionHeader density="compact" title="任務聯絡授權" subtitle="選一項安排，核對主要接收者及授權期限。" />
          <Text style={s.meta}>{page.tasksHaveMore ? '僅顯示最多 50 個任務內已載入的清單，並非全部任務。' : '顯示本次已載入的任務。'}主要接收者依任務負責人，後備須本人另行同意。</Text>
          {!tasks.length && model.load === "ready" && model.online && model.access !== "lost" ? <EmptyListCard title="已載入資料中暫無任務" detail={page.tasksHaveMore ? "任務清單未完整載入；不能據此判斷所有授權已失效。" : "不能據此判斷已有授權全部失效。"} /> : null}
          <View style={wide && selectedId ? s.columns : s.stack}>
            <View style={wide && selectedId ? s.taskIndex : s.full} testID="contact-task-index">{tasks.map(task => {
              const grant = page.grants.find(item => item.taskId === task.id);
              const primary = page.recipients.find(item => item.userId === task.assigneeUserId);
              return <Pressable key={task.id} ref={node => { if (node) taskRows.current.set(task.id, node); else taskRows.current.delete(task.id); }} accessibilityRole="button" accessibilityLabel={`核對${task.title}的聯絡授權`} aria-current={selectedId === task.id ? 'true' : undefined} accessibilityState={{disabled: model.busy || !!model.pending, selected: selectedId === task.id}} aria-disabled={model.busy || !!model.pending} disabled={model.busy || !!model.pending} onPress={() => setSelection({epoch: model.epoch, id: task.id})} style={({pressed}) => [s.taskRow, selectedId === task.id && s.selectedTask, pressed && !(model.busy || model.pending) && (selectedId === task.id ? s.selectedPressed : s.pressed)]}>
                <View style={s.copy}><Text style={s.title}>{task.title}</Text><Text style={s.meta}>接收者：{contactName(page, task.assigneeUserId)}</Text><Text style={s.meta}>{primary?.enabled && primary.channels.length ? primary.channels.map(channel => contactChannelLabels[channel]).join(' · ') : '接收同意或可用渠道待核對'}</Text>
                  <AppStatusBadge {...contactGrantStatus(grant, task.version)} /></View><AppIcon name="chevron-right" size={18} />
              </Pressable>;
            })}</View>
            <View ref={taskPanel} tabIndex={-1} testID="contact-task-detail" style={[wide && selectedId ? s.taskDetail : s.full, !selectedId && s.hidden]}>
              {selectedId ? <AppButton expanded label="收起任務授權詳情" density="compact" variant="quiet" onPress={() => setSelection(null)} disabled={model.busy || !!model.pending} /> : null}
              {tasks.map(task => <View key={`${model.scopeKey}:${task.id}`} style={selectedId !== task.id ? s.hidden : undefined} pointerEvents={selectedId === task.id ? 'auto' : 'none'} aria-hidden={selectedId !== task.id} accessibilityElementsHidden={selectedId !== task.id} importantForAccessibility={selectedId === task.id ? 'auto' : 'no-hide-descendants'}><ContactTaskCard task={task} missing={!page.tasks.some(item => item.id === task.id)} model={model} actions={actions} onTask={onTask} /></View>)}
            </View>
          </View>
        </View>
        <ContactHistory model={model} actions={actions} onTask={onTask} />
      </> : null}{previewTools}
    </View>
  </PageFrame>;
}
