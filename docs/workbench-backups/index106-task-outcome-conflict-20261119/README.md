# 選配工作台第 91 題：同一待辦出現相反終態

同一待辦若基於同一版本收到相反的完成與取消回報，系統停催並交由有權的人覆核，不以最後一筆為準。先看兩次回報，再明確選擇完成或取消、填理由和確認；預覽不是保存，覆核不會改期或重新催辦。比較使用假例，不提交操作。

[固定產品規則](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/server/task-policy.ts#L9-L18)。沒有操作任何待辦。

## 相反回報-01｜Nested Knowledge：先找待覆核的例外，再逐項看

原工作區的 Adjudicate Screening 入口和隊列進度可定位需要處理的項目，打開後旁列相反結果。這不是家庭產品；只比較從例外進入，不沿用篩選、投票或按原結果直接執行。

- [作者來源](https://about.nested-knowledge.com/docs/dual-two-pass-screening/)
- Nested Knowledge 文件更新 2024-11-01，作者圖檔標示 2024-09-24；UCL 2021-07-02 教學僅佐證清單。產品 build 未標。
- [Nested Knowledge 作者整頁原圖：覆核入口、隊列和目前項目](https://about.nested-knowledge.com/wp-content/uploads/2024/09/Screenshot-2024-09-24-at-12.39.41-1024x444.png)
- [UCL EPPI-Reviewer Web 官方教學第 71 頁：多筆分歧工作清單](https://eppi.ioe.ac.uk/cms/Portals/35/EPPI-Reviewer%20Web%20Presentation%20-%202%20July%202021_1.pdf#page=71)
- [育伴港固定版本：待辦例外入口及所載數量](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/tasks/TasksView.tsx#L140-L145)
- 僅連結作者發布，不轉載圖像、商標或範例記錄。

## 相反回報-02｜MediaWiki：在同一項詳情攤開兩份回報

歷史原圖把兩個版本並排、有另外的預覽與提交。對育伴港只借看清來源和分開確認，不照搬預選、合併或覆寫原回報。原因必填是育伴港自身要求。

- [作者來源](https://commons.wikimedia.org/wiki/File:New_design_for_the_Two_Column_edit_conflict_interface,_status_October_2018.png)
- Wikimedia Commons 歷史圖初版 2018，現存圖 2020-09-08，WMDE Max Klemm；官方說明修訂 8195680。兩者不必視作相同 build。
- [Wikimedia Deutschland 作者原圖：兩欄與底部確認](https://upload.wikimedia.org/wikipedia/commons/8/85/New_design_for_the_Two_Column_edit_conflict_interface%2C_status_October_2018.png)
- [MediaWiki 固定文件版本：比較、預覽與提交](https://www.mediawiki.org/w/index.php?title=Help:Paragraph-based_Edit_Conflict_Interface/en&oldid=8195680)
- [育伴港固定版本：歷史回報](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/tasks/TaskDetail.tsx#L31-L58)
- [育伴港固定版本：終態、必填理由和確認](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/tasks/TaskForm.tsx#L88-L105)
- 原圖 CC BY-SA 4.0，保留作者及來源外鏈；本預覽未轉載。

## 驗證

91 題、185 選項、108 外部參考；原 90 題及 146 張圖片不變。靜態完整性、模擬 DOM 開啟／比較／選取／清除、主題搜尋回歸通過。未跑真瀏覽器、產品流程或寫入；沒有發布、合併或替換。

- HTML SHA-256: `8ad3f57795a05003a4680c189c1206e3719ffbd3351ec12f81a5a150dc4246a5`
- HTML bytes: 31028785
- 基準 SHA-256: `5f87c135c2b0379bb8058c628904e9a2debd18f8d4a2535ac919e972584868b9`
