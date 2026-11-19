# 第 56 題｜本人多孩對話：這次要談哪幾個孩子？

家長想一起討論兩個孩子的午睡安排，不是邀請兩人加入聊天，也不是要切換全站的孩子檔案。這題把「建立前能否改選」和「重開後認不認得這一組」拆開比較。

## 育伴港的實際流程

前置讀碼基準：`2NTTY/child-ai-caregiver` 的 `master` 提交 `dc9b23d8bc25f14858a9fd8af1b1a156121c6cf2`。[全部功能的入口](https://github.com/2NTTY/child-ai-caregiver/blob/dc9b23d8bc25f14858a9fd8af1b1a156121c6cf2/frontend/src/components/navigation/app-navigation.ts#L10-L14) 前往 `/settings?section=children`，不是獨立房間網址。[孩子選取、建立與已有對話](https://github.com/2NTTY/child-ai-caregiver/blob/dc9b23d8bc25f14858a9fd8af1b1a156121c6cf2/frontend/src/production/MixedChatConversation.tsx#L148-L193) 顯示候選姓名及已選姓名，可選一至一百位，並非至少要兩位；現有清單用孩子組合和更新時間辨認。[已開啟的對話](https://github.com/2NTTY/child-ai-caregiver/blob/dc9b23d8bc25f14858a9fd8af1b1a156121c6cf2/frontend/src/production/MixedChatConversation.tsx#L203-L209) 再次列出對象。本次未執行建立對話，也沒有驗證服務端私隱、權限或儲存行為。

## 兩款原作者參考，各自只支持一種狀態

1. **對象-01｜Power BI Desktop：勾選之後，再確認。** Microsoft 的 [Navigator 對話框原圖](https://learn.microsoft.com/en-us/power-bi/create-reports/media/desktop-dimensional-model-report/desktop-load-tables.png) 左側有七個表格已勾選；其中一列另有底色，與右方預覽對應。下方有獨立的執行與取消按鈕。要借的是「勾選、核對、提交」的區別，不是桌面版資料匯入或預選全部孩子。[官方教學](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-dimensional-model-report#prepare-your-data) 使用 AdventureWorks Sales 範例；頁面更新於 2026-08-31，圖檔無明示組建號。是完整對話框，不是整個應用程式。
2. **對象-02｜OneNote：對話名稱之外，列出涵蓋的對象。** Microsoft 的 [Windows 已開筆記本工作區原圖（revision 5）](https://techcommunity.microsoft.com/t5/s/gxcuf89792/images/bS00NDIzMzQ2LVp6QWwyWA?image-dimensions=999x590&revision=5) 同時顯示 Marketing Launch 和 References 下逐項可辨認的來源名稱。[產品經理的原文](https://techcommunity.microsoft.com/blog/Microsoft365InsiderBlog/microsoft-365-copilot-notebooks-available-in-onenote-on-windows/4423346) 發表於 2025-06-13；文章列出支援的版本，不代表已確認截圖組建號。「週末午睡安排」下列「討論對象：小晴、小朗」是合成設計例。把同一組名字顯示在最近對話中，是讓家長選回正確對話的建議；原圖沒有顯示多孩聊天或含完整對象的歷史列。

這兩款原圖均由 Microsoft 第一方發布。HTML 每款提供一條原作者原圖連結，並在「來源、版本與授權」中另列一條官方教學或產品文章連結。未取得圖檔隨產品分發或嵌入的授權，沒有下載、裁改、轉載或嵌入。[Microsoft 圖像使用說明](https://www.microsoft.com/en-us/legal/intellectualproperty/copyright/permissions)。不以桌面圖、未核實的手機圖或替代文字冒充手機、歷史列表或育伴港自身的實測畫面。

## 私人讀本靜態與閱讀器驗證

- 檔案：`育伴港選配工作台-56主題-本人多孩對話外鏈版-20261119.html`，30,902,340 bytes；SHA-256 `e65192acd7cbc4ac407c0b471b401af133f7ba183c4fa24a69a96810aeec15c8`。基準為已交付的第 55 題版，SHA-256 `8b6f1e590d6c9cb403b286493131af30486e53ae22ab78cdd9748665ee6d995d`。
- 56 個主題／115 款可選：77 款離線、38 款外鏈。加入這題後，刪去新增的 JSON 記錄可逐位元組還原原資料段；原 146 張內嵌圖逐張解碼、核對 SHA-256。第 56 題實際渲染兩條 HTTPS 原圖與兩條官方來源連結，沒有內嵌圖檔、縮放或下載功能。
- 靜態檢查及 JavaScript 語法檢查通過；用交付 HTML 內的閱讀器執行 37 項離線 JS VM 檢查，涵蓋總數、各題單看與並看、#55/#56 雙向切換與末頁邊界、剛選的設計被另一款取代、清單返回當前選擇、撤回不影響其他題、按鈕焦點與按下狀態，以及外鏈屬性。不是瀏覽器、真鍵盤或實機手機驗收；沒有啟動產品或將參考套用到育伴港。
