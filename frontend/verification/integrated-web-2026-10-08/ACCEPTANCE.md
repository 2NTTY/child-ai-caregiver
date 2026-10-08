# 前端 A07 整合：固定 v64 交付摘要

## 固定範圍

Git 整合目標 b30a7b28b8f00f72013e2f6a01a6e65832856549 ＋本次71-path完整patch。以A07新帳戶／歷史／來源目錄／固定文件版本接點為底，保留已驗空態、操作、照片／來源恢復、原opId、draft、scope及原生history-entry修復。不是正式後端部署，也不是全倉checkout或全站驗收。

三次增量問題均保留原失敗：v62保存後queued刷新會把B舊snapshot切回目前版；v63修復穩態及C明確重讀門檻；v63的C重讀成功後舊提示於v64收短。成功manual只修改匹配的saved提示，state/reference及其他error不清除。

## 自動驗證與獨立覆核

- 最後小修本輪39個reader/lifecycle測試通過；62個未變更相關測試按相同bytes證據復用。去重101，不把93+39或多版重跑累加，也不宣稱101全數最後一輪執行。
- 同版frontend typecheck與35-route Expo Web export通過。source-map343個project及1622個dependency文字模組逐byte匹配；20binary assets匹配。
- 599-file source manifest、71-path patch preimage/replay、68-member preview archive、3原wrapper、2合成fixture與PNG已獨立核對。原無診斷與CSP防線保留。
- A07六組純合成parser/transport、既有15組recovery／8 growth authority／5 visible controls／4 remaining controls按未變fixture證據復用，不當成真服務驗證。
- source局部物化的未使用WORKLOG/migrate/worker檔不在交付patch，不宣稱整份checkout可部署；真正frontend bundle來源已有同版source-map證據。

## 有界真UI及版本證據

- v64（2026-10-08 02:29–02:32 UTC）新驗：C二次導航安全降級、manual503仍暫隱且提示待核、再manual成功回C並只顯示「先前文件的保存已確認。」；後續穩態及正常Memory→Summary→Preparation→C導航仍正確。一次A mutation，沒有重送。最小列表返回及記憶頁smoke通過。
- v63按未變bytes復用：active／archived／page2 B固定舊版穩態，文件版本／來源／authority變更清舊snapshot；B補讀中再選C後暫隱、auto成功不越過manual門檻、失權清資料。最初authority操作逾時保留為inconclusive，fresh短操作後通過，不能抹除第一次。
- v62按未變bytes復用：歸檔首次loading／failure／真空／hasMore／跨status，個人歷史原文及搜尋，memory已保存工作與公共目錄、正常account／guide、320px reader／memory／popup smoke。v62 reader失敗由v63精確補驗修復，不改寫舊報告。
- v61原生Chrome Back→Escape→再Back及相關草稿/照片/Forward證據僅對unchanged implementation/wrapper bytes引用。沒有把它標為新v64原生Back通過。
- v64官方預覽部署succeeded，DOM bundle路徑為index-87312b4ec557a0e4502631f387892284.js；publisher核對bundle SHA256，browser未另hash response bytes。預覽成功不等於GitHub已交付或GCP已部署。

## 仍未驗／不可替代的界線

新整合版原生Chrome Back鏈未重跑：native AT-SPI工具失效，沒有用CDP/iframe back冒代。真touch、真offline、完整screen-reader audit未做。個人歷史額外分頁及關閉早於延遲原文完成沒有專用可見場景；正常原文/關閉不是該證据。Guide／child-directory loading/error/offline變體未全部執行，正常狀態已核。窄Web不是Android真機。

只合成資料；沒有以本次預覽宣稱真帳戶登入／email/password操作、真通知／模型、真家庭資料、後端持久化、account export/deletion、GCP或正式權限變更。request panel僅fixture-side method/path/opId/count/hash，不是完整GET trace或正式送達證明。

## 指紋

- patch：b4279a1cd76ae06688ef3af6e16558ff384ccb5c0123bb30a018a3a769613b10
- source manifest：1574f1df42e12f5f57f155dd05fc11bca773f4ccd0861c1089b70a86abdf2e1f
- bundle：4684fc1038d56c12aaa690a72cc73adeebfb1882ce9bd4cfc1d0beebecef8852
- safe preview archive：01c1a4fa2964aef17ab5066fd2d26db1f6980bfcafb58327eec2ce1ade2993c5

2026-10-08使用者已明確恢復GitHub寫入授權。交付基線65055a9e37fcb573286d5de4e38e0132865113f9；b30之後11項路徑與73項交付路徑零重疊，71項preimage未改，沿用已驗v64技術證據。正常更新既有PR與合併後，再由遠端核實最終狀態；本摘要不預先宣稱已合併。保留原PR #130 ancestry、歷史verification及最新master的文件與測試；無checks不稱CI綠。
