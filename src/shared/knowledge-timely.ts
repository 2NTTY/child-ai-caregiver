import { z } from "zod";

export const TIMELY_EVENT_KINDS = [
  "news",
  "announcement",
  "safety_alert",
  "recall",
  "policy_change",
  "deadline",
] as const;

export const TIMELY_EVENT_STATUSES = [
  "active",
  "corrected",
  "lifted",
  "superseded",
  "expired",
] as const;

export type TimelyEventKind = (typeof TIMELY_EVENT_KINDS)[number];
export type TimelyEventStatus = (typeof TIMELY_EVENT_STATUSES)[number];

export interface TimelyEventLifecycle {
  kind: TimelyEventKind;
  status: TimelyEventStatus;
  statusUpdatedAt?: string | null;
  supersededBySourceId?: string | null;
  statusReason?: string | null;
}

const sourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const statusTimestampSchema = z.iso.datetime({ offset: true });
const statusReasonSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(value => Boolean(value.trim()) && !/[\u0000\uD800-\uDFFF]/u.test(value));

export const timelyEventLifecycleSchema: z.ZodType<TimelyEventLifecycle> = z
  .strictObject({
    kind: z.enum(TIMELY_EVENT_KINDS),
    status: z.enum(TIMELY_EVENT_STATUSES),
    statusUpdatedAt: statusTimestampSchema.nullable().optional(),
    supersededBySourceId: sourceIdSchema.nullable().optional(),
    statusReason: statusReasonSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.supersededBySourceId !== undefined &&
      value.supersededBySourceId !== null &&
      value.status !== "superseded" &&
      value.status !== "corrected"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "supersededBySourceId requires superseded or corrected status",
      });
    }
  });

export function isTimelyEventActive(timelyEvent?: TimelyEventLifecycle | null): boolean {
  return !timelyEvent || timelyEvent.status === "active" || timelyEvent.status === "corrected";
}

export function isPersistentTimelyKind(kind: TimelyEventKind): boolean {
  return kind === "recall" || kind === "safety_alert";
}
