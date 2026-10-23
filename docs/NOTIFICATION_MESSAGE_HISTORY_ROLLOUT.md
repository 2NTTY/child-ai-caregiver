# 本人消息歷史：兩階段部署及回退

本文件是部署門檻，不是部署紀錄或執行批准。接口／內容／coverage 契約見 [API](API.md#本人已保存的外發消息內容)。此包只交付程式、索引 manifest 及合成測試；公開預覽的 synthetic 示例不證明 GCP 已有此接口。

## 1. 先部署兼容 reader，保持功能關閉

- 所有新 API、worker、維護及還原工具先使用 `FIREBASE_MESSAGE_HISTORY_ENABLED=false`（缺省亦為 false）。嚴格拒絕其他非 boolean 字串，範例在 [根環境模板](../.env.example)。
- 兼容版可讀舊／新 optional 快照及權限欄，保留原有欄位；舊資料缺欄時重序列化仍缺欄，不自動補 0。此模式不首次保存快照，不初始化權限 marker，消息 API 回明確 `503 message_history_unavailable`，不查新增索引。
- 在任何實例開啟功能前，部署者須核對**全部** API、worker 及維護／還原 reader 均已達兼容版本，沒有 pre-bridge 舊 binary 仍接流量或處理工作。若資料已曾啟用並有新欄，不能再把 pre-bridge binary 加回，即使旗標為 false。
- 這個兼容版本是往後的回退下限。記錄實際映像／commit 及各服務配置，不只憑最新映像名稱判斷整個服務群已更新。

## 2. 驗證索引，才開啟 capture／API

- 核對 [Firestore manifest](../deploy/firebase/firestore.indexes.json) 中四個消息查詢索引已在正確 database／namespace ready：Push、native Push、Telegram、contact，按 `messageSentAt` 與真 entity ID 排序。
- 現有 index helper 對 ADK events manifest 有已知拒絕；此包沒有修復它。若因該限制未能安全建立並確認所需索引，activation 仍受阻，不能忽略錯誤或宣稱 ready。
- 全部 reader 兼容且索引 ready 後，才由獲授權部署者把所需 API／worker 的 `FIREBASE_MESSAGE_HISTORY_ENABLED` 設為 true。此旗標**不**啟用 AI、通知渠道或排程，不新增外發工作、不重送 unknown；原有 consent／去重保護不變。
- 未開啟 capture 的兼容 worker 仍可沿原流程處理已有工作，但不新保存正文；混合旗標期間的缺漏仍屬 coverage 限制，不可聲稱已完整記錄全渠道。

## 3. 權限 marker 與混合旗標

首次啟用的本人消息讀取會先在原生 authority transaction 寫入 workspace `childAccessVersion:0`，提交後才可返回任何頁或游標，不改一般 `changeSeq`。此後，**任何兼容實例**只要讀到該欄存在（包括 0），孩子刪除屏障同交易都須遞增；不能因自身旗標關閉而跳過。普通寫入保留欄位。初始化與刪除讀寫同一 workspace，依原生 transaction 衝突重試排序。

若關閉消息 API，前端收到明確 unavailable 後會清除通知快照／分頁，鈴鐺及完整歷史同時清除；不是保留失權內容為 stale。權限計算與新資料到達分開，不能改用一般 `changeSeq`。

## 4. 回退及還原

- 先停用 capture／API 旗標，可回退至兼容 reader 下限，但不得退至不識新欄位的舊 strict schema。
- 既有 marker、加密快照及原投遞記錄必須保留；不得刪欄、清庫或以重新發送填補歷史。停用後的孩子刪除仍維護 marker。
- 還原沿原加密 codec，採來源／live 較高 permission revision 保留 activation marker，並使用新 storage epoch；兩邊原本缺欄則保持缺欄。排序 metadata 只從已驗證加密快照重建。
- Provider 接受後終態交易失敗維持原 sending／unknown 防重，不因部署或缺正文而另發消息。舊正文、驗證／重設郵件秘密及未知投遞不可回填。

## 驗收界線

本地相關檢查：`tests/firestore-notification-messages.test.ts`、`tests/firebase-config.test.ts` 的消息 activation 案，以及 gateway／service-worker、authority／recovery 案。必須另核全倉既有失敗，不能把局部綠當全倉綠。合成串行 Firestore、mock transport、TypeScript 檢查不能證明原生雲端索引、並發或裝置實際接收；雲端驗收及任何真發送須由相應獲授權操作另行記錄。
