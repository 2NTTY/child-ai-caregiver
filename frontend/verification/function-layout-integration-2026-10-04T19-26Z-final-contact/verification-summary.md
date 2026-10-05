# FE-W38 有界整合驗證摘要

## 最後被測版本

- 基線：`65f8cf37bceeb15b05f46326c49e0370349ae3a5`；隔離、sparse 的前端合成預覽。
- 最後 Web export：`/workspace/shared/caregiver_layout_redesign_builds/function-layout-2026-10-04T19-26Z`。
- v32 入口：`entry-23f445ff0520f924d5f1431d60ff06b3.js`；瀏覽器實際載入已核對。
- [最後建置結果](build-checks.json)、[來源 manifest](source-manifest.json)、[建置 manifest](build-manifest.json)、[最後來源完整性](final-runtime-integrity.json)。source manifest SHA-256：`754cd2c11130d4c97cb4601d04f7f86f1fd55bf8b54c51fcf2773a95d26d529b`。
- v32 相對 v31 唯一 runtime 差異為 `frontend/src/components/contact/ContactConsentCard.tsx`。其餘已驗來源沿固定版本證據復用，沒有重跑成功矩陣。最後瀏覽器補验後，348 個 runtime 檔與只讀家庭契約再比對，零漂移。
- 所有建置沿指定 `expo-environment.sh` 及既有依賴 symlink，沒有安裝套件。稀疏工作區沒有物化的舊路徑不當作刪除。已物化的 21 份基線測試保持原字節；舊本地證據未被驗證過程改寫。

## 分開保留的失敗、修復及補驗

1. **初次 typecheck 因 baseline 缺檔失敗**：[18:56 run](../function-layout-integration-2026-10-04T18-56Z/build-checks.json)。缺少 `src/shared/family.ts` 導致 `TS2307` 及連鎖 family 型別錯誤；即時停批，當次沒有 export。主模型從固定基線物化該只讀契約，Git blob `5f605fac7d982748ca2e90c38964ce6458adbf9b` 已核對，非業務修改。
2. **基線依賴補齊後**：[18:58 run](../function-layout-integration-2026-10-04T18-58Z-baseline-retry/build-checks.json) 的獲授權一次 typecheck 重驗及首次 Web export 通過，生成 v30。
3. **v30 首個瀏覽器斷言失敗**：[原結果](../function-layout-integration-2026-10-04T18-58Z-baseline-retry/browser-v30/checks.json)、[細節](../function-layout-integration-2026-10-04T18-58Z-baseline-retry/browser-v30/failure-details.json)、[原截圖](../function-layout-integration-2026-10-04T18-58Z-baseline-retry/browser-v30/failure-records-upward-drag-320.jpg)。320×600 的 Records 上拖 60px 應開 `/more`，實際落在 `/care`，即時停批。主模型另從該圖確認 Care 工具列「更多」裁切。
4. **第一輪局部修正**：跨 pathname effect 保留拖後 click 抑制，以及 Care 工具列窄屏換行。獲授權一次 typecheck/export 後，v31 同一起終點上拖、普通點按、ArrowUp 與 320 工具列補驗通過；[修後 Records](../function-layout-integration-2026-10-04T19-08Z-local-fix/browser-v31/records-after-drag-more-320.jpg)、[修後工具列](../function-layout-integration-2026-10-04T19-08Z-local-fix/browser-v31/care-toolbar-fixed-320.jpg)。
5. **第二輪局部修正**：Contact 的完整視覺文案在 320px 縮略，主模型裁決只改短標籤「管理同意」，保留完整可及名稱。最後一次 typecheck/export 通過；[v32 局部結果](browser-v32/checks.json)、[最後 320 圖](browser-v32/contact-320-label-final.jpg)。可見文字完整，accessible name 為「管理本人接收同意」，48px 高，x174.07–286.48，全部在 320px 內。

## 畫面及互動的實際範圍

- v30：首頁 1440／1024／390／320 截圖及 document 寬度量度；文字、文件、語音快捷拖向；文件／語音取消；可見按鈕與 Enter／Escape 替代；超出方向區域取消；孩子文字草稿隔離與返回自身草稿。未啟動相機或咪高峰。
- v31：More、Summary、Profile、Settings、Sources、Photos、Care、Tasks、Growth、Family、Contact、Chat、Memory、Guide、Login 共 15 頁 × 4 寬度的 document 幾何與首屏截圖。連同保留的首頁，共 16 頁／64 個寬度畫面；**此數字不是全內容、全狀態或完整回歸通過**。各頁原圖與 DOM 在 [v31 run](../function-layout-integration-2026-10-04T19-08Z-local-fix/browser-v31/checks.json)。
- Profile：未保存草稿切孩子的取消保留內容；確認正常切換後，同一控制的 y322→322，焦點留在新孩子控制。
- Settings：窄屏真正 Tabs；分類往返後顯示名稱合成草稿仍在。沒有提交帳戶變更或使用模型秘密。
- Sources：只輸入合成原文，離頁取消保留草稿，沒有私人保存、取得網頁、模型或正式接入。
- Photos：在 `/photos` 選擇「沒有照片」合成集合，經正常導航到 `/care?view=photos` 保持同一空集合；換孩子重設為該孩子 fixture。選取合成照片及未保存草稿後，確認放棄並換孩子，原選取及草稿清除。沒有上傳、提取、刪除或家庭共享。
- Chat：320px composer 與時間線保持 32px overlap；未重跑原有 PageUp 雲端／使用者本機差異。
- v32：只對最後 Contact320 文案及 accessible name 補驗。未再次跑原矩陣。回主頁預覽連結的 Enter 沒有觀察到啟動，普通點擊可到達；已原樣記錄，不把此操作當作登入鍵盤全面通過。

## 四個實作組的既有證據

下列由整合驗證者讀取及原字節保存，**沒有再次執行**；[來源與 SHA-256](worker-check-provenance.json)。各組的 syntax 不等於 semantic typecheck。

- **Navigation / quick input**：[worker report](worker-checks-navigation.json)。初輪 `assistant-draft.test.mts`、`local-voice-capture.test.mts`、`home-agent-entry.test.mts` 合計 10 passed；其中 3 項是 synthetic voice lifecycle。Records 修正後 `pointer-click-gate.test.mts` + `assistant-draft.test.mts` 為 6 passed，含重跑的 3 項 draft 測試，**不能與初輪簡單相加為獨立測試總數**。另 27 檔 syntax 檢查。
- **Daily / action**：[worker report](worker-checks-daily.json)。首次 cwd 重複 `frontend/` 前綴，沒有建立測試檔，也沒有執行 assertion；保留原錯誤。經主模型批准改正命令後，`node --test scripts/task-layout.test.mts` 為 4 passed。報告由原工具回覆重建，包含原 stdout／chunk IDs，沒有捏造絕對執行時間。18 檔早期 syntax 及最後 Contact 單檔 syntax 的版本邊界另列。
- **Review / history**：[worker report](worker-checks-review.json)。25 檔 syntax；`node --test frontend/src/components/care/care-review.test.mjs` 為 3 passed；合成孩子範圍／記錄關聯純探針另報。沒有把此摘要冒作整合 hook、瀏覽器或真 API 證據。
- **Management**：[worker report](worker-checks-management.json)。23 檔 syntax 及重要 controller／契約未變的來源核對；**沒有另宣稱跑過純測試**。相關 Profile／Settings／Sources 的 runtime 互動由上述 v31 有界流程補上。

## 明確未解／未驗

- **來源字型顯示限制仍未解**：聊天來源列中文及正文引用括號可見缺字方格，DOM 原文完整。[目前診斷](../function-layout-integration-2026-10-04T19-08Z-local-fix/browser-v31/chat-font-diagnosis.json)、[目前截圖](../function-layout-integration-2026-10-04T19-08Z-local-fix/browser-v31/chat-font-diagnosis-320.jpg)。主模型實際查看 v29 原圖 `home-chat-visual-2026-10-04T16-18Z/320-chat.jpg`，確認已存在同一現象；AnswerSources/theme 與基線逐字未變。不得稱新回歸、工具假象或來源可讀性通過。一次唯讀診斷發現來源內文與正常「參考來源」標題均為相同 system font stack、13px／600；沒有注入或更換字型。
- 原 320px PageUp 雲端失敗與使用者本機成功，繼續分開保留；本輪没有替代或重試其證據。
- 沒有真後端、模型、真家庭資料、實際相機／咪高峰權限、真音訊 codec、原生裝置、完整鍵盤／讀屏、所有隱藏狀態、連續動效首幀或全量回歸驗證。synthetic voice lifecycle 通過不等於真錄音已驗。
- 瀏覽器捕捉的本站記錄只見 Web `useNativeDriver` fallback 警告；extension metadata 噪音另分。這是捕捉紀錄觀察，沒有完整 network trace，不能稱 GitHub CI 或正式產品全綠。
- 主模型負責最終視覺／範圍裁決、來源發布與 draft PR；本驗證沒有進行 Git／PR／合併操作。
