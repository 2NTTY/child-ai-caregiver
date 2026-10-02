import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import {useEffect, useRef, useState} from 'react';
import type {HomeChild} from '../view-model';
import type {ContactDecision, ContactPage, ContactPending, ContactViewModel} from '../contact-view-model';
import {contactMayAcknowledge, sameContactBinding} from '../contact-view-model';
import {contactExpiryValid} from '../components/contact/contact-form';
import {contactFixture} from './contactFixture';

export type ContactCondition = 'normal' | 'empty' | 'loading' | 'read_error' | 'read_only' | 'no_bindings' | 'primary_ineligible' | 'worker_paused' | 'expired_grant' | 'lost';
export type ContactOutcome = 'success' | 'failed' | 'unknown' | 'conflict' | 'confirmed_unread';
export type ContactLookup = 'unknown' | 'unconfirmed' | 'confirmed' | 'confirmed_unread' | 'no_pending';
export type ContactRead = 'same' | 'changed' | 'missing_task' | 'receiver_changed';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Pending = ContactPending & {applied: boolean};

// Synthetic receipts and saved snapshots only. No dispatch policy, API, persistent draft or outbox.
export function useContactPreview(child: HomeChild, online: boolean, identity: string, server: string) {
  const [page, setPage] = useState<ContactPage | null>(() => contactFixture(child, identity));
  const pageRef = useRef(page); pageRef.current = page;
  const [condition, setCondition] = useState<ContactCondition>('normal'), [outcome, setOutcome] = useState<ContactOutcome>('success'), [lookup, setLookup] = useState<ContactLookup>('unknown'), [read, setRead] = useState<ContactRead>('same');
  const [busy, setBusy] = useState(false), [readFailed, setReadFailed] = useState(false), [dirty, setDirty] = useState(false), [missingTasks, setMissingTasks] = useState<string[]>([]);
  const dirtyKeys = useRef(new Set<string>());
  const [pending, setPending] = useState<Pending | null>(null), [originalConsent, setOriginalConsent] = useState(false);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  usePreviewLeaveGuard(dirty, busy || !!pending);
  const [operation, setOperation] = useState<ContactViewModel['operation']>('none'), [notice, setNotice] = useState(''), [epoch, setEpoch] = useState(0), [confirmationEpoch, setConfirmationEpoch] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), flight = useRef<'read' | Pending | null>(null), generation = useRef(0), alive = useRef(true), serial = useRef(0);
  const onlineRef = useRef(online); onlineRef.current = online;
  const access = condition === 'lost' ? 'lost' : condition === 'read_only' || child.accessRole === 'viewer' ? 'read_only' : 'editable';
  const accessRef = useRef(access); accessRef.current = access;
  function put(next: ContactPage | null) {pageRef.current = next; setPage(next);}
  function track(next: Pending | null) {pendingRef.current = next; setPending(next); setOriginalConsent(false);}
  function cancel() {generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; flight.current = null; setBusy(false);}
  function later(action: () => void) {const started = generation.current; timer.current = setTimeout(() => {timer.current = null; if (!alive.current || started !== generation.current || !onlineRef.current || accessRef.current === 'lost') return; flight.current = null; setBusy(false); action();}, 420);}
  function valid(decision: ContactDecision) {
    const current = pageRef.current; if (!current) return false;
    if (decision.kind === 'consent') return decision.input.expectedVersion === current.consent.version && (!decision.input.enabled || decision.input.bindings.length > 0 && decision.input.bindings.every(binding => current.availableBindings.some(item => sameContactBinding(item, binding))));
    if (decision.kind === 'acknowledge') return current.requests.some(request => request.attempts.some(attempt => attempt.id === decision.attemptId && contactMayAcknowledge(attempt, identity)));
    const task = current.tasks.find(item => item.id === decision.taskId), grant = current.grants.find(item => item.taskId === decision.taskId), input = decision.input;
    if (!task || input.expectedTaskVersion !== task.version || input.expectedVersion !== (grant?.version ?? 0)) return false;
    if (!input.enabled) return !!grant?.enabled;
    const primary = current.recipients.find(item => item.userId === task.assigneeUserId), backup = current.recipients.find(item => item.userId === input.backupUserId);
    return task.occurrence.state === 'scheduled' && !!primary?.enabled && primary.channels.length > 0 && contactExpiryValid(input.validUntil) && (!input.backupUserId || input.allowFallback && input.backupUserId !== task.assigneeUserId && !!backup?.enabled && backup.allowBackup && backup.channels.length > 0);
  }
  function apply(entry: Pending) {
    const current = pageRef.current; if (!current || entry.applied) return;
    entry.applied = true; entry.confirmed = true;
    const decision = entry.decision, next = clone(current);
    if (decision.kind === 'consent') {
      if (next.consent.version <= decision.input.expectedVersion + 1) {
        next.consent = {userId: identity, version: decision.input.expectedVersion + 1, enabled: decision.input.enabled, allowBackup: decision.input.allowBackup, bindings: clone(decision.input.bindings)};
        next.recipients = next.recipients.map(item => item.userId === identity ? {...item, enabled: decision.input.enabled, allowBackup: decision.input.allowBackup, channels: decision.input.bindings.map(binding => binding.channel)} : item);
      }
      dirtyKeys.current.delete('consent');
    } else if (decision.kind === 'authorization') {
      const task = current.tasks.find(item => item.id === decision.taskId), old = current.grants.find(item => item.taskId === decision.taskId);
      if (task && (!old || old.version <= decision.input.expectedVersion + 1)) next.grants = [...next.grants.filter(item => item.taskId !== task.id), {taskId: task.id, version: decision.input.expectedVersion + 1, taskVersion: decision.input.expectedTaskVersion, enabled: decision.input.enabled, primaryUserId: task.assigneeUserId, backupUserId: decision.input.backupUserId, allowFollowUp: decision.input.allowFollowUp, allowFallback: decision.input.allowFallback, validUntil: decision.input.validUntil, authorizedBy: identity, updatedAt: new Date().toISOString(), content: 'generic_notice', trigger: 'task_due'}];
      // A receipt remains confirmed even if its task disappeared from the latest limited page.
      else if (!task && old && old.version <= decision.input.expectedVersion + 1) next.grants = next.grants.filter(item => item.taskId !== decision.taskId);
      dirtyKeys.current.delete(`grant:${decision.taskId}`);
    } else next.requests = next.requests.map(request => ({...request, attempts: request.attempts.map(attempt => attempt.id === decision.attemptId ? {...attempt, acknowledgedAt: new Date().toISOString()} : attempt)}));
    put(next); setDirty(dirtyKeys.current.size > 0);
  }
  function readLatest() {
    const current = pageRef.current; if (!current) return;
    const next = clone(current);
    if (read === 'changed') {next.consent.version++; next.availableBindings = next.availableBindings.map(item => ({...item, bindingVersion: item.bindingVersion + 1})); next.tasks = next.tasks.map(item => ({...item, version: item.version + 1})); next.grants = next.grants.map(item => ({...item, version: item.version + 1}));}
    if (read === 'receiver_changed') next.recipients = next.recipients.map(item => item.userId === 'preview-helper' ? {...item, enabled: false, allowBackup: false, channels: []} : item);
    if (read === 'missing_task') {setMissingTasks(current.tasks.map(item => item.id)); next.tasks = [];}
    put(next); setReadFailed(false); setConfirmationEpoch(value => value + 1);
    if (!dirtyKeys.current.size) setEpoch(value => value + 1);
  }
  function refresh() {
    if (flight.current || !onlineRef.current || accessRef.current === 'lost') return;
    flight.current = 'read'; setBusy(true); setConfirmationEpoch(value => value + 1); setOriginalConsent(false);
    const original = pendingRef.current; if (original) track({...original, reviewed: false});
    later(() => {
      if (condition === 'read_error') {setReadFailed(true); setNotice('聯絡資料未能讀取；選項、原版本及原操作保留。'); return;}
      const entry = pendingRef.current;
      if (entry && (entry.confirmed || lookup === 'confirmed' || lookup === 'confirmed_unread')) {
        apply(entry);
        if (lookup === 'confirmed_unread') {track({...entry, confirmed: true, reviewed: false}); setReadFailed(true); setOperation('confirmed_unread'); setNotice('原收據已確認保存，最新聯絡資料未讀回；停止重送，請再次查核及更新。'); return;}
        readLatest(); track(null); setOperation('saved'); setNotice('原收據已模擬確認並讀回聯絡資料；沒有發送通知或完成任務。'); return;
      }
      readLatest();
      if (entry && lookup === 'no_pending') {track(null); setOperation('none'); setNotice('查核已結束，沒有待處理原操作；不代表已保存。保留選項與原版本，核對最新資料後才可重新確認。');}
      else if (entry) {track({...entry, reviewed: lookup === 'unconfirmed'}); setOperation('unknown'); setNotice(lookup === 'unconfirmed' ? '尚無確認收據，已讀取目前資料；只有重新同意後才能用原識別、原內容及原版本重試。' : '原操作仍然結果未知。讀取最新資料不代表原操作成功，不能另建提交。');}
      else setNotice('已重新讀取合成聯絡資料，未提交選項及原版本保留。');
    });
  }
  function send(entry: Pending) {
    if (flight.current || !onlineRef.current || accessRef.current !== 'editable' || readFailed || !pageRef.current?.canManage) return;
    track({...entry, reviewed: false}); setBusy(true); flight.current = entry; setOperation('saving'); setNotice('正在模擬保存決定，尚未確認成功。');
    later(() => {
      const result = outcome === 'success' && !valid(entry.decision) ? 'conflict' : outcome;
      if (result === 'success') {apply(entry); readLatest(); track(null); setOperation('saved'); setNotice('已模擬保存決定並更新資料；投遞、收到及事項完成仍分開。'); return;}
      if (result === 'confirmed_unread') {apply(entry); track({...entry, confirmed: true, reviewed: false}); setReadFailed(true); setOperation('confirmed_unread'); setNotice('保存收據已確認，最新資料未讀回；不能重送或另建提交。'); return;}
      setReadFailed(true);
      if (result === 'failed') {track(null); setOperation('failed'); setNotice('這次決定未獲接受，選項及原版本保留；請更新並重新核對。'); return;}
      track({...entry, reviewed: false}); setOperation(result); setNotice(result === 'conflict' ? '這次決定遇到版本衝突；保留原操作與選項，先查核及更新，不能自動換版本重送。' : '保存結果未知；先查原收據，保留同一識別、完整內容與版本。');
    });
  }
  function changeCondition(next: ContactCondition) {
    if (next !== 'lost' && (flight.current || pendingRef.current || dirtyKeys.current.size)) return;
    cancel(); track(null); dirtyKeys.current.clear(); setDirty(false); setMissingTasks([]); setEpoch(value => value + 1); setConfirmationEpoch(value => value + 1); setOperation('none'); setCondition(next); setNotice('');
    if (next === 'lost') {put(null); setReadFailed(true); setNotice('身份或孩子存取權已改變；聯絡資料、選項及原操作已清除。'); return;}
    const fresh = contactFixture(child, identity);
    if (next === 'empty') {fresh.tasks = []; fresh.grants = []; fresh.requests = []; fresh.tasksHaveMore = false; fresh.historyLimited = false;}
    if (next === 'read_only') fresh.canManage = false;
    if (next === 'no_bindings') fresh.availableBindings = [];
    if (next === 'primary_ineligible') fresh.recipients = fresh.recipients.map(item => item.userId === 'preview-dad' ? {...item, enabled: false, channels: []} : item);
    if (next === 'worker_paused') fresh.workerEnabled = false;
    if (next === 'expired_grant') fresh.grants = fresh.grants.map(item => ({...item, validUntil: '2026-01-01T00:00:00Z'}));
    const blocked = next === 'loading' || next === 'read_error'; setReadFailed(blocked); put(blocked ? null : fresh);
  }
  useEffect(() => {alive.current = true; return () => {alive.current = false; generation.current++; if (timer.current) clearTimeout(timer.current); pendingRef.current = null; flight.current = null;};}, []);
  useEffect(() => {if (online) return; const active = flight.current; cancel(); setReadFailed(true); setOriginalConsent(false); setConfirmationEpoch(value => value + 1); if (active && active !== 'read') {track({...active, reviewed: false}); setOperation('unknown');} else if (pendingRef.current) track({...pendingRef.current, reviewed: false}); setNotice('目前離線；未提交選項與原操作只留本頁，沒有離線提交佇列。回線後手動更新。');}, [online]);
  const loading = busy || condition === 'loading';
  const model: ContactViewModel = {scopeKey: JSON.stringify([server, identity, child.id]), childName: child.displayName, userId: identity, dataLabel: '全部只屬合成預覽，未接駁 Server；不訂閱、不外發、不啟動 worker。', page: page ? {...page, canManage: page.canManage && access === 'editable'} : null, online, access, load: loading ? 'loading' : readFailed ? 'error' : 'ready', busy: loading, locked: !online || loading || readFailed || !!pending || access !== 'editable' || !page?.canManage, notice, operation, pending, originalConsent, dirty, epoch, confirmationEpoch, missingTasks};
  return {model, condition, outcome, lookup, read, changeCondition, setOutcome, setLookup, setRead, actions: {
    refresh, markDirty(key: string) {dirtyKeys.current.add(key); setDirty(true);},
    discard() {if (model.busy || !online || pendingRef.current || readFailed) return; dirtyKeys.current.clear(); setDirty(false); setEpoch(value => value + 1); setConfirmationEpoch(value => value + 1);},
    save(decision: ContactDecision, labels: string[]) {if (model.locked || pendingRef.current || !valid(decision)) return; const frozen = clone(decision); send({reference: `preview-contact-operation-${++serial.current}`, decision: frozen, body: JSON.stringify(frozen.input), labels: [...labels], confirmed: false, reviewed: false, applied: false});},
    setOriginalConsent, retryOriginal() {const original = pendingRef.current; if (!original || original.confirmed || !original.reviewed || !originalConsent) return; send(original);},
  }};
}
