import { z } from 'zod';

export const utcMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const count = z.number().int().nonnegative();
const amount = z.object({ currency: z.string().regex(/^[A-Z]{3}$/u), micros: z.string().regex(/^\d+(?:\.\d{1,6})?$/u), attempts: count }).strict();
const pool = z.object({ estimates: z.array(amount.extend({ priceVersion: z.string() })), settlements: z.array(amount),
  unestimatedAttempts: count, unsettledAttempts: count }).strict();
export const monthlyFinanceSchema = z.object({ month: utcMonthSchema, through: z.iso.date(), general: pool, maintenance: pool }).strict();
export type MonthlyFinance = z.infer<typeof monthlyFinanceSchema>;
