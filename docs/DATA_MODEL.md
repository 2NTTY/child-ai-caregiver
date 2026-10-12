# 数据模型、版本与不变量

**實作與目標分界：**下文 PostgreSQL／Better Auth／pg-boss 專項保留原機制及證據；依 [ADR-024](DECISIONS.md#adr-024)，正式 SQL 接點改用 Firestore，原 VM／Node／Compose／Caddy 及網站繼續沿用。Firebase Auth、Storage、Tasks 的既有接線按實際範圍復用，不表示全部功能已遷移。現行契約見 [Firestore 接點](#firestore-target)，已合併／未合併／待驗只見 [PLAN](../PLAN.md#active)。

本文件管穩定契約／設計，不維護包進度或即時部署。實作與未驗項見 [PLAN](../PLAN.md#roadmap-packages)，運行觀察見 [STATUS](../STATUS.md#deployment)，測試結論只按所連 EV 的版本／範圍解讀。

本文件唯一維護已確定的概念實體、字段含義、關係、終態、版本及遷移格式。現行 Server 模型依 [ADR-008](DECISIONS.md#adr-008) 替代本地主庫及離線操作模型，保留既有錨點。不是已生成的 schema；SQL 類型、索引／約束名及序列化細節見 [待實施細化](DECISIONS.md#deferred)。各包只落實當前所需字段，不提前建立全部對象。

<a id="section-3-2"></a>
## 3.2 数据存储

<a id="data-3-2-11"></a>
附件记录保存稳定 ID、相对路径、类型、大小和哈希，不依赖某个云厂商的永久 URL。

<a id="p1-account-workspace"></a>
## P1 帳號與私人資料空間

S06-W03 的 Better Auth user／session／account／verification schema 由固定 1.7.5 adapter 的 migration 管理。應用程式 `workspaces` 表保存 UUID `id`、唯一 `owner_user_id`（外鍵指向 auth user）、UUID `storage_epoch` 及 Server `created_at`；刪除帳號時此表跟隨刪除。P1 每個帳號只有一個私人資料空間；P2 才增加家庭成員及共享權限，不把這個單一 owner 欄位當作完整家庭模型。

建立資料空間以 unique owner 約束及 upsert 處理重複／並行請求，身份只取 Server session；讀取 SQL 必須同時限制當前帳號。`app_migrations` 保存已套用的應用程式 migration ID／checksum；既有 migration 不回寫，改變時新增 migration。執行 migration 不清空既有帳號或業務資料，重啟沿用同一 PostgreSQL volume。

<a id="p2-family-data"></a>
### S06-W02 家庭延伸

新增 `006-family-access`，不改寫 P1 migration 或重建資料。`workspaces.owner_user_id` 保留唯一 owner 及原孩子加密歸屬，新增 `access_version`；`family_members(workspace_id,user_id)` 唯一保存 caregiver／viewer。撤權刪除資格，不刪該成員的私人聊天；失去孩子存取權後不能再讀寫，其他成員亦不能取得其私聊。

`family_invitations` 保存 UUID、workspace、token SHA-256、加密收件電郵、角色、建立者／時間、到期、接受者／時間及撤銷時間。只在建立回應提供 32-byte 隨機碼，原碼不落 DB／URL／日誌；已接受與已撤銷互斥，終態不還原成 pending。電郵密文 AAD 綁 workspace／invitation，接受及角色修改在 workspace 排他鎖內核對。owner 管理邀請與成員時更新權限版本；接受的原終態保留，以防舊碼恢復撤權。

`notification_preferences` 以 user ID 唯一保存加密偏好、version 及更新時間；沒有資料時回預設 version=0，首次保存後為 1。偏好與成員角色、任務外發授權及渠道訂閱分離。新表由既有完整 pg_dump／加密還原涵蓋；workspace／user 外鍵維持刪除關係，不引入另一份明文備份。

新增資料讀寫以 [API 家庭範圍](API.md#p2-family-http) 為準。孩子稱呼 AAD 仍用 workspace 原 owner，文字記錄仍用原作者；授權新照顧者讀取時不重加密、也不以 caller 改變歸屬。以下 P1 章節保留原落地背景，其 owner-only 讀取由 S06-W02 的角色授權延伸。

<a id="p1-child-record-data"></a>
## P1 孩子與原始文字記錄

S03-W01 的 `children` 屬於既有私人資料空間，保存 UUID、稱呼及 Server 建立時間；`text_records` 關聯孩子與作者，保存 UUID、完整文字原文及 Server 建立時間。這個時間是 Server 收到記錄的時間，不解析或冒充文字描述的事件發生時間。原文不經 trim、數值轉換或 AI 改寫。

讀寫以孩子 → 資料空間 → 已登入 owner 核對權限；作者只由 Server session 決定，不能透過請求 body 代寫別人的資料。新增 `002-child-records` migration，保留 `001-workspaces` 的 SQL 及 checksum；升級不重建資料庫或刪除原有帳號。P2 才加入完整照顧事件、修訂、家庭共享及一致性字段；P1 本包沒有建立空白通用實體框架。

<a id="p2-confirmed-records"></a>
## P2 確認記錄與孩子檔案（S05-W02）

`007-confirmed-records` 沿用 `text_records` ID、孩子及原作者，新增 `version`、加密結構資料、最後確認者及時間。原文仍在既有加密欄位；更正先保留舊版本，再以同一交易更新目前值及新增 `text_record_revisions`。P1 記錄的原有提交已是明確保存，版本為 1；沒有獨立結構資料時保留為 note，不事後猜出事件時間或數值。首次更正前才保存其歷史快照，不批量重寫原文。舊 P1 讀取入口取得最新確認文字。

結構資料保留種類、數量原寫法／單位／精確或約數、事件時間原文／精度／時區、使用者填寫的來源。只有明確 exact 事件時間才可帶絕對時間；模糊／未知維持 null，不將 Server 保存時間當作發生時間。結構化數量仍是原寫法，摘要的數值解析及計算另由 S14 處理。每次修訂保存原因、確認者、Server 時間及完整內容，歷史每頁 50 版；版本衝突回 409，客戶端保留當前草稿，不靜默覆蓋。

`children.profile_version` 由 0 開始；`child_profile_revisions` 保存加密的整份已確認檔案、來源、適用期限（可未知）、確認者／時間及更正原因。年齡是 unknown、出生日期或約數原值／單位／基準日期的互斥依據，預產期及早產資料分開保存；本包不計算矯正年齡或推造生日。地區、語言、過敏、特殊需要、偏好未知時為 null。使用者明確確認共享才保存，不讀取或自動提升私人聊天；候選事實及模型記憶服務在 S09／S11 接入同一權威資料。

上述新增正文及來源全部加密，AAD 綁孩子／記錄／版本；原文字段仍綁原作者。按權限永久刪除一則記錄會刪全部修訂並保留 `deleted_records` 最小 ID／孩子／版本／時間標記；永久刪除檔案清除全部檔案版本，孩子上的版本繼續遞增以拒絕舊寫入。更正不是永久刪除。owner 刪除孩子時外鍵連帶清除上述資料；既有完整加密 pg_dump 涵蓋新表，備份時間點及保留政策不變。

時間軸按 Server 首次加入時間排序，事件時間另呈現；搜尋只在有權孩子範圍內，Server 每頁最多解密 200 筆、回最多 50 筆匹配，游標保留 PostgreSQL 微秒及 ID。同一分頁可能無匹配但仍有下一頁，不能宣稱整庫無結果；不建立明文全文索引。S07-W03 啟用後，新 cursor 加入 workspace changeSeq，資料改變即拒絕續頁並要求重讀；這是拒絕混合頁面，並非長期保留資料庫 snapshot。舊 cursor 相容但沒有此保證。

<a id="p1-chat-data"></a>
## P1 私人聊天原文

S09-W01 的 `chat_messages` 保存 UUID、孩子、私人聊天擁有者、作者、user／model 角色、完整原文、回覆關係及 Server 時間。user 作者必須等於當前擁有者；model 作者為 null 並引用同孩子、同擁有者的 user 訊息，不能冒稱照顧者。每則 user 訊息最多一則 model 回覆。HTTP 只容許建立 user 訊息；model 寫入只供 Server orchestration。

權限同時限制孩子的私人資料空間及聊天擁有者；不因未來有家庭管理員便公開私人聊天。列表取最近 100 則後依時間由舊至新返回，不按天清除；完整搜尋、修訂及長期記憶仍屬後續包。004 遷移只新增資料表及索引，不改寫原遷移或刪除既有資料。

<a id="p1-encrypted-data"></a>
## P1 加密欄位與必要刪除（S05-W01，本機已驗證）

005 新增 `children.display_name_encrypted`、`text_records.text_encrypted` 及 `chat_messages.text_encrypted`；舊欄位先容許 null，另由明確的停服升級工具在交易内轉換原文。成功後密文欄位 NOT NULL、舊欄位 CHECK 必須為 null，`storage_security` 保存版本及受同 key 保護的驗證值。舊 migration 不改寫，轉換失敗回滾，不更換原記錄 ID、作者、時間或關聯。

owner 刪除孩子時，現有外鍵連帶刪除照護記錄、聊天及該孩子的 AI attempt metadata；同一 SQL 保存 `deleted_children(id, workspace_id, deleted_at)` 最小標記。每日使用計數保留，不能藉刪除退回配額。API 不接受 caller 指定新孩子 ID，已刪 ID 的舊寫入失敗；P2 才補完整版本／一致性協議。舊備份的時間點狀態不自動重寫，還原及保留界線見 [操作說明](P1_STORAGE.md)。

<a id="section-4-3"></a>
## 4.3 在線操作及確認字段

| <a id="data-4-3-01"></a>字段 | 用途 |
|---|---|
| <a id="data-4-3-03"></a>`workspaceId` | 确定资料空间及权限边界 |
| <a id="data-4-3-04"></a>`storageEpoch` | 标识當前存储世代，阻止旧环境直接回放操作 |
| <a id="data-4-3-05"></a>`deviceId` | 识别发起设备 |
| <a id="data-4-3-06"></a>`opId` | 标识一次逻辑操作，重试时不改变 |
| <a id="data-4-3-07"></a>`entityId` | 标识被操作的记录、聊天或任务 |
| <a id="data-4-3-08"></a>`baseVersion` | 标识修改所依据的版本 |
| <a id="data-4-3-09"></a>`action` | 新增、更正、完成、取消、删除等动作 |
| <a id="data-4-3-10"></a>`payload` | 经验证的业务内容 |
| <a id="data-4-3-11"></a>`changeSeq` | Server 分配的權威變更序號 |
| <a id="data-4-3-12"></a>`cursor` | 客户端已接收的位置 |

<a id="data-4-3-13"></a>
关键区别：

- <a id="data-4-3-14"></a>`opId` 解决请求重复；
- <a id="data-4-3-15"></a>`baseVersion` 解决同时修改；
- <a id="data-4-3-16"></a>`storageEpoch` 解决迁移后旧端回放；
- <a id="data-4-3-17"></a>`changeSeq`／`cursor` 表示在線增量更新的位置，不代表本地離線業務副本或待寫入操作；

<a id="data-4-3-18"></a>
不使用设备时间来决定谁的修改一定正确。

<a id="online-storage"></a>
### S07-W03 持久操作與變更

`010-online-operations` 加入 workspace `change_seq`（bigint，HTTP 用十進位字串避免精度流失）、`online_operations` 及 `online_changes`。識別及版本契約見 [API](API.md#online-http)。Web 的 deviceId 是本頁傳輸實例識別，不是授權憑據或 P4 裝置登記。

- 操作以 `(user_id, op_id)` 唯一，保存 device／workspace／epoch、路徑、孩子關聯、業務狀態及 changeSeq。正規化請求 hash 及結果使用既有 cipher 加密；不另存明文業務 payload，AAD 綁本人／opId／欄位。原記錄原文不因 hash 正規化而修改。
- 變更以 `(workspace_id, change_seq)` 唯一；僅記種類、孩子識別、刪除旗標及可見範圍。查詢在目前授權下過濾，游標可越過本人無權讀取的序號；空頁不代表整個家庭沒有私人活動，不回傳其內容。
- 操作收據與業務變更共用一個 PostgreSQL connection／交易；外層才 commit。既有 store 的局部交易改作 savepoint，不使用另一 connection 或在持鎖期間呼叫模型／通知。
- 刪整個孩子時清除相關收據正文；刪一筆記錄時保守清除該孩子 care 類收據正文，刪檔案歷史時清除 profile 類正文。保留最少操作識別及加密 fingerprint，阻止舊建立操作復活；result=null 不是未確認。新台帳隨既有全庫備份保存，本包沒有新增備份還原演練。
- 舊直接寫入在 migration 啟用後也追加變更，但不獲得不存在的 opId 冪等保證。新記憶、任務及附件須由各自工作包接上相同授權／確認邊界，本包不預先實作它們。

S09-W02 的 `011-memory-online` 擴充既有台帳的 `memory` 種類，沿用相同原子提交及目前授權，不改寫已套用的 010 migration。記憶寫入取得 workspace UPDATE 後再鎖孩子；共享事件只含孩子及種類，私人事件綁本人。刪除單一事實／話題時，保守抹除該孩子所有 memory 收據正文而保留去重識別；此擴展已與 008 記憶資料完成獲准本機 SQL／重啟／刪除驗收，見 [EV-S09-W02](../artifacts/verification/S09_W02_CHECKS.json)。

<a id="section-4-5"></a>
## 4.5 冲突规则

<a id="data-4-5-01"></a>
首版不引入通用 CRDT 平台，使用版本检查和明确的业务规则：

- <a id="data-4-5-02"></a>不同记录可以独立合并。
- <a id="data-4-5-03"></a>同一内容同时修改时保留双方版本，提示用户处理。
- <a id="data-4-5-04"></a>疑似重复记录先提示，不自动删除可能真实发生的第二次事件。
- <a id="data-4-5-05"></a>更正保留历史，不静默覆盖原始资料。
- <a id="data-4-5-06"></a>刪除保留最小刪除標記，防止舊版本請求重新建立已刪除資料。
- <a id="data-4-5-07"></a>任务完成或取消后，旧操作不能重新变成待执行。
- <a id="data-4-5-08"></a>完成与取消同时发生时保留双方事件，显示待核对，不重新提醒。
- <a id="data-4-5-09"></a>重新开启已经结束的事项需要明确操作，形成新的任务或实例。

<a id="section-5-1"></a>
## 5.1 数据分类

| <a id="data-5-1-01"></a>类型 | 保存内容 |
|---|---|
| <a id="data-5-1-03"></a>家庭與孩子 | 最低必要資料、年齡依據／精度及日期基準、成員和權限 |
| <a id="data-5-1-04"></a>原始输入 | 文字、录音、图片、来源及录入者 |
| <a id="data-5-1-05"></a>照护事件 | 时间、事项、数量、单位、约数、确认状态 |
| <a id="data-5-1-06"></a>聊天 | 原始消息、作者、时间、附件和引用 |
| <a id="data-5-1-07"></a>确认事实 | 用户明确确认的稳定资料和偏好 |
| <a id="data-5-1-08"></a>话题状态 | 待回答、已回答、稍后处理、已解决 |
| <a id="data-5-1-09"></a>任務 | 安排、發生實例、授權版本、渠道綁定、投遞嘗試與完成／取消事件 |
| <a id="data-5-1-10"></a>官方知识 | 原文、来源、分段、版本、向量和审核状态 |
| <a id="data-5-1-11"></a>报告 | 数据范围、引用、生成版本和核对状态 |
| <a id="data-5-1-12"></a>审计 | 必要操作、授权、变更及执行结果 |
| <a id="data-5-1-14"></a>成長關注（P2） | 已核對規則、適用階段／來源、關注候選、處理歷史、抑制及主題停用；與任務／投遞分開 |

<a id="data-5-1-13"></a>
事件發生、輸入、Server 確認及客戶端最後取得資料的時間分開保存。空白不當零，約數不改成精確數字。

<a id="child-age-basis"></a>
### P2 孩子資料及年齡依據

- <a id="data-age-01"></a>出生日期可選；約數年齡保存原始值、單位、精度及對應日期，不推造出生日期。衍生年齡保存可追溯的計算依據，不能反過來升格為更精確的已確認資料；缺資料不阻止一般問答。
- <a id="data-age-02"></a>預產期／早產資料按需要確認，實際年齡與矯正年齡分開；每條關注規則明示採用何種年齡及官方依據，未知時不假定可用矯正年齡。地區預設香港但可核對；語言、過敏、特殊需要及家庭偏好只保存必要且已確認的內容、來源及適用範圍，不以語言推斷地區或醫療條件。
- <a id="data-age-03"></a>可見範圍與確認狀態分開；家庭背景判斷不能使用未獲准共享的私人資料。新增持久資料及更正／刪除關係納入既有加密、刪除及備份；完整匯出／遷移隨 P4 交付，不能遺漏新增類型。

<a id="section-5-3"></a>
## 5.3 已确认事实

<a id="data-5-3-01"></a>
事實包含內容、適用對象與可見範圍、來源、確認人、確認時間和有效狀態；有適用期間或失效條件時明確保存，未知不捏造統一有效期。確認與來源版本可追溯。

<a id="data-5-3-02"></a>
规则：

- <a id="data-5-3-03"></a>AI 提取先形成候选。
- <a id="data-5-3-04"></a>AI 提取或推斷的候選須經使用者確認才寫入長期事實，使用者直接提交的明確確認不必再機械重問；不確定、衝突或影響行動的內容先核對。私有轉共享須明示目標範圍並取得確認，確認事實不等於授權通知外發。
- <a id="data-5-3-05"></a>更正保留旧版本及来源。
- <a id="data-5-3-06"></a>过期事实可以停用。
- <a id="data-5-3-07"></a>外部貼文、分享內容、新聞或其他家庭經驗均是不可信輸入，不直接成為孩子事實、穩定規則或執行授權；須按既定確認流程處理。

<a id="section-5-4"></a>
## 5.4 长期记忆

<a id="data-5-4-09"></a>
摘要必须记录覆盖到哪条消息，避免漏段或重复总结。摘要只是辅助上下文，不能代替原始记录，也不能改变任务状态。

<a id="data-5-4-10"></a>
已回答、已解决和暂缓话题记录再次询问条件。不能因为新开会话或清空模型缓存，就重新问同一件已处理事项。

### S09-W02 已實作資料

<a id="p2-long-term-memory"></a>
`008-long-term-memory` 新增加密的 `memory_facts`／修訂、`memory_topics`／修訂及本人 `conversation_summaries`。身份、孩子範圍、版本、可見狀態及來源關聯供 Server 校驗；正文、來源描述、有效期間、再問時間／原因及摘要內容全部沿用 AES-GCM。AAD 綁孩子、原資料 ID 及版本，摘要另綁私人擁有者；不以當前讀取者重寫加密歸屬。

- 事實先為私人候選，明確確認後才按指定範圍生效；修訂追溯及來源版本保留。候選歷史不因最新版本共享而全部共享。照顧記錄／私聊來源有外鍵，來源刪除時其直接衍生事實及修訂一併清除；源記錄更正令事實失去當前適用性。
- 話題保存 `pending / answered / snoozed / resolved`；暫緩有明確到期時間，已回答／已解決只可因使用者明確重開另建關聯項目，原終態保留。話題不是任務或 occurrence，不能把「已解決話題」當作照護任務完成。
- 摘要保存本批精確覆蓋 ID、末項 ID、前一摘要關聯及版本；`summary_message_coverage` 以 message ID 唯一約束避免重複涵蓋。不是用不穩定的新增序號作覆蓋邊界；晚提交但時間較早的訊息仍保留未覆蓋身份，下次批次會納入。
- 權威檔案、照顧記錄、事實或話題的版本集合改變，或覆蓋訊息缺失時，舊摘要不再返回給 UI／模型。重建僅重設本人覆蓋關聯，保留既有加密摘要並標記失效；刪除單項記憶不擴大為刪除其他人的摘要。摘要不是長期權威來源，不能恢復被停用、刪除或更正的事實／終態。
- 單項記憶刪除有最小 `deleted_memories` 標記；刪除整個孩子沿用已授權的外鍵連帶刪除。新表由既有全庫加密備份涵蓋；新增表的空庫還原仍須後續必要驗收，不以 schema 存在作還原成功證據。

模型 context 的事實集合先排除 inactive 歷史項目，再套用既有 200 項完整集合上限；一般列表與歷史不變。inactive 本身不是目前不可用 key 的否決來源，候選、過期／變更來源的 confirmed 項及所有話題終態仍維持原防護。超過相關集合上限仍明示拒絕，不靜默遺漏可能衝突的有效事實。

實際 API 與限制見 [S09 記憶介面](API.md#p2-memory-http)。已確認年齡資料直接復用 S05 檔案，不建立第二份出生日期；完整任務台帳與模型接線分別由 S13-W01／S11-W02 交付。

<a id="agent-run-model"></a>
### 5.4A P2 Agent 運行與確認語義

<a id="data-ar-01"></a>
Server 運行紀錄關聯 runId、互動／背景觸發、資料空間／孩子與可見範圍、身份及授權／資料版本、pack／recipe／模型版本、狀態與停止原因、生成／工具／embedding 實際次數，以及既有 opId／occurrenceId／投遞識別。只保存必要結果與引用，不把整份模型協定或內部推理寫入工程／成本日誌；新增私人正文沿用加密、存取、刪除及備份規則。

<a id="data-ar-02"></a>
ADK session 只供單次工具循環使用，不取代已確認事實、摘要、任務或投遞台帳。跨運行待確認項保存穩定識別、種類、原事項／訊息、對象、展示範圍、內容版本及有效性；新 session 或清快取不消除待確認／unknown 狀態，也不復活已關閉／完成事項。

<a id="data-ar-03"></a>
恢復先關聯原邏輯工作及操作結果，重建 run 不重設有限重試／跟進或通知計數。呼叫取消、逾時及最終文字失敗與業務操作結果分開；已成功副作用保留成功、未知投遞保留 unknown，不因 Agent 運行失敗而回退成未執行。完整表名及 schema 隨工作包落實。

<a id="agent-run-implementation"></a>
S11-W02 的 migration 016 定義新增 `agent_runs／agent_proposals`。運行按本人、孩子、觸發類型及原訊息／提醒 ID 唯一；候選按 run／call ID 唯一，同 run 的等價候選透過解密內容比較去重，不另存私人內容 hash。結果、引用、候選、對象標籤及已執行結果以既有 AES-GCM 保存；只留必要身份／版本／狀態 metadata。孩子／來源訊息刪除沿外鍵清理，備份沿用全庫加密及停用 worker 的還原規則。各環境是否已套用須依該環境的日期／版本證據核對；2026-09-30 P2 交付環境的遷移紀錄見 [P2 交付](P2_DELIVERY.md#上線邊界)及[固定驗證](../artifacts/verification/S17_W02_CHECKS.json)，不代表其他環境已套用。

運行狀態為 running／completed／stopped／unknown；90 秒未結束的紀錄按中斷處理，未保存用量不可當零。候選 pending／accepted／dismissed／expired 與業務任務終態分開；24 小時期限及原授權版本／storage epoch 校驗不取代目標任務版本。接受或略過按原版本交易更新，失去回應後先 GET 原結果；新 session 不重建候選或重設期限。背景結果維持原接收者私有，但輸入只可使用家庭共享資料。

<a id="ordinary-agent-data"></a>
INT-W02 普通操作增補（migration 025）：本人／孩子的預授權保存內容版本、目前成員授權基準及 storage epoch；更改／撤回以原 operationId 和版本防重複，保留修訂。政策並非模型上下文中的布林授權；每個寫入交易重新讀取權威版本。直接操作收據連到原互動 run、使用者訊息、工具 call、政策版本及真正業務資源 ID／版本；同 run 等價動作及原 call 重試返回原結果，不再建立副本。普通記錄不以保存時間代替事件時間；沒有可對應的原文數字時刻時，保留原時間文字、at=null 及約數精度，不能靜默填 Server 現在時刻。驗收見所屬包證據。

政策產生的到期聯絡權限保留 task／policy／grant 版本關聯。撤回或改變通知範圍時，在同一交易停用仍由該政策管理的 grant；之後由本人另行修改的 grant 不受舊關聯覆蓋。操作收據是歷史結果，重放不能令旧政策重新生效；畫面另讀目前政策及任務狀態。

一般照護整理仍寫既有 care 資源，`confirmationBasis=preauthorized_user_statement` 區分本人預授權整理與逐筆確認，不能把它稱為已核實健康事實。普通私人交代另以 `provenance=user_statement` 保存同一本人／孩子的文字、來源訊息及更正版本；不複製成 MemoryFact、不向家庭成員公開。原聊天、普通交代、摘要及已確認事實是不同種類；更正／明確刪除使本人衍生摘要失效，之後依最新權威資料重建。私人交代與操作 payload 沿既有 AES-GCM 及 AAD 加密，孩子／帳號／來源刪除不得產生孤立或復活資料。

待確認索引直接查 `agent_proposals`／`agent_runs`，不新建另一個待辦主庫。它包含過期但尚未處理項，游標依完整時間精度與 ID 分頁；只讓本人在有孩子存取權時查找，與近期聊天／背景清單分開。過期候選保留追溯及明確略過入口，不能延長舊期限後直接接受。新前端與 Agent 都投影同一資源及收據，畫面文字不是第二份業務權威。

<a id="section-5-5"></a>
## 5.5 任务台账

<a id="data-5-5-01"></a>
任务系统区分：

- <a id="data-5-5-02"></a>任务安排；
- <a id="data-5-5-03"></a>某一次待办；
- <a id="data-5-5-04"></a>负责人；
- <a id="data-5-5-05"></a>通知投递；
- <a id="data-5-5-06"></a>用户确认完成；
- <a id="data-5-5-07"></a>取消、更正和审计事件。

<a id="data-5-5-08"></a>
每次发生使用稳定 `occurrenceId`。通知投递还包含收件人和渠道，不能因为技术重试另建任务。

<a id="task-ledger-storage"></a>
S13-W01 的 migration 012 使用 `care_tasks` 保存安排、`task_occurrences` 保存本次發生、`task_revisions` 保存每次動作及快照。首版手動安排一項對應一個 occurrence，不預建通用週期引擎；投遞、關注候選及關注處理結果不混入任務狀態。標題、正文、負責人、時區、原因／完成備註及 revision 均加密；只留識別、版本、到期時間及狀態供查詢。AAD 綁定孩子／任務／版本／occurrence，與當前讀取者無關。

安排及 occurrence 共用一個版本，寫入在 workspace 排他鎖後重新核對成員及指派資格；台帳、revision、change feed 及原 opId 收據同交易。完成／取消的同基準並發保留兩個事件並進入 `needs_review`，顯式 resolve 只能落到 completed／cancelled；舊終態不復活。改期不改識別。所有三表隨孩子刪除 cascade，舊收據正文沿用孩子刪除 trigger 清除；全庫加密備份自動包含新增表，擴展後空庫還原仍須按後續批准範圍驗收。[實際 HTTP 契約](API.md#p2-task-http)

<a id="notification-model"></a>
<a id="task-worker-storage"></a>
S13-W04 的 migration 013 新增 `task_work`（task＋version 唯一、occurrence、workspace storage epoch、worker generation、目前 framework jobId、檢查時間、累積失敗及加密確認者參照）、`worker_control`（執行開關及世代）、`task_reminder_batches`（收件人／類型／本地日或 occurrence 的唯一站內批次）及 `task_reminders`（occurrence＋initial／follow_up 唯一）。提醒無重複正文；確認者 payload AAD 綁 workId，取正文仍經原任務權限。任務刪除 cascade 工作及提醒；空批次只留不含孩子／正文的分類 metadata。pg-boss schema 42 保存 UUID 參照及框架狀態，成功／失敗保留及清理由固定框架配置處理，不複製私人正文。

同一收件人的普通提示按其本地日合併到一個 open 站內批次；sealed 預留後續外發快照的封存語義，本包不自動封存或外發。改期保留 occurrence，不能重置一次 initial／一次 follow_up 的上限。終態、版本不符或指派失效的舊提醒不在當前清單呈現。還原包含兩套 schema，完成後輪換 worker generation 並強制暫停；人工核對啟用只重排有效 pending 工作，不自動重開 failed／unknown／stopped 或照護終態。框架租約不是產品授權，備份中的 active job 亦不是已完成證據。

<a id="data-5-5-09"></a>
P2 任務及外發須保存以下必要語義；實際表名、欄名及枚舉於相應工作包定稿，不建立通用渠道或授權平台：

- <a id="data-5-5-10"></a>**授權及版本：**授權人、資料空間、適用對象、允許的內容／動作、渠道、觸發／跟進與 fallback 範圍、版本、生效／撤銷狀態及時間。每次執行記錄所核對版本，舊版本不是繼續執行的許可。
- <a id="data-5-5-11"></a>**渠道綁定：**收件帳號／成員、渠道身份或裝置訂閱、安全保存的投遞目標、綁定核實時間及啟用／失效／撤銷狀態。Telegram 包含已啟動 bot 及帳號連結的核實；綁定不等於任意外發授權。
- <a id="data-5-5-12"></a>**投遞嘗試：**穩定投遞識別、occurrenceId、收件人、渠道、綁定及已核對授權版本、內容版本／參照、嘗試時間、渠道接受／拒絕／未知結果、可用供應商識別與回執，以及重試次數。送達／已讀僅有實際證據時記錄，與任務完成分開。
- <a id="data-5-5-13"></a>**Fallback 與終止：**源投遞、觸發原因、適用授權規則、下一渠道／對象決策及停止原因；區分完成、取消、撤權、超出授權、重試耗盡、無可用渠道及等待未知結果核對，不無限升級或默認成功。
- <a id="data-5-5-14"></a>**Worker 恢復：**穩定工作識別、到期／觸發來源、租約擁有者與期限、嘗試及最後執行結果。租約到期只允許重新核對，不能證明外部投遞失敗；重啟須先檢查台帳、當前授權及任務終態。

<a id="data-5-5-15"></a>
授權撤銷、任務取消／完成與新投遞的檢查須協調，停止後續執行；已被外部渠道接受的訊息不保證撤回，保留實際結果。unknown 不是 failed 或未發送；在原結果核對前不盲目重試或 fallback。模型輸出、分享內容及公共來源不能直接建立或擴大授權。

<a id="growth-attention-model"></a>
### 5.5A 關注及控制資料語義（P2）

以下業務語義保持有效；S13-W08 的實際保存見下方，不把候選、任務及投遞串成一條狀態機。

| 識別／資料 | 必須保存的語義 |
|---|---|
| <a id="data-ga-01"></a>關注規則 | 穩定規則／主題識別、規則版本、適用地區／年齡依據／階段／必要事實、觀察／安排／諮詢類型、官方片段／版本、核對及發布／停用狀態；產品觸發窗口與官方適用期分開 |
| <a id="data-ga-02"></a>關注候選 | 穩定識別、孩子及可見範圍、規則／來源版本、當次觸發及事實版本依據、為何現在、建議及限制、建立時間、待處理／接受／暫緩／關閉／失去適用性的語義、操作者／時間及可選備註；與任務／occurrence 的關聯 |
| <a id="data-ga-03"></a>抑制與再提出 | 同一範圍、孩子、主題、階段及實質依據的去重關係、暫緩至何時、關閉原因／處理結果、前次候選關聯及新實質依據；舊終態不改寫。紀錄主題永久停用／明確重新啟用及操作者，停用不因新依據自動失效 |
| <a id="data-ga-04"></a>個人通知偏好 | 接收者、時區、渠道啟用／退訂、安靜時段、合併普通提示及跟進計數、明確選擇的預約例外；與家庭事項狀態／執行授權分開。預設值由 [SPEC](../SPEC.md#req-5-10-13) 維護，不在 adapter 另定 |

<a id="data-ga-05"></a>
無紀錄保持未知，不寫成否定事實；建議安排不寫成已預約。過期／失去適用性不等於完成；暫緩／改期保留既有任務及 occurrence 的邏輯關係，不因重試建立第二份。家庭共享處理結果對當前有權成員可見，個人退訂不改共享終態。

<a id="data-ga-06"></a>
原始正文／私有來源及其引用繼續按資料權限、刪除規則處理，不以審計或抑制為由永久保留已刪正文；只保留防止舊版本復活所需的最小標記。來源停用或規則不再適用時記錄原因並停止使用其生成／外發關注，保留獲授權的歷史追溯而不冒充仍有效；已確認預約不因公共來源變動而刪除或冒充取消。


<a id="growth-attention-storage"></a>
#### S13-W08 保存實作（migration 017）

- `growth_attention`／`growth_revisions` 保存候選與處理版本；`growth_topics`／`growth_topic_revisions` 保存永久停用及明確近況操作；正文用既有 cipher／穩定 child、項目及 revision AAD 加密。孩子刪除連帶清除。每孩子／主題只有一個 proposed 或 snoozed；accepted、dismissed、inapplicable 終態不復活。
- 基準由階段、該規則實質版本、已核對片段 hash 及有限枚舉近況構成；原始記憶正文、私人聊天、原私人引用不複製到關注。另存 profile／相關已確認共享 fact ID 及版本供追溯。來源抓取時間、無關事實版本、更正文案不單獨構成新依據；變回歷史相同基準也不重提。只剩未知不當作新的已確認資料。
- 首版每孩子最多讀取 500 個歷史基準，超出即拒絕並要求人工核查，不截掉去重證據後繼續生成；列表顯示全部活躍事項及最近 30 項歷史，舊記錄仍留台帳。
- `growth_checks` 只存下一個有意義的評估時間、目錄版本及至多三次失敗計數；共享資料、来源實質狀態改變把相應評估標為到期，私人資料不觸發家庭判斷。有效期、年齡邊界及暫緩期限可觸發評估；失敗上限可見，沒有宣稱已處理。
- 候選接受可連原任務或在同一交易新建已確認任務，保留單一 occurrence；投遞仍屬其他台帳。公共來源失效只停止該關注建議，不改已確認預約／任務終態。

<a id="section-5-6"></a>
## 5.6 官方育儿知识库

<a id="data-5-6-09"></a>
每个来源保存：

- <a id="data-5-6-10"></a>标题、发布机构及 URL；
- <a id="data-5-6-11"></a>正文和章节位置；
- <a id="data-5-6-12"></a>年龄、主题及适用条件；
- <a id="data-5-6-13"></a>官方发布日期／修订日期；
- <a id="data-5-6-14"></a>团队抓取与查核时间；
- <a id="data-5-6-15"></a>内容哈希、版本和审核状态；
- <a id="data-5-6-16"></a>使用条件及失效状态。

<a id="data-5-6-17"></a>
不能把重新抓取日期当成官方更新时间。

<a id="data-5-6-18"></a>
每個公共知識項目另保存下列語義；實際欄名可在相應工作包定稿，但不得合併成一個含糊時間：

- <a id="data-5-6-19"></a>`knowledgeClass` 或等效分類：`stable guidance`／`recent news`；同一來源可有兩類項目；
- <a id="data-5-6-20"></a>`sourceId`、原文 URL、標題、摘要及發布機構，用於引用及基本去重；來源清單注明可用類別：穩定指引只接受官方來源，指定媒體只接受為近期資訊，不另建媒體評分模型；
- <a id="data-5-6-21"></a>`publishedAt`：來源首次發布時間；
- <a id="data-5-6-22"></a>`updatedAt`：來源明示的內容修訂時間；
- <a id="data-5-6-23"></a>`fetchedAt`：本次成功取得內容的時間；
- <a id="data-5-6-24"></a>`lastSuccessfulCheck`：最後一次成功完成查核的時間；
- <a id="data-5-6-25"></a>官方生效／失效日期或適用期、內容 hash、發布審核狀態、來源啟用／失效狀態及最後錯誤狀態。

<a id="data-5-6-26"></a>
七日是近期資訊的預設查詢窗口，不寫入官方有效期欄位。擷取或查核時間不能冒充 `publishedAt`／`updatedAt`；更新失敗只更新錯誤狀態，不推前 `lastSuccessfulCheck`。近期資訊不能轉成孩子事實、長期育兒規則或任務安排。

<a id="knowledge-vector-model"></a>
### 5.6A P2 公共向量知識語義

- <a id="data-kv-01"></a>片段關聯來源、內容版本、章節／位置、原文、適用條件及內容 hash；向量關聯片段 hash、embedding 模型、維度、處理版本、生成狀態及時間。公共向量庫不收私人聊天、家庭事實或任務記憶。
- <a id="data-kv-02"></a>核對、發布、停用及向量準備狀態分開；核對且所需向量完成才發布新版，不把生成失敗當作空向量成功。保留已發布版本與歷史引用關係；已知失效即停止檢索，不能為等待新版而繼續使用。
- <a id="data-kv-03"></a>正文未變且模型／維度／處理版本相同才可復用向量，變更只更新受影響片段；不混用不相容向量。同次查詢復用保持當前 run 及適用條件，不讓私人查詢流入跨家庭共享資料。
- <a id="data-kv-04"></a>檢索結果關聯片段／來源版本及實際檢索模式、降級／不可用原因；向量距離或排名不等於建議支持證據。正文仍須可逐項引用，模型不能產生不存在的片段識別。
- <a id="data-kv-05"></a>P2 記錄相容 PostgreSQL／pgvector 版本及必要恢復前置，空目標先具備相容擴展，不能缺擴展仍宣稱還原完成。P4 的管理／批量維運及完整遷移沿用這些資料，不建立第二套向量／引用事實來源。

S10-W01 的 [009 migration](../server/migrations/009-public-knowledge.sql) 已通過必要真 DB／embedding／還原驗收：`knowledge_sources` 保存啟用狀態／活躍版本；`knowledge_versions` 保存不可變內容、核對／發布及日期語義；`knowledge_chunks` 保存短原文、核對轉述、適用性及 hash；`knowledge_vectors` 以真正 embedding 輸入 hash＋模型／維度／pipeline 重用。`embedding_attempts` 分 query／maintenance，公共文件可記 document hash，私人查詢不保存正文或 hash。停用標 withdrawn 且保留舊正文／核對依據；重新發布先重核。這些公共資料不替換原私人加密表；備份還原須涵蓋 vector extension 及全部表。

<a id="knowledge-a04-model"></a>
P2-A04 沿同一來源／版本／片段權威，增加可選 `originalText` 與實際 PDF 頁碼；來源的 extraction 保存正文／檔案 hash、格式、選取頁及技術覆蓋，不把抽取文字成功等同原意完整。舊片段只有短摘錄時，繼續標示 excerpt-only；不能把已核對轉述冒充全文。

新增的版本語義審核證據綁 source、候選版本／hash、當時 active 版本及來源 observation。審核保存實際變動／移除的 key、舊新引文、含義比較、關鍵限制、代表問題及規則影響；hold 與 approve 分開，只有仍對應當前觀察且向量齊備才發布。歷史發布前證據不回寫成已通過新門檻；後續換版、停用重啟須按新門檻核對。

查詢假設只屬當次受限檢索情境，保留本人使用者訊息或檔案版本依據及不確定性；不寫入孩子年齡／事實。conditional／requires_clarification 的片段不是精確資格。引用快照記錄實際讀過的固定版本與範圍；它是可追溯副本，不能另行修改知識權威。

<a id="knowledge-refresh-model"></a>
S10-W02 的 [014 migration](../server/migrations/014-knowledge-refresh.sql) 增加三張公共維護表：`knowledge_watches` 保存固定來源定義、條款核對、啟用／配置版本及最後嘗試／成功狀態；`knowledge_observations` 保存每個原 URL 的最近正文指紋、可核對內容、來源日期、抓取／成功時間及人工批准所指向的既有版本；`knowledge_source_checks` 以 job ID 保存一次結果，避免同一 job 重領重寫效果。首次或 hash 改變只形成候選，不另建一套向量／發布模型。

穩定頁以既有 source ID 對應；RSS 項目以 feed ID＋正規原 URL hash 作穩定識別，重排／重入不新建同一項。feed 不再列出某項不等於官方撤回，其最後成功時間不更新，近期檢索自然失去新鮮度；404／410、來源停用則立即排除。原版本／向量及核對歷史保留，觀察頁不是完整網站存檔。三表與原生 schedule／job 一同備份；還原沿用 `worker_control` 暫停及新世代，不能因保留 cron 而恢復網絡抓取。此新增接線仍待本包必要 DB 驗收。

<a id="section-6-2"></a>
## 6.2 通用迁移格式

<a id="data-6-2-01"></a>
相容 Server 遷移包採用版本化的：

<a id="data-6-2-02"></a>
**JSON／JSONL 数据＋原始附件＋校验清单＋元数据。**

<a id="data-6-2-03"></a>
包含：

- <a id="data-6-2-04"></a>数据格式与应用版本；
- <a id="data-6-2-05"></a>资料空间标识及存储世代；
- <a id="data-6-2-06"></a>聊天、事實、記錄、話題、任務、授權版本、渠道綁定、投遞嘗試及完成憑證；
- <a id="data-6-2-07"></a>权限关系及设备迁移信息；
- <a id="data-6-2-08"></a>附件路径、大小和哈希；
- <a id="data-6-2-09"></a>知识来源与版本；
- <a id="data-6-2-10"></a>embedding 模型、维度和可选索引数据；
- <a id="data-6-2-11"></a>导出时间和完整性检查结果。

<a id="data-6-2-12"></a>
公共知识库可单独备份或重建，普通家庭搬迁不必携带全部公共向量库。

<a id="section-9-6"></a>
## 9.6 成本统计与上限

<a id="data-9-6-01"></a>
记录：

- <a id="data-9-6-02"></a>功能、模型及调用次数；
- <a id="data-9-6-03"></a>输入／输出 token；
- <a id="data-9-6-04"></a>缓存 token；
- <a id="data-9-6-05"></a>embedding 数量；
- <a id="data-9-6-06"></a>延迟、错误及重试；
- <a id="data-9-6-07"></a>估算模型费用；
- <a id="data-9-6-08"></a>数据库、附件和服务器使用情况。

<a id="data-9-6-09"></a>
P2 使用量區分生成、查詢 embedding 及語料維護；按實際 API 嘗試記錄並關聯 run／維護工作及獲授權歸屬，不把整個 Agent run 當一次呼叫。拒絕／失敗工具也計入運行上限，維護批次另有有限額並受全局控制；成本欄位不保存查詢正文、私人資料或憑據。配置唯一來源見[架構](ARCHITECTURE.md#p2-agent-budgets)。


<a id="p2-web-push-storage"></a>
### P2 Web Push 持久化（S13-W05）

migration 015 的 web_push_subscriptions 以 user_id 歸屬本人，保存版本、狀態、provider、public VAPID key 及時間。endpoint／keys／標籤用既有 AES-GCM 加密，AAD 綁本人及 subscription ID；active 保存唯一 endpoint SHA-256，撤銷／供應商失效清除 hash／密文。其他家庭成員無讀取權。

web_push_deliveries 保存本人、綁定及版本、worker_generation、嘗試／結束時間、有限原因／HTTP status；job 只存 deliveryId，同 ID 原子入列。先 commit sending，外發前重核綁定／世代；重新領取 sending 標 unknown，不再外發。還原沿用 worker 暫停／新世代，舊投遞不能重發。刪 user cascade 綁定／投遞；刪孩子不等於撤銷本人通用渠道。

本包僅固定一般測試，不保存家庭正文或更改照護任務終態。[HTTP 契約](API.md#p2-web-push-http)／[通知模型](#notification-model)。

<a id="relations"></a>
## 已确认关系的索引

下表解释上述概念如何关联，不重复另定义字段。

| 对象关系 | 权威定义／约束 |
|---|---|
| 資料空間、家庭、孩子、成員、裝置 | 在線字段 workspaceId／deviceId；P1 帳號隔離、P2 家庭權限由 [API 身份與權限](API.md#section-3-4) 定義 |
| 原始输入 → 确认事件／事实 | [数据分类](#section-5-1)、[事实来源与修订](#section-5-3)；保留原输入和确认来源 |
| 消息 → 摘要覆盖 → 话题状态 | [聊天持久保存](../SPEC.md#section-5-2)、[摘要与话题不变量](#section-5-4) |
| 任务安排 → 稳定发生实例 → 投递／完成／取消事件 | [任务台账](#section-5-5)、[终态和并发冲突](#section-4-5)；投递不是用户完成 |
| 官方来源 → 内容版本 → 分段／向量 → 报告引用 | [来源元数据](#section-5-6)、[索引更新](ARCHITECTURE.md#section-5-7)、[报告范围与证据](../SPEC.md#section-5-8) |
| 業務請求 → Server 事務確認 → 在線更新游標 | [SyncOperation 字段](#section-4-3)、[事務及確認過程](ARCHITECTURE.md#section-4-4)；不含持久離線 outbox |
| 任務 → 當前授權版本 → 渠道綁定 → 投遞／fallback | [任務與投遞模型](#notification-model)、[API 渠道契約](API.md#notification-contract)；渠道證據不等於使用者完成 |
| 删除／撤权 → 副本、索引、缓存清理 | [删除与隐私](../SPEC.md#section-5-9)、[设备撤权](../SPEC.md#section-4-8)，保留必要防复活标记 |

SyncOperation 保留為在線操作字段組的引用名，不代表離線同步框架。上述新增授權／投遞語義尚未固定 schema；更細的合法轉換在 S07、S09、S13 相應包補充，須符合完成／取消不復活、執行重查授權及未知投遞不盲重發等不變量。

<a id="telegram-storage"></a>
## P2 Telegram 持久資料

migration 018（S13-W06，未執行）加入 telegram_challenges、telegram_bindings、telegram_deliveries、telegram_updates 及 telegram_meta。沿用本人 workspace／user 的固定鎖順序、原 opId 收據及私有 preferences 變更事件；不建立新的家庭角色。

- challenge 保存期限、原 storage epoch、版本、token hash，token／候選身份以既有 AES-GCM 及本人／ID AAD 加密；seen 並不代表已綁定，須網頁明確確認。
- binding 的 chat／sender ID 分開加密，名稱只作顯示；以加密保存的隨機 HMAC key 建立穩定身份索引，避免將可枚舉的數字身份直接 hash。撤銷／封鎖清除身份密文及索引，歷史投遞仍留狀態。
- delivery 保存原 binding 版本、worker generation／storage epoch、狀態／時間及 provider message ID；callback secret 加密，queue 只存 delivery ID。發送前先保存 sending，再短交易重查資格後單次外發；不在持鎖時呼叫 Telegram。
- update 以 bot ID＋update_id 唯一，與綁定／回應效果同交易，保存固定 outcome 而非正文。不依賴 ID 永遠遞增；不將 callback 或 answerCallbackQuery 當任務完成。
- 再領 sending 成為 unknown；框架 job 已失效／取消／不存在時，有限批次復核將 queued 轉 stopped、sending 轉 unknown。已撤銷、世代或 epoch 不符的 queued 不外發，還原沿用 worker 暫停閘。密鑰、備份及空庫還原行為仍待集中真 DB 核對。

個人綁定不是家庭授權。S13-W07 才加入任務／對象／披露範圍與渠道的連結，不能從本包的一般測試推論已完成主動聯絡。

<a id="care-summary-storage"></a>
## S14-W01 摘要來源與到診草稿

摘要每次從當前已確認記錄／檔案及任務計算，不另存第二份家庭事實或把私人聊天提升為共享。來源帶 record ID／version／source／更正原因；孩子年齡沿用原精度及日期基準。現行寫入只容許 exact 事件時間有 at，約數／未知事件時間不列入期間統計；quantity 的約數保留。純計算函式可保留型別容許的約數時間輸入，不改既有寫入規則。

[020-care-summaries.sql](../server/migrations/020-care-summaries.sql) 保存每孩子目前一份 `visit_preparations` 及加密版本歷史，含問題、準備項、可選預約、核對人／時間／期間及資料依據版本。家長可切換目前準備的預約；這是共享草稿，不是新的照護事實、完成確認或外發授權。AAD 綁孩子／版本，刪孩子連帶清理；備份沿用既有整庫加密流程，020 已隨合成庫配對備份／空庫還原核對。

核對狀態綁 storage epoch／家庭 change seq／所選期間；任何來源或家庭資料變化後保守失效，需重新讀取及明確核對。自身保存造成的 seq 變化在同一交易納入新依據；還原或跨範圍不能沿用舊核對。數字與原始記錄同一快照取得，已刪或已更正來源不沿用舊計算。

<a id="p2-photo-data"></a>
## P2 附件保存與刪除（021）

`photo_attachments` 保存孩子、上傳者、原始 byte size／SHA-256、MIME、穩定 `<uuid>.enc` 相對路徑、版本及 reserved／ready 狀態。檔名／來源、模型候選及處理說明用既有 cipher 加密；原圖在工程外 `ATTACHMENTS_DIR` 以獨立 nonce 的相同 storage cipher 保存，AAD 綁固定附件 ID，保留原 bytes，不自動壓縮或剝除 metadata。產品限制及 HTTP 語義只見 [照片契約](API.md#p2-photos)。

檔案先持久寫入，SQL 才標 ready；SQL 未確認時保留 reserved，可對相同 ID／hash 重送並核對已有檔案。私人原圖及候選不進向量知識庫；原圖共享必須有使用者明確確認，家庭成員只見共享原圖及已核對照護記錄，其他人的未確認候選不公開。記錄與附件外鍵關聯，刪記錄、孩子或附件連帶清除關係；觸發器保存 `photo_file_deletions` 最小 ID，Server 啟動及定期清理原檔，失败保留清單，不復活舊收據。

提取 run ID、權限版本及到期時間由 Server 保存，模型不決定。原權限改變、刪除、逾時及未知結果不能沿用舊 run 再呼叫；已知失敗只有使用者依目前版本再要求才開新 run。pending／unknown 原檔仍可人工核對成記錄。備份须包含資料庫、原圖及配對清單；純 pg_dump 不代表附件備份，操作見 [照片備份](P2_PHOTOS.md)。

<a id="p2-shared-input-data"></a>
## S12-W04 私人分享來源

migration `022-shared-inputs` 新增 `shared_inputs`：孩子／輸入者／來源類型、版本、fetch 與 extraction 的獨立 run ID／期限／授權版本、可選共享記錄連結及確認類型。每個孩子最多 50 項，以 workspace 寫鎖串行核對上限。

INT-W04 在同一加密 payload 保存可選 management：用途、來源性質聲稱、時效原文、啟用與本人授權的連續正文片段；舊資料為 null，不自動授權。migration `026-private-source-management` 增加管理修訂，綁 input／child／owner 複合外鍵及版本、刪來源時 cascade，前後 management 與原因均加密；沒有第二份可寫來源主表。修改正文撤回原片段授權並清過時提取。Agent 候選沿既有加密 proposals，在同一交易调用來源服務及保存結果資源 ID／版本，精確重播不重建來源。私人引用快照只進本人 run，與公共 KnowledgeEvidence 分開。

新增 `023-personal-sources` 只擴充 kind／source_id 約束，加入 `personal_source`；它和 paste 的 source_id 均為 null，不註冊公共來源。023 本機遷移及新來源保存／隔離已通過；022 的集中驗收結果另見 [S16 集中驗收](../PLAN.md#s16-w02)，不能當成 023 通過。資料仍按孩子及輸入者隔離，不新增跨孩子訂閱或帳密資料表。

原文、來源名稱／網址／日期／私人備註、hash／取得時間、選取片段及 AI 候選以既有 storage cipher 加密，AAD 綁穩定輸入 ID；不放公共向量庫。貼上字串原樣保存；抓取保存明確標示的解析正文。來源快照一旦 ready 不背景刷新，來源日期未知保持 null，保存日期不代替原文日期。舊加密 payload 缺 sourceNotes 時讀為空字串；家長提供的正文保留原樣，URL-only 明示 not_requested，沒有正文不能提取或確認。

原文永久維持輸入者私有；確認只新增家長核對的共享 CareRecord，不把原文改為家庭可讀。`reference` 明確標外部參考、數字及時間不進摘要計算；`family_record` 須另確認實際孩子關係，也不自動建立 MemoryFact／任務或外發授權。既有 Care 更正歷史及版本繼續適用。

新增／確認／刪除沿用私人收據；刪除移除相應回傳正文。記錄／孩子 FK cascade 及 DB 加密備份涵蓋新表，歷史備份仍保留當時快照；還原及資料保留證據見 [S12-W04](../artifacts/verification/S12_W04_CHECKS.json)。[契約](API.md#p2-shared-inputs)

<a id="proactive-contact-storage"></a>
## S13-W07 聯絡台帳（migration 019）

[019-proactive-contact.sql](../server/migrations/019-proactive-contact.sql) 把本人接收同意、精確任務授權、聯絡請求與渠道嘗試分開：
- `contact_consents／contact_consent_revisions` 綁孩子、本人、版本、渠道順序及家庭權限版本；`contact_grants／contact_grant_revisions` 保存任務版本、確認人、對象／同意／綁定版本、披露範圍、期限及 fallback。正文以既有 cipher 及種類／資源／版本 AAD 加密。
- `contact_requests` 每個 reminder 唯一，保存 run／task／occurrence、原 worker generation／storage epoch、job、授權快照及狀態；`contact_attempts` 保存每次已授權渠道的實際證據。先提交 sending 再外發；worker 中斷只能轉 unknown，不能假定未送。
- `contact_daily_slots` 以接收者／本地日限制普通通知，刪除原孩子後仍保留已消耗的無正文名額；`contact_updates` 只保存 bot／update ID 去重，不保存原始 webhook。
- 孩子／任務刪除連帶清理相關正文及聯絡資料；投遞只用 opaque ID 和固定通知。callback token 加密保存、查找用 hash，完成嘗試後清除 token 正文。
- 模型工具與請求／job 同交易；只有這筆受信交易可更新自身 run 的 data version。其他資料變化使舊生成結果失效；如已有成功入列，只可保存重新核權後的固定操作回報，不保存舊上下文、候選或摘要。

019 與 014–018 一同列入集中 migration／加密備份及空庫還原驗收；還原後既有 worker 暫停／世代規則繼續適用。型別及 scripted case 不代替 SQL、刪除或恢復證據。

<a id="personal-model-settings"></a>
## S06-W05 本人模型設定與計數（024）

`model_settings` 以本人 user_id 唯一保存，跟隨帳號刪除；不是孩子／家庭資料，其他家庭成員不可存取。欄位包括 version、mode、背景 opt-in、三種可調限額、更新時間及 api_key_encrypted。初次版本 0；保存時鎖帳號並 CAS，成功遞增版本。AES-GCM 沿用現有 cipher，AAD 綁帳號及版本；沒有明文、尾碼或 hash 回傳。一般停用保留 key，刪除清空密文並停用，歷史備份中的密文須按既有保留政策管理；供應商撤銷 key 是另一項操作。

`ai_attempts`／`embedding_attempts.billing_source` 由 Server factory 決定，既有列標 platform；原 counters 不清零。personal 使用 `personal:global`／`personal:user:<id>`，與平台 global／user 分開。公共語料維護僅用 platform；個人 key 不進工作佇列、Agent session、prompt、候選、online receipt 或一般日誌。每次運行只在記憶體持有快照，背景使用受信事件的執行帳號並檢查 opt-in。


<a id="int-concerns"></a>
## INT-W05 共享持續關注（027）

關注有穩定 ID、childId、版本、following／closed 狀態、真實建立／更新／歸檔时间、共享觀察事件及原關聯 ID；不是 MemoryTopic 或 GrowthAttention 的別名。正文與版本历史沿既有 AES-GCM 保存，AAD 綁固定歸屬與版本。原操作收據綁 user／opId／scope 與正規化請求；重播返回已提交結果，不重新寫入。

事件中的觀察保持使用者陳述，來源記錄／任務／有限關注指向同一孩子的共享資源。歷史不回寫，超出有界容量明確拒絕，不靜默截斷成完整歷史。家長結束關注不改相連任務終態；恢復保留經過，不把舊關注候選變成新的已接受行動。

一次站內跟進分開保存 reference、到期時間、pending／queued／completed／stopped／unknown／cancelled 及實際 runId；未知不是未執行。背景結果正文仍依原 Agent run 的私人權限存取，共享事件只記結果關聯，不複製私人回覆。重排用新 reference，舊終態保留；孩子刪除連帶刪除本包關聯與收據，備份還原沿既有暫停 worker／更換 epoch 的制度。


<a id="int-family-documents"></a>
## INT 家庭文件

FamilyDocument 保存 kind／purpose／目前版本／歸檔與自動更新狀態；DocumentSnapshot 保存期間、來源依據、有限覆蓋說明、章節、精確來源 ID／版本及更新說明。加密修訂和原操作收據沿既有穩定 AAD／epoch／權限規則。來源業務資源保持權威，文件是可失效的衍生快照，不能反寫成另一份可編輯孩子事實。

文件排程只保存待更新的資源識別，不保存明文家庭資料或模型思考。來源更正／刪除時隱藏受影響舊正文；歷史快照不能繞過目前權限。詳見 [API 契約](API.md#int-family-documents)。


家庭標準 growth_report／family 在同孩子及相同起訖期間內的 active 防重由既有 workspace 寫入鎖下的 create／restore 守衛保障；不新增 schema 或重寫既有文件。Checklist 刷新只保留身份、文字及來源均未變的勾選狀態。未有事件日期的現行關注可作明示未知日期的正文來源，不能偽造時間。

A03 的 patch 沿既有文件及快照密文保存，不另建文件主庫。快照新增可選的編輯保護 metadata：被指定的章節、刪除章節及指定欄位；舊快照缺少時視為全由來源整理。此 metadata 不由任意模型 path 寫入。新正文候選沿 agent_proposals／agent_confirmations 保存並綁版本，接受後才成為共享文件正文；不建立確認事實。清單／修訂依既有 created_at、id、version keyset 續讀，游標必須重新核權。當前文件版本、快照版本和歷史版本分開；詳見 [局部修改契約](API.md#document-editing)。

<a id="p2-agent-service"></a>
## P2 增補資料語義

此為 [SPEC 增補](../SPEC.md#p2-agent-service) 的目標契約，沿既有資源與收據擴充，不預建完整資料表／遷移。新增正文沿現有加密、刪除與備份規則。

| 概念 | 必要資料與不變條件 |
|---|---|
| 通用工作 | 穩定工作 ID、本人／孩子／可見範圍、目標、焦點、相關資源／版本、待答問題、待確認引用、已執行收據、狀態及取消／失效原因；原 run／訊息可追溯。它是恢復狀態，不是任務或文件的可寫副本，也不預定工具順序。 |
| 來源與理解 | 原話／訊息 ID、資料類別、精度及日期基準、陳述／整理／推測／已確認的身份、有效版本及範圍；約數不轉成精確生日，未知不補造。Agent 更正／停用事實沿原資源歷史及重要確認。 |
| 待確認綁定 | 原操作 ID、操作參數、具體資源 ID、expectedVersion、授權／政策版本、提問訊息及本人回應、候選 ID／版本、有效期與處理史；不能以模型布林代替同意，過期重新核對而非直接延長。 |
| 摘要與查詢 | 來源 ID／版本、連續 coverage 或已讀範圍、可見範圍、查詢／固定版本游標、complete／未讀部分。混合私人來源的整理不得寫入較寬 scope；刪除／更正／撤權按來源鏈失效或遮蔽。 |
| 文件 | 沿 FamilyDocument／Snapshot，章節／項目穩定 ID，區分自動來源區和指定編輯區；版本及原 opId 收據保存真修改。歷史不能獨立編輯，恢復建立同一 ID 新版本。歸檔／歷史分頁，歸檔不計終身上限；現有容量在實作包遷移前仍據實呈現。 |
| 成長與期間報告 | 來源 ID／版本、固定期間及時區、完整 coverage／未知日期／遺漏說明、確定性統計和必要敘述；同一快照供 Web／PDF，來源更新標 stale，分批進度可恢復。 |
| 官方版本 | 來源及使用範圍、地區／年齡／主題、官方版本、章節／頁碼、抽取完整度、片段 hash、embedding 模型／維度／處理版、語義變更及核對依據／政策版、發布或保留原因。hash 不代表語義核准；已知失效與取得暫失分開。 |
| 邀請與帳戶 | 邀請資格不賦予另一帳戶資料權；本人獨立空間仍沿原隔離。驗證／找回憑據有期限且不入一般日誌。下載／退出／刪除保留處理狀態、撤銷範圍與備份保留政策；還原不得復活已撤權或刪除內容。 |

讀取得到並不代表可分享。Server 在讀取前及衍生保存／外發前核對原來源和目的範圍；模型參數不可擴大 scope。跨孩子／身份取消舊請求與焦點，不讓遲到回應寫回。未知操作只查原收據，不重建新 ID。新增帳戶刪除須覆蓋通知、key、附件、工作及衍生內容，保留具體保留政策，不在本次文件定案聲稱已刪除。

P2-A02 的工作與確認以本人／孩子為加密 scope；工作只存引用與恢復資料，不另存可寫事實。記憶有效期限另存 `valid_until／validity_indexed` metadata 供摘要 basis 的 SQL 有界判斷；舊資料按已授權範圍每批最多 100 條核對補回，未完成時摘要暫不可作有效上下文，仍能查回原訊息及分頁事實。摘要 basis 聚合資源版本及有效性，不把全量正文讀出／解密後才判定；未知不能當作有效，使用期限變化亦使摘要重新核對。

A02 使用 `agent_work`（目前版本及加密工作內容）、`agent_work_operations`（本人／孩子／原操作與 run／call 防重）及 `agent_confirmations`（候選／工作／問句／回覆與授權版本綁定）。正文及實際確認結果沿既有 StorageCipher 加密；範圍與版本 metadata 用於交易核對。工作修改使原確認綁定失效；真正已保存的 Server 問句才可進入 asked，只有驗證後沿原 proposal decide 才可 accepted。取消／失效不更改候選歷史為已完成。孩子或帳戶刪除連帶清理這些附屬資料，既有加密備份涵蓋新表。

<a id="p2-a05-reports"></a>
### P2-A05：有界報告進度

沿用 family_documents／snapshots；新增加密的每文件整理進度，只保存游標、固定期間、來源修訂、必要統計及有界選錄，不建立可獨立修改的照護資料副本。共享來源變更增加文件來源修訂，歸檔亦不得繞過失效；私人變更不擴散正文或加入共享統計。每批在既有孩子授權／交易內核對修訂、storage epoch 及整理者資格，完成後才原子保存同一文件的新快照。游標與未完成累計可跨服務重啟接續；來源更正／刪除、有效期、撤權及儲存 epoch 變更須停止沿用旧聚合。

來源依既有權威解密與授權，逐頁讀記錄、確認事實、任務及關注事件；日期採事件香港日期，未知日期獨立統計，約數不變精確值。統計只計保存筆數，不推論餵食總量、診斷、能力或發展評分。進度及快照仍加密、隨孩子刪除，備份沿用資料庫加密備份。

<a id="p2-a06-continuation"></a>
### P2-A06：跟進檢查基線與合併事件

工作 followUp 是本人持久工作的一部分，沿原加密正文、版本及操作收據；檢查列保存工作版本、權限／epoch、必要來源識別與加密比較基線及到期狀態。業務變更／已核對來源發布只喚醒相關的有界檢查。工作更正與舊事件失效在同一交易處理。

合併站內事件以本人／孩子／香港日期防重，最多5項工作版本及變更依據加密保存；原 pg-boss 入列與台帳同交易。payload 只放事件及世代參照，執行時重查權限／版本／終態並由原業務資源重建上下文。Agent run 沿穩定 triggerReference唯一，回應丟失及重啟不重複生成；結果／停止／未知及runID可追溯，資料隨孩子／本人刪除及原備份處理。

**F01 起始輸入證據契約，尚未有 adapter／consumer。** 在原 Firestore continuation event 權威內只保存一份有界快照，涵蓋該 event 完整且最多 5 個候選 work／version 的 included／not_included 分類；不能只保存選入者，再將未出現的項目推定為排除。快照綁 `eventId`、原 `runId`、`ownerUserId／childId`、`storageEpoch／generation` 及每項 `workId／workVersion`；`unknown` 只在原 event 已驗證的持久格式／版本證明為舊格式且缺快照時作讀投影，不依建立時間或目前工作終態猜測／補造舊快照。它只證明已提交的起始輸入選擇，不證明 provider 接收、後續工具讀取、run 成功或 work 完成；公開相容性見 [API](API.md#p2-a06-continuation)。

- **同庫、同次 claim 提交。** 在 work／event／run 的同一 Firestore 交易權威內，全讀原 event 完整候選、deterministic trigger claim／run、目前授權／tombstone／epoch／generation、各候選原 workVersion 及有效性，才一次寫入原 run claim 與 event 快照。回調可重跑，只能從成功 commit 的 attempt 產生起始 context；丟棄 attempt 不洩出 context，提交後不能重新選工作、換版本或用另一份查詢結果組裝。若原子確認全部排除且原 claim／run 不存在，可提交全排除快照及 `runId:null`，不能把交易外查不到或讀取失敗當成無 run。重投／失去回覆只查同一原 claim／快照，不重選、補建 run 或重新生成。
- **取消先後及讀取失敗。** claim 前取消先 commit，該原版本必須排除；claim 後取消不回寫 included 歷史，但原 dataVersion／授權／版本失效守衛仍阻止使用失效 context。快照不擴大背景唯讀能力，不把晚到結果當工作完成，也不保證撤回已在途 provider。缺權、讀取／解密錯誤、未知格式或 event／run／scope／epoch／generation／workVersion 綁定失配均 fail closed；完整候選缺項／超界／重複亦是錯誤，不退成 unknown／not_included。
- **單份加密及清理。** 沿既有 StorageCipher 與格式版本校驗；新／舊格式辨識標記須屬原 event 受加密完整性保護的已驗證格式／版本，不能只靠可缺失的快照欄判斷，已 claim 新格式缺快照為錯誤。目標 AAD 必須綁格式／project／namespace／event／owner／child／version，內層核上述完整身份，不靜默換 scope 重加密。新 AAD 要求只適用新的證據格式；合法舊 event 仍按原格式／AAD 讀取，不因缺新欄位而拒絕、回填或重新加密。只留查詢／清理所需最小非正文索引，不保存整 prompt、工作正文或結果副本，不建第二份 per-work outcome 主庫。owner／child／event／run／work 附屬清理須覆蓋此快照；parent tombstone 先阻止讀寫，再按原有界 cursor 清理。備份／獨立刪除 journal／隔離 restore 換 epoch 的閉包照原契約，不能以 TTL 或舊快照復活已刪／撤權資料。

此契約以前述同庫權威為實作前置；現有 Firestore session／root budget／usage 切片不具 work／event／run 的同交易 claim 能力。不得在 SQL 與 Firestore 分拆寫入後聲稱原子，亦不新增 SQL schema、長期雙寫或空 port。離線合成 trace 只驗語義及先後，不代表保存、SDK 交易競爭或正式流程已接通。


<a id="p2-a08-service"></a>
### P2-A08：註冊資格及刪除恢復邊界

邀請按正規化電郵的hash及期限保存，不是家庭成員；註冊資格綁本人，消耗／撤回紀錄不因帳戶刪除而變回可用。資料處理確認保存政策版本及原操作，身份驗證和密碼由Better Auth權威處理。郵件URL與接收資料用現有StorageCipher加密，queue只帶參照；不假設SDK hook與另開Pool寫入共享交易。

永久刪除意圖在工程外受保護、加密且fsync的append-only journal保存穩定user／child ID及原op，才交易刪除SQL資料；不含名字／正文／密碼。回應丟失仍按原意圖完成，不讓舊備份重新啟用已授權刪除的帳戶／孩子。還原及服務啟動須核對journal身份並先重放未套用意圖；journal缺失、認證失敗或不確定是否為最新便保持離線，不能使用備份裡較舊的副本代替。照片沿原file_deletions清理，狀態不冒稱立即物理清除所有備份。備份實際保留期由部署核定並顯示，不能承諾尚未執行的到期刪除。


<a id="firestore-target"></a>
## Firestore 目標資料與可靠寫入契約

下列是遷移資料契約及分組，不表示每個 store 已完成；F01 的權威／交易／身份基礎已合併，F02 及後續逐項沿既有 path／SDK／索引接通，狀態見 [PLAN](../PLAN.md#active)。Firebase Auth 身份仍由 Server 核實，不開放瀏覽器任意 collection 操作；VM 或 Cloud Run 不改變這些權威。

| 分組 | 沿用權威與必要調整 |
|---|---|
| 帳戶／workspace／members | 新 Firebase uid 作穩定 userId，唯一本人 workspace、角色及 accessVersion；依 ADR-022 不搬舊帳號／私人資料，建立後既有識別不隨重登／版本回退改變。邀請單次消耗、准入、政策同意、逐裝置 session／撤銷與 Auth 分開，email 更改不轉移資料 |
| 孩子／記錄／檔案／記憶 | 保留 childId、原文、精度、來源、版本、可見範圍及歷史；列表以 workspace／child／scope、排序與 cursor 取有界頁，不複製孩子正文到每頁 |
| 私人訊息／工作／確認 | 綁本人＋孩子；原訊息、coverage、工作焦點、候選、提問／回覆、原 opId 及授權版本保持，長正文／歷史分段，取消／撤權失效 |
| 文件／修訂／報告 | 同一 documentId／version，固定 snapshot／章節／項目；分段與分頁不改變權威，來源刷新不覆蓋指定修改，PDF 指向同版 |
| 任務／occurrence／通知 | 任務、發生實例、投遞和回應分開；保存原 generation、終態、授權、unknown／實際證據，Tasks 名稱不是完成證據 |
| 操作／變更／outbox | deterministic op key、request fingerprint、結果／資源版本、workspace changeSeq、storageEpoch、派送／lease／retry 狀態；private changes 只向本人披露 |
| 知識／來源／發布 | 固定 source／version／chunk ID、使用範圍、章節頁碼、hash、核對狀態、embedding 模型／維度／處理版；不可變批次與 active 指標，獨立停用閘 |
| 附件／清理／刪除 | assetId、bucket／object／generation、hash、cipher metadata、資源／scope、reserved／ready／deleting 狀態；獨立 journal 意圖與可重放清理進度 |

### 交易、不變量與查詢映射

- 原 opId 的 scope、request fingerprint 和結果唯一性沿用；同 ID 不同參數拒絕。同一交易讀授權／准入／刪除狀態、storageEpoch、expectedVersion 與收據，寫業務、收據、變更及 outbox；並發相同操作只生效一次。業務拒絕／衝突不得留下半份成功寫入。
- 唯一性以確定 ID claim 保存並交易核對，包含邀請消耗、唯一 run trigger／occurrence 及現有文件防重；不靠「先查不到再 add」。workspace changeSeq 保留字串 wire／單調順序，游標與權限版本／epoch 綁定；同一 workspace counter 的競爭需實測，不能改成全站一把鎖。
- 交易回調全讀後寫且可重跑；原 SQL advisory lock／FOR UPDATE／savepoint 不能機械複製。多次有界步驟以進度文件、lease generation 和可恢復階段承接；大型刪除或報告不塞單交易。
- F01 對每個查詢列出權威集合、授權範圍、等值／範圍／排序欄位、複合索引、投影來源／重建、page limit／cursor 及成本。加密正文不另建明文私人索引，沿授權頁掃描並標 complete／nextCursor；公共候選索引另計 posting 容量。query constraints 不足以表達現有語義時明示調整並以 F02 驗證，不刪功能。
- FK／cascade／trigger 由建立／引用檢查與持久清理取代；parent tombstone 先阻止新讀寫／子項新增，再按固定 cursor 清理所有附屬記憶、文件、工作、通知、key 及附件。歷史版本不能繞過目前權限或恢復已刪資料。

<a id="firestore-chat-transaction-boundary"></a>
### 聊天 work／confirmation／原收據的交易邊界

此為各聊天 store 移植必須保留的交易約束；F01 基礎已合併不代表全部領域已接通。逐 store／query／index 對照見 [TECH_REUSE](TECH_REUSE.md#firestore-chat-store-audit)，不另建收據或工作主庫。

1. **識別與歷史授權分開。** 原 trigger claim、runId、callId、work operationId、proposalId／version、asking run、ask／response message 及 domain opId 各沿原 scope。work operation 的唯一鍵為本人＋孩子＋operationId，document operation 為本人＋opId；不得統一縮成較窄鍵。索引／claim 只保存必要非正文 metadata；原正文／request fingerprint／結果沿既有 cipher、AAD、ID 及版本，不能以新路徑或新 owner 靜默解密再重綁。
2. **讀集必須覆蓋授權和完整條件。** 新效果的 transaction 讀 account／device session 准入證據、workspace／membership／child 可用性、accessVersion／storageEpoch／刪除閘、原 trigger／run 狀態／期限、policy、來源訊息、目標版本、必要 work／proposal／confirmation 及原 claim／receipt；非適用項不虛構讀集。Auth provider 的外部狀態不能納入 Firestore 原子性，逐裝置 ledger／即時檢查是另需接線的前置，HTTP 薄 port 不代表已具備。查詢投影帶原來源版本並在本交易核權；無效／缺失索引資料 fail closed，不回退無 scope 全掃。
3. **全讀後写、一次 commit。** 完成全部 domain／source／版本驗證，才排入業務、修訂、原 receipt／call／link、changes、必要 outbox 及 run dataVersion 寫集。Firestore 回調可重跑，不能在其內調模型、發訊息、派 Tasks 或寫外部 Storage；穩定的新 ID／操作身份在回調外固定，期限／權限於每次 attempt 重核。回傳給 caller 的成功結果只能來自已 commit 的 attempt，不從丟棄回調泄出。
4. **沒有 nested SQL savepoint 的替身。** 原 consumeConfirmation 會調原 proposal decide，業務衝突時只 retire 快捷確認並保留候選；SQL 能 rollback nested store。Firestore 必須在首個 write 前得出可提交的 domain 結果，或整筆失敗後以另一次重新核 scope／版本的交易處理失效。不得捕捉已排入部分 writes 的錯誤後，照樣 commit「invalidated」而留下半份 domain effect。transaction 內也不能靠重新 get 看見本 attempt 先前排入的 writes。
5. **跨 run 確認。** 新 asking run 須 running；被確認的是原 proposal run／proposal version，不能要求原 run 仍 running。只接受 Server 已保存並綁定的問句、目前最新本人訊息及相鄰提問、明確同意、恰好一項有效候選／asked binding、原 hash、policy/access/epoch 及可選 workVersion／active-or-waiting 全部一致。consume 原確認與 domain effect 同 commit；response run 可在其後才 claim，不能以新 run failure 重做已接受效果。 已有 accepted 的同訊息重試與唯讀原收據查回，共用目前本人／孩子、accessVersion／storageEpoch、原 proposal 的 owner／child／accepted version、本人 user 回覆及加密 result 的 ID／原 run／孩子／版本綁定驗證；原結果通過後才可交後續 response run。有效已提交收據不因提案過期失效；已存在但綁定失效、超出有界唯一性或讀取失敗須停止，不當作 not found 或重做 decide，也不改寫原密文／已提交效果。此驗證不代表歷史正文已按目前 fact／document 來源重新投影，亦不表示整個工作已完成。named proposal 決定及快捷文字同意分開，不能因快捷失效便自動略過或接受原 proposal。
6. **三種取消與原結果。** run cancel 只將目前 running 原互動 run 置 stopped／cancelled，finish 不得覆寫；已提交效果／候選保留。work cancel／改版立即使舊 workVersion 的確認及跟進失效，不等同取消已建 task／document；proposal dismiss 沿原 version 只退候選。被取消 run 的新 runtime／tool effect 與 cancel 讀寫同一交易權威；cancel 先提交便阻止該 run 後續 runtime／tool effect，effect 先提交則保留原 receipt。這不禁止本人其後依原 proposal 作新的明確決定；該決定仍按上一項重核候選／scope／版本／同意，不要求原 proposal run 仍 running。不得跨 SQL／Firestore 分拆兩端後聲稱已 fence。查回只核既有 receipt，run 維持 stopped／unknown，未保存用量仍 countsKnown=false；查詢失敗不得當作沒有副作用或自動重試。
7. **有界失效與刪除。** workVersion、policy/accessVersion、epoch 及 parent tombstone 讀時即生效；原 SQL 全量 UPDATE／cascade 可轉分批整理，但不能讓權限等待清理完才失效。每個 query／cleanup page 都保留 scope、精確 cursor 及 complete／未完成狀態；原訊息刪除亦涵蓋引用它的 note／revision／receipt／confirmation／summary，不能只清 work。原收據讀回期限與新決定期限分開，accepted receipt 不因 proposal 過期隱藏已提交效果，也不因此永久保留已刪正文。
8. **背景起始輸入與 claim。** [原 event 有界快照](#p2-a06-continuation)須與 deterministic run claim 共用本節的同庫讀集、全讀後寫及成功 attempt 規則；不能用 ADK session／root budget／usage 的獨立提交代替。起始選入不提升為 per-work 執行或完成權威。

原生 [transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)及[transaction isolation](https://docs.cloud.google.com/firestore/native/docs/transaction-data-contention)文件已核：原子提交、全讀後寫、回調重跑、commit-time serializable 與交易內讀不見自身尚未提交的寫入。本項目仍須以固定 Node SDK／實際 schema 核對 latest-message／唯一 pending、並行新候選及撤權／刪除的 query read-set；不能以「先 limit 2 再 transaction 點讀」冒充對整個條件的原子檢查，亦不以未實測為由否定原生 serializable。Fake／Emulator 不代替 F02 真雲端競爭證據。


### Auth、附件與恢復關聯

Auth 用戶並非 Firestore 子文件，註冊／刪除無法跨兩服務交易；保存新 Firebase uid 的穩定 mapping、pending／active／deleting 狀態及原操作，外部步驟按原 ID 查核恢復。依 ADR-022 乾淨起點不匯入舊 UID、密碼雜湊或 session；原 STANDARD_SCRYPT 相容要求已被取代，不能當成已驗。

Storage 先 reserved，確定 object generation／hash／大小／加密版本後才 ready。下載及覆寫／刪除綁實際 generation；metadata 存在不代表物件已成功保存，物件存在也不能自行擴大 scope。孤立物件及部分刪除有持久清理記錄。

獨立刪除 journal 用不可覆寫的加密 intent 物件，保存最小本人／孩子／asset ID、原 op、類型、時點及完整性證據；不保存家庭正文或密碼。它不受資料庫 restore 回退，正常備份到期不順帶刪 journal；其保留須覆蓋全部可用備份及回退副本，未能證明不再可能復活時不清除。

配對 manifest 綁資料恢復點、附件 generation／hash、cipher 版本及完整度；每日 14 天資料庫備份有同期間附件副本，7 天 soft-delete 不充當唯一副本。還原對照最新 journal、現行 Auth／撤銷與 scope，重放刪除、驗附件／索引、換 epoch 後才可開放。工作和 unknown 收據保留，不將舊 pending 全數重發。

<a id="p2-agent-roles"></a>
## 四角色 Agent 的資料不變量（目標）

依 [ADR-024](DECISIONS.md#adr-024)，P2 只保留角色設定及輸入輸出／共同執行契約，不新增三個未啟用角色的內部資料流或專用 collection。下列草稿、審核及自主維護資料語義由 [P3-M01～M03](../PLAN.md#p3-agent-roles) 按需落實；沿既有領域服務，不另建通用成果資料庫。編排見 [架構](ARCHITECTURE.md#p2-agent-roles)。

| 資料 | 必須保留的語義 |
|---|---|
| 根運行與角色執行 | 原 root runId／工作／opId、角色與父關聯、Server 注入的身份／孩子或公共維護 scope、授權及資料版本、共同用量／deadline／取消／停止與 unknown；角色 session 不是業務權威 |
| 編製草稿／局部修改 | 原領域資源及目標版本、用途 schema／模板版本、內容 hash、來源 ID／版本／範圍與 coverage、原指令／操作關聯；陳述、整理、推測與確認狀態分開。draft 不成為正式記憶／任務／文件，亦不是第二份可獨立修改的孩子資料 |
| 審核記錄 | 草稿 hash、來源版本／原始證據、對象／expectedVersion／輸出可見範圍、審核模型與 prompt／policy 版本、通過／需修正／證據不足、最小問題位置及依據；Server 記錄角色與判斷來源，不偽稱人工審核。正文／私人證據依原加密／刪除規則，不入一般診斷 |
| 知識維護工作 | 核准來源與 scope 版本、站內 frontier／已讀範圍／續讀游標、原始檔 hash／object generation／章節頁碼、抽取方式／模型版本／完整度、前後知識版本、語義核對與發布關聯、lease／generation／累計用量；私人資料及 key 不進此工作 |

正式保存前交易核對草稿 hash、授權、來源有效版、資源版本、審核有效性及必要使用者確認，再提交原領域資料、收據與 changes／outbox。審核通過不能作確認同意；資料、來源或披露範圍變更後舊審核失效，無權／被刪來源不能靠歷史審核重新讀取。已成功效果只按原操作核對，不因重審或收尾失敗重做。

公共原生文字、模型抽取與綜合整理分開保存，模型抽取不能冒充逐字官方原文；引用可定位實際來源版本及原頁。發布仍沿不可變批次／有效指標及即時停用閘，不另開一套 RAG。來源更正／撤權／刪除須令依賴成果待更新、遮蔽或失效，PDF 指向同版正式成果。

未完成草稿、審核、維護進度及累計配額跨重啟保留，沿對應本人／孩子／來源清理和備份範圍處理；還原仍先重放獨立刪除記錄，不能恢復被刪私人草稿或重投舊發布／通知。

<a id="firestore-foundation-authority"></a>
## F01 canonical 權威與身份 ledger

實際 schema 入口為 server/firestore-authority.ts、firestore-work-continuation-recovery.ts 及 firestore-device-sessions.ts；F01 只交付邀請／admission／consent、本人 workspace、孩子與 pure-due work 的可執行生命週期。其餘領域仍按 [全路徑對照](TECH_REUSE.md#firestore-full-runtime-audit) 逐包承接，不能以 unsupported_work 或 503 削減原需求。

- canonical control／account／workspace／child／work／followup／run／claim／event／change 共用既有 WorkRecovery codec。account 不按 child 複製，workspace 的 storageEpoch／accessVersion／changeSeq 是唯一權威；收據命中之前亦核目前狀態及 scope。run／claim 的現有 pure-due writer 沿 FirestoreWorkContinuationStore；完整互動 run、outbox 與來源接點仍待 F03／F06。
- authority 輔助文件與 canonical 同 collection、同 database／transaction；invitation、identity、owner mapping、operation、child/work detail 各用確定 kind/ID hash 及加密 AAD。auxiliary envelope version 2；既有 recovery kind version 1 不改。JSON 屬性順序依既有 codec 正規化，不能僅以語義等價物件重建不同 AAD。
- 新 uid、invitation 消耗、本人 workspace／epoch 一次提交；重跑交易或提交後失回覆不產生第二個 workspace。Auth getUser 的現行 verified/disabled/email 由受信 Admin SDK 注入，HTTP／模型不能自報。未驗證／未同意可走帳戶設定，不能走業務。邀請撤銷同步關 account；deleting／deleted 不會重新准入。
- authority-operation 以本人、可選孩子、原 operationId 綁 action／完整 payload fingerprint／原結果；帳戶及建立孩子為本人 scope，work 為本人＋孩子。其他域沿各自原契約（文件 opId 仍 caller-wide），不得任意縮窄 scope。孩子／work、版本、followup、changeSeq、change、原 receipt 全有或全無。TTL 不刪 accepted／unknown 收據。
- pure-due work 不接受 source messages、resources、pending proposals、watchResources 或 knowledge watch；回明確 unsupported_work 且零寫入。取消以 expectedVersion 提交 cancelled、關閉 followup、原收據與 change；完整語義由 F03 保留及擴展，不對外宣告現已完整。
- 裝置 session ledger 與業務 authority 分 collection；只存 cookie SHA-256、uid、到期、auth_time、generation／撤銷，原 cookie／ID token 不落庫或日誌。每次 session 讀回核 Admin revoke/current user、ledger、現行 admission。revoke-other-sessions 同交易提升 generation 並只保留目前 cookie；舊 auth_time 不能重新換回有效會話。保留 cookie 的例外須由 HTTP 現有 cookie 已驗證所得，不接受請求自報 hash。
- control 與 session 均確定 ID 點讀；無需查詢密文。私人 client Rules 必須拒絕全部直讀寫，Server IAM 不能代替上述業務交易。還原須對照目前 Auth、重放刪除並改 epoch，亦須失效舊 ledger；F01 不以當前 session 格式宣稱 restore 已驗。
