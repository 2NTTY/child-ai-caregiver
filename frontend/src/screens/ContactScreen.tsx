import {useState} from 'react';
import {Text} from 'react-native-paper';
import type {HomeChild} from '../view-model';
import {usePreview} from '../preview/PreviewContext';
import {useContactPreview, type ContactCondition, type ContactOutcome, type ContactLookup, type ContactRead} from '../preview/useContactPreview';
import {ContactView} from '../components/contact/ContactView';
import {contactStyles as s} from '../components/contact/contact-styles';
import {AppButton, AppSelect, SectionCard, SectionHeader} from '../components/ui';
import {PageFrame} from '../components/PageFrame';

function ContactWorkspace({child, online, identity, server, onIdentity, onServer, onTask, onSettings}: {child: HomeChild; online: boolean; identity: string; server: string; onIdentity: () => void; onServer: () => void; onTask: (id: string) => void; onSettings: () => void}) {
  const preview = useContactPreview(child, online, identity, server), [tools, setTools] = useState(false);
  return <ContactView model={preview.model} actions={preview.actions} onTask={onTask} onSettings={onSettings} previewTools={<SectionCard><SectionHeader title="合成聯絡情境" subtitle="不取得瀏覽器權限、不綁定渠道、不外發或啟動背景執行。" icon="information-outline" />
    <AppButton label={tools ? '收起聯絡情境' : '顯示聯絡情境'} variant="quiet" onPress={() => setTools(value => !value)} />
    {tools ? <>
      <AppSelect label="聯絡資料情境" value={preview.condition} options={([{value: 'normal', label: '一般'}, {value: 'empty', label: '沒有任務或紀錄'}, {value: 'loading', label: '載入中'}, {value: 'read_error', label: '讀取失敗'}, {value: 'read_only', label: '唯讀'}, {value: 'no_bindings', label: '沒有本人綁定'}, {value: 'primary_ineligible', label: '負責人未同意渠道'}, {value: 'worker_paused', label: '背景聯絡暫停'}, {value: 'expired_grant', label: '已保存授權過期'}, {value: 'lost', label: '失去存取'}] as {value: ContactCondition; label: string}[])} onChange={preview.changeCondition} />
      <AppSelect label="聯絡決定保存結果" value={preview.outcome} options={([{value: 'success', label: '成功'}, {value: 'failed', label: '未獲接受'}, {value: 'unknown', label: '結果未知'}, {value: 'conflict', label: '版本衝突'}, {value: 'confirmed_unread', label: '保存已確認但未讀回'}] as {value: ContactOutcome; label: string}[])} onChange={preview.setOutcome} />
      <AppSelect label="聯絡原收據查核結果" value={preview.lookup} options={([{value: 'unknown', label: '仍未知'}, {value: 'unconfirmed', label: '尚無確認收據，原操作仍待處理'}, {value: 'confirmed', label: '已確認並讀回'}, {value: 'confirmed_unread', label: '已確認但未讀回'}, {value: 'no_pending', label: '查核結束，沒有待處理原操作'}] as {value: ContactLookup; label: string}[])} onChange={preview.setLookup} />
      <AppSelect label="聯絡重讀資料" value={preview.read} options={([{value: 'same', label: '同一版本'}, {value: 'changed', label: '同意綁定與任務版本已改變'}, {value: 'missing_task', label: '原任務不在有限清單'}, {value: 'receiver_changed', label: '原後備已撤回接收同意'}] as {value: ContactRead; label: string}[])} onChange={preview.setRead} />
      <Text style={s.meta}>預覽帳戶：{identity} · Server：{server}；切換清除舊聯絡資料、草稿及原操作。</Text><AppButton label="切換聯絡預覽帳戶" variant="secondary" onPress={onIdentity} /><AppButton label="切換聯絡預覽 Server" variant="secondary" onPress={onServer} />
    </> : null}</SectionCard>} />;
}
export function ContactScreen() {
  const {model, actions} = usePreview(), child = model.children.find(item => item.id === model.selectedChildId), [identity, setIdentity] = useState('preview-mom'), [server, setServer] = useState('合成 A');
  return child ? <ContactWorkspace key={JSON.stringify([child.id, identity, server])} child={child} online={model.connection === 'online'} identity={identity} server={server} onIdentity={() => setIdentity(value => value === 'preview-mom' ? 'preview-second-user' : 'preview-mom')} onServer={() => setServer(value => value === '合成 A' ? '合成 B' : '合成 A')} onTask={() => actions.open('tasks')} onSettings={() => actions.open('settings')} /> :
    <PageFrame title="主動聯絡授權" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不讀取其他孩子的聯絡授權。</Text><AppButton label="查看子女檔案" onPress={() => actions.open('profile')} /></SectionCard></PageFrame>;
}
