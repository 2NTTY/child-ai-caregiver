import type { AdminUsageFinance } from '../../../../src/shared/admin';

export function formatMoneyMicros(micros: string) {
  const [whole, fraction = ''] = micros.split('.');
  const digits = whole.padStart(7, '0');
  const decimals = (digits.slice(-6) + fraction).replace(/0+$/u, '');
  return digits.slice(0, -6) + (decimals ? '.' + decimals : '');
}

export function displayMoney(currency: string, micros: string) {
  return currency + ' ' + formatMoneyMicros(micros);
}

export function parseMoneyBudget(amount: string, currency: string) {
  if (!amount.trim()) return null;
  const match = /^(\d{1,10})(?:\.(\d{1,6}))?$/u.exec(amount.trim());
  if (!match || !/^[A-Z]{3}$/u.test(currency)) return undefined;
  const micros = Number(match[1] + (match[2] ?? '').padEnd(6, '0'));
  return Number.isSafeInteger(micros) ? { currency, micros } : undefined;
}

export function budgetBalanceLabel(finance?: Pick<AdminUsageFinance, 'settlement' | 'unsettledAttempts'> & {
  approvedDailyBudget?: { currency: string; micros: number } | null }, period = '當日') {
  if (!finance?.approvedDailyBudget) return null;
  const { approvedDailyBudget: budget, settlement, unsettledAttempts } = finance;
  const pending = unsettledAttempts > 0 ? `仍有 ${unsettledAttempts} 次未對帳，餘額待確認。` : null;
  if (settlement.status !== 'settled') return pending;
  if (settlement.currency !== budget.currency) return '結算與預算幣別不同，餘額待確認。';
  if (!/^\d+$/.test(settlement.micros) || !Number.isSafeInteger(budget.micros)) return '餘額待確認。';
  const difference = BigInt(budget.micros) - BigInt(settlement.micros);
  if (difference < BigInt(0)) {
    const over = displayMoney(budget.currency, (-difference).toString());
    return `已結算金額超出預算${unsettledAttempts ? '至少' : ''} ${over}`;
  }
  if (difference === BigInt(0)) return '已用盡' + period + '預算';
  return pending ?? `已對帳餘額 ${displayMoney(budget.currency, difference.toString())}`;
}
