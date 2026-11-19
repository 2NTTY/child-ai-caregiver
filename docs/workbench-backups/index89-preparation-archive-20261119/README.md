# 第 75 題｜郊遊準備單用完了：怎樣收起，再找回同一份？

假設「小禾｜海濱郊遊」原定 11 月 7 日，11 月 9 日才收起。水樽已勾、雨衣未勾。歸檔把這份準備單移出待用清單，不是刪除，也不替你勾雨衣。要按日期找，用 9 日歸檔日，而不是 7 日使用日。只查閱時不用恢復；要再次使用才明確把同一份恢復到待用，不會複製或重置勾選。找不到也可能還未載入；來源和恢復仍須符合權限。工作台只比較設計，不動原文件。

## 兩個原作者的畫面

**準備單-01｜monday workdocs：先核對正在收起的原文件。** 在作者的具名原文件同時看見標題、正文及右上的選單。Archive 和 Delete 分開；選的是收起這份原件，不是在打勾、完成待辦或刪除。原圖沒有展示準備單勾選或收起後的結果；育伴港本例才有水樽、雨衣的勾選，兩者不能混說。

[看 monday workdocs 作者原圖：用中的文件與 Archive 選項（需連網）](https://support.monday.com/hc/article_attachments/27990712060946)。[monday 官方指引：Archive a workdoc](https://support.monday.com/hc/en-us/articles/115005314609-How-to-archive-and-restore-data)；[monday workdocs 原作者產品介紹](https://monday.com/blog/monday-workdocs/our-newest-building-block-is-here-monday-workdocs/)；[monday 官方權利條款入口](https://monday.com/l/)。

monday workdocs 桌面網頁；作者產品介紹日期 2021-08-19，不是歸檔功能或截圖日期；拍攝時間、畫面 build 未列。 monday.com 官方原圖，權利保留；這裏只連原圖和說明，不重發或嵌入。

**準備單-02｜Mstnd：從歸檔清單找回同一份。** 從獨立的 Digital archive 查看保留的文件，以名稱及原資料夾核對。再看恢復確認畫面，它重複顯示第一張圖中的同一份文件；原作者說完成後回到原資料夾。這不是垃圾桶，也不是由搜尋例子的另一份文件恢復。育伴港先找原準備單，若只是看當時勾了甚麼，不用把它移回待用。

[看 Mstnd 歸檔工作區原圖：搜尋及原資料夾（需連網）](https://learn.mstnd.sa/learn/54_archive/step_01-860.webp)。[Mstnd 整頁工作區：歸檔與垃圾桶分開](https://learn.mstnd.sa/learn/54_archive/cover-1200.webp)；[Mstnd 還原確認原圖：核對要恢復的同一文件](https://learn.mstnd.sa/learn/54_archive/step_03-860.webp)；[Mstnd 原作者文件：歸檔與恢復步驟](https://learn.mstnd.sa/en/archive)。

Mstnd 英文文件的 Digital archive 教學，作者標示 2026-10-26 更新；畫面 build、拍攝日期未列。 Mstnd 作者原圖，權利保留；只連作者圖與文件，不重發或嵌入。

## Current master 原碼

以 GitHub connector 讀取 refs/heads/master，固定 [55b763cf63f4c7724d7fd87221554d21fc14be9d](https://github.com/2NTTY/child-ai-caregiver/commit/55b763cf63f4c7724d7fd87221554d21fc14be9d)。是原碼核對，不是瀏覽器或正式資料實測。

1. [外出／旅行是準備單用途](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/preparation-view-model.ts#L5-L11)；[待用工作區只列 active，提供獨立「查看已歸檔」入口](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/preparations/PreparationWorkspace.tsx#L257-L287)。[目前正文可以選「使用完畢，歸檔」，按名稱核對只歸檔這一份，亦可選「繼續使用」；已歸檔的非舊修訂才有受能力限制的恢復入口](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/preparations/PreparationWorkspace.tsx#L156-L167)。[確認後提示到歷史查看或繼續看其他準備；歷史可開詳情](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/preparations/PreparationWorkspace.tsx#L232-L252)。
2. [歷史畫面真的接準備單分類、文字與日期條件](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/screens/historyScreen.tsx#L80-L90)；[按歸檔時間而非使用日期過濾，只搜尋已載入且可讀的內容；可繼續載入](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/preparations/PreparationWorkspace.tsx#L301-L322)。[檢視歸檔日和使用時版本、以不可操作的勾選記號看歷史](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/components/preparations/PreparationWorkspace.tsx#L116-L133)。無結果不等於從未有過準備單；唯讀家人並無修改權。
3. [正式工作區明說只歸檔文件，原來源和任務保留；按原 ID 與期望版本執行 archive / restore](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/frontend/src/production/useFamilyDocuments.ts#L424-L444)。[伺服器核對原件與版本](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/server/firestore-family-documents.ts#L568-L575)，[在原文件翻轉 active / archived、更新歸檔時間；不像勾選、修改或整理新版本那樣產生新正文](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/server/firestore-family-documents.ts#L586-L608)；[來源失效時不再回傳原快照，不以「曾經存檔」繞過存取界線](https://github.com/2NTTY/child-ai-caregiver/blob/55b763cf63f4c7724d7fd87221554d21fc14be9d/server/firestore-family-documents.ts#L158-L166)。恢復需通過可用上限和權限；不要保證一按成功。

## 私用版本與驗證

- 私用離線檔：`育伴港選配工作台-75主題-準備單歸檔找回-20261119.html`；30,977,132 bytes；SHA-256 `898e9b0ae0a1e2165d2fd8992dc66d4c32c8a51d7d806e78f45bcee539ba6345`。保存已交付第 74 題基準 `5c23234b1103c590665893bf3fe550040735f041137974a6e2317ece1469f6a4` 的全部紀錄與原圖。

- 75 題、153 款。原來的 146 張圖逐張核對；本題作者圖只保留原始連結。頁上不會對作者網站預取、登入、歸檔或恢復任何原文件。

- 已驗證離線結構、內容安全策略、JS 語法以及新版閱讀器的模擬導覽、並看、選擇、複製來源、替換和撤選。未做瀏覽器／真機或產品功能實測；沒有讀取真實家庭資料、調用模型或實際派發事項。本分支只有文字備份，沒有建立 PR、合併或發布網站。
