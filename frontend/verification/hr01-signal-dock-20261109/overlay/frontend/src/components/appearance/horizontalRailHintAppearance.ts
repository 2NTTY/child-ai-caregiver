/** Paint-only seam. No dimensions, layout, opacity, events, refs or domain data. */
export interface HorizontalRailHintAppearance {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderRadius: 0 | 6 | 8 | 16;
  readonly iconColor: string;
  readonly hoveredBackgroundColor: string;
  readonly pressedBackgroundColor: string;
  readonly focusedBorderColor: string;
}

/** HR01: isolated Signal Dock proposal, never the application default. */
export const signalDockRailHintAppearance: HorizontalRailHintAppearance = Object.freeze({
  backgroundColor: "#202744",
  borderColor: "#202744",
  borderRadius: 6,
  iconColor: "#FFE08A",
  hoveredBackgroundColor: "#303A60",
  pressedBackgroundColor: "#151B31",
  focusedBorderColor: "#FFFFFF",
});
