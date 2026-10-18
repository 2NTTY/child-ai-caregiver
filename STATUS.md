# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **管理員總控已上線：**#233 的每日／每輪政策維持單一權威，本輪部署沒有修改配額或清零用量。最後已核值為每人200／全站400、每輪8生成／16工具／4查詢／90秒。S05會話、S07同步及S09原運行查回的本機必要檢查已通過，API／Web已更新；新版APK已獲使用者確認正常開啟及原資料保留；首條真人／跨端驗收仍待完成，現場版本只見下方部署觀察。

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **當前工作：**[S12-W05](PLAN.md#s12-w05)通用附件及首頁快捷入口已部署原站API／worker／Web；同一合成Word的真Storage保存、讀取與清理已核，原腳本失敗保留。Android相容OTA亦已發布，毋須新APK；Android相機開啟／取消與Word草稿選取／移除已核；錄音預聽停在0秒，局部修正版待補核。Web選檔／兩端下載、首條真人聊天、真機播放、FCM、跨端接續、OTA回退及draft #229／#234～#239依賴合併仍待完成。新版APK v2已獲使用者確認正常開啟、原資料保留；既有鍵盤輸入可見及回位證據不擴成全部真機通過。Android成品後先報告並停下；本人key／自選模型／限額及本地Agent入口等使用者另行定案，iOS暫緩，#214～#216不接管。

- **操作範圍：**主模型實作及 review；最新使用者授權可用 Luna 按規則唯讀定位。只做最低必要檢查，局部讀取或日誌尾部，不全量、Computer Use 或重做前端設計；手機 gate 待驗時繼續獨立工作。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-18 10:20 UTC 附件更新：**API／worker為`files-a12da46`、Web為`files-c4ac1b9`，全部健康且公開HTML hash一致；原配額、正式資料、通知設定及VM期限不變。保留前版映像和受保護Compose副本；新附件已寫入後的回退必須保留其reader／清理能力。只核最近READY備份metadata，原生真還原仍延後；詳見[附件EV](artifacts/verification/S12_CHAT_FILES_20261018.json)。 Android OTA群組`a8c6bf35-1b67-42ea-9c41-cf7c0ec896a6`已發布，與已安裝APK v2 runtime一致；真機重開後已接收，Android文件草稿入口已核；語音預聽問題與其餘gate仍待完成。

**2026-10-18 07:47 UTC 核對：**原 VM 的 API／worker／Web 已部署 `mobile-bf47c47`，三服務健康，公開入口 hash 對應同版產物；PostgreSQL保持停止，沒有模型、通知、資料遷移或配額修改。前置10個索引／6項欄位設定均READY，Linux音訊解析及正式組裝的4次有界查詢通過；準備腳本的掛載、CLI與查詢形狀失敗分開保留。見[同版交付證據](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)。APK於07:54 UTC核對完成，固定發布入口已記錄基線；使用者其後於2026-10-18確認「能正常開啟，原資料仍在」，ADB核對versionCode 2；既有OTA不能承接新原生模組；首條真人聊天、手機功能與原生備份真還原仍待驗。

**2026-10-18 其後局部更新：**Web改為`keyboard-d321553`，公開HTML hash與產物一致；API／worker沒有重啟、資料與配額不變。APK v2相容OTA群組`759892ac-b994-45c8-b1fd-dc2502077990`已發布，真機核對輸入可見、清空及鍵盤收起後回位；過渡動畫不宣稱全面通過。Web回退使用保留的`mobile-bf47c47`映像及`compose.yaml.before-keyboard-d321553`配置。

保留 `admin-8ba66e7` 映像、受保護設定副本及所有資料。新語音／通知資料寫入後，只能回退相容 reader／worker，不能盲退舊API，見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。部署前磁碟可用約1.0GiB，使用約7.2MB壓縮的小型更新層；沒有刪除舊備份。部署前唯讀核對最近原生備份為2026-10-17 22:05 UTC、READY、保留至10月31日；只核metadata，沒有讀取內容或還原，原延期保持。

VM 此次核對為 e2-small，已按使用者要求續期 5 天，新的自動停止期限為 **2026-10-23 13:33:50 香港時間**。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
