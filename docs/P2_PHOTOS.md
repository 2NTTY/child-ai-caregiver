# P2 照片操作與驗收範圍

S12-W03 必要 migration／照片 API／真候選及加密配對空庫還原已核對；完整照片面板瀏覽器及公開部署未驗。原刪除脚本快照失敗與實際功能／清理證據分開保留，見 [驗收](../artifacts/verification/S12_W03_CHECKS.json)。原 P1 現網及既有備份不變。

- `ATTACHMENTS_DIR` 是工程外、僅 Server 作業系統帳號可讀寫的絕對路徑。容器需持久 volume，API 可寫、備份程序停服後讀寫；不公開掛載為靜態網站。Windows ACL 與 Linux mode 各自核對，不能只憑 mode 宣稱 Windows 私密。
- 沿用 `STORAGE_KEY_FILE`，备份仍使用不同的 `BACKUP_KEY_FILE`。原檔及 metadata 分別加密，密鑰不隨附件或備份輸出。
- 有附件後停 API／worker，使用 `node --env-file-if-exists=.env scripts/photos-backup.mjs backup <加密備份路徑> --server-stopped`；保留資料庫備份及同名 `.attachments` 目錄作一組。清單受 backup key 認證並綁資料庫備份 hash，每張原圖先驗原 hash 再獨立備份加密。備份失敗不當成完整恢復點。
- 還原至空資料庫、空專用附件目錄，使用 `node --env-file-if-exists=.env scripts/photos-backup.mjs restore <加密備份路徑> --empty-target-server-stopped`；完整認證／核對配對及原圖後才還原，並核資料庫清單。失敗保持停服；成功亦保持 worker 暫停，待核對授權、任務及照片後才決定開啟。不得覆蓋使用中目錄。
- 舊純資料庫命令不能作 P2 附件完整備份。舊歷史備份仍保留當時資料，刪除不回寫歷史備份；依保留政策管理，還原前核對刪除時間點，不能把舊資料重新公開。
- 檔案寫入中斷保留 reserved；依原附件 ID／hash 重傳，不能聲稱已確認。刪除 metadata 立即取消存取，持久刪除清單由 Server 清理；清理失敗保留 pending，不另呼叫模型或外發。

集中驗收只補缺少的真證據：合成原圖上傳／hash／角色隔離與容量拒絕、一次有界真照片提取及人工確認、回應中斷與版本、刪記錄／孩子後原圖清理、配對備份空庫還原及缺檔拒絕。復用既有權限／加密／ADK 證據，次數與成本於 P2 接線就緒後集中批准；不在本包另跑測試矩陣。
