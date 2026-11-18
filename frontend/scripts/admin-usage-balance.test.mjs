import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetBalanceLabel } from '../src/components/admin/usage-amounts.ts';

test('an approved balance distinguishes full settlement, partial liability and different currencies', () => {
  const finance = { payer: 'platform', approvedDailyBudget: {currency: 'HKD', micros: 2_000_000},
    settlement: {status: 'settled', currency: 'HKD', micros: '1250000', attempts: 2}, unsettledAttempts: 0 };
  assert.equal(budgetBalanceLabel(finance), '已對帳餘額 HKD 0.75');
  assert.equal(budgetBalanceLabel({...finance, unsettledAttempts: 1}), '仍有 1 次未對帳，餘額待確認。');
  assert.equal(budgetBalanceLabel({...finance, unsettledAttempts: 1, settlement: {...finance.settlement, micros: '2350000'}}),
    '已結算金額超出預算至少 HKD 0.35');
  assert.equal(budgetBalanceLabel({...finance, settlement: {...finance.settlement, micros: '2000000'}}), '已用盡當日預算');
  assert.equal(budgetBalanceLabel({...finance, settlement: {...finance.settlement, currency: 'USD'}}), '結算與預算幣別不同，餘額待確認。');
  assert.equal(budgetBalanceLabel({...finance, settlement: {status: 'unknown'}, unsettledAttempts: 0}), null);
  assert.equal(budgetBalanceLabel({...finance, approvedDailyBudget: null}), null);
});
