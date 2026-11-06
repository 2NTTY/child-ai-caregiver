# 育伴港選配工作台 · preview26 實驗候選保存版

日期：2026-11-05 UTC。這是供挑選的合成前端實驗候選，不等於正式 owner 接線、全站功能完成或正式產品驗收。此保存版未部署 Site，也沒有合併 master；公開分支保存和可運行網站部署是兩回事。

本檔 RELEASE-STATUS.md 是這份保存版的當期驗證狀態說明。原有 README、研究頁及候選文案保留其歷史時點；其中「尚待 review／整合 native NOT_RUN」等文字，不代表後來的有限觀察不存在。以下更新只涵蓋明列的有限證據，不改寫原始候選契約或尚未解決的限制。

## 原檔不變與內容範圍

原 preview26 的 281 個公開檔案共 18,620,898 bytes 全部逐 byte 保留，包括五個原始設計、舊候選、選擇／undo 與清冊。另加本檔及 RELEASE-MANIFEST.json，共 283 個公開檔案。公開清冊涵蓋另外 282 檔；為避免循環 hash，只排除它自己的根路徑。它是檔案完整性清冊，不是測試報告。

31 個唯一候選分布於 30 個有候選模組；清冊仍為 88 個邊界、16 組、285 個角色來源路徑。132 個去重 exact URL 是研究索引數，不是 132 個全部讀完的來源或獨立研究家族。原有讀取深度、每個候選的採用／拒絕用途及不可用嘗試均保留。

PH01 與 NP01 共 13 個 runtime 檔案保持已覆核修正版的原 bytes。PH01 為 child-scoped 分頁十欄歷史閱讀，共享同一合成只讀 owner，沒有 structured diff、restore writer 或 raw sortable timestamp。NP01 為 account/server/session 的本人通知偏好，不是 child owner；正式 Settings 的 notifications tab 對應此模組，preferences tab 是 appearance。四欄與 version、saved／draft、unknown 原操作讀回後 fresh consent 明確重試、confirmed 只讀邊界均不變。兩候選從 A 開始，B 用頁內控制；沒有 query-B 直入或工作台返回連結。

全域 catalog 的 e8918dd 與原快照 e842c7d、候選來源 checkpoint 2abe7ae、PH 選取本地來源 f453 及五個原始設計快照保持分層。沒有宣稱全站使用最新 master。CW 仍屬其既有獨立版本；TE、TH、CO 沒有加入本版。

## 已有的有限證據

來源、實際 DOM 與離線封包整合已獲獨立覆核，接受進入有限原生整合觀察。這不是正式產品 suite 或原生驗收的替代。

最新原生觀察判定為 **BOUNDED_NATIVE_PARTIAL_SUPPORT_BLOCKED**，不是完整 gate PASS。已記錄的有限範圍包括：

- root／nested 的 PH、NP featured 與 filtered catalog 共 8 個實際入口；特定 code／full ID／group／ready／mapped 過濾、Clear 回 search，以及若干真實 Back／Forward 路由與焦點恢復。這不證明 BFCache 機制或全導航矩陣。
- PH 的實際 A／B、版本 5 完整十欄加四項 metadata、一次更多分頁、長文字與未知欄、Escape 回 live opener，以及 320 CSS 寬度的一次 reader／返回焦點觀察。不是實體手機、觸控或全部 reader 鍵盤巡覽。
- NP 的四欄 draft 與 saved v7 分離、A／B、review heading／Tab 到保存、unknown 後保留同 ID／原輸入／版本、讀收據與目前值、fresh consent 明確 retry、confirmed 不再提交。最後實際選到「讀回另一個版本」：saved v8 更新，原 draft 保留；不能稱原先預期的 matching original-receipt 分支已驗。
- root320、root390、nested320、nested390 四組各 132 列的內容與水平幾何對照，沒有觀察到水平溢出。這是 4×132 列觀察，不是 528 個來源。只抽樣原始畫面與 settled focus；部分長列高於 viewport，不表示每列完全可見或已逐像素／逐焦點巡覽。

原生窗口僅使用每個 mount 的 19 個檔案，含 gallery 實際依賴 recap/art.svg，root／nested 合計 38 個 staged runtime。這不是完整 281 檔 served closure 或全部舊方案驗收。

## 明確未完成與未知結果

- 瀏覽器控制工具中斷，因此窄版 NP 與資源 HTTP 逐項核對未完成；未判為產品失敗。窄版 NP 後續畫面與流程未驗。
- 38 個 HTTP response status／body／hash 逐項讀回未執行，成功 byte proof 為 0。staged 檔案與來源 byte-exact、路由畫面已出現，不等於全部 HTTP 回應 exact；不能把過往 server 注入值當成本輪測量。
- PH loaded-version search、完整 reader keyboard trap、所有舊候選 suite、全部來源逐像素與逐焦點巡覽、所有寬度／狀態矩陣未做。部分桌面 search／disabled 接納按鈕離 viewport、保存按鈕 raw 畫面底部邊緣不完整，不能概括為全面焦點可見通過。動畫中間態與 settled 焦點分開。

這些缺口仍限制可作出的驗收聲明，不能稱完整原生驗收通過。

## 持續保留的限制

PH 原 adapted source 17 PASS／1 FAIL 的舊 UI lookup 結果保留，未重跑。NP 的 DP-F01、lookup404、正式安全自動 reconnect read 與候選 explicit read 差異未修。NP320 select 尾字截短、review 顯示完整值是先前有限觀察，不是這輪新窄版 NP PASS；退役 callback 檢查仍只屬來源／DOM。

正式 63／65／72／48 未執行；semantic88 待驗；production adapter 尚未實作。OS IME、AT／screenreader、實體手機／touch／gesture、完整 WCAG、BFCache、OS forced-colors／reduced-motion、正式 API／Firestore／model 均未驗。CM-F01、same-document hash 焦點、CD 窄 B 文案、SL 初始空白及歷史 code9 UNKNOWN 等既有限制仍保留。

此保存版只包含項目程式、美術、合成示例及獲准的清冊分析，供比較與挑選；不包含真實家庭資料，也不代表正式功能上線。
