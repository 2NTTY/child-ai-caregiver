import { useContainerWidth } from "../useContainerWidth";
import { StatusAnnouncement } from "../StatusAnnouncement";
import {useRef, useState} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import type {ContactActions, ContactViewModel} from '../../contact-view-model';
import type {TaskView} from '../../task-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {PageFrame} from '../PageFrame';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {ContactConsentCard} from './ContactConsentCard';
import {ContactTaskCard} from './ContactTaskCard';
import {ContactHistory} from './ContactHistory';
import {MotionDisclosure} from '../../motion';
import {contactStyles as s} from './contact-styles';

export function ContactView({model, actions, onSettings, onTask, previewTools}: {model: ContactViewModel; actions: ContactActions; onSettings: () => void; onTask: (id: string) => void; previewTools?: React.ReactNode}) {
  const containerLayout = useContainerWidth();
  const wide = containerLayout.width >= 980;
  const [details, setDetails] = useState(false), cache = useRef(new Map<string, TaskView>()), epoch = useRef(model.epoch), page = model.page;
  if (epoch.current !== model.epoch) {cache.current.clear(); epoch.current = model.epoch;}
  page?.tasks.forEach(task => cache.current.set(task.id, task));
  const tasks = [...cache.current.values()], canRetry = model.online && !model.busy && model.load === 'ready' && model.access === 'editable' && !!page?.canManage && !!model.pending?.reviewed && !model.pending.confirmed;
  return <PageFrame density="compact" title="主動聯絡授權" description={`分別核對${model.childName}的接收同意、任務授權及聯絡紀錄，讓下一步安排有清楚依據。`}>
    <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={model.notice} urgent={model.operation === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權存取；舊資料及未提交內容已清除。" : ""} urgent={model.access === "lost"} />
    <SectionCard><SectionHeader density="compact" title="先核對，再授權" icon="bell-outline" subtitle={model.dataLabel} />
      <AppButton label={model.pending ? '先查原收據及更新聯絡資料' : '更新聯絡資料並保留選項'} variant="secondary" disabled={!model.online || model.busy || model.access === 'lost'} onPress={actions.refresh} />
      {model.busy ? <Text style={s.meta}>正在讀取／提交，尚未確認最新狀態。</Text> : null}
      {!model.online ? <Text style={s.warning}>目前離線；不提交、不排隊外發。選項及原操作只留本頁。</Text> : null}
      {model.load === 'error' && page ? <Text style={s.warning}>目前顯示資料尚未重新核對，暫停新的保存。</Text> : null}
      {model.load === 'error' && !page && model.access !== 'lost' ? <Text style={s.warning}>聯絡資料未能讀取，沒有據此推定無任務或無紀錄；請手動更新。</Text> : null}
      {model.access === 'read_only' ? <Text style={s.meta}>目前只有檢視權限，不能修改授權或確認收到。</Text> : null}
      {model.access === 'lost' ? <Text style={s.warning}>已無權存取；舊資料、選項及原操作已清除。</Text> : null}
      {model.notice ? <Text style={model.load === 'error' || !model.online || model.pending || ['failed', 'conflict', 'unknown'].includes(model.operation) ? s.warning : s.body}>{model.notice}</Text> : null}
      {model.dirty ? <AppButton label="放棄全部未提交選項並載入已保存資料" variant="quiet" disabled={!model.online || model.busy || !!model.pending || model.load !== 'ready'} onPress={actions.discard} /> : null}
    </SectionCard>
    {model.pending ? <SectionCard testID="contact-pending"><SectionHeader density="compact" title="原決定待核對" icon="information-outline" />
      <Text selectable style={s.meta}>原操作：{model.pending.reference}（合成參考）</Text>{model.pending.labels.map((text, index) => <Text key={index} style={s.body}>{text}</Text>)}
      <AppButton label={details ? '收起原提交內容' : '查看原提交內容及版本'} variant="quiet" onPress={() => setDetails(value => !value)} />
      <MotionDisclosure expanded={details} scopeKey={`${model.scopeKey}:${model.pending.reference}`}><Text testID="contact-original-body" selectable style={s.meta}>{JSON.stringify(JSON.parse(model.pending.body), null, 2)}</Text></MotionDisclosure>
      <Text style={s.meta}>{model.pending.confirmed ? '原收據已確認，最新資料尚未讀回；不能重送或另建提交。' : '原識別、接收者、內容及版本保持不變；GET 本身不證明原決定成功。'}</Text>
      <AppCheckbox label="我已核對目前資料，同意以原識別內容及版本重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} /><AppButton label="明確重試原聯絡決定" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} />
    </SectionCard> : null}
    {page ? <>
      {!page.workerEnabled ? <SectionCard><Text style={s.warning}>背景聯絡 worker 目前未啟用，保存授權不會啟動投遞。仍可管理或撤回授權。</Text></SectionCard> : null}
      <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={wide ? s.columns : s.stack}><View style={wide ? s.column : s.full}><ContactConsentCard key={`${model.scopeKey}:${model.userId}`} model={model} actions={actions} onSettings={onSettings} /></View>
        <View style={wide ? s.column : s.full}><SectionCard><SectionHeader density="compact" title="各任務的聯絡授權" icon="clipboard-check-outline" /><Text style={s.meta}>{page.tasksHaveMore ? '僅顯示最多 50 個任務內已載入的清單，並非全部任務。' : '顯示本次已載入的任務。'}主要接收者依任務負責人，後備須本人另行同意。</Text>{!page.tasks.length ? <Text style={s.body}>目前沒有載入任務；沒有據此推定已有授權全部失效。</Text> : null}</SectionCard>
          {tasks.map(task => <ContactTaskCard key={`${model.scopeKey}:${task.id}`} task={task} missing={!page.tasks.some(item => item.id === task.id)} model={model} actions={actions} onTask={onTask} />)}</View></View>
      <ContactHistory model={model} actions={actions} onTask={onTask} />
    </> : null}{previewTools}
  </PageFrame>;
}
