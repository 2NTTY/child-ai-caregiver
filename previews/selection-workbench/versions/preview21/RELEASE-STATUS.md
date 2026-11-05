# 選配工作台 preview21 · 日期驗收補充

截至 **2026-11-05 17:24 UTC**，preview21 的 MR01 記憶閱讀、CI01 引用閱讀已完成下列工作台入口與閱讀檢查；補驗也讀完指定長頁尾。**整體原生驗收仍為 INCOMPLETE**：較長瀏覽場次曾出現 Chromium code 9，短場次未重現，原因未明。這是精確版本的有界結果，不是全產品通過、發布批准或新功能。

## 這份版本包含甚麼

- 原應用 **233 檔、18,193,753 bytes** 完全保留。本說明及 RELEASE-MANIFEST.json 是另加兩檔；同一公開目錄合計235檔，不把補充檔算進應用分母。
- 原公開 manifest SHA-256：**9838850d793e03018cd0420aa049d2734ae305bd1a506689a5ed59856227daa6**。RELEASE-MANIFEST.json 內嵌其完整內容、原大小及雜湊，列出233個公開路徑與逐檔 SHA-256。
- **23候選／22個有候選模組**是可開啟的合成互動範例；**88盤點邊界**是清冊範圍，並非88個已完成模組；**94去重研究URL**是參考資料筆數，並非94種設計或通過項目。原創19方向共38布局，另有4個來源擷取／呈現組合；每個A／B共用同一合成宿主、只計一個候選。
- 四個來源組合為 Care 最近通知 N01、Care 未送出文件附件托盤 A01、Handbook 歷史分類框架 HF01、Care 首頁閱讀組合 HC01，各有自己的邊界，不是四套全站拼接，也不是23套完整產品。SL01、CD01、PC未納入本版。
- 相比preview20：217原檔逐bytes不變；僅README.md、catalog-data.js、index.html、modules.json、sources-data.js五檔改動；新增MR六檔36,975 bytes及CI五檔28,078 bytes，共65,053 bytes，皆原樣接入其固定來源。此補充沒有再改這233檔。

## 從哪裏開始，哪些可操作

從 [index.html](index.html) 進入工作台，可搜尋、組合篩選、展開清冊，再按候選入口。MR01可切換「三室索引館／核對案卷」，閱讀分開的facts、private context、reference；準備內容只建立本地合成草稿並保留原稿。CI01可切換「正文旁註／來源分類卷宗」，開啟詳讀並返回原標記；複製、外開仍為disabled，example.invalid只作格式示例，不外開。引用存在不等於內容真實、醫療證據或來源可達。

- MR01入口：[modules/memory-reading/index.html](modules/memory-reading/index.html)。採用hover-fix02，來源seal SHA-256：0ce028310c9fdc637c02c7918319ccc4737af1ca6448bc807493dbf9e50880ab；該修訂獨立覆核與有界原生hover記錄：6a933f2f34de011c1fa588617efa861c0526279d2eede281cb5433bdcfaec86d。舊漏檢與history觀察修正不被抹去；窄屏native hover未成立。
- CI01入口：[modules/citation-reading/index.html](modules/citation-reading/index.html)。採用fix01，來源seal SHA-256：bd53bee91ed86ad680c67975c4081563ffcdfcf49cb01a70d263d023d36a5877；獨立來源覆核：3af98b5af300066097294393bbe238e544cd314740fb27c35d2f8269ac146d05；兩段原生記錄依序為0f6e8c12095e7d6b77c96367bab15ea5f80cf9a01fab7908645308a8449f7c77、00f91db1acb381c9e93881425ae2531ad7c9d22ffe3ddc2cc8cdbcbf7e93ced7。第一段仍是局部結果；第二段補足其指定範圍，未完成項目不升級。

## 本版實際觀察到的範圍

- 根HTTP與真正HTTP子路徑的MR／CI卡片、清冊入口、相對資產及A／B內容可用。
- 各自代碼配正確分類及「已有互動候選」顯示一筆；改為待逐批加入有明確空結果；清除回復88項並把焦點送回搜尋。
- 真正跨頁Back／Forward的指定樣本保留工作台篩選、展開卡片與入口焦點；CI第二個同號標記經Escape或返回可回到同一標記。不承諾候選內部閱讀狀態持久化，不證明BFCache命中。
- 實際桌面1180×757，以及320／390 CSS iframe的新卡片、焦點外框、變更說明和長研究文字有界可讀；清冊長文只抽查MR390與CI320，不是完整二乘二矩陣。九個相關研究條目包含六個新URL及三個沿用URL；沒有因本輪而重訪外部來源。
- 原較長場次在320頁尾展開後已有成功畫面，下一次向下捲動後瀏覽器顯示code 9。新短場次重走該320路徑，並補390長頁尾及桌面末端，未重現故障、指定內容可讀且沒有所測水平溢出。**不能排除長場次問題，不能判定OOM，也不能說已修好或只是工具逾時。**短場次沒有重驗全部卡片、候選或完整GR／來源卡矩陣。

以上依序綁定來源封存231f2d44f0c96d3f4181802be74f1a5b976355997e0edd2187dc8b3d1cf812bb、獨立整合覆核4a47118fcf5129a4d2f54beac2db49ae203e17de0e3ec09166cdd8f8e26542d3、主原生記錄b3a4df28117db73334d7a8f0f4697c2bb6c782efacdffc9696e0fdcc8a0322fd、短頁尾補充0d712c6048376dd2f451d42741e5a1044e9b7f66a7e16a7540e713bee970e19b。這些SHA-256是精確內容識別，不是簽章。各階段與歷史測試不相加成「總通過數」。

## 來源、歷史狀態與仍未完成的事

全域清冊固定於[e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92](https://github.com/2NTTY/child-ai-caregiver/tree/e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92)，候選研究固定於[f453226fca1befc6aef8e020407d2191f89de784](https://github.com/2NTTY/child-ai-caregiver/tree/f453226fca1befc6aef8e020407d2191f89de784)。最近已知PR #506合併後master為[2abe7aed60b192b253414f6464e3fd070cc377e7](https://github.com/2NTTY/child-ai-caregiver/commit/2abe7aed60b192b253414f6464e3fd070cc377e7)；這份補充沒有重新查詢目前master。三個來源身份不可互換。

頁內NOT_RUN／pending保留2026-11-05 16:23 UTC建置快照。本補充僅說明上述preview21工作台及頁尾觀察，不回寫已驗UI，也不讓其他pending自動通過。preview20的GR驗收只對應其原版本；本輪僅看變更文字，未重跑GR產品／日期流程。

- same-document hash Back曾使焦點從連結移至BODY，仍未定位或修復；跨頁返回成功不代表全面焦點恢復。AI01及其餘候選原有局限保留，本輪未重測另外21個候選。
- native IME／組字、完整AT／WCAG、真手機、觸控／手勢、OS軟鍵盤、320／390頂層視口、BFCache命中／事件監聽累積、完整競態與延遲回調矩陣未完成。CI close時新選取與composition Escape未驗；CI1440證據只是分段iframe。zoom、forced-colors、reduced-motion、定量對比度沒有本輪完整驗收。
- semantic88仍全數PENDING；正式72／正式48 NOT_RUN。正式owner／adapter／API／模型未接，不含真家庭資料、照片、訊息、憑證或帳戶／網站權限變更。
- 研究只保留適用摘要與來源引用，沒有搬用外部圖片、字型、文章或第三方程式；94 URL跨論壇、官方方法與項目文檔，同家族文檔／repo或多URL不重算設計方向。

## GitHub檔案與HTTP預覽不同

本次只準備公開分支交付檔，未進行遠端寫入、部署或合併master。GitHub顯示HTML原始碼，不等於已有可操作網站；這份說明不是部署確認。

依原[README.md](README.md)：下載本版完整公開目錄，在該目錄執行 `python3 -m http.server 8000`，開啟 `http://127.0.0.1:8000/index.html`。如用子路徑，把完整公開內容放於靜態根的 `workbench/`，從靜態根啟動HTTP，再開啟 `http://127.0.0.1:8000/workbench/index.html`。保留相對路徑與完整檔案，不用file://雙擊；只提供公開目錄，不從含來源、研究或證據的父目錄啟動server。
