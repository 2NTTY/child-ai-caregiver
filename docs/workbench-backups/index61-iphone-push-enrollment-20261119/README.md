# 育伴港選配工作台｜第 47 頁：iPhone 推播開通與驗收

本頁比較「在使用時引導開通」和「到本機裝置設定查狀態並試發」。不重做靜音時段或通知歷史。

- **推播-01｜PushEngage 示範店面**：[原方指南](https://www.pushengage.com/documentation/setting-up-web-push-notifications-for-ios-ipad/)；[安裝原圖](https://www.pushengage.com/wp-content/uploads/2023/07/ATH-1-2-1211x1024.png) → [主畫面及店面前置提示原圖](https://www.pushengage.com/wp-content/uploads/2023/09/iphone_optin_homescreen-1.png) → [iOS 詢問及迎新推播原圖](https://www.pushengage.com/wp-content/uploads/2023/09/secondallow_optin_and_firstcampaign-1.png)。原圖路徑版本 2023-07／09；真正的畫面版號未公開。最後是迎新通知，不是手動試發。
- **推播-02｜KIRA 本機通知設定**：[完整桌面設定原圖](https://kira.id/images/docs/inbox-profile-notifications-en.webp)顯示 Installed、目前裝置、Send test／Turn off；[原方 iPhone 指南](https://kira.id/en/blog/iphone-push-notifications-not-showing)依序說明安裝、從圖示打開、設定、允許和試發。指南日期 2026-10-22；截圖版號未公開。不能把桌面圖當成 iPhone 實收證明。
- 2026-11-19 核對兩家原方圖和指南。未核實重新散布畫面權利，兩案僅由用戶按外鏈查看，不下載或重製圖到工作台。

## 與育伴港現況的對照
- [育伴港主畫面試用指南](https://github.com/2NTTY/child-ai-caregiver/blob/aa759f49b0ffda4e351387b6f9582587d3b3c9a8/docs/IPHONE_PWA.md#L3-L16)記錄 iOS 16.4 以上從主畫面圖示進入，在「設定 → 通知」啟用並選擇一般提示或內容預覽。
- [渠道設定畫面](https://github.com/2NTTY/child-ai-caregiver/blob/aa759f49b0ffda4e351387b6f9582587d3b3c9a8/frontend/src/components/notifications/ChannelCards.tsx#L184-L254)：普通分頁先提示安裝，拒絕時先去系統設定再讀回；iOS 已允許不等於已綁定或已送達。已綁定親自試一般通知，與管理員觸發助手示範，是兩個操作。
- 11 月 12 日試用者回報鎖屏收到及點回原聊天後能回覆；未記錄 iOS 版本、預覽模式或投遞收據。本輪不連帳戶、不試發、不重驗真機，不改正式功能。

## 工作台核對
離線 HTML 30,878,279 bytes，SHA-256 `cab0c3885e8bc7cbcfe26b7c0a63010dd631d1e31b972e47dbbdcb1f4b1e2fb7`。47 個主題／97 款，舊 46 頁及 146 張圖片雜湊不變。19 組離線閱讀器測試通過，未測真瀏覽器。本分支只備份此文字，沒有 PR 或發布。
