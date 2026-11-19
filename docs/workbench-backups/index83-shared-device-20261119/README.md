# 第 69 題｜離開共用電腦後：哪些裝置要重新登入？

假設你在社區中心借電腦登入育伴港，回家才想起可能忘了登出。你手上的手機和家中平板都登入了同一帳戶。你想中斷舊電腦的登入，又不想讓家中平板也得重新登入。

**先問一件事：你認得舊電腦那一筆嗎？** 如果認得，A 可以只結束那筆登入；如果清單上幾列看來差不多，且你接受讓平板重新登入，我會選 B。若一定要保住平板的登入，B 就不合適。工作台只記錄你喜歡哪一款畫面的做法，不會查閱或改動裝置。

## 兩個完整畫面怎樣讀？

**裝置-01｜Zoho Accounts：只結束認得的那一筆。** 從左側導覽找到中間的 Active Sessions，再看五筆 Windows 10 登入。它們名稱相同，要用瀏覽器圖示、時間和地點輔助分辨；這些線索不是某人的身分證明。第四列有底色，右端才出現紅色 Terminate，紅箭頭是作者加的說明。它只針對該列；清單上方另有批量動作。若能可靠認出借用電腦的那筆，家中平板就不用跟着重登。代價是要先認對，桌面上還要移到那一列才會看見動作。首列綠點沒有文字說明，不能據此認定是目前裝置。原圖停在操作前；育伴港這個入口不能逐筆登出。 [看 Zoho 官方原圖：桌面設定頁中第四列的終止動作（需連網）](https://www.manageengine.com/identity-360/help/admin-guide/images/troubleshooting-tips-14.png)。[ManageEngine 官方說明：移到指定的 Zoho Accounts 登入列再終止](https://www.manageengine.com/identity-360/help/admin-guide/troubleshooting/session-management.html)；[Zoho 官方問答：在公用電腦忘記登出（不是原圖出處）](https://help.zoho.com/portal/en/kb/accounts/faqs-troubleshooting/faqs/security/articles/i-forgot-to-sign-out-from-my-zoho-account-while-using-a-public-computer-what-should-i-do)。

Zoho Accounts 桌面網頁，出自 ManageEngine Identity360 的同時登入上限說明。未列介面 build 或拍攝日期；Windows 10 和列內日期是示例資料，不是截圖版本。 Zoho Corporation／ManageEngine 官方文件。只連原圖及說明；未確認逐圖重發授權，不嵌入、裁切或重畫。

**裝置-02｜Telegram：保留本次，其餘全部重登。** 先讀 Devices 頁中段的 This device：Samsung 手機下方是 Terminate All Other Sessions，緊接的一行說明這部裝置除外。再往下才是 Active sessions 中的 Dell 筆電和 iPhone。毋須猜哪一筆是舊電腦，也不能只挑其中一筆來執行這個批量動作。套在例子裏，手上手機的本次登入保留，但共用電腦和家中平板的既有登入都會失效；不接受平板重登就先不要選這種做法。頁底閒置多久後自動終止是另一項設定。原圖不是執行結果，育伴港可借用的是動作旁先寫清範圍，而不是照搬裝置清單。 [看 Telegram 官方原圖：本次裝置、批量範圍及其他登入（需連網）](https://telegra.ph/file/p/335e9e7a1c7/6e6b47d082f54a2f5775e19.jpg)。[Telegram 官方截圖目錄：Android「Devices」第 1752 圖](https://translations.telegram.org/screenshots/1752/settings/?mode=screenshots)。

Telegram 官方 Android 截圖 #1752。圖內示例為 Samsung SM-G988N、Telegram Android 8.4.1、Android 7.1.2 (25)。build 已遮蔽，未列拍攝日期；不是目前版本的真機驗收。 Telegram 官方翻譯平台發布的參考圖。只連作者目錄及原圖；未確認逐圖重發授權，不嵌入、裁切或重畫。

## 套回育伴港：哪些會變、哪些不會？

根據[固定修訂 2567253（合併 #681）](https://github.com/2NTTY/child-ai-caregiver/commit/25672533effaf4dbadae31f689af300737181d3b)的原始碼和既有測試文字，本次沒有實際執行帳戶操作或產品測試。

- **已支援的是 B，不是 A。** [「設定 → 登入與安全」有登出本人帳戶入口](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/screens/settingsScreen.tsx#L76-L83)；[「登出其他裝置」是另一個操作](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/components/account/AccountDataControls.tsx#L16-L23)。[這個操作不接收裝置參數](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/src/client/account-auth-api.ts#L24-L28)，沒有給你選一台電腦的清單。不能把 Telegram 的畫面當成育伴港已有這一頁，也別把「登出本人帳戶」當成代舊電腦登出。
- **成功後，手機只保留發起操作的這次登入。** [服務保留本次會話](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/server/firestore-device-sessions.ts#L197-L209)。共用電腦與家中平板同帳戶的舊登入不能再向服務取用資料；另一個人的獨立帳戶不受影響。不是抹掉遠端正在顯示的文字、已下載檔案或定位那台電腦，也不會妨礙其後正常重新登入。[既有合成測試](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/tests/firestore-device-sessions.test.ts#L90-L105)分別覆蓋本次登入、其他登入、其他帳戶及之後的新登入。
- **按過不等於完成。** [用戶端分開成功和錯誤的提示](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/AccountServiceOwner.ts#L225-L230)，亦有[回應遺失的既有測試](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/tests/firestore-device-sessions.test.ts#L126-L134)。收不到結果，不應斷言遠端一定已登出或一定沒登出。作者圖都停在操作前，沒有畫出確認或成功畫面；本題亦不是更改密碼、登入方式或家庭成員權限。

第 28 題問怎樣登入；第 49 題問帳戶可用哪些登入方式；第 42 題談刪除帳戶。這一題只問已登入後的影響範圍：保留哪些登入、其餘哪些要重登。

## 離線版本與驗證範圍

- 私用離線 HTML：`育伴港選配工作台-69主題-共用電腦登入外鏈版-20261119.html`，30,953,158 bytes，SHA-256 `be870976024e1f47885ba8460d499745ec59037a88bb4c5bdf9937484ad647e6`。基準為已交付的第 68 題版（30,948,839 bytes，SHA-256 `1fcab88c9a7b21f11398e589550c7695157b9fa652a5bef1356b605ce0caa8ab`），該版私用文字備份的收件修訂為 `d5d96feec5dd4396c30b1c5c5ea216c74b98cad6`。
- 共 69 題、141 款：77 款離線、64 款外鏈。移除新增記錄後，原資料區逐位元組還原為第 68 題版。原有 146 張內嵌圖按原序逐張解碼核對 SHA-256。本題兩個原圖和三個補充連結都要主動點開；沒有下載、嵌入、重畫或自動載入新圖。
- 已核對離線結構、無 DNS 預取政策、內容安全策略及 JavaScript 語法；不連網的模擬閱讀器通過 75 組檢查，覆蓋全 69 題單看／並看及新題的作者連結、無預設選擇、選取、替換、摘要返回、撤選、焦點與最後一頁的界線。
- 以上是本機組裝時的狀態，不是遠端交付收據。未做瀏覽器／真機驗收、產品建置或登入測試；沒有查閱真實裝置或家庭資料、變更任何登入或調用模型。本分支只備份來源和驗證文字，不含完整預覽檔或私用素材，沒有 PR、合併或公開發布。
