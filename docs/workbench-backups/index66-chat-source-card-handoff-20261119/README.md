# 第 52 題：來源卡：從聊天回到同一張卡

## 育伴港實作基準

[PR #668](https://github.com/2NTTY/child-ai-caregiver/pull/668)，合併提交 `87a6c57f4d2aa3c9c62be80663ba0baa82ed2511`。

- [聊天回覆入口](https://github.com/2NTTY/child-ai-caregiver/blob/87a6c57f4d2aa3c9c62be80663ba0baa82ed2511/frontend/src/screens/chatScreen.tsx#L280-L285)：「查看來源卡」連往「記憶與參考」的同一個 cardId；需要本人登入才會出現「前往來源卡登入」的入口。
- [展開正確卡片](https://github.com/2NTTY/child-ai-caregiver/blob/87a6c57f4d2aa3c9c62be80663ba0baa82ed2511/frontend/src/production/RegisteredSourceCards.tsx#L107-L116)；[登入表單與獨立同意](https://github.com/2NTTY/child-ai-caregiver/blob/87a6c57f4d2aa3c9c62be80663ba0baa82ed2511/frontend/src/production/RegisteredSourceCards.tsx#L233-L244)。開表單不代表已有授權。
- [受控本機驗證](https://github.com/2NTTY/child-ai-caregiver/blob/87a6c57f4d2aa3c9c62be80663ba0baa82ed2511/artifacts/verification/CHAT_DELEGATED_SOURCE_SETTINGS_20261119.json#L3-L18)：同一卡由每日改成每週，頁面使用的 API 讀回新版本。這不是正式站發布證據。

這一題只比較從聊天到同一筆資料的入口和回查，不重做第 50 題的巡查頻率／範圍，也不模擬真實註冊、授權或取資料。

## 可選整頁

1. **來源卡-01｜Slack 清單與同項側欄。** [Salesforce 2024 官方案例原圖，第 68 頁](https://d34u8crftukxnk.cloudfront.net/slackpress/prod/sites/6/Salesforce-on-Salesforce_How-Slack-Transformed-Salesforces-Enterprise-Operations-EBOOK.pdf#page=68)。原圖選定一列，右邊顯示同一筆的名稱、狀態與欄位；不必離開清單。[Slack 官方聊天 → Add to list → 項目](https://slack.com/help/articles/27452748828179-Use-lists-in-Slack)。從聊天加入項目的步驟不在這張圖內；沒有採用可能隨地區換圖的附件。PDF SHA-256 `022f8b3200fc9efa2cc6eb8c118ede49ea20c866688869860cd5dfa5d6d71286`。
2. **來源卡-02｜Teams 儲存位置與 Planner 回查。** [官方 My Tasks／Private tasks 頁原圖](https://support.microsoft.com/en-us/planner/media/getting-started-with-planner-screenshot-four-version-two-png.png)，[聊天的私人任務表單原圖](https://support.microsoft.com/en-us/teams/media/create-a-task-in-private-tasks.png)。從聊天可看出要存到哪裡，備註可保留原訊息位置；後續在 Planner 的相應清單回查。[建立指引](https://support.microsoft.com/en-us/teams/platform/create-a-task-from-a-teams-message)與[清單指引](https://support.microsoft.com/en-us/planner/teams/getting-started-with-planner-in-teams#track-your-tasks-in-my-tasks)。兩張原圖是不同示例，不是同一筆任務的前後比對。清單圖 SHA-256 `54f327dbe878e96e115c5ecbac55b799add551d578f4bf45e75b9a2dc158d582`，表單圖 SHA-256 `a2889de6d4c801a65c0b8e0ef329abf00dc080852b23e058befe28f35849203a`。

2026-11-19 查得以上原圖及指南可用；未見畫面建置版號。原圖只保留官方外鏈，不重新分發。網站示例並非育伴港角色、資料或權限規格。

## 備份驗證

- 52 個主題、107 款（77 款離線，30 款外鏈），原有 51 題及 146 張內嵌圖像逐字節／摘要核對不變。
- 單檔 HTML 30,890,350 bytes，SHA-256 `bd25f2bb07e6562e6e2ac83409a54d754cdac15f7f67971e3641138bc3d64d1a`。
- 29 項離線閱讀器邏輯檢查及靜態驗證通過；未在瀏覽器做完整互動驗收。不自動載入外站，不提交或登入任何服務。
- 本分支只留這份索引、原始來源及驗證記錄；不含 HTML、圖片、私人網站、真實家庭資料或憑證。沒有 PR、合併、發布或自動替換。
