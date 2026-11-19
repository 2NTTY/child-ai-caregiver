# 第 68 題｜通知預覽：有新回覆，手機上要顯示多少？

假設你接孩子時把手機放在桌上。你想知道助手有新回覆，但不想旁邊的人看見你們談過甚麼。兩款設定頁都保留提醒，分別解決兩個問題：**App 有沒有附上聊天文字？如果有，手機鎖定時會不會顯示？**

## 先分清楚：沒有附上，還是暫時遮住？

- **希望通知始終不帶聊天文字：** 保留這部裝置的聊天通知，關掉內容預覽。即使解鎖，那則通知也沒有聊天正文可以顯示。你仍可以在育伴港打開原來的對話閱讀回覆。這不等於隱藏 App 名稱、時間等所有提示資料。
- **希望只在鎖定時遮住：** 如果 App 有附上預覽文字，而且手機提供並已設定相應的鎖定畫面選項，解鎖後才有機會在通知看見內容。手機只控制已收到的內容怎樣顯示；無法補回 App 沒有附上的正文。
- 對這個虛構家庭，我會先選 **A**。家長在意的是旁人看不到正文，並不打算解鎖後直接從通知閱讀。如果習慣解鎖後先掃一眼再決定要不要打開聊天，**B** 的說明會更有用。以下是比較設計，不是叫工作台替你改設定。

## 育伴港現有的做法

根據[固定修訂 2567253（合併 #681）](https://github.com/2NTTY/child-ai-caregiver/commit/25672533effaf4dbadae31f689af300737181d3b)的程式與既有測試文字，不是真機驗收：

1. 在[設定 → 通知](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/screens/settingsScreen.tsx#L93-L101)看[本人的裝置推播，不是 Telegram 或全家的設定](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/SettingsDomains.tsx#L106-L120)。[聊天提醒與內容預覽分開](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/components/notifications/ChannelCards.tsx#L215-L227)：須有已綁定且支援的裝置，並已開啟相應聊天通知，才談得上切換預覽。這版 Android 的說明是開聊天提醒時會一併開預覽，之後可再關掉；不是保證一律預設隱藏。[Android 原生實作](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/useProductionPushSettings.native.ts#L119-L142)及[主畫面 App 的動作](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/useProductionPushSettings.ts#L158-L175)不等於所有手機或桌面瀏覽器都支援相同功能。
2. [服務端按每個訂閱決定是否附上預覽文字](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/server/firestore-chat-notification-policy.ts#L75-L83)；[既有合成測試分別核對兩個裝置的有預覽及一般提醒，並指向原對話](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/tests/firestore-native-chat-push.test.ts#L215-L236)。這不是送達收據。育伴港的 App 預覽偏好和手機本身的鎖定畫面是不同層次；下面的 B 是設計參考，不是育伴港額外提供了「解鎖才顯示」的開關。

第 16 題問何時靜音，第 41 題問事後怎樣回看，第 47 題問怎樣開通推播；這裏是「保留提醒時，要不要露出聊天文字」，不影響其他家庭成員的權限，也不代表對方已讀。

## 兩款原作者畫面怎樣選？

**預覽-01｜LINE：照樣提醒，不附聊天文字。** 看同一個「通知」設定頁：頂部總通知開關是綠色，下面聊天通知區的「訊息通知內容顯示」是灰色關閉。兩者可以不同；旁邊的鈴聲和縮圖又是別的項目。指尖是作者註解，不是按鈕。另一張原圖顯示同一項目開啟，兩張都不是鎖定畫面的結果。育伴港可借的是把「收不收提示」與「提示中有沒有正文」分開說。關掉預覽並非關掉聊天提醒，也不等於隱藏 App 名稱或時間；不照搬 LINE 的頭像或縮圖行為。 [看 LINE 官方原圖：保留總通知、關閉聊天正文（需連網）](https://guide.line.me/ja/notification-android_16_2.png)。[LINE 日本官方指南：Android 通知與預覽的設定步驟](https://guide.line.me/ja/account-and-settings/setup-android.html)；[LINE 官方原圖：同一個內容開關開啟時](https://guide.line.me/ja/notification-android_14_2.png)；[LINE 官方繁中說明：通知相關用語（非原圖版本依據）](https://help.line.me/line/smartphone/sp?contentId=20011381&lang=zh-Hant)。

LINE Android 日本官方指南，頁面標示 2023-06-23 更新；無法從此圖核實 LINE build 或 Android 版本。 LINE 官方指南頁尾標示 © LY Corporation。只連作者文件和原圖，沒有逐圖重發授權，不嵌入、裁切或重畫。

**預覽-02｜SHARP AQUOS：鎖定時遮住，解鎖後再看。** 在鎖定畫面設定的最後一步，三個單選項依次是顯示所有通知內容、只在解鎖後顯示私密內容、完全不顯示通知，下面才是「完成」。原圖選中第一項；中間那項是可選而未選，黃色指尖是作者註解。若只想在手機鎖住時保留提示但遮住細節，看中間項而非第三項。它管的是系統視作私密的內容，不保證每個 App 的所有文字都會被遮住。即使選了中間項，App 沒附上的聊天文字，解鎖也不會出現在那則通知。 [看 SHARP 官方原圖：鎖定時的三種顯示選擇（需連網）](https://k-tai.sharp.co.jp/support/d/sh53a/userguide/webver/img/02_01_sc_rock_06.png)。[SHARP 官方操作指南：設定畫面鎖定的最後一步](https://k-tai.sharp.co.jp/support/d/sh53a/userguide/webver/m_02_01.html)；[SHARP 同型號指南 PDF：末頁載有 Android 版本及刊行時間](https://k-tai.sharp.co.jp/support/d/sh53a/userguide/pdf/AQUOS_sense5G-GuideBook_web.pdf)。

SHARP AQUOS sense5G SH-53A，Android 11 對應版。指南資料截至 2021-01、2021-02 刊行；廠方教學示意，未列特定韌體 build，不代表所有現款手機。 SHARP 指南末頁有限制轉載說明。只連作者原件，沒有逐圖重發授權，不嵌入、裁切或重畫。

## 本機驗證與交付狀態

- 私用離線 HTML：`育伴港選配工作台-68主題-通知預覽私隱外鏈版-20261119.html`，30,948,839 bytes，SHA-256 `1fcab88c9a7b21f11398e589550c7695157b9fa652a5bef1356b605ce0caa8ab`。基準是已交付的第 67 題日期註記版（30,944,565 bytes，SHA-256 `feba6a695dd1c4d4d1ef4b7d165d3183937bdfff8b073c801e7daadd37f0e7ad`）；其私用文字備份收件紀錄為 `b2500b57d0f4105fac021637ce6a1b30aec33b9c`。這是前版的收件證明，不是本版已交付。
- 共 68 題、139 款：77 款離線、62 款外鏈。移除第 68 題新增資料後，資料區完全還原第 67 題日期註記版；保留 #681 的兩個歷史旁註。舊有 146 張內嵌圖逐張解碼核對 SHA-256。本題只有兩個主要及五個補充作者連結，均須主動點選；沒有新增內嵌或自動載入的圖片。
- 已核對靜態結構、內容安全策略、JavaScript 語法。使用不連網的模擬閱讀器，通過 72 組檢查，含全部 68 題的單看／並看、本題的逐條原件連結、初始沒有選擇、選取／改選／撤回、摘要往返、保留既有選擇、焦點與末頁邊界。沒有做瀏覽器或真機驗收、TypeScript 檢查、產品建置或匯出；沒有使用真實家庭資料、帳戶、模型或推播。
- 本分支只備份來源及驗證文字，不含完整預覽檔、私用素材或帳戶資料。沒有 PR、合併或公開發布。
