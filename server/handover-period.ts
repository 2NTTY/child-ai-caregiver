import { z } from 'zod';
import { supportsHandoverPeriodModules, type HandoverHeader } from '../src/shared/handover.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { sourceHistoryExportSchema } from './handover-history-records.ts';
import { validateSourceHistory } from './handover-source-history.ts';

type Selection = HandoverHeader['selection'];
const timestamp = z.iso.datetime({ offset: true });
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const supportsHandoverPeriod = (selection: Selection) => !selection.period || supportsHandoverPeriodModules(selection.modules);
export type HandoverPeriod = NonNullable<Selection['period']>;
export function withinHandoverPeriod(at: string, period: HandoverPeriod) {
  const time = Date.parse(at);
  return time >= Date.parse(period.from) && time <= Date.parse(period.to);
}

/** A revision can accompany its selected current resource, never create an orphan or restore an obsolete date. */
export function datedParent(section: string, raw: unknown) {
  if (!['care', 'tasks', 'care_history', 'task_history'].includes(section)) return null;
  const row = object(raw), revision = section === 'care_history' || section === 'task_history';
  const resource = revision && row.format === 'yuyoufang-source-revision:1' ? object(row.resource)
    : section === 'task_history' ? object(row.task) : row;
  if (typeof resource.id !== 'string') throw new HandoverArchiveError('invalid_package_data');
  return { revision, key: JSON.stringify([section === 'care' || section === 'care_history' ? 'care' : 'tasks', resource.id]) };
}

/** A range describes the domain event, even when a revision or imported copy was saved later. */
export function handoverPeriodMatch(section: string, raw: unknown, period: NonNullable<Selection['period']>): 'inside' | 'outside' | 'undated' {
  const row = object(raw);
  let value = row;
  if (row.format === 'yuyoufang-source-revision:1') {
    const module = section === 'care_history' ? 'care' : section === 'task_history' ? 'tasks' : null;
    const wrapper = sourceHistoryExportSchema.safeParse(row);
    if (!module || !wrapper.success || wrapper.data.evidence.module !== module) throw new HandoverArchiveError('invalid_package_period');
    value = validateSourceHistory(wrapper.data).evidence.value;
  }
  let at: unknown;
  switch (section) {
    case 'care': case 'care_history': at = object(object(value.details).eventTime).at; break;
    case 'tasks': at = object(value.occurrence).dueAt; break;
    case 'task_history': at = object(object(value.task).occurrence).dueAt; break;
    case 'chat': at = value.createdAt; break;
    case 'chat_imports': at = object(value.message).createdAt; break;
    default: throw new HandoverArchiveError('package_period_not_connected');
  }
  if (at === null && (section === 'care' || section === 'care_history')) return 'undated';
  const instant = timestamp.safeParse(at);
  if (!instant.success) throw new HandoverArchiveError('invalid_package_period');
  return withinHandoverPeriod(instant.data, period) ? 'inside' : 'outside';
}
