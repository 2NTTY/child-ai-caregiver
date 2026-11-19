# 育伴港選配工作台｜第 64 至 66 題來源及檢查備份

只備份原件連結、原始碼版本與驗證紀錄。工作台為累積版本，66 題版保留前兩題；完整 HTML 保存於私人 Library，不附在 GitHub，不改動現有公開預覽。

## 第 64 題｜短期脈絡：昨天沒談完的事，今天怎樣接著說？

昨晚已列好郊遊要帶的東西，只差集合時間。今天拿到通告，要先在幾件工作中認出那一件，再決定怎樣補答。這是虛構例子，不是真實的通告或家庭資料。A 比較「找到正確的工作」；B 比較「訊息已進草稿，仍可改」。這份文字只供選設計，不會打開助手或送出訊息。

### 育伴港現有流程

依據[固定修訂 3c02633a](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)核對程式碼，沒有執行產品或模型。

1. **先找哪一件。** 在本人工作區選好孩子，進[記憶](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/memoryScreen.tsx#L16-L36)，再選[短期脈絡，查看工作事項](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/memory/MemoryReferenceView.tsx#L389-L419)。正式資料按[本人和孩子讀取，可載入更多](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/usePersonalHistory.ts#L113-L123)；這個入口不是[所有近期對話的逐字稿](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/usePersonalHistory.ts#L202-L219)。
2. **看上次停在哪。** [收合時看目標和狀態；展開時看焦點和待答問題](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/history/PersistentWorkCards.tsx#L21-L46)。待核數量、接續原因、時間等只在有資料時顯示；不在這裡批准變更。[助手已結束工作](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/history-view-model.ts#L85-L91)不等於家長已完成準備。
3. **由家長補答。** 同一工作區的[工作和版本吻合](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/memory/MemoryReferenceView.tsx#L393-L403)才準備續談；問題使用[目標、已有焦點和待答事項](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/history-view-model.ts#L89-L91)。回助手是[前往聊天輸入區](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/ProductionProvider.tsx#L124-L129)，[已有文字先保留，空白才帶入問題](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/ProductionProvider.tsx#L154-L160)。不會自動寄送、重跑工作或覆寫原稿，也不能理解成重開原本那條聊天串。

第 25 題是已確認的長期事實，第 40 題是找匯入對話的原文。這次要認出的是助手留下哪一個未解問題，而不是查找曾經說過的每一句話。

### 原作者畫面與取捨

**續談-01｜AptiveAI：先找正等你決定的那一項。** 看中間清單：上方 Needs you 把待答的發票工作 #4821 提出來，下面仍看得見已完成的夜間服務請求和進行中的供應商檢查。#4821 的摘要點出發票已逾期 34 天，問是否先擬提醒；問題後半被截斷。最右側停靠的是另一份「每週逾期發票報告」，不是 #4821 的詳情，也不能用它的輸入框證明如何回覆 #4821。可借中欄的目標、狀態與待答摘要；回到郊遊例子，家長點開後應讀得到完整問題。 [看 AptiveAI 作者原圖：中間清單哪一項還在等答覆？（需連網）](https://docs.aptiveai.io/_astro/task-beside-page-dark-20261014.CUTnnnEC_Z1XHeIU.webp)。[AptiveAI 官方文件：Tasks／Beside the page](https://docs.aptiveai.io/concepts/tasks/#beside-the-page)。

AptiveAI（ClusterCode LLC）文件的桌面示範。原圖 2880 × 1620；檔名帶 20261014，未標正式發布日或產品版本。 工作台只連作者原圖及文件。未核實開放轉載授權，不收錄圖片。

**續談-02｜Google Gmail：有字在回覆框，不代表已送出。** 從動圖一輪的開頭算起：約第 3 秒，原信追問星期日十時是否如期推出；約第 16 至 18 秒，選中的建議已放進回覆框，末行有游標，鍵盤仍開著，畫面提示可以 Undo，頂部送出鍵還在。全片沒有寄出。這是「選建議後插入」，不是打開工作就會預填。育伴港可借這些線索，讓家長看清現在可以補上集合時間；不是替家長確認一個未知答案。這段影片也沒有示範保留舊草稿。 [看 Google 官方手機動圖：先看第 3 秒，再看第 16 至 18 秒（需連網）](https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEipFFTzJrzJxq6q0fPscji9cHsoGHtYPslE9Eeoln8nfBWVIDv54e3cGyeOvYGay7RbaDatNaitXRy_YDYV9GHzSgMYg7NORg6mOrlpLkngY3JfmLhL3rNvGM6hSMidGU_RXEFA2yRWBF17DFdGq-k03RhB6MAPkkJUQeQUqz8s0h556iV8A3HYG8T-wtg/s16000/cropped-Get%20reply%20suggestions%20with%20Gemini%20in%20Gmail%20.gif)。[Google Workspace 原公告：Gmail 的情境式回覆建議](https://workspaceupdates.googleblog.com/2024/09/contextual-smart-replies.html)；[Gmail 官方說明：選擇、編輯和傳送是分開的步驟](https://support.google.com/mail/answer/15464729?hl=en)。

Google Workspace 團隊在 2024-09-26 發布的 Gmail 手機示範，GIF 一輪約 22 秒；不是現版實測。 工作台只連 Google 原始動圖、公告及說明。未核實開放重發授權，不截取影格或內嵌動圖。

**我會先選續談-01。** 家長隔天回來，最怕答錯了另一件事。A 的清單先讓人認出「郊遊物品」和「還欠集合時間」，不用逐條重讀昨天的訊息。若要說明「按回助手後，我還可以改嗎」，B 的游標和仍未按下的送出鍵反而更清楚。挑 A 不是要搬入多視窗，挑 B 也不是要接 Gmail 或替家長代答。

兩個原件於 2026-11-19 UTC 核對。A 是 2880 × 1620 的完整桌面原圖；B 是 Google 作者原 GIF，406 × 819，一輪約 22 秒，開啟後按相對秒數觀看。不把商業產品畫面當成育伴港實機驗收。[AptiveAI 條款](https://aptiveai.io/terms)與 [Google 品牌指引](https://about.google/brand-resource-center/guidance/)均未在此解讀為特定媒體的開放重發授權；工作台不自動載入兩個原件。

### 本機檔案與驗證範圍

- 私用 HTML：`育伴港選配工作台-64主題-短期脈絡續談草稿外鏈版-20261119.html`，30,932,002 bytes，SHA-256 `6f6f63bd525b085ce62ebd629be7bad83bd1a584936b79120ee4131ae0024f90`。63 題版本機核對基準為 `14c3a50cb21c9ed85804b994b29551ee7a467a307e4a72d1a9e3cbad17c4410f`。
- 共 64 題、131 款：77 款離線、54 款外鏈。從新版資料區移除第 64 題新增的位元組，即可逐位元組還原前版完整資料區；146 張舊圖均經解碼、逐張核對 SHA-256。新題只有兩個主要作者原件（桌面原圖、手機動圖）及 3 個補充連結，沒有新增任何內嵌圖片或遠端自動載入。
- 靜態、CSP 雜湊與 JavaScript 語法通過；離線 VM 通過 60 組檢查，包括全 64 題單看／並看、新題連結、選取／改選／撤回、摘要往返、保留舊選擇、焦點狀態及末頁邊界。VM 只模擬工作台閱讀器，不會開原站。沒有瀏覽器、真機、登入、實際恢復工作／開啟草稿、傳送訊息、模型、TypeScript 或產品匯出測試；沒有變更育伴港或發布預覽。

## 第 65 題｜班級歸屬：這一班由誰管理，移出後誰接手？

假設海星班一直由晨光教師空間共同管理，而林老師準備獨立接手。交接中途，另一位老師還能打開海星班嗎？**如果只是指定林老師，仍按原教師空間的權限；林老師本人接受後，才改由他獨立管理。** 如果現任管理員自己接手，則在確認後直接生效。這裡的班級、人名及空間均為虛構。這份參考供教師端版面選擇，不是操作真實帳戶。

### 在育伴港找班、查歸屬、看交接

依據[固定修訂 3c02633a](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)的程式碼及已有測例，而非實機測試。

1. **哪個空間有這一班？** [教師頁由選中的教師空間列出所屬班級](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L121-L137)。可按班名進名冊、續看更多班；[正式控制器](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/SharingController.ts#L201-L212)按所選空間讀取。它不是所有獨立班的清單。打開管理頁[不會切換孩子](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L68-L75)。
2. **目前誰管？** [班級頁](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L200-L223)會表明這班獨立使用，還是跟隨具名教師空間，以及管理角色從何而來。反方向把獨立班加入空間時，[要核對目的地及原有班級成員改按上層權限，再次確認才提交](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L269-L273)。這不是逐人權限差異預覽。
3. **指定了，是否等於辦妥？** [由現有成員選接手人](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L203-L215)。[選他人只記待接手，由指定本人接受；管理員選自己則確認即生效](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/server/firestore-sharing.ts#L503-L539)。[完成才解除原空間的管理關係，建立獨立管理身分](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/server/firestore-sharing.ts#L226-L234)。孩子和資料仍在同一班；[已有測例](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/tests/class-teacher-space.test.ts#L119-L132)檢查原件可讀、其他舊空間成員失去存取及上層名單移除該班。本次只讀測例，沒有執行、送通知或驗收真實權限。

第 12 題看班內孩子名冊；第 51 題看一個人加入的邀請；第 57 題看一個孩子共享哪些資料。這題改變的是整個班的管理歸屬，不是把孩子轉校、搬名冊或複製記錄。

### 原作者畫面與選擇

**歸屬-01｜Seesaw：先看這所學校有哪些班。** 從頁首認出 Bayside School of Excellence，再往下看已選中的 Classes 分頁。搜尋和篩選下面，Art Monday、Art Thursday 各佔一列；兩列在同一個具名學校之下。原圖保留了工作區頁首、導覽及班表上段，沒有展開全部 36 班，也沒有選中某一班。借它讓老師在晨光的班表找到海星班，再進班核對管理來源。教師人數不是班主身分；這畫面不能告訴你誰將接手。 [看 Seesaw 官方原圖：從學校名稱看到所屬班級（需連網）](https://help.seesaw.me/hc/article_attachments/37939909371149)。[Seesaw 官方說明：The Classes Tab，可按班名進入](https://help.seesaw.me/hc/en-us/articles/115003657043-How-to-use-the-School-Dashboard)。

Seesaw 管理員網頁版，官方 School Dashboard 說明的 Classes 分頁原圖；作者未標圖片日期或產品版本。 只連到 Seesaw 原圖及官方說明。未確認可轉載，不內嵌截圖或複製班表。

**歸屬-02｜Autodesk Fusion Team：移出前核對原屬、去向和影響。** 看講義第 8 頁上方 Figure 7。左邊的瀏覽器工作區仍可見 EAGLE-Team、專案清單及該列的移轉選單；旁邊疊上 AU2021 ECAD-MCAD 的交接資料。先對照來源和目的地，再讀項目與分享連結會怎樣，最後才繼續。圖說把目的地指為 Melanie 的團隊。這是原作者把完整瀏覽器工作區與移轉細節組成的合成圖，不是單張未加工的全螢幕截圖。圖中沒有接手人接受的狀態；下方 Figure 8 也不是交接回執。育伴港應清楚分開「目前：晨光」「擬接手：林老師」「林老師已接受」；指定不等於接手。Google Classroom 的官方文字另有同類區分，不是這張圖的內容。 [看 Autodesk 作者講義第 8 頁上方 Figure 7（需連網；可放大）](https://static.au-uw2-prd.autodesk.com/Class_Handout_CP500009_ClassHandout-CP500009-Thilo-AU2021.pdf#page=8)。[Autodesk University 原課程：作者、年份與講義](https://www.autodesk.com/autodesk-university/class/Smart-Design-Mechanical-Components-and-PCBs-Seamless-Workflow-2021)；[Google Classroom 官方文字：對方接受前，原教師仍持有班級（非截圖）](https://support.google.com/edu/classroom/answer/7449476?hl=en)。

Autodesk University 2021，課號 CP500009，Melanie Thilo 與 Richard Hammerl 的桌面操作示範；若 PDF 沒定位，請手動翻到印刷頁碼 8。不是現版產品驗收。 只連 Autodesk 原講義及課程，不重載 PDF 或擷取插圖；未確認開放轉載授權。Google Classroom 只作文字佐證，不是第三款設計。

**我會選歸屬-02，用在真正準備移出的一刻。** 如果一指定林老師就顯示「已獨立」，同事便會以為自己已經失去存取，林老師也可能以為不用回應。把「現在誰管」放在「將由誰接手」旁邊，直到接受才換掉前者。選自己接手則不應顯示虛假的等待。若日常任務只是在教師空間找班級，A 的具名清單更短，不必每次查班都打開移出程序。

第 8 頁 Figure 7 是跨行業的核對版面，不是育伴港的權限規格。Google Classroom 官方文字能佐證「指定」和「接受」是兩件事；Google 原教師最後成為共同教師的規則不能跟着搬過來。此處只連作者原件，不轉載圖片或 PDF。

### 本機驗證與交付狀態

- 本機私用 HTML：`育伴港選配工作台-65主題-班級歸屬與接手外鏈版-20261119.html`，30,936,135 bytes，SHA-256 `4713c792ec46e9aa3c0f19ea5bfbf5de98788d3d79ae2415b33c53f344355fb7`。本候選以已在本機核實的第 64 題完整檔案 `6f6f63bd525b085ce62ebd629be7bad83bd1a584936b79120ee4131ae0024f90` 為基準；本機核對不等於交付。
- 共 65 題、133 款：77 款離線、56 款外鏈。移除第 65 題新增資料後可按位元組還原前版完整資料區。舊版 146 張內嵌圖已逐張解碼及核對 SHA-256。新題只增兩條主要作者原件連結和三條補充連結，沒有新內嵌素材或自動遠端載入。
- 通過靜態結構、內容安全策略雜湊及 JavaScript 語法檢查。離線閱讀器 VM 通過 63 組檢查，含全 65 題單看／並看、新題連結、選擇／改選／撤回、摘要來回、保留舊選擇、焦點及末頁邊界。沒有操作瀏覽器、真機、帳戶、實際權限、真實 API、模型或產品建置；沒有回寫育伴港、開 PR 或發布 Site。

## 第 66 題｜助手代記授權

假設你只想說「幫我記低今天的午睡」，不想讓助手改以前的時間，也不想它為你開待辦。可以只准新增睡眠，不開另外兩項。但**准許代記**和**誰能看到記下來的內容**是兩個問題。「日常備註」是照護記錄，按這個孩子原有的家庭權限可見；「本人私人備註」才是只給自己看的備註。這個例子是虛構的，沒有使用任何家庭資料。

### 在育伴港，甚麼時候才生效？

依據[固定修訂 17c4289c](https://github.com/2NTTY/child-ai-caregiver/commit/17c4289cb7f1bba2cbda5b005b9988359cdacba2)的程式碼查證；不是本輪實機測試。

1. **先核對自己和孩子。** 在[設定的「助手」分頁](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/settingsScreen.tsx#L29-L34)，[要先選定孩子](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/settingsScreen.tsx#L101-L103)。[代記政策按本人與孩子分開](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/server/firestore-agent-actions.ts#L46-L63)。沒有舊設定時，初始為未啟用、各項關閉；[讀取失敗則不能保存](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/production/AgentAuthorization.tsx#L42-L49)。這兩種狀態不能混為一談。
2. **逐項選想交給助手的事。** [日常備註、餵食、睡眠、換片](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/production/AgentAuthorization.tsx#L17-L20)都是照護記錄類別，不是私人便箋。[本人私人備註、修改自己的原記錄、分派給本人的待辦各有控制](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/production/AgentAuthorization.tsx#L42-L58)。只想代記新睡眠，就不必把改舊記錄或待辦一起打開。分派給本人也不是只有本人能看的保證。
3. **家庭可見的寫入須多一次同意。** [選了照護記錄類別、修改原記錄或本人待辦，就須確認共享影響](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/src/shared/agent-actions.ts#L7-L19)，才能保存這組授權。[改選會清除已給的確認](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/production/AgentAuthorizationOwner.ts#L90-L97)；[保存完成後重新讀取目前設定](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/production/AgentAuthorizationOwner.ts#L184-L199)。這不是逐筆寫入的確認，也不是讓家長改誰有家庭存取權。
4. **保存授權不會新增一筆午睡。** [日後實際代記時仍須有互動工作和本人的明確交代，再核對權限和政策版本](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/server/firestore-agent-actions.ts#L189-L219)。[系統整理的是本人陳述，並非把私人備註或陳述升格為已確認事實](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/server/firestore-agent-actions.ts#L225-L235)。隨口提到午睡不等於請助手寫入。

這題看「以後我交代時，助手可記甚麼」。第 26 題看「這次提出的更改是否接受」，第 33 題看「可否聯絡本人」，第 57 題看「哪些家人可看某個模組」。三者都不代替助手的代記授權。

### 原作者畫面與選擇

**代記-01｜Google：准許記一筆，不等於可以改舊記錄。** 看 Health Connect 的完整手機授權頁：同一資料類別的讀取和寫入各有一格，兩格都未勾，底部才是拒絕或允許。另一組官方測試圖以四屏並排顯示變化，中間兩屏分別為兩項全關、兩項全開，沒有一開一關的畫面。可借的是逐項決定的方式：讓家長只開新增睡眠，保留「修改我原有的記錄」和「新增分派給我的待辦」為關閉；不是要在育伴港增設醫療讀取功能。原圖沒有孩子或家庭可見範圍。 [看 Google 官方手機原圖：同一資料類別的兩個未勾選項（需連網）](https://developer.android.com/static/codelabs/health-connect/img/4752973f6b0b8d56.png)。[Android Developers 官方教學：Permission control](https://developer.android.com/codelabs/health-connect#2)；[Google 官方原圖：兩項全關和全開的分別（四屏並排）](https://developer.android.com/static/health-and-fitness/health-connect/test/images/hc-04-02.png)；[上述四屏的官方測試說明：04-02](https://developer.android.com/health-and-fitness/health-connect/test/test-cases)。

Android Developers 的 Health Connect Codelab 及官方測試指南；圖中沒有可核實的作業系統或應用版本。 只連 Google 官方教學、測試說明及原圖；不轉載、裁剪或重畫畫面。

**代記-02｜Proton：先分清誰看得到，再保存授權。** 看整個 Drive 檔案頁：分享視窗內，檔案、收件人和選好的角色放在一起，底部仍有 Back 和 Share，尚未提交。另一張角色選單原圖說明 Editor 的權限；那是另一個檔案的管理畫面，不是接續上一張的成功收據。育伴港可借這個排列，讓家長保存前對照「只供我看的私人備註」和「按家庭原有權限可見的日常備註」。分派給本人的待辦也屬須確認共享影響的項目，不能當作私人備註。Proton 沒有示範育伴港額外的共享確認，也不是要家長邀請收件人或改家人角色。 [看 Proton 官方原圖：按 Share 前的整個檔案頁（需連網）](https://res.cloudinary.com/dbulfrlrz/images/w_1024,h_539,c_scale/f_auto,q_auto/v1778671454/wp-pme/share-file-email-confirm/share-file-email-confirm.png?_i=AA)。[Proton 官方說明：提交前選擇對象及角色（第 3 至 4 步）](https://proton.me/support/drive-how-to-share-files-via-email)；[Proton 官方原圖：另一檔案的角色選單](https://res.cloudinary.com/dbulfrlrz/images/w_1312,h_1122,c_scale/f_auto,q_auto/v1784809302/wp-pme/drive-share-access-2/drive-share-access-2.png?_i=AA)；[角色選單的官方說明：管理已有存取權的人](https://proton.me/support/drive-manage-access-shared-files)。

Proton Drive 網頁版，兩篇官方支援文章的不同示例；圖片由文章所用的 Cloudinary 媒體服務提供，未標示可核實的產品版本。 只連 Proton 官方文章及其原圖，不轉載截圖或示範收件人資料。

**我會選代記-02。** 家長容易選錯的不是「睡眠」，而是看到「備註」就以為只有自己能看。先並列「依既有權限給家人看」和「只給我看」，再用 A 的分項做法列出助手可新增或修改甚麼。家長不必為了代記午睡而准許改舊記錄或開待辦；取消共享確認後也不能誤存。這是設計建議，不是產品已有兩套可切換的授權介面。

### 本機驗證與交付狀態

- 本機私用 HTML：`育伴港選配工作台-66主題-助手代記授權外鏈版-20261119.html`，30,940,446 bytes，SHA-256 `dac074270f7c6f3c94efe84eff4ff230a93371006ad422a8a7d59239128f4788`。本候選以已在本機核實的第 65 題完整檔案 `4713c792ec46e9aa3c0f19ea5bfbf5de98788d3d79ae2415b33c53f344355fb7` 為基準；本機核對不等於交付。
- 共 66 題、135 款：77 款離線、58 款外鏈。移除第 66 題新增資料後可按位元組還原前版完整資料區。舊版 146 張內嵌圖已逐張解碼及核對 SHA-256。新題只增兩條主要作者原件連結和六條補充連結，沒有新內嵌素材或自動遠端載入。
- 通過靜態結構、內容安全策略雜湊及 JavaScript 語法檢查。離線閱讀器 VM 通過 66 組檢查，含全 66 題單看／並看、新題連結、選擇／改選／撤回、摘要來回、保留舊選擇、焦點及末頁邊界。沒有操作瀏覽器、真機、帳戶、實際權限、真實 API、模型或產品建置；沒有回寫育伴港、開 PR 或發布 Site。
