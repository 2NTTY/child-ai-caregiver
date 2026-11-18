import { View } from 'react-native';
import { Text } from 'react-native-paper';
import type { MonthlyFinance } from '../../../../src/shared/monthly-finance';
import type { DailyMoneyBudget } from '../../../../src/shared/model-settings';
import { budgetBalanceLabel, displayMoney } from './usage-amounts';

export function MonthlyFinanceDetails({ title, pool, budget }: {
  title: string; pool: MonthlyFinance['general']; budget?: DailyMoneyBudget | null;
}) {
  const settlement = pool.settlements[0];
  const balance = pool.settlements.length > 1 ? '結算包括多種幣別，總餘額待確認。' :
    budgetBalanceLabel({ approvedDailyBudget: budget, unsettledAttempts: pool.unsettledAttempts,
      settlement: settlement ? { ...settlement, status: 'settled' } : { status: 'unknown' } }, '當月');
  return <View>
    <Text accessibilityRole="header">{title}</Text>
    <Text>{budget ? '當月預算 ' + displayMoney(budget.currency, String(budget.micros)) : '尚未設定月預算'}</Text>
    {pool.estimates.map(item => <Text key={item.currency + '/' + item.priceVersion}>估算 {displayMoney(item.currency, item.micros)} · {item.attempts} 次 · {item.priceVersion}</Text>)}
    {pool.settlements.map(item => <Text key={item.currency}>已結算 {displayMoney(item.currency, item.micros)} · {item.attempts} 次</Text>)}
    {pool.unsettledAttempts || pool.unestimatedAttempts ? <Text>{pool.unestimatedAttempts} 次尚無估價，{pool.unsettledAttempts} 次待對帳。</Text> : null}
    {!pool.settlements.length && !pool.unsettledAttempts ? <Text>這段期間沒有計費呼叫。</Text> : null}
    {budget && balance ? <Text>{balance}</Text> : null}
  </View>;
}
