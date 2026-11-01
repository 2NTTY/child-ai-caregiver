export interface HorizontalRailItem { key: string; x: number; width: number }
export interface HorizontalRailMetrics { rowWidth: number; viewportWidth: number; contentWidth: number; x: number }

export function horizontalOverflow(metrics: HorizontalRailMetrics) {
  const { rowWidth, viewportWidth, contentWidth, x } = metrics;
  // The full row, not the narrowed viewport, determines whether a hint slot is needed.
  const overflow = rowWidth > 0 && contentWidth > rowWidth + 1;
  return { overflow, more: overflow && viewportWidth > 0 && contentWidth > Math.max(0, x) + viewportWidth + 1 };
}

export function horizontalRevealOffset(item: HorizontalRailItem, metrics: HorizontalRailMetrics) {
  const { viewportWidth, contentWidth, x } = metrics;
  const next = item.x < x || item.width > viewportWidth ? item.x
    : item.x + item.width > x + viewportWidth ? item.x + item.width - viewportWidth : x;
  return Math.max(0, Math.min(next, contentWidth - viewportWidth));
}

export function nextHorizontalItem(items: readonly HorizontalRailItem[], metrics: HorizontalRailMetrics, pendingKey: string | null) {
  const pendingIndex = pendingKey === null ? -1 : items.findIndex(item => item.key === pendingKey);
  return items.find((item, index) => index > pendingIndex && item.x + item.width > metrics.x + metrics.viewportWidth + 1)
    ?? items[items.length - 1];
}
