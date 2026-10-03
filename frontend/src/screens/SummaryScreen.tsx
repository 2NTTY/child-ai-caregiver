import {useState} from 'react';
import {Text} from 'react-native-paper';
import type {HomeChild} from '../view-model';
import {usePreview} from '../preview/PreviewContext';
import {useSummaryPreview, type SummaryCondition, type SummaryOutcome, type SummaryLookup, type SummaryRead} from '../preview/useSummaryPreview';
import {SummaryView} from '../components/summary/SummaryView';
import {summaryStyles as s} from '../components/summary/summary-styles';
import {AppButton, AppSelect, SectionCard, SectionHeader} from '../components/ui';
import {PageFrame} from '../components/PageFrame';

function SummaryWorkspace({child, online, identity, server, onIdentity, onServer, onRecord, onTask}: {child: HomeChild; online: boolean; identity: string; server: string; onIdentity: () => void; onServer: () => void; onRecord: (id: string) => void; onTask: (id: string) => void}) {
  const preview = useSummaryPreview(child, online, identity, server), [tools, setTools] = useState(false);
  return <SummaryView model={preview.model} actions={preview.actions} onRecord={onRecord} onTask={onTask} previewTools={<SectionCard><SectionHeader density="compact" title="合成摘要情境" subtitle="不計算真資料、不建立預約、不呼叫 Agent 或外發。" icon="information-outline" />
    <AppButton label={tools ? '收起摘要情境' : '顯示摘要情境'} variant="quiet" onPress={() => setTools(value => !value)} />
    {tools ? <>
      <AppSelect label="摘要資料情境" value={preview.condition} options={([{value: 'normal', label: '一般'}, {value: 'empty', label: '沒有期間記錄'}, {value: 'loading', label: '載入中'}, {value: 'read_error', label: '讀取失敗'}, {value: 'read_only', label: '唯讀'}, {value: 'range_limit', label: '期間超限'}, {value: 'scope_limit', label: '孩子記錄超限'}, {value: 'lost', label: '失去存取'}] as {value: SummaryCondition; label: string}[])} onChange={preview.changeCondition} />
      <AppSelect label="摘要保存結果" value={preview.outcome} options={([{value: 'success', label: '成功'}, {value: 'failed', label: '未獲接受'}, {value: 'unknown', label: '結果未知'}, {value: 'conflict', label: '版本衝突'}, {value: 'confirmed_unread', label: '保存已確認但摘要未讀回'}] as {value: SummaryOutcome; label: string}[])} onChange={preview.setOutcome} />
      <AppSelect label="摘要原收據查核結果" value={preview.lookup} options={([{value: 'unknown', label: '仍未知'}, {value: 'unconfirmed', label: '尚無確認收據'}, {value: 'confirmed', label: '已確認並讀回'}, {value: 'confirmed_unread', label: '已確認但摘要未讀回'}] as {value: SummaryLookup; label: string}[])} onChange={preview.setLookup} />
      <AppSelect label="摘要重讀資料" value={preview.read} options={([{value: 'same', label: '同一來源及準備'}, {value: 'changed', label: '來源及家庭準備已改變'}, {value: 'appointment_missing', label: '原預約已不在清單'}] as {value: SummaryRead; label: string}[])} onChange={preview.setRead} />
      <Text style={s.meta}>預覽帳戶：{identity} · Server：{server}；切換清除舊摘要、草稿及原操作。</Text><AppButton label="切換摘要預覽帳戶" variant="secondary" onPress={onIdentity} /><AppButton label="切換摘要預覽 Server" variant="secondary" onPress={onServer} />
    </> : null}</SectionCard>} />;
}
export function SummaryScreen() {
  const {model, actions} = usePreview(), child = model.children.find(item => item.id === model.selectedChildId);
  const [identity, setIdentity] = useState('合成媽媽'), [server, setServer] = useState('合成 A');
  return child ? <SummaryWorkspace key={JSON.stringify([child.id, identity, server])} child={child} online={model.connection === 'online'} identity={identity} server={server} onIdentity={() => setIdentity(value => value === '合成媽媽' ? '合成爸爸' : '合成媽媽')} onServer={() => setServer(value => value === '合成 A' ? '合成 B' : '合成 A')} onRecord={() => actions.open('care')} onTask={() => actions.open('tasks')} /> :
    <PageFrame density="compact" title="照顧摘要與到診準備" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不讀取其他孩子的摘要。</Text><AppButton label="查看子女檔案" onPress={() => actions.open('profile')} /></SectionCard></PageFrame>;
}
