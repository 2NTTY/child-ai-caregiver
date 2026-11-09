export type HeaderOperationState = 'none' | 'saved' | 'saving' | 'needs_confirmation' | 'unknown' | 'conflict' | 'failed' | 'confirmed_unread';
export type HeaderOperationHintView = { id: string; page: string; status: string; tone: 'info' | 'warning' | 'error'; onReview(): void };
export type HeaderOperationInput = { id: string; page: string; state: HeaderOperationState; onReview?: () => void };

/** Presentation of owner-produced write states, not a business-attention calculation. */
export function headerOperationHints(inputs: readonly HeaderOperationInput[]): HeaderOperationHintView[] {
  return inputs.flatMap(({ id, page, state, onReview }) => {
    if (!onReview || state === 'none' || state === 'saved') return [];
    const status = state === 'saving' ? '進行中' : state === 'needs_confirmation' ? '待確認'
      : state === 'failed' ? '未完成' : state === 'conflict' ? '需比較' : '待核對';
    return [{ id, page, status, tone: state === 'saving' ? 'info' : state === 'failed' ? 'error' : 'warning', onReview }];
  });
}
