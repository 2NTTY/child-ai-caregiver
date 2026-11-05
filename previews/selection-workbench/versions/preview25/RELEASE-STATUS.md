# 育伴港選配工作台 · preview25 靜態版本

更新日期：2026-11-05 UTC。這是專案來源、清冊／分析與合成示例的實驗選配庫，不是已部署網站、正式產品整合、全站驗收或 CI 通過宣告。此文件記錄發布準備時的狀態，不把後續 GitHub 分支檔案上傳當作網站部署。

## 精確內容與入口

- 原 preview25 的 268 檔／18,495,627 bytes 全部逐 byte 保留。只新增本文件及 RELEASE-MANIFEST.json，公開合計 270 檔。完整檔案清冊、來源 SHA-256 與本文件身份見 manifest；manifest 不循環記錄自己的大小或 hash。
- 29 個候選、28 個有候選模組、88 個功能／邊界項目、16 組、285 個去重角色來源路徑、121 個 exact 研究 URL。A/B 只是同一候選的兩種方向，不加算候選。
- gallery 入口仍為 index.html；CS01 為 child-scope/index.html。CS01 是 child-picker 的孩子與共享範圍切換候選，完整 ID child-scope-cp01。它與既有 child-profile 的 CP01/P01 不同。候選內原歷史 CP01 文字保持不變。
- CS01 的 B 必須使用頁內真實控制；不支援自行推測的 query/hash B 直入。候選沒有新增品牌返回連結，請用瀏覽器 Back。
- 原 README、候選 UI 與歷史 NOT_RUN／待覆核文字沒有改寫。它們描述各自封存時點；本文件與日期化 manifest 補充後到的獨立 source review 和有限 native delta，並不倒改歷史證據。

## 來源身份

全域清冊 checkpoint 為 e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92；候選 checkpoint 為 2abe7aed60b192b253414f6464e3fd070cc377e7。這兩層不合併成「整份都是最新 master」，本次準備也沒有更新遠端來源。

原 117 個 exact URL 加 4 個新 URL，合計 121。CS01 有 7 次引用用法，其中 3 次復用。cmdk repository 與 README 是兩個 exact URL，但不是兩個獨立研究家族。原 readDepth、各候選使用方式、未讀圖片／未跑 demo／license 限制逐 byte 保留；不借用其他候選的閱讀深度升級 CS01。這輪沒有外部研究重抓或第三方程式／圖片／字型／Skill 安裝。

## 當期有限驗收

獨立 source review 結果為 ACCEPT_FOR_NATIVE_DELTA。後到的 preview25 原生差異回歸為 ACCEPTED_BOUNDED_NATIVE_DELTA；G24-N01 只在這份精確 preview25 的來源區有界回歸關閉。原 preview24 的 BLOCKED_NATIVE_GALLERY_HORIZONTAL_OVERFLOW 封包及結論仍然保留。

來源區修補只改四處 scoped CSS：三處 grid track 使用 minmax(0,1fr)，source item 使用 min-width:0 與 overflow-wrap:anywhere。沒有以 overflow:hidden、刪文或裁切掩蓋問題。320／390 CSS iframe 的 document client/scroll 分別為 305/305、375/375，15px scrollbar 已計入；1100／1101 CSS iframe 分別為兩欄／三欄。

121 列來源的 rendered title、URL、狀態、段落和 DOM geometry 均對照原資料；代表性320／390長文像素與native焦點可見。這不是每一列的完整像素／鍵盤遍歷，沒有打開 121 個外網站。CSS iframe 不是實體手機或整個瀏覽器 viewport。

CS01 已有 root／nested 卡片及目錄入口、真頁內 A/B、真 Browser Back、root Forward、搜尋／group／ready／mapped／Clear 焦點及代表性窄版 A 提交／B 搜尋 dialog 觀察。該窗沒有從 B modal 提交切換命令；不以其推論全部 modal 狀態機通過。

該次 native stage 合計 20 檔，root／nested 各 5 個 gallery 檔與 5 個 CS01 檔，不是全 268 檔 runtime 的 native 驗收。舊 PC／AP／TC 的 18 個候選檔與這版逐 byte 相同，可以沿用原有界候選觀察，不能把當時 gallery 阻斷改稱整包 PASS，也不代表重跑全部舊流程。

## 仍然未驗或未修

- 全 88 項 semantic review：PENDING。正式 63／65／72／48 測試：NOT_RUN。正式 React／RN／ProductionOwner adapter：NOT_IMPLEMENTED。
- CM-F01：UNFIXED。既有 candidate source gate、same-document hash 焦點、CD 窄版 B 文案、SL 初始詳讀空白等限制保持原狀。
- 全部舊候選旅程、全268 runtime native、OS IME、AT／screen reader、實體手機／touch、forced colors／reduced motion、完整 standalone matrix、modal same-context publication／retained identity／ABA 及 BFCache 證明仍未完成。
- 歷史 code9 根因 UNKNOWN。這一窗沒有 code9 或 protocol timeout，不能當作根因修復證據。原生 log 仍有 browser-extension metadata error 樣本，不稱 console clean。
- 一次 selector no_matches 及一次私有 verifier inventory 假設修正已保留於驗收證據，不把它們當成產品缺陷，也不隱去。

## 完整靜態 HTTP 使用

保留全部 270 檔及相對路徑。從倉庫根目錄可用標準 Python 靜態 HTTP server：

    python3 -m http.server 8000 --directory previews/selection-workbench/versions/preview25

開啟 http://127.0.0.1:8000/index.html 。真正的 nested mount 範例：

    python3 -m http.server 8000 --directory previews/selection-workbench

開啟 http://127.0.0.1:8000/versions/preview25/index.html 。不使用 file://，不需安裝 dependencies、登入、真家庭資料、照片、訊息或真模型。這些是啟動說明，本次發布準備沒有啟動 server／browser，也沒有新增完整root／nested native驗收。GitHub 原始檔瀏覽不是 HTTP 部署。

## 版本與發布邊界

本版新目錄是 previews/selection-workbench/versions/preview25/。既有 compact CW 選項仍固定 preview23，另留在 previews/selection-workbench/versions/cw01-preview23/；未 port、未覆蓋其 root／選擇，也不宣稱自動相容 preview25。PH／NP／TE／TH 不在本版。

準備狀態是 LOCAL_ONLY_PENDING_INDEPENDENT_RELEASE_REVIEW。下一步另做獨立 release review，再由正常 GitHub connector 在新鮮分支 head/tree 上發布精確 allowlist。舊版、其他目錄、分支 root 與 master 不改，不 force push、不合併 master、不改 Site、憑證或權限。只公開專案程式、美術、已授權來源摘要和合成示例，不公開測試、原始截圖、私有證據或 source snapshot。
