import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import {useEffect, useRef, useState} from 'react';
import type {HomeChild} from '../view-model';
import type {PreparationDecision, SummaryPage, SummaryPending, SummaryViewModel} from '../summary-view-model';
import {sameSummaryPeriod, summaryBasisChanged} from '../summary-view-model';
import {summaryPeriodSchema, summaryQueryDefaults} from '../components/summary/summary-form';
import {summaryFixture} from './summaryFixture';

export type SummaryCondition = 'normal' | 'empty' | 'loading' | 'read_error' | 'read_only' | 'range_limit' | 'scope_limit' | 'lost';
export type SummaryOutcome = 'success' | 'failed' | 'unknown' | 'conflict' | 'confirmed_unread';
export type SummaryLookup = 'unknown' | 'unconfirmed' | 'confirmed' | 'confirmed_unread';
export type SummaryRead = 'same' | 'changed' | 'appointment_missing';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Pending = SummaryPending & {applied: boolean};

// No API, aggregation, storage or outbox. Production retains the original CareSummaryApi controller.
export function useSummaryPreview(child: HomeChild, online: boolean, identity: string, server: string) {
  const [query, setQuery] = useState(summaryQueryDefaults), [page, setPage] = useState<SummaryPage | null>(() => summaryFixture(child, summaryQueryDefaults()));
  const pageRef = useRef(page); pageRef.current = page;
  const [condition, setCondition] = useState<SummaryCondition>('normal'), [outcome, setOutcome] = useState<SummaryOutcome>('success'), [lookup, setLookup] = useState<SummaryLookup>('unknown'), [read, setRead] = useState<SummaryRead>('same');
  const [busy, setBusy] = useState(false), [readFailed, setReadFailed] = useState(false), [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const [pending, setPending] = useState<Pending | null>(null), [originalConsent, setOriginalConsent] = useState(false);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  usePreviewLeaveGuard(dirty, busy || !!pending);
  const [operation, setOperation] = useState<SummaryViewModel['operation']>('none'), [notice, setNotice] = useState('');
  const [formEpoch, setFormEpoch] = useState(0), [confirmationEpoch, setConfirmationEpoch] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), flight = useRef<'read' | Pending | null>(null), generation = useRef(0), alive = useRef(true), serial = useRef(0);
  const onlineRef = useRef(online); onlineRef.current = online;
  const access = condition === 'lost' ? 'lost' : condition === 'read_only' || child.accessRole === 'viewer' ? 'read_only' : 'editable';
  const accessRef = useRef(access); accessRef.current = access;
  function put(next: SummaryPage | null) {pageRef.current = next; setPage(next);}
  function track(next: Pending | null) {pendingRef.current = next; setPending(next); setOriginalConsent(false);}
  function cancel() {generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; flight.current = null; setBusy(false);}
  function later(action: () => void) {const started = generation.current; timer.current = setTimeout(() => {timer.current = null; if (!alive.current || started !== generation.current || !onlineRef.current || accessRef.current === 'lost') return; flight.current = null; setBusy(false); action();}, 420);}
  function apply(entry: Pending) {
    const current = pageRef.current; if (!current || entry.applied) return;
    entry.applied = true; entry.confirmed = true;
    const input = entry.input;
    put({...current, preparation: {version: input.expectedVersion + 1, appointmentTaskId: input.appointmentTaskId, questions: [...input.questions], checklist: clone(input.checklist), reviewed: input.reviewed, reviewedBasis: input.reviewed ? input.basisVersion : null, period: {...input.period}, updatedBy: identity, updatedAt: '2026-10-01T04:00:00Z'}, reviewCurrent: input.reviewed && current.basisVersion === input.basisVersion && sameSummaryPeriod(current.period, input.period)});
  }
  function readLatest(replaceDraft = false) {
    const current = pageRef.current; if (!current) return;
    const target = pendingRef.current?.input.period ?? query;
    let next = sameSummaryPeriod(current.period, target) ? clone(current) : {...summaryFixture(child, target), preparation: clone(current.preparation), reviewCurrent: false};
    if (read === 'changed') next = {...next, basisVersion: next.basisVersion + ':new', preparation: {...next.preparation, version: next.preparation.version + 1, questions: ['另一位家庭成員更新的已保存問題（合成）']}, reviewCurrent: false};
    if (read === 'appointment_missing') next = {...next, basisVersion: next.basisVersion + ':task', appointments: [], reviewCurrent: false};
    put(next); setReadFailed(false); setConfirmationEpoch(value => value + 1);
    if (replaceDraft || !dirtyRef.current) {setDirty(false); dirtyRef.current = false; setFormEpoch(value => value + 1);}
  }
  function refresh() {
    if (flight.current || !onlineRef.current || accessRef.current === 'lost') return;
    if (!summaryPeriodSchema.safeParse(pendingRef.current?.input.period ?? query).success) {setNotice('請核對開始日、期間及有效 IANA 時區。'); return;}
    flight.current = 'read'; setBusy(true); setOriginalConsent(false); setConfirmationEpoch(value => value + 1);
    const entry = pendingRef.current; if (entry) track({...entry, checked: false});
    later(() => {
      if (condition === 'read_error' || condition === 'range_limit' || condition === 'scope_limit') {setReadFailed(true); setNotice(condition === 'range_limit' ? '期間記錄太多，請改用單日；沒有產生部分總計。' : condition === 'scope_limit' ? '孩子記錄超出摘要入口上限；沒有產生部分總計，請到記錄區查閱。' : '摘要讀取失敗，草稿及原操作保留。'); return;}
      const original = pendingRef.current;
      if (original && (original.confirmed || lookup === 'confirmed' || lookup === 'confirmed_unread')) {
        apply(original);
        if (lookup === 'confirmed_unread') {track({...original, confirmed: true, checked: false}); setReadFailed(true); setOperation('confirmed_unread'); setNotice('原收據已確認保存，但最新摘要未能讀取。停止重送；請再查核及更新摘要。'); return;}
        readLatest(true); track(null); setOperation('saved'); setNotice('原保存收據已模擬確認，最新摘要及到診準備已讀取；是否仍吻合以目前核對狀態為準。'); return;
      }
      readLatest();
      if (original) {track({...original, checked: lookup === 'unconfirmed'}); setOperation('unknown'); setNotice(lookup === 'unconfirmed' ? '尚無確認收據，已讀取目前摘要。明確重試只用原識別、原內容及原來源版本。' : '原操作仍然結果未知；最新摘要已讀取，不代表原操作已保存，不能另建一次提交。');}
      else setNotice('已重新讀取合成摘要；未保存草稿及原基準保留。');
    });
  }
  function send(entry: Pending) {
    if (flight.current || !onlineRef.current || accessRef.current !== 'editable' || readFailed || !pageRef.current?.canManage) return;
    track({...entry, checked: false}); setBusy(true); flight.current = entry; setOperation('saving'); setNotice('正在模擬保存家庭共享準備；尚未確認成功。');
    later(() => {
      if (outcome === 'success') {apply(entry); readLatest(true); track(null); setOperation('saved'); setNotice('已模擬保存家庭共享到診準備，摘要已重新讀取；沒有建立預約或外發。'); return;}
      if (outcome === 'confirmed_unread') {apply(entry); track({...entry, confirmed: true, checked: false}); setReadFailed(true); setOperation('confirmed_unread'); setNotice('原保存已確認，但最新摘要未能讀取；先查收據與更新摘要，不再次提交。'); return;}
      if (outcome === 'unknown') {track({...entry, checked: false}); setReadFailed(true); setOperation('unknown'); setNotice('保存結果未知。原識別、完整內容及來源版本已保留；先查收據。'); return;}
      track(null); setReadFailed(true); setOperation(outcome === 'conflict' ? 'conflict' : 'failed');
      setNotice(outcome === 'conflict' ? '這次保存有版本衝突，草稿及原依據保留。先更新摘要，核對差異後才可明確換基準。' : '這次保存未獲接受，草稿保留；請先更新摘要及重新核對。');
    });
  }
  function changeCondition(next: SummaryCondition) {
    if (next !== 'lost' && (flight.current || pendingRef.current || dirtyRef.current)) return;
    cancel(); track(null); setDirty(false); dirtyRef.current = false; setFormEpoch(value => value + 1); setConfirmationEpoch(value => value + 1); setOperation('none'); setCondition(next);
    const blockedRead = ['loading', 'read_error', 'range_limit', 'scope_limit'].includes(next); setReadFailed(blockedRead); setNotice('');
    if (next === 'lost') {put(null); setReadFailed(true); setNotice('身份或孩子存取權已改變；摘要、草稿及原操作已清除。'); return;}
    const fresh = summaryFixture(child, summaryPeriodSchema.safeParse(query).success ? query : summaryQueryDefaults());
    if (next === 'empty') {fresh.counts = {note: 0, feeding: 0, sleep: 0, diaper: 0, temperature: 0, measurement: 0, appointment: 0}; fresh.records = []; fresh.metrics = []; fresh.appointments = []; fresh.conflicts = []; fresh.missing = {unknownEventTime: 0, invalidQuantities: 0, emptyKinds: Object.keys(fresh.counts) as SummaryPage['missing']['emptyKinds']};}
    if (next === 'read_only') fresh.canManage = false;
    put(blockedRead ? null : fresh);
    if (next === 'range_limit') setNotice('期間記錄太多，請改用單日；沒有產生部分總計。');
    if (next === 'scope_limit') setNotice('孩子記錄超出摘要入口上限；沒有產生部分總計，請到記錄區查閱。');
  }
  useEffect(() => {alive.current = true; return () => {alive.current = false; generation.current++; if (timer.current) clearTimeout(timer.current); flight.current = null; pendingRef.current = null;};}, []);
  useEffect(() => {if (online) return; const current = flight.current; cancel(); setReadFailed(true); setOriginalConsent(false); setConfirmationEpoch(value => value + 1); if (current && current !== 'read') {track({...current, checked: false}); setOperation('unknown');} else if (pendingRef.current) track({...pendingRef.current, checked: false}); setNotice('目前離線；草稿及原操作保留在本頁，沒有離線提交佇列。回線後手動更新摘要。');}, [online]);
  const model: SummaryViewModel = {childName: child.displayName, scopeKey: JSON.stringify([server, identity, child.id]), dataLabel: '全部只屬合成預覽，未接駁 Server。數值由 fixture 提供，不在前端重新計算。', query, page: page ? {...page, canManage: page.canManage && access === 'editable'} : null, online, access, readFailed, busy: busy || condition === 'loading', operation, notice, pending, originalConsent, dirty, formEpoch, confirmationEpoch};
  return {model, condition, outcome, lookup, read, changeCondition, setOutcome, setLookup, setRead, actions: {
    updateQuery(value: SummaryViewModel['query']) {if (!flight.current && !pendingRef.current) setQuery(value);}, refresh,
    markDirty() {dirtyRef.current = true; setDirty(true);},
    save(input: PreparationDecision, appointmentLabel: string) {const current = pageRef.current; if (!current || pendingRef.current || summaryBasisChanged(input, current) || input.appointmentTaskId && !current.appointments.some(task => task.id === input.appointmentTaskId)) return; const frozen = clone(input); send({reference: `preview-summary-operation-${++serial.current}`, input: frozen, body: JSON.stringify(frozen), appointmentLabel, confirmed: false, checked: false, applied: false});},
    discard() {if (model.busy || !online || pendingRef.current || readFailed || !pageRef.current) return; setDirty(false); dirtyRef.current = false; setFormEpoch(value => value + 1); setConfirmationEpoch(value => value + 1);},
    setOriginalConsent, retryOriginal() {const original = pendingRef.current; if (!original || original.confirmed || !original.checked || !originalConsent) return; send(original);},
  }};
}
