# P1 儲存保護與備份操作

S05-W01 的權威範圍是 Server 孩子稱呼、照護文字及私人聊天正文。AES-256-GCM 在應用層加密後才寫 PostgreSQL；版本、隨機 nonce、tag 及 ciphertext 一起保存，AAD 綁定記錄／擁有者／關聯，讀取仍先經現有授權 SQL。ID、時間、角色及用量 metadata 保留可查詢；Better Auth 的帳號 email／名稱、session 由原 adapter 管理，密碼仍使用其安全 hash。本機磁碟／WAL 的全面加密不是本功能的證據，部署磁碟與資料庫加密须在交付環境核對。

## 密鑰與首次升級

1. 停止使用這個資料庫的旧 Server。不要清空 DB、volume 或重新生成已有 key。
2. 使用 Node 24 執行 `node scripts/setup-storage-keys.mjs <工程外的新私密目錄絕對路徑>`；父目錄須存在。工具拒絕重用目錄／覆蓋檔案，建立不同的 `storage.key`／`backup.key`。POSIX 為 0700／0600；Windows 先移除目錄繼承並只授予目前 SID，再寫檔。
3. 在忽略的 `.env` 設定 `STORAGE_KEY_FILE`／`BACKUP_KEY_FILE` 的絕對路徑；只放路徑，不貼 key 到對話或工程。正式環境由受保護 secret mount 提供，容器映像不能帶 key。兩把 key、Better Auth secret、DB／服務設定分開安全保管；只拿到資料備份不能代替密鑰恢復。
4. `npm run db:migrate` 套用 005 的欄位及狀態表；`npm run storage:encrypt -- --server-stopped` 在單一交易及排他鎖中逐批轉換既有正文，清空原 plaintext 欄位，加入禁止明文的資料庫約束。失敗回滾，不能用清空既有資料通過檢查。
5. 啟動新 Server。缺 key、錯 key 或未完成轉換會拒絕啟動；沒有讀明文 fallback。舊 binary 的明文寫入亦被約束拒絕，不能回退後繼續寫。

轉換不等於安全抹除既有磁碟區塊、WAL 或舊備份。P1 只用合成資料；正式部署使用加密儲存，歷史明文副本依保留規則處理。不要刪除唯一密鑰或唯一已核驗備份；本包未提供在線密鑰輪替。

## 最小加密備份與還原

- 使用 PostgreSQL 18 的 `pg_dump`／`pg_restore`。預設從 PATH 執行；本機 Docker 可設 `PG_TOOL_CONTAINER` 為指定 PostgreSQL 容器，連線只限 loopback 設定並轉為容器內 5432。資料庫名稱限英數及底線；連線 query 僅接受 `sslmode`，不能悄悄忽略其他連線參數。
- `npm run storage:backup -- <新檔案絕對路徑.ybak>`：核對儲存 key，完整 custom-format database snapshot 以不同 backup key 加密，原始 archive 不落磁碟。錯誤或 stderr warning 視為未通過；不覆蓋已有檔案。P1 上限 64 MiB 壓縮 archive，超限須後續擴充，不盲目增加記憶體。
- 包含帳號／密碼 hash、空間、孩子、記錄、聊天、用量、刪除標記、schema 及 migration 狀態；不包含臨時 session／verification 資料、叢集 roles／tablespaces、外部設定或密鑰。還原要重新登入，目標服務角色須另外配置。P1 尚無附件／知識／任務，不假稱完成 P4 災備。
- 另建 `template0` 的空 DB，保持新舊 Server 停止寫入。把還原命令程序的 `DATABASE_URL` 指向空目標，保留原 storage／backup key 路徑；執行 `npm run storage:restore -- <備份.ybak> --empty-target-server-stopped`。工具拒絕非空目標；完整 GCM 驗證後才把 archive 送入單一交易 pg_restore，不使用 `--clean`／`--create` 覆蓋舊資料。
- 只還原可信來源的備份；GCM 不會把不可信來源 SQL 變安全。完成後先保持目標停止／AI 關閉，核對 schema、帳號登入、正文／關聯、用量及刪除標記，再由操作人員決定啟用。沒有自动換 URL、启動模型或双主切換。

## 必要刪除

已登入 owner 經二次確認，可刪除所選孩子及其全部照護文字、私人聊天／回覆、相關 AI attempt metadata；本頁相應草稿／緩存一併清理。保留孩子 ID／workspace／刪除時間的最小標記及每日已用配額，不保留正文、不因刪除退回調用額度。其他帳號、其他孩子及已保存資料不受該次操作影響；過期畫面不能用舊 ID 再寫入。

已存在的加密備份是建立時的快照，刪除不會改寫它們。應按保留政策撤回過時備份，還原前核對快照時間與刪除要求；完整跨環境刪除／遷移協調由 P4 S15 接續，不能聲稱本包會自動清除所有歷史副本。


<a id="account-erasure-journal"></a>
## P2 帳戶退出與舊備份抑制

035起，API／worker在開放前必須讀取工程外的目前刪除journal並重放；缺檔、認證失敗、錯identity或截短chain拒絕啟動。此段補充上方P1歷史邊界，不能再只依舊DB中的刪除標記。每個部署使用自己的journal，不能還原為備份當天的旧副本。

1. 保留原storage key及配對加密備份，停止API／worker。先按部署環境建立受保護的父目錄（POSIX0700；Windows僅目前SID／SYSTEM／Administrators），設定ACCOUNT_ERASURE_JOURNAL_DIR為其中尚未建立的獨立子目錄。
2. 套034／035後，只在首次建立部署執行npm run account:journal -- initialize，再執行npm run account:journal -- bind。工具不覆蓋既有檔案，不把不同journal綁到已有DB；後續只用replay。
3. journal每筆意圖先fsync再SQL；確認後的SQL失敗沿原意圖恢復，不換opId。照片仍經原刪除佇列清理，收據attachmentsPending與DB完成分開。
4. 空庫還原及照片manifest核對完畢後，使用**目前**journal執行npm run account:journal -- replay，再核對照片清理與權限；原worker世代保持暫停。API／worker亦重做此啟動閘，不能回退到不懂journal的舊binary。
5. 加密DB備份排除session、verification及auth_mail_outbox資料；還原不重發舊驗證郵件。journal與backup分開安全保存及備份，密鑰再分開；實際保留／異地恢復安排由A09交付，不宣稱本機journal能抵禦整台主機丟失。

已刪帳戶的收據只回處理狀態；下載／刪除契約見[API](API.md#p2-a08-service)。完整跨Server搬遷仍非本包範圍。
