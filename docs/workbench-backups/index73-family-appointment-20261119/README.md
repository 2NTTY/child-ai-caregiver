# 第 59 題｜家庭預約登記：哪天幾點，誰帶孩子去？

**家長已經約好試堂，現在要記下誰帶孩子去，不是再向學校訂位。** 以「星期六下午三時・游泳試堂」為虛構例子。這個選配工作台只有兩款設計可選；不會建立家庭事項、聯絡機構、發訊息或改動權限。

## 育伴港現有流程

前置查核依據是 [master 固定提交 3c02633](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b) 的靜態實作，不是現站測試。選好孩子後，可編輯者在[「待辦與預約」選「手動新增」](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/tasks/TasksView.tsx#L128-L143)，窄屏先打開「操作」。在同頁的「安排事項」對話框填寫標題、選擇「預約」、設定時區和時間、從[合資格的家庭照顧成員](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/tasks/TaskForm.tsx#L60-L86)中選擇負責人；檢視者不是可指派對象。

[草稿預覽](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/tasks/TaskContent.tsx#L65-L71)列出種類、事項、時間和負責人。這時未儲存，仍可退回修改。[勾選核對並在線確認建立](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/tasks/TaskForm.tsx#L94-L105)後，[成功才選取新事項並更新清單](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/task-knowledge-tasks.ts#L132-L145)。這只表示家庭已記下安排，不是機構確認、家人收到通知或答應接送；也不改變誰可閱覽孩子的資料。和第 37 題閱讀既有事項、第 57 題檢查家庭共享範圍是不同任務。

## 兩款設計的取捨

1. **登記-01｜OurFamilyWizard：在同一頁看時間、定接送人。** [桌面原圖](https://www.ourfamilywizard.com/sites/default/files/styles/scale_width_960/public/media/image/2023-04/website-one-time-event.png?itok=qz_cvOhN)在月曆上方顯示單次活動表單，活動為誰而設、誰送去、誰接回分別填寫，兩個接送欄尚未填。[同一產品的手機原圖](https://www.ourfamilywizard.com/sites/default/files/styles/scale_width_480/public/media/image/2023-04/mobile-one-time-event.jpg?itok=0RAQu3Dt)顯示已指定接送的狀態，並非下方欄位全都入鏡。[官方教程](https://www.ourfamilywizard.com/knowledge-center/tips-tricks/parents-website/one-time-events#:~:text=Creating%20a%20One-Time%20Event)解釋欄位。育伴港可在時間旁明確寫「負責人：照顧者乙」，不必增加兩個接送欄。這是辨認分工的優先選擇。媒體目錄標示 2023-04，未提供產品組建號；[權利條款](https://www.ourfamilywizard.com/legal/terms)不構成重刊許可。
2. **登記-02｜AppClose：逐步核對對象，再回看時間。** [第一張手機原圖](https://support.appclose.com/hc/article_attachments/30836914334619)把活動對象、所屬日曆、分享對象分行列出；分享對象不是接送人。[下一張原圖](https://support.appclose.com/hc/article_attachments/30836899170459)保留標題並展示可改的起訖時間，是後續編輯頁而不是完整的草稿核對頁。[作者教程](https://support.appclose.com/hc/en-us/articles/30836914343451-How-do-I-create-an-event)標示 2024-11-11 更新。這款適合窄屏參考：同一標題一路保留，預覽時能回頭核對時間；不能由參考推斷育伴港可逐筆更改分享範圍。[AppClose 條款](https://appclose.com/terms)保留圖片權利。

前置查驗由作者公開原站辨認畫面，不下載到交付檔、不熱連圖片、不鏡像，不使用示例中的姓名、照片、地點或行程。[GOV.UK 的核對答案示例](https://design-system.service.gov.uk/patterns/check-answers/default/)可補充說明返回修改的方式，是 HTML 示範，不是第三款設計，亦不計入工作台原圖。全部原圖只有點連結才會離開離線檔。

## 檔案與驗證

- 私用 HTML：`育伴港選配工作台-59主題-家庭預約登記外鏈版-20261119.html`，30,913,093 bytes，SHA-256 `38710b4493709df863ffffe897e6be943e8657c5f234dccbf4038a235b53ffad`。基準是第 58 題私用交付檔 `78e22c2d32af22dd3dd9c0046ad30e16b722e7aa6b93afbfc9d2729816a21535`。
- 59 題、121 款（77 款離線、44 款外鏈），146 張既有離線圖片不變。移除新增的一題後，原有完整資料區可逐位元組復原。146 張舊圖逐一解碼核對 SHA-256；新增選項只有 2 個主要原圖連結、2 個補充原圖連結和 2 個作者教程連結，沒有新增嵌入素材。
- 靜態驗證、內容安全政策摘要、腳本語法均通過；離線 VM 的 45 組核對通過，包括全 59 題單看／並看、新頁原圖標示、選取／改選／撤回、摘要往返、原有選擇、焦點及末頁邊界。VM 不開啟外鏈。未啟動瀏覽器、未做手機或產品端實機驗收、未操作真實表單、未建立機構預約、未發送家庭訊息、未發布預覽。
