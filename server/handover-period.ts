import { z } from 'zod';
import { supportsHandoverPeriodModules, type HandoverHeader } from '../src/shared/handover.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { historyModule, sourceHistoryExportSchema } from './handover-history-records.ts';
import { validateSourceHistory } from './handover-source-history.ts';
import { growthTopicResourceId } from './firestore-growth.ts';
import { growthTopicSchema } from '../src/shared/growth.ts';
import { factContentDate, memoryUpdateDate, summarySourcePeriodSchema } from './handover-memory-dates.ts';
import { firestoreFactSchema, firestoreTopicSchema } from './firestore-memory.ts';
import { firestorePrivateInstructionSchema } from './firestore-private-instructions.ts';
import { firestorePreparationSchema } from './firestore-care-summary.ts';
import { containsCareSummaryPeriod } from './care-summary-policy.ts';

type Selection = HandoverHeader['selection'];
const timestamp = z.iso.datetime({ offset: true });
function datedValue<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HandoverArchiveError('invalid_package_period');
  return parsed.data;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const supportsHandoverPeriod = (selection: Selection) => !selection.period || supportsHandoverPeriodModules(selection.modules)
  || !!(selection.accountAvatar || selection.notificationPreferences) && selection.modules.length === 0;
export type HandoverPeriod = NonNullable<Selection['period']>;
export function withinHandoverPeriod(at: string, period: HandoverPeriod) {
  const time = Date.parse(at);
  return time >= Date.parse(period.from) && time <= Date.parse(period.to);
}

const datedParentSections = new Set(['care', 'profile', 'tasks', 'private_sources', 'growth_attention', 'growth_topics', 'memory_facts', 'memory_topics', 'visit_preparation']);
/** Retained revisions address the receiving child's local parent, while their event time belongs to the original evidence. */
export function datedParent(section: string, raw: unknown, childId: string) {
  const history = historyModule(section), parent = history ?? section;
  if (!datedParentSections.has(parent)) return null;
  const row = object(raw);
  let id: unknown;
  if (history && row.format === 'yuyoufang-source-revision:1') id = object(row.resource).id;
  else if (parent === 'profile' || parent === 'visit_preparation') id = row.childId;
  else if (parent === 'growth_topics') {
    const topic = growthTopicSchema.safeParse(row.topicId);
    if (!topic.success) throw new HandoverArchiveError('invalid_package_data');
    id = growthTopicResourceId(childId, topic.data);
  }
  else if (parent === 'growth_attention') id = object(row.item).id;
  else if (section === 'task_history') id = object(row.task).id;
  else if (section === 'private_source_history') id = row.inputId;
  else id = row.id;
  if (typeof id !== 'string') throw new HandoverArchiveError('invalid_package_data');
  return { revision: history !== undefined, key: JSON.stringify([parent, id]) };
}

/** A range describes the domain event, even when a revision or imported copy was saved later. */
export function handoverPeriodMatch(section: string, raw: unknown, period: NonNullable<Selection['period']>): 'inside' | 'outside' | 'undated' {
  const row = object(raw);
  let value = row;
  if (row.format === 'yuyoufang-source-revision:1') {
    const module = historyModule(section);
    const wrapper = sourceHistoryExportSchema.safeParse(row);
    if (!module || !wrapper.success || wrapper.data.evidence.module !== module) throw new HandoverArchiveError('invalid_package_period');
    value = validateSourceHistory(wrapper.data).evidence.value;
  }
  let at: unknown;
  switch (section) {
    case 'visit_preparation': case 'visit_preparation_history':
      return containsCareSummaryPeriod(period, datedValue(firestorePreparationSchema, value).period) ? 'inside' : 'outside';
    case 'summary_history': {
      if (value.sourcePeriod === undefined) return 'undated';
      const proof = summarySourcePeriodSchema.safeParse(value.sourcePeriod);
      if (!proof.success) throw new HandoverArchiveError('invalid_package_period');
      return withinHandoverPeriod(proof.data.from, period) && withinHandoverPeriod(proof.data.to, period) ? 'inside' : 'outside';
    }
    case 'instructions':
      at = memoryUpdateDate('instructions', datedValue(firestorePrivateInstructionSchema, value)); break;
    case 'memory_topics': case 'memory_topic_history':
      at = memoryUpdateDate('memory_topics', datedValue(firestoreTopicSchema, value)); break;
    case 'memory_facts': case 'memory_fact_history':
      at = factContentDate(datedValue(firestoreFactSchema, value)); break;
    case 'care': case 'care_history': at = object(object(value.details).eventTime).at; break;
    case 'tasks': at = object(value.occurrence).dueAt; break;
    case 'task_history': at = object(object(value.task).occurrence).dueAt; break;
    case 'profile': case 'profile_history': at = value.confirmedAt; break;
    case 'private_sources': at = value.createdAt; break;
    case 'private_source_history': at = value.changedAt; break;
    case 'growth_attention': case 'growth_history': at = object(value.item).updatedAt; break;
    case 'growth_topics': case 'growth_topic_history': at = value.at; break;
    case 'chat': at = value.createdAt; break;
    case 'chat_imports': at = object(value.message).createdAt; break;
    case 'files': case 'photos': case 'voices': at = value.createdAt; break;
    case 'child_avatar': at = value.updatedAt; break;
    default: throw new HandoverArchiveError('package_period_not_connected');
  }
  if (at === null && ['care', 'care_history', 'profile', 'profile_history', 'child_avatar', 'instructions',
    'memory_facts', 'memory_fact_history', 'memory_topics', 'memory_topic_history'].includes(section)) return 'undated';
  const instant = timestamp.safeParse(at);
  if (!instant.success) throw new HandoverArchiveError('invalid_package_period');
  return withinHandoverPeriod(instant.data, period) ? 'inside' : 'outside';
}
