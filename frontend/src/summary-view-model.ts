import type { CareKind } from './care-view-model';
import type { TaskView } from './task-view-model';

// Display projections only. Production uses the existing CareSummaryApi and shared schemas.
export interface SummaryPeriod { startDay: string; period: 'day' | 'week'; timeZone: string }
export interface SummaryBasis { expectedVersion: number; basisVersion: string; period: SummaryPeriod }
export interface SummaryPreparation {
  version: number; appointmentTaskId: string | null; questions: string[];
  checklist: {text: string; done: boolean}[]; reviewed: boolean; reviewedBasis: string | null;
  period: SummaryPeriod | null; updatedBy: string | null; updatedAt: string | null;
}
export interface PreparationDecision extends SummaryBasis {
  confirmShared: true; appointmentTaskId: string | null; questions: string[];
  checklist: {text: string; done: boolean}[]; reviewed: boolean;
}
export interface SummaryRecord {
  id: string; version: number; text: string; source: string; kind: CareKind;
  quantity: {rawValue: string; unit: string; precision: 'exact' | 'approximate'} | null;
  eventTime: {rawText: string; at: string | null; timeZone: string; precision: 'exact' | 'approximate' | 'unknown'};
  confirmedBy: string; confirmedAt: string; reason: string; createdAt: string;
}
export interface SummaryPage {
  childId: string; childName: string; canManage: boolean; period: SummaryPeriod; endDayExclusive: string;
  generatedAt: string; basisVersion: string;
  profile: {version: number; ageLabel: string; source: string; confirmedBy: string | null; confirmedAt: string | null; reason: string | null};
  counts: Record<CareKind, number>;
  metrics: {kind: CareKind; unit: string; samples: number; approximate: number; total: string | null; min: string; max: string; recordIds: string[]}[];
  records: SummaryRecord[];
  missing: {unknownEventTime: number; invalidQuantities: number; emptyKinds: CareKind[]};
  appointments: TaskView[]; conflicts: TaskView[]; preparation: SummaryPreparation; reviewCurrent: boolean;
}
export interface SummaryPending {
  reference: string; input: PreparationDecision; body: string; appointmentLabel: string;
  confirmed: boolean; checked: boolean;
}
export interface SummaryViewModel {
  childName: string; scopeKey: string; dataLabel: string; query: SummaryPeriod; page: SummaryPage | null;
  online: boolean; access: 'editable' | 'read_only' | 'lost'; readFailed: boolean; busy: boolean;
  operation: 'none' | 'saving' | 'saved' | 'failed' | 'unknown' | 'conflict' | 'confirmed_unread';
  notice: string; pending: SummaryPending | null; originalConsent: boolean; dirty: boolean;
  formEpoch: number; confirmationEpoch: number;
}
export interface SummaryActions {
  updateQuery(query: SummaryPeriod): void; refresh(): void; markDirty(): void;
  save(input: PreparationDecision, appointmentLabel: string): void; discard(): void;
  setOriginalConsent(value: boolean): void; retryOriginal(): void;
}
export const sameSummaryPeriod = (a: SummaryPeriod, b: SummaryPeriod) => a.startDay === b.startDay && a.period === b.period && a.timeZone === b.timeZone;
export const summaryBasis = (page: SummaryPage): SummaryBasis => ({expectedVersion: page.preparation.version, basisVersion: page.basisVersion, period: {...page.period}});
export const summaryBasisChanged = (basis: SummaryBasis, page: SummaryPage) => basis.expectedVersion !== page.preparation.version || basis.basisVersion !== page.basisVersion || !sameSummaryPeriod(basis.period, page.period);
export const summaryPeriodLabel = (value: SummaryPeriod) => `${value.startDay} 起${value.period === 'day' ? '一日' : '七日'} · ${value.timeZone}`;
export function summaryTime(value: string, timeZone = 'Asia/Hong_Kong') {
  try { return new Date(value).toLocaleString('zh-HK', {timeZone, hour12: false}); } catch { return value; }
}
