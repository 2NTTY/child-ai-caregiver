# 選配工作台第 89 題：同一主聊天的模式切換

兩種候選都在同一主聊天保留歷史。育伴港未合併 PR #692 的「只是聊天」仍可查資料，但不代寫、不建待確認卡；換模式只影響後續新訊息，不把舊請求補做、不撤銷本來在途的動作。切至助手不等於批准任何操作。臨時聊天是另一入口。這題比較怎樣說清下一則的模式，不是正式上線。

比較接點：[PR #692（未合併）](https://github.com/2NTTY/child-ai-caregiver/pull/692)，固定版本 `c0775b280e537f2a2103d17ce24fa12a9d47aa69`；[聊天模式的只讀工具邊界](https://github.com/2NTTY/child-ai-caregiver/blob/c0775b280e537f2a2103d17ce24fa12a9d47aa69/server/product-agent-capabilities.ts#L77-L89)。設計比較不改權限，不代替正式 PR 驗收。

## 聊天模式-01｜VS Code：輸入框常駐目前模式，送出前切換

比較下拉選單放在同一輸入框的做法：不離開原對話就能看見及更換目前模式。Ask、Edit、Agent 是原網站的名稱與權限，不等同育伴港兩種模式。

- [作者來源](https://code.visualstudio.com/updates/v1_99#_unified-chat-view)
- VS Code 1.99，2025 年 3 月更新文件，截圖為當時版本；不是目前的 VS Code 全幅介面。
- [VS Code 1.99 作者原圖：輸入框及展開選單](https://code.visualstudio.com/assets/updates/1_99/chat-modes.png)
- [育伴港未合併版本：既有候選的常駐模式控件](https://github.com/2NTTY/child-ai-caregiver/blob/c0775b280e537f2a2103d17ce24fa12a9d47aa69/frontend/src/components/chat/ChatModeSwitch.tsx#L17-L42)
- 僅連結作者原始頁與截圖，未轉載圖像、品牌或示例對話。

## 聊天模式-02｜Replit：在對話流中明示何時從討論轉到行動

歷史版原圖在同一對話顯示計畫，再另給修改或開始的動作。此處借的是對話內提示接下來的步驟，不複用 Replit 的執行權限；在育伴港，切換模式、發一則新訊息、確認待辦是不同動作。

- [作者來源](https://replit.com/blog/introducing-plan-mode-a-safer-way-to-vibe-code)
- Replit Agent Plan Mode 的 2025-09-03 發布案例；舊切換器已退役，並非現行產品畫面，實際 build 未標。
- [Replit 作者整頁畫面：同場保留對話、輸入框與工作區](https://cdn.replit.com/sanity/blog/select.png)
- [Replit 作者原圖：對話內的計畫及後續按鈕](https://cdn.replit.com/sanity/blog/task-list.png)
- [育伴港未合併版本：同一主聊天的模式與在途提示](https://github.com/2NTTY/child-ai-caregiver/blob/c0775b280e537f2a2103d17ce24fa12a9d47aa69/src/shared/chat.ts#L16-L22)
- 僅連結作者原始頁與截圖，未轉載圖像、品牌或示例對話。

## 驗證

89 題、181 選項、104 外部參考；原 88 題及 146 張既有圖片不變。靜態完整性、模擬 DOM 比較／選取／清除和搜尋回歸均通過。未跑真瀏覽器或產品測試；沒有上線、合併或更改產品。

- HTML SHA-256: `0ca24672267326f573d8fd9168f7c281447c9525e9354b7edecfa6cf7557cdd2`
- HTML bytes: 31021902
- 基準 SHA-256: `c5d5233fb63603b14b9ea0aa369980279cb70efe45fa5eaa93caad7139e0a916`
