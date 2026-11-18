import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyFinance, monthDays } from '../server/monthly-finance.ts';
import { dailyFinance } from '../server/ai-financial-evidence.ts';

test('UTC months include leap day, stop at today and reject future or invalid months', () => {
  assert.equal(monthDays('2024-02', '2024-03-01').length, 29);
  assert.deepEqual(monthDays('2024-03', '2024-03-02'), ['2024-03-01','2024-03-02']);
  assert.throws(() => monthDays('2024-04', '2024-03-02'));
  assert.throws(() => monthDays('2024-00', '2024-03-02'));
});
test('monthly evidence preserves currencies, fractional estimates, partial settlement and separate pools', async () => {
  const day = (currency: string) => ({ ...dailyFinance('personal', 3), unsettledAttempts: 1, unestimatedAttempts: 2,
    settlement: { status: 'settled' as const, currency, micros: '12', attempts: 2 },
    estimates: [{ status: 'estimated' as const, currency, priceVersion: 'r1', micros: '0.000009', attempts: 1 }] });
  const report = await monthlyFinance('2024-03', '2024-03-03', async date => ({
    finance: day(date.endsWith('03') ? 'USD' : 'HKD'), maintenanceFinance: dailyFinance('personal', 0) }));
  assert.deepEqual(report.general.settlements, [{ currency: 'HKD', micros: '24', attempts: 4 }, { currency: 'USD', micros: '12', attempts: 2 }]);
  assert.equal(report.general.estimates[0].micros, '0.000018');
  assert.equal(report.general.unsettledAttempts, 3);
  assert.equal(report.maintenance.settlements.length, 0);
  await assert.rejects(monthlyFinance('2024-03', '2024-03-02', async () => { throw new Error('failed day'); }), /failed day/);
});
