import { colors, paperTheme } from '../../theme';

/** Fixed host semantics, not source identity, a data owner or runtime admission. */
export const TASK_WORKBENCH_BASE = Object.freeze({
  id: 'workbench-original-base-v1',
  sourceVariantId: 'original',
  themeSourceSha256: '747b825d2c49eb72b2d73c5919c0aa6217b0750d3651ddea1d053337d8a088a2',
} as const);

export const taskWorkbenchColors = colors;
export const taskWorkbenchPaperTheme = paperTheme;

/** Exact historical web family order; native keeps its existing platform fallback. */
export function taskWorkbenchFontFor(platform: 'web' | 'native'): string | undefined {
  return platform === 'web' ? "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif" : undefined;
}

export const taskWorkbenchCss = Object.freeze({
  tapHighlight: 'rgba(39, 35, 67, 0.16)',
} as const);
