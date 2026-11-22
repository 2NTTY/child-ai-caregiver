import { DateTime } from 'luxon';
import { z } from 'zod';
import { taskDueAtSchema, taskTimeZoneSchema } from '../src/shared/tasks.ts';
import { dateTimeValue } from '../src/shared/task-local-time.ts';
import { FamilyError } from './family-access.ts';

const localMinute = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/u;
export const agentTaskTime = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/u).describe(
  '家長指定時區的本地日期及鐘面時間，格式 YYYY-MM-DDTHH:mm。Server 按 timeZone 換算。');

export class AgentTaskTimeError extends FamilyError {
  readonly nextAction: string;
  constructor(code: string, nextAction: string) {
    super(400, code);
    this.nextAction = nextAction;
  }
}

/** Resolve newly proposed schedules before any direct write or confirmation draft. */
export function resolveAgentTaskTime(value: unknown, zone: unknown): string {
  const timeZone = taskTimeZoneSchema.parse(zone);
  const input = agentTaskTime.parse(value);
  const local = localMinute.exec(input);
  if (local) {
    const result = dateTimeValue(local[1]!, local[2]!, timeZone);
    if (result.value === null) throw new AgentTaskTimeError('invalid_task_local_time', result.error);
    return taskDueAtSchema.parse(result.value);
  }
  // An explicit offset also disambiguates repeated times at a daylight-saving transition.
  const instant = taskDueAtSchema.parse(input);
  const declared = DateTime.fromISO(instant, { setZone: true });
  if (declared.offset !== declared.setZone(timeZone).offset) throw new AgentTaskTimeError('task_time_zone_mismatch',
    '請把家長所說的本地日期和鐘面時間按 YYYY-MM-DDTHH:mm 填入 dueAt，保留 timeZone。系統會換算成儲存時間。');
  return instant;
}
