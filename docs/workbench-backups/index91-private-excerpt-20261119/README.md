# 第 77 題｜私人通告：只把哪幾句交給 AI 整理？

假設整份校外活動通告已保存為私人原文，但只想整理集合安排。「星期六上午九時在北門集合。請自備水樽。」可選為連續摘錄，不包括接着的義工簡介。保存原文不等於同意 AI 提取。短文可能預填整段，先確認只留下要處理的原句，才明確同意 AI 模型處理這次的摘錄；改了摘錄就要重新同意。沒選的段落不在這次整理的正文欄，但流程仍會帶必要的來源脈絡。結果只是候選，不是家人已確認的記錄；也可以不用 AI。工作台只看作者畫面，不傳送或處理文字。

## 兩個原作者的畫面

**私人摘錄-01｜Notepad：在原文中看清選了哪段。** 作者畫面顯示原文、反白的片段，以及狀態列所選和全文的字元數。Rewrite 預覽的「替換／取消」要在產生之後才出現，不是傳給模型之前的同意。育伴港可借選區上下文讓家長看清從哪句到哪句，仍須另外核對及同意這次的摘錄。

[開 Notepad 作者說明頁看第一幅圖：所選片段與預覽（需連網）](https://support.microsoft.com/en-us/windows/ai/ai-apps/enhance-your-writing-with-ai-in-notepad#:~:text=Using%20Rewrite%20in%20Notepad)。[Microsoft 2024 發布公告](https://blogs.windows.com/windows-insider/2024/11/06/new-ai-experiences-for-paint-and-notepad-begin-rolling-out-to-windows-insiders/)；[Microsoft 截圖及使用政策](https://www.microsoft.com/en-us/legal/intellectualproperty/copyright/permissions)。

Microsoft Windows Notepad Rewrite；2024-11-06 公告列預覽版 11.2410.17.0。支援頁原圖的拍攝日期與實際 build 未列。 Microsoft 作者原圖依原頁查看；這裏只用文字連原說明頁，不直連、重發或嵌入原圖。

**私人摘錄-02｜Substack：執行前核對準備送出的引文。** 第一張作者圖在整篇文章上選中兩句；第二張在仍未發佈的 Quote 草稿中看見同一引文、來源與移除按鈕，Post 是另一步。借的是把『準備送出這兩句』明確放在最後核對畫面，不借公開發文，更不是 AI、私人資料權限或改文後仍同意的例子。

[看 Substack 作者原圖：發佈前核對原句的草稿（需連網）](https://support.substack.com/hc/article_attachments/33120501449492)。[Substack 另一張原圖：在原文章選中的兩句](https://support.substack.com/hc/article_attachments/33120501444884)；[Substack 作者指引：從選中摘錄到發佈前草稿](https://support.substack.com/hc/en-us/articles/14671398684308-What-is-a-restack-on-Substack-Notes)。

Substack Notes 英文網頁示例；作者說明頁於 2024-12-29 更新，截圖實際拍攝日期與 build 未列。 作者支援頁所刊圖樣；沒有確認重製授權，只提供作者原頁及原圖連結。

## 當時 master：不是概念功能

用 GitHub connector 讀取 refs/heads/master，固定 [cb07870aa91e5bb0c6df59990fe5350cfdb82571](https://github.com/2NTTY/child-ai-caregiver/commit/cb07870aa91e5bb0c6df59990fe5350cfdb82571)，僅讀原碼：

1. [私人來源正式頁接 ProductionSourcesWorkspace](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/screens/SourcesScreen.tsx#L6-L18)；[由「取得原文、提取或核對家庭記錄」展開工具，另有人工入口](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/components/shared-inputs/SourcesView.tsx#L109-L121)。[查看完整保存原文、辨認單一來源與版本](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/components/shared-inputs/SourceDetails.tsx#L37-L54)。這是一個來源閱讀、選取、預覽與決定的工作頁，不是孤立的「我同意」選框。
2. [短正文可先把整篇放入摘錄，超過限制則留空](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/production/usePhotoInputSources.ts#L21-L28)；[提取只接受 1–10,000 字、逐字包含於正文的連續片段；勾明同意後才能提取；可人工整理](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/components/shared-inputs/SourceDetails.tsx#L87-L96)。不能拼首尾兩段、把改寫視為逐字摘錄或自動截斷。[改摘錄清同意，採用候選只是放入草稿](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/production/usePhotoInputSources.ts#L343-L353)；[候選有原日期、數量、可能的不確定處](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/components/shared-inputs/SourceDetails.tsx#L104-L110)。
3. [API 強制明確 confirmModel、同一版本及摘錄](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/server/shared-input-api.ts#L40-L45)；[儲存層驗證摘錄實屬該原文](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/server/firestore-shared-inputs.ts#L335-L347)。**隱私表述須準確**：[這次提取的來源正文欄是所選 excerpt；整理流程還帶來源識別、名稱、日期等脈絡，personal_source 的網址設為 null](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/server/shared-input-service.ts#L29-L47)。可以說「沒選的通告段落不在這次提取的正文欄」，不能說「技術上只傳送這幾個字、連任何其他資料都不會傳」，也不保證其他模型產品只讀選取範圍。[另存『容許聊天模型使用的摘錄』是另一項持續設定](https://github.com/2NTTY/child-ai-caregiver/blob/cb07870aa91e5bb0c6df59990fe5350cfdb82571/frontend/src/components/shared-inputs/SourceIntakeEditor.tsx#L103-L115)，有不同長度限制；不能說做了一次提取就替將來的聊天授權。

## 私用版本與驗證

- 私用離線檔：`育伴港選配工作台-77主題-私人摘錄與提取-20261119.html`；30,983,451 bytes；SHA-256 `4b4c720ec0e42ab3ab7d0e2376873b956597f4ff5c5249852b83f4071ea9d585`。保存已交付第 76 題基準 `ae7001b943c6166b755cc276f258ec51f67b807281a7b6136f78367c5e6a371a` 的全部紀錄與原圖。

- 77 題、157 款。原來的 146 張圖逐張核對；本題作者圖只保留原始連結。頁上不會對作者網站預取、登入、同意或提交任何文字給模型。

- 已驗證離線結構、內容安全策略、JS 語法以及新版閱讀器的模擬導覽、並看、選擇、複製來源、替換和撤選。未做瀏覽器／真機或產品功能實測；沒有讀取真實家庭資料、調用模型或實際派發事項。本分支只有文字備份，沒有建立 PR、合併或發布網站。
