# 選配工作台第 122 頁：小助手揮手了，怎樣才算打開並看過提醒？

- **A｜原頁文字提示。** [Slack 桌面官方整窗](https://slack.zendesk.com/hc/article_attachments/54893886946451)把助手、具名 Activity 入口和未讀角標放在同一畫面。原圖沒打開通知列表，更沒展示已讀。
- **B｜開啟小對話後分開看原文和狀態。** [Microsoft Teams 官方行動版雙畫面](https://learn.microsoft.com/en-us/microsoftteams/platform/assets/images/activity-feed/mobile-overview.png)讓提醒和同名任務一眼對上。原圖有預覽，沒有展示查看回報。

育伴港的角色揮手、摸頭、移動或收起都不算已讀。[同一孩子的小對話](https://github.com/2NTTY/child-ai-caregiver/blob/883426b658c032e496228b877b0c0b5cee8b24ab/frontend/src/components/companion/SiteCompanion.tsx#L93-L124)須顯示該則提醒，[滿足前景、連線及同範圍條件](https://github.com/2NTTY/child-ai-caregiver/blob/883426b658c032e496228b877b0c0b5cee8b24ab/frontend/src/production/useChatExposure.ts#L15-L45)才回報。收到同一則提醒的成功回應才更新狀態，不代表推播送達、待辦完成或本人讀懂。本頁只比較，不寫入已讀；新增原圖只外連，版本及權利見 `spec122.json`。

## 重建與檢查

- 前 121 頁不變。共 122 題、247 款，其中 151 款只外連；保留 165 張既有離線圖。
- 用已驗證 #121 HTML（SHA-256 `7eb1b0a36ba11c474b821bfcbcc201b4b55bb72f127db54c9d661dcaa63e87c1`），執行 `python append122.py baseline121.html spec122.json output122.html`。
- HTML 34,374,928 bytes，SHA-256 `4939fb4a4761bdff2abcde0b78de2eb8ceca1d66d3d2085e2e3907ee0b73f837`；單檔 ZIP 22,771,286 bytes，SHA-256 `ee2953fe10e431cde09e4b7125667a9c3ae0b064bfaa41d0c31e4a95b4622a06`。
- 離線驗證選配和來源連結，沒有更新網站、主分支或四方案，並非正式站或原生實機驗收。
