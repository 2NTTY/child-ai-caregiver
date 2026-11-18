import { utcMonthSchema, type MonthlyFinance } from '../src/shared/monthly-finance.ts';
import type { ModelSettingsUsage } from '../src/shared/model-settings.ts';

export function monthDays(month: string, today: string): string[] {
  if (!utcMonthSchema.safeParse(month).success || month > today.slice(0, 7)) throw new RangeError('invalid_month');
  const date = new Date(month + '-01T00:00:00Z'), days: string[] = [];
  for (let day = date.toISOString().slice(0, 10); day.startsWith(month) && day <= today; day = date.toISOString().slice(0, 10)) {
    days.push(day);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

type Daily = NonNullable<ModelSettingsUsage['finance']>;
type Amount = MonthlyFinance['general']['settlements'][number];
function addAmount<T extends Amount>(lines: T[], line: T, matches: (item: T) => boolean) {
  const current = lines.find(matches);
  if (!current) { lines.push({ ...line }); return; }
  const scaled = (raw: string) => {
    const [whole, fractional = ''] = raw.split('.');
    return BigInt(whole + fractional.padEnd(6, '0'));
  };
  const sum = scaled(current.micros) + scaled(line.micros);
  const fraction = (sum % 1000000n).toString().padStart(6, '0').replace(/0+$/u, '');
  current.micros = (sum / 1000000n).toString() + (fraction ? '.' + fraction : '');
  current.attempts += line.attempts;
}

export async function monthlyFinance(month: string, today: string,
  readDay: (day: string) => Promise<{ finance?: Daily; maintenanceFinance?: Daily }>): Promise<MonthlyFinance> {
  const days = monthDays(month, today);
  const pool = (): MonthlyFinance['general'] => ({ settlements: [], estimates: [], unsettledAttempts: 0, unestimatedAttempts: 0 });
  const result = { month, through: days[days.length - 1], general: pool(), maintenance: pool() };
  // Only an explicit month lookup reads historical counters. Keep simultaneous transactions bounded.
  for (let offset = 0; offset < days.length; offset += 4) {
    const rows = await Promise.all(days.slice(offset, offset + 4).map(readDay));
    for (const row of rows) {
      for (const [target, day] of [[result.general, row.finance], [result.maintenance, row.maintenanceFinance]] as const) {
        if (!day) throw new Error('missing_daily_finance');
        target.unsettledAttempts += day.unsettledAttempts;
        target.unestimatedAttempts += day.unestimatedAttempts;
        if (day.settlement.status === 'settled') {
          const { currency, micros, attempts } = day.settlement;
          addAmount(target.settlements, { currency, micros, attempts }, item => item.currency === currency);
        }
        for (const { currency, micros, attempts, priceVersion } of day.estimates) {
          addAmount(target.estimates, { currency, micros, attempts, priceVersion }, item => item.currency === currency && item.priceVersion === priceVersion);
        }
      }
    }
  }
  return result;
}
