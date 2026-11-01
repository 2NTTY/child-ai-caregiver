const name = "育有方";

export const brand = {
  name,
  previewName: `${name} · 前端預覽`,
  homeLabel: `${name}，返回主頁`,
  agentTitle: `${name} Agent 對話`,
  platformServiceLabel: `${name}平台服務`,
  restoreBackgroundLabel: `恢復${name}原圖`,
  illustrationFilename: `${name}美術示例.png`,
  // Preserve the original logo artwork colors; UI colors remain in theme.ts.
  artworkInk: "#203E3A",
  guidingLight: "#D99A3D",
} as const;
