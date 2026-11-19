# 育伴港選配工作台｜第 48 頁：臨時聊天

這一頁只比較如何在第一句之前進入獨立的臨時對話、確認模式、知道退出後會發生甚麼。不重做助手聊天總覽或匯入對話。

- **臨時-01｜Gemini 手機獨立入口**：[官方原圖](https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Temporary_Chat.width-1200.format-webp.webp)含兩張完整手機畫面。[2025-08-13 公告](https://blog.google/products-and-platforms/products/gemini/temporary-chats-privacy-controls/)及[Android 使用步驟](https://support.google.com/gemini/answer/13275745?co=GENIE.Platform%3DAndroid&hl=en)。從聊天清單選獨立入口，第一句之前顯示模式和影響；退出後不出現在最近聊天，不代表不保留，公告明示最多 72 小時。
- **臨時-02｜Claude 新對話切換**：[官方完整視窗原圖](https://assets.claude.com/6b32914222225ea9a486840d892105052f03a78b.png)、[2025-09-11 公告](https://claude.com/blog/memory)及[開啟與退出說明](https://support.claude.com/en/articles/12260368-use-incognito-chats)。新對話按右上角開啟，輸入時仍保留黑框和模式標籤。歷史、記憶、服務端保留分開；一般預設保留 30 日，企業政策可不同。
- 官方示範版號未公開。僅外鏈原圖，不下載或散布；保留期限屬原產品，不是育伴港的設定。

## 育伴港對照
- [REQ-003 普通聊天](https://github.com/2NTTY/child-ai-caregiver/blob/f458dc14fa3a7f6172ebc1000ebbbbafac062cf8/docs/REQUIREMENTS_BACKLOG.md#L616-L638)的目標是保留主對話與脈絡、可文字問答和搜尋，但不能啟動助手寫入，也不重放舊待執行操作。
- [REQ-003 臨時聊天](https://github.com/2NTTY/child-ai-caregiver/blob/f458dc14fa3a7f6172ebc1000ebbbbafac062cf8/docs/REQUIREMENTS_BACKLOG.md#L640-L668)的目標是新開空白、無孩子／私人及主脈絡、不能寫回，正常退出在項目能控制的範圍清理、捨棄遲到結果，不承諾離線或第三方完全刪除。
- [現有服務按操作類別查授權](https://github.com/2NTTY/child-ai-caregiver/blob/f458dc14fa3a7f6172ebc1000ebbbbafac062cf8/server/firestore-agent-actions.ts#L205-L219)，但不是臨時模式完整實作。[目標流程矩陣](https://github.com/2NTTY/child-ai-caregiver/blob/f458dc14fa3a7f6172ebc1000ebbbbafac062cf8/docs/AGENT_TARGET_FLOW_V0_11.md#L14-L28)不能當正式交付證據。

## 離線驗證
工作台含 48 頁、99 款；原有 47 頁與 146 個圖片雜湊不變。21 項離線檢查通過，包括選擇、改選、摘要及撤銷。HTML 30,880,596 bytes，SHA-256 `d78c623a460882a42b48455ae09f4accc1e249a76a9cb300440557ec9a050b57`。未測真瀏覽器，未發布。本分支只保存來源參照文字。
