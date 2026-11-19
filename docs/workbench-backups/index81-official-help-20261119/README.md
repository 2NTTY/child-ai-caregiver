# 第 67 題｜官方求助：不等助手回覆，怎樣找到官方入口？

> **版本旁註（2026-11-19）：** 本題保留修訂 17c4289 的歷史畫面比較。[#681](https://github.com/2NTTY/child-ai-caregiver/pull/681) 已從[聊天頂列移除手動入口](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/screens/chatScreen.tsx#L229-L239)，保留[輸入區前的情境求助卡](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/screens/chatScreen.tsx#L296-L302)。以下例子描述歷史快照，不是目前主分支的兩條入口。

假設你想看看香港官方的安全用藥資料，不打算向助手問個別用藥建議。你不必先打一段解釋才有入口；即使已經開始寫，也不必把問題送出才看得到相關卡。這是一個虛構的找資料例子，不涉及真實病況、個案或用藥量。

## 在育伴港，兩條路在哪裏？

以下根據[固定修訂 17c4289c](https://github.com/2NTTY/child-ai-caregiver/commit/17c4289cb7f1bba2cbda5b005b9988359cdacba2)的程式碼；不是產品實機測試。

1. **不想打字：開頁頂「官方求助」。** [工具列的固定入口](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/chatScreen.tsx#L238-L249)可在空白對話使用。主動展開後會列出[緊急求助和醫療與用藥諮詢這兩類固定卡](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/src/shared/agent-feedback.ts#L5-L13)。[手動加入的卡和當前相關卡去重](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/chatScreen.tsx#L158-L173)；收合目錄不等於當前相關卡也消失。
2. **已在寫問題：送出前留意輸入區上方。** 例如在草稿寫「我想找官方的安全用藥資料」。[草稿和適用的本輪文字會用來決定顯示哪些卡](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/chatScreen.tsx#L149-L173)。[匹配看的是既定字詞，空白不觸發](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/src/shared/agent-feedback.ts#L76-L89)，不是評估嚴重程度，也不是每一種寫法都有提示。**沒有出卡不代表毋須求助。**
3. **看到卡、打開來源、送出問題是三件事。** [提示區可捲動、有高度上限](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/chatScreen.tsx#L177-L189)，[在時間線之外、輸入區之前，與「送出」控制分開](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/screens/chatScreen.tsx#L304-L313)。每卡有標題、說明和來源；[由使用者按下才要求開啟相應網址](https://github.com/2NTTY/child-ai-caregiver/blob/17c4289cb7f1bba2cbda5b005b9988359cdacba2/frontend/src/components/chat/OfficialHelpCards.tsx#L14-L23)。沒測試目的站是否載入；出卡或開卡都不表示已致電、送出草稿、聯絡機構或建立記錄。下列外部原件是一般產品支援介面，不是醫療或香港服務來源。

第 35 題是全站功能目錄；第 38 題是收到回答後回查引文；第 46 題是來源系列與版本。這題專看「未提問也可自行找」與「寫到一半便有去處」。

## 原作者畫面與選擇

**求助-01｜Zendesk：未打字，先按類別找去處。** 先看空白搜尋框下面：兩行六個分類框各有標題和一句範圍說明，精選文章在它們之後。這是 Zendesk 的說明中心首頁示例，不是六種危急程度；原圖停在文章清單，沒有頁尾或打開分類後的畫面。育伴港可借它讓人不必先交代情況也能選去向：頁頂常設「官方求助」，按開才列出兩類固定卡，不是把六格擺在聊天首頁。 [看 Zendesk 官方原圖：空白搜尋框下的六個分類（需連網）](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/hc_copenhagen_theme.png)。[Zendesk 官方文件：Copenhagen 預設主題及其示例圖](https://support.zendesk.com/hc/en-us/articles/4408845834522-Using-the-standard-Copenhagen-theme-in-your-help-center)。

Zendesk Copenhagen 預設主題，FineTuning 示範說明中心。官方文件及圖片沒有可核對的主題版本或產品 build。 只連 Zendesk 官方文章及其原圖；沒有逐圖重發授權，不轉載、裁剪或重畫。

**求助-02｜Atlassian：還在寫問題，旁邊已看見相關資料。** 在 Jira Service Management 的請求頁，已填的摘要欄下面有一條文章標題及所屬分類，再往下才是描述欄。箭嘴和說明框是作者註解，不是按鈕；原圖沒顯示提交收據。另附的文章閱讀頁是另一個例子，不是前圖同一篇文章。育伴港可借的是讓支援留在寫問題的位置：自家卡在輸入區上方，不是 Jira 摘要欄下方。育伴港按既定字詞對應固定卡，不沿用 Jira 的文章搜尋，也不會把草稿交給 Atlassian。 [看 Atlassian 官方原圖：摘要欄與相關文章放在一起（需連網）](https://confluence.atlassian.com/servicemanagementserver0511/files/1295811922/1402408484/1/1703038681212/RecommendKBs.png)。[Atlassian 官方文件：在請求摘要中輸入文字時推薦文章](https://confluence.atlassian.com/servicemanagementserver0511/write-search-and-share-knowledge-base-articles-1295811922.html)；[Atlassian 官方原圖：另一篇文章打開後的閱讀頁（非前圖後續）](https://confluence.atlassian.com/servicemanagementserver0511/files/1295811922/1402408485/1/1702956693210/help_center_view.png)。

Atlassian 的 Jira Service Management Data Center 5.11 文件，最後修改於 2024-05-28。5.11 是文件版本，不是已核實的截圖 build。 只連 Atlassian 官方文件及其原圖；沒有逐圖重發授權，不嵌入、裁剪或重畫。

**我會選求助-02作為打字時的提示，保留求助-01作固定入口。** 已在寫問題時，相關卡靠近輸入區才不易錯過；沒想好怎樣問、字詞沒匹配，或根本不想打字時，頁頂仍有確定的去處。兩種入口可以並存。這不是兩種診斷方法，也不是要家長先等助手判斷才可找官方資料。

[Zendesk 商標指引](https://www.zendesk.com/company/trademark-property/trademarks/?cta=trademarks)與 [Atlassian 商標指引](https://www.atlassian.com/legal/trademark)不代表逐圖重發授權。保留完整作者原圖的連結，由讀者選擇是否到原站觀看，不熱連、不當作合作背書。

## 本機驗證與交付狀態

- 本機私用 HTML：`育伴港選配工作台-67主題-官方求助入口外鏈版-20261119.html`，30,944,565 bytes，SHA-256 `feba6a695dd1c4d4d1ef4b7d165d3183937bdfff8b073c801e7daadd37f0e7ad`。本候選以第 66 題已交付且雜湊相符的完整檔案 `dac074270f7c6f3c94efe84eff4ff230a93371006ad422a8a7d59239128f4788` 為基準；本機核對不等於交付。
- 共 67 題、137 款：77 款離線、60 款外鏈。移除第 67 題新增資料後可按位元組還原前版完整資料區。舊版 146 張內嵌圖已逐張解碼及核對 SHA-256。新題只增兩條主要作者原圖連結和三條補充連結，沒有新內嵌素材或自動遠端載入。
- 通過靜態結構、內容安全策略雜湊及 JavaScript 語法檢查。離線閱讀器 VM 通過 69 組檢查，含全 67 題單看／並看、新題連結、選擇／改選／撤回、摘要來回、保留舊選擇、焦點及末頁邊界。沒有操作瀏覽器、真機、帳戶、求助端點、真實 API、模型或產品建置；沒有回寫育伴港、開 PR 或發布 Site。
- 本分支只備份來源和驗證文字，不含完整預覽檔、私用素材或帳戶資料。沒有 PR、合併或發布。
