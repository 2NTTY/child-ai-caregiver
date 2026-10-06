# v40 有界合成驗證

## 結果與固定版本

已完成 4 個主要畫面 × 1440／1024／390／320 CSS px 的截图及量度，沒有 document 横向溢出。重要確認、過期操作與跨頁共享狀態有下列 runtime 證據；準備歸檔被工具拒絕，未驗。這不是全站、正式資料庫或所有按鈕通過。

- 固定來源：2026-10-05 16:06:25 UTC。之後 NEXT 的 adapter 工作是 root 已知的新修改，不屬本版，也沒有將它當意外漂移
- root 核對發布：16:14:11 UTC；Site commit `64bbe36f39354ead34fe758fd0fd6335e81a7682`
- entry：`entry-29f5685892ac54b0ca53a9bde3814118.js`
- entry SHA-256：`01512f96a992b364160705fa094d90ff4dfe71d78d94298acce50318f3004bc9`
- source manifest：`90325e659e6c3d8763e8b6cbb175a1572816590f221115b1d28f108a9f555c96`
- build manifest：`f1bf4c203740f4e8abc2eefd898bcf475092f3365b0b75d15b639d6dd59e8132`
- 使用 dot 雲端 Chrome browser 1／tab 22。`runtime-entry.json` 保存瀏覽器讀到的同名 script URL；hash 來自固定本地 export，沒有另作遠端 byte-hash 宣稱
- 固定 build：`/workspace/shared/caregiver_preparations_update_builds/next-release-2026-10-05T16-06Z-single-worker-recovery`；QA 後 63 檔 hash 相同

## 建置

16:00 freeze 的完整 typecheck 通過；首個 fresh-cache Web export 被 Killed、exit 137，原因未能證實，不能直接寫成 OOM。原 log、空輸出目錄及只讀資源診斷保留在上一 run。

新 freeze 的 runtime delta 正好只有 `CareRecordsView.tsx`，hash 符合 root 提供的 `6c7571d05d2f94c9ef19f374a0736ccfad2e56fc7315b12774528cfb7e226486`；沿用完整 typecheck 與 owner 單檔 semantic／6 guards，沒有再跑完整測試。

唯一获准恢復以新 TMPDIR、`--clear --max-workers 1` 做 export-only，保留 minify／SSG，成功輸出 37 routes／63 檔。已核對精確 NEXT appRoot、/history／/summary、新概況／準備／歸檔／跨聊天重要待確認文案；Unicode 文字同時考慮 minifier escape。全部來源及舊證據在建置前後沒有漂移。

## 實際已驗

- 孩子概況四寬：已確認 Profile 來源、興趣與生活偏好、日常照顧要點分開；身高／體重尚未接入明示不可提供，未知不當成沒有過敏／特別需要
- 準備閱讀四寬：四種用途各自文件，手機可直接閱讀；來源固定合成示例，不稱為真正 Agent 生成。另存 320 清單畫面
- 多聊天 Records 四寬：6 項、5 個來源批次，重要待確認排前，普通已保存與須先確認才寫入分開。手動補填預設不出現，只有展開既有「其他記錄入口」才顯示
- 重要確認：鍵盤明確確認一項後，重要待確認由 2→1、總待確認由 4→3。結果清楚說沒有再次寫入記錄、通知、預約或醫療行動
- 過期重要操作：仍保留黃燈、原話及未核實說明，沒有可提交舊操作的確認／寫入按鈕。沒有把過期、關閉或換頁當成確認
- Care History 四寬：從 Records 進入後仍是同一 1／3 狀態及過期項目；日期條件沒有假造可核實日期。這證明本次 preview 跨頁呈現同一 owner 狀態，不代表正式 current-authoritative DB 已接通
- 準備清單：Space 勾選第一項變 1／3，文案說只更新合成預覽。去 Records／History 再回到同一文件，該項仍 checked，證據見 `preparation-checklist-cross-page.txt`

## 工具阻擋及保留限制

1. 歸檔最初被明確拒絕，理由是 QA 授權未指明歸檔。root 提供使用者「如果用完了，就點按鈕歸檔準備頁」及驗收原句後，同一「使用完畢，歸檔」call 重試一次仍收到「JavaScript execution did not receive approval」。已停止，沒有另一條路或額外重試；歸檔結果與 archive→History 不得標通過或 app 故障
2. 另外兩次 generic no-approval 分別涉及四寬 read/capture 與重開同一文件讀 checked 狀態，均只在 root 補 transcript 後同 call 重試一次成功
3. 舊 capture helper 留有已關閉 v39 tab20，最初報 Unknown CDP tab 20；已改為明確傳入目前 tab22 的 helper。這是驗證工具狀態問題，不是產品失敗
4. 本輪 app 操作以鍵盤完成；wrapper 尺寸按鈕用 pointer。沒有用鍵盤成功取代 pointer。v38 ChildPicker／footer pointer 原限制仍未解
5. 截圖為 wrapper fullPage，展示 iframe 當時 scroll viewport，不是頁面全部長內容，也不是 pointer 可見性證據。沒有全面驗 hover、讀屏、連續動畫或 Tab traversal

## 按鈕呈現的精確結論

- 已有量度顯示「來源與版本」「其他記錄入口」為透明背景＋1px 描邊
- 選中的準備單卡片仍是 `rgb(227,246,245)` 填色＋2px `rgb(39,35,67)` 外框，見 `preparation-reading-1440.jpg/.json`。這是 selectable row 的實際現況；是否屬使用者「填色或描邊二選一」的例外，已交 root 判斷，沒有擅改或概括通過
- Paper AppButton 的外層 role node 是透明／0px，視覺樣式在內層；讀取內層的 call 與歸檔同批被拒，沒有得到該補充證據。不能由外層數值斷言按鈕沒有外觀，亦不能稱所有可點元件均符合二選一

## 未驗及證據入口

準備歸檔／歷史、所有 button 內層樣式、真正換孩子 scope、準備私人来源撤權／unknown／舊原操作恢復、此版本之後的 adapter 修改，以及真 API／模型／媒體／原生皆未驗。沒有 GitHub 操作、發版、project source／權威文件修改或額外 build。

`checks.json` 是逐項原始結果；`completion-status.json` 補齊版本、工具拒絕、跨頁清單結果、呈現邊界及 build hash 核對。`evidence-manifest.json` 列全部證據 hash。四寬圖／DOM／量度按 `child-overview-*`、`preparation-reading-*`、`multi-chat-records-*`、`history-care-*` 命名。
