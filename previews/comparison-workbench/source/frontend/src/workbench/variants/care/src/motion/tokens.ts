import { Easing } from "react-native-reanimated";

const overlayEnterDuration = 240;
const overlayExitDuration = 180;

// v10 guide values describe presentation only, never operation completion.
export const motionTokens = {
  ease: Easing.bezier(0.2, 0, 0, 1),
  coverEase: Easing.bezier(0.4, 0, 0.2, 1),
  route: { duration: 200, distance: 10 },
  drawerRight: { enter: overlayEnterDuration, exit: overlayExitDuration },
  backdrop: { enter: overlayEnterDuration, exit: overlayExitDuration },
  local: { cover: 140, reveal: 220, color: "#DCEADF" },
  summary: { cover: 160, reveal: 260, color: "#DCEADF" },
  scope: { cover: 160, reveal: 260, color: "#E2ECE3" },
  detail: { duration: 280, distance: 24 },
  add: { duration: 200, distance: 12 },
  detailAdd: { duration: 220, distance: 14 },
  exit: { duration: 150, distance: 8 },
  flip: { duration: 200 },
  dialog: { duration: 220, distance: 12 },
  message: { duration: 180, distance: 10 },
  panel: { duration: 180, distance: 7 },
  disclosure: { duration: 180 },
  selection: { duration: 180 },
  feedback: { duration: 180, color: "#E2ECE3" },
} as const;
