# 當前與後續開發計劃

**P2 及以前的歷史計劃：**已移至 [P1／P2 歷史計劃](_archive/plans/P1-P2-20261018.md)；歸檔來源及查閱方式見[歷史索引](_archive/README.md#plan-p1-p2-20261018)。只在追溯舊工作時按需閱讀，日常直接看本文件的[當前工作](#active)。

本文件維護工作包的目標、前置、狀態、未完成項及完成門檻，按包推進，不按日期或周排程。產品要求見 [SPEC](SPEC.md)，短現況與部署觀察見 [STATUS](STATUS.md)，實際測試與失敗見 [WORKLOG](WORKLOG.md) 及各包證據；執行與文件更新規則只依 [AGENTS](AGENTS.md#document-updates)。

Sxx 是穩定範圍標識，不代表數字執行順序。原條款被新決策修訂時保留錨點；Firestore／原站與角色階段沿 [ADR-024](docs/DECISIONS.md#adr-024)，資料庫先行次序依 [ADR-025](docs/DECISIONS.md#adr-025)，以 [ADR-008](docs/DECISIONS.md#adr-008) 追溯替代關係；不得把被替代要求當成已完成。

## 閱讀次序

1. 先讀 [STATUS](STATUS.md) 與[當前工作](#active)，再只讀對應包。
2. 當前按 [P4 執行次序](#p4-execution)先落實契約，再開功能包。[P3](#phase-3)未驗項維持原歸屬；Agent 聯合補驗等協作者自查，[iOS](#p3-ios)等待 Apple 前置。P4 不一律等待全部 P3，按實際接口依賴推進。
3. 舊包只透過[歷史索引](_archive/README.md#plan-p1-p2-20261018)按需查閱；日常不讀 P1／P2 歷史正文。
4. 工作狀態與最低驗收規則仍見[狀態](#states)、[證據層級](#verification)及[按包驗收](#p2-deferred-acceptance)。

<a id="phases"></a>
## 五階段及完成門檻

| 階段 | 工作正文 |
|---|---|
| P1 基礎成品 | [P1 工作包](#s01-w01) |
| P2 完整 Agent／穩定 Web 服務 | [歷史正文](#p2-delivered)／[未完成門檻](#p2-str01) |
| P3 高級完善成品 | [Android／iOS 及更新](#p3-mobile)／[三角色 Agent](#p3-agent-roles) |
| P4 集中服務完善 | [個人／家庭／班級與完整服務能力](#p4-integrated) |
| P5 自部署與跨 Server 能力 | [延後的必要能力](#p5-future) |

<a id="phase-1"></a>
### P1 基礎成品

已交付；原範圍／完成門檻只見[歷史 P1](_archive/plans/P1-P2-20261018.md#phase-1)。

<a id="phase-2"></a>
### P2 完整 Agent／穩定 Web 服務

Firestore 正式零 SQL、前端接線與既有修正已交付；STR01 及指定備份驗收仍未完成，見[當前待辦](#p2-str01)。原各輪計劃／證據見[歷史 P2](_archive/plans/P1-P2-20261018.md#phase-2)。

<a id="phase-3"></a>
### P3 高級完善成品

- **交付範圍：**Android／iOS 在線 App、跨端更新、原生通知、語音／相機；家庭多人接線移至 P4；審核、資料編製、背景知識維護三角色保留原範圍。手機接線復用新前端及後端，不重做設計。
- **完成門檻：**Android／iPhone 真機使用同一 Server、身份及資料，必要登入、同源成果、附件、通知及更新有證據；三角色另按 P3-M01～M03 驗收。不建本地 Agent 或離線主庫，手機內測里程碑不代替整個 P3 完成。

<a id="phase-4"></a>
### P4 集中服務完善

- **交付範圍：**快捷登入、可選家庭共享、獨立班級／教師空間、多孩子助手、交接與個人備份文檔包；保留完整知識管理、系統分享、報告分析、集中服務跨端可靠性及災難恢復。
- **完成門檻：**所有仍屬 P4 的有效功能、AC、必要證據及交付完成，涉及的待決事項已定案。未測／延期／已合併不當完成；不把 P3 欠項改列完成。見 [S16](#s16-w04-p4)／[S17](#s17-w04-p4)。

<a id="phase-5"></a>
### P5 自部署與跨 Server 能力

- **交付範圍：**自選相容 Server、Windows Docker／WSL2 自部署、跨 Server 搬遷、身份／工作交接、恢復及交付；這些是延後的必要能力。
- **完成門檻：**實證資料、身份、附件、知識與工作的完整性、單主執行及不丟新寫入的回退，另一組員可按文件重現；見 [S16](#s16-w04-p5)／[S17](#s17-w04-p5)。掃碼／短碼配對與臨時會話已取消，不移至 P5。

<a id="current-p2"></a>
<a id="active"></a>
## 當前工作

**當前入口（2026-10-28）：[P4-CLASS01](#p4-class01) 班級解散收束，接續背景授權。**基線 #357／`8702125`，分支 `codex/p4-class-erasure`。班級解散已接既有持久工作、獨立日誌及分頁清理；原操作可查 pending／completed，私人原件及登入身份保留。共用前端提供確認及原收據進度。合成流程涵蓋日誌中斷、附件、版本／角色、防重、其他資料隔離及兩種舊備份；review 找到中途備份可能倒退清理狀態，已先紅後綠修正。必要個人刪除相容與前端 controller／型別已核，[證據](artifacts/verification/P4_CLASS_ERASURE_20261028.json)；未部署、未作真雲端還原。下一步是班級背景授權／通知接點，再接統一匯入；整個 CLASS01／P4 尚未完成。教師空間[原證據](artifacts/verification/P4_CLASS_TEACHERS_20261028.json)、P3／P5 及 D PR 範圍保留。

**已接回的系統分享：**#354 已合併 Android 本機收件箱／原草稿接線及三項 review 修正，定向核對與 JS 匯出完成，未建置／發布新 APK；真機接收、iOS extension 與 HANDOVER01 資料包入口見 [S12-W02](#s12-w02)。#352 共享附件頁面亦已合併未部署。AUTH01 的 Apple 邀請接續／自動連結、共享寫入／背景及 P3／P5 欠項繼續保留；D 的 #254／#262／#263／#265／#273／#353 仍不改、不代合併。

**名冊前包核對（復用）：**50 名合成孩子經正式 HTTP／client 建立、分頁搜尋、原操作查回、版本及撤權的單一流程通過；共用 class controller 與受影響 family 相容檢查通過。Web 匯出含新 `/classes`，型別圖只有兩項已確認原診斷；獨立 review 的空間列表續頁提示已修。詳見[名冊接線證據](artifacts/verification/P4_CLASS_CONTROL_20261028.json)，不是部署／真機或 CLASS01 完成。教師空間關係沿當前包接續，班級生命週期仍未完成；不重跑已有證據。

**P3 保留待驗：**下列收尾、語音、四 Agent／DEV02、串流與 iOS 原有未完成項維持原狀態；按使用者安排等待相關 Agent 本地自查或本人／平台條件，不重跑已有證據。下列「當前收尾」是原包入口，不取代本次文件範圍。

**四項修補來源交付：[FIX-FOUR01](#four-fix01)。**[PR #286](https://github.com/2NTTY/child-ai-caregiver/pull/286) 已獲使用者指示正常合併；本輪接續 #288／#289，保留照片聊天接線與部署記錄，僅補受影響照片恢復／client 契約核對。正常合併仍須獨立覆核及遠端必要檢查，不代表部署或真機驗收。

**P3 原收尾：[S16 Android／頭像／附件庫／個人模型收尾](#s16-w03)。**頭像成熟裁切已由 #305 合併，`1f07fab` 更新原 Web，公開 hash／health 通過。必要映射、adapter、局部型別／匯出、Web 保存及桌面縮放已核；[實作證據](artifacts/verification/AVATAR_CROP_REUSE_20261025.json)／[交付](artifacts/verification/AVATAR_CROP_DELIVERY_20261025.json)。Android v4 已一次免費建置並核對同簽署、runtime 與品牌資源，[覆蓋安裝](https://expo.dev/artifacts/eas/tqzvvQXmWmc7RqelWQgCcJoXiTrfBmDEKET4fjyLda8.apk)；使用者已覆蓋安裝；v4、登入／孩子資料、系統裁切／EXIF／預覽及取消已核，沒有向 v3 強推 OTA。個人 Vertex key 短生成、附件檔名、v4 真機 OTA 回退／恢復及 Web 完成待辦後手機自動同步已通過；本人 Vertex 完整 Web/API 流程已核（見下方 MODEL03）；手機本人 key 輸入、跨端 Agent／確認接續、另一身份的真機隔離及照護通知目標核權仍待驗。四 Agent／DEV02 等協作者自查、不改其 PR。

**iOS 保留：[S04-W03 發佈準備](#s04-w03)等待 Apple 前置。**#272、#274～#278 已合併，本機接線／匯出／APNs掛載配置有證據；尚無 IPA、部署或真通知。免費真機需可用 Mac，TestFlight 需已授權 Apple 團隊及簽署；不為等待條件重跑測試或購買會員。完整範圍見 [iOS 計劃](#p3-ios)。

**指定交付範圍：**[附件庫](#attachment-read01) API／畫面、[來源索引狀態](#source-readiness01)與[頭像](#avatar-01)生命週期／啟用已交付；剩餘設備接點按各包保留，不宣稱全部人工流程通過。保留原設計及同一 Firestore／Storage；協作者未合併 Agent 工作與延後 DEV02 維持原責任。

**本批整合：**#244 已收束 review 過的角色、本地環境及個人模型接點；程式基線 `00aa6ad`，合併批次沿用原驗證，部署另見MODEL02。[DEV-AGENT01](#dev-agent01) 已可供協作者在分支改完即本地試用，方法見[本地開發入口](docs/AGENT_LOCAL.md)。環境交付與角色品質／功能增補分開；不因長來源或多模態尚缺能力而另造測試 Agent、阻止使用現有環境。

**保留的前批交付：**[MODEL-SELF03](#model-self03)可由用戶在 Web／Android 自行填寫憑證與模型試用；#270 共用導航及 #271 延後聯合補驗已合併，導航接線已隨 `382d217` Web／Android OTA 發布，真機效果待核。依使用者指示，[DEV02](#dev-agent02)最後引用／審核及聯合補驗等待四個 Agent 真正完成且協作者先自行檢查，不提前重跑或接管。iOS 不以新模型驗收取代這些缺口。

<a id="four-fix01"></a>
### FIX-FOUR01：照片恢復、通知登記競態與原生 PDF（待驗收）

- **範圍／接續：**依使用者指定第 1–4 項修補，照片普通草稿離頁守衛／已批准捨棄、成功重讀清精確舊錯誤、APNs 過時 410 的登記 revision／時間核對，以及原生 PDF 實際分享能力 gate 均已實作。原操作／unknown、身份及版本守衛保留；#286 接續最新 `98f56a3`（#288／#289），照片 workspace 保留協作者新增的 `attachSavedPhoto`／`onChatPhoto` 接線，不回退已發布功能。
- **分層證據：**原 `382d2174` 整合照片 49/49、APNs 10/10；較闊 PDF 批次 44/54，10 項既有 `HistoryCards` fixture 失敗保留。#284 的 PDF owner 3/3、archive 1/1、新 native 5/5 沿既有來源；本輪 #288／#289 產品交集只在照片 workspace wrapper，合成照片恢復 49/49 及新聊天照片 client 契約 1/1 通過，沒有重跑無關 APNs／PDF、全量型別或 build。[同一收據](artifacts/verification/FOUR_FIXES_20261024.json)按基線保存原紅、最新補驗及限制。
- **合併／後續門檻：**使用者於 2026-10-24 明確要求合併 #286；本輪整合須經獨立相容覆核，再核精確 head、分支保護及必要檢查，以正常 merge commit 合併，不強推或繞過規則。真機照片捨棄、原生分享、Apple APNs／原生 Firestore 競爭及正式驗收仍待補，空 CI 狀態不當通過。來源合併不含本包部署，不代表照片聊天模型品質、頭像、附件庫或 iOS 整包完成。

<a id="attachment-read01"></a>
### ATTACHMENT-READ01：附件回看與私人清單（Web／Android 文件下載及原生檔名已驗）

- 2026-10-25 v4 附件保存／重開讀回／下載接線已真機通過：只送一份 108-byte 無私人資料 TXT，聊天與附件庫均能開啟系統分享，重開後原聊天亦讀回完成結果。#308／`35ad214` 檔名修正於 13:23 UTC 發布相容 OTA（group `39974363`）；沿已核 hash 的同一資產，改用已確認的 Expo/GCS 直接 TLS 路徑上傳一次成功，保留先前兩次逾時及 host guard 停止記錄。手機重開後選取一份 68-byte 未送出 TXT，原檔名正確；隨即丟棄草稿、刪測試檔並返回首頁，零模型／上傳／通知，沒有重跑保存或建 APK。[交付及設備結果](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)。

- #259 已於 2026-10-24 合併；來源基線 `339c707`，分支 `dot/attachment-media-followup-20261023`；26 個 source/test 檔＝22 產品＋4 測試。原照片 owner 保留；語音／影片／文件走[唯讀清單契約](docs/API.md#private-attachment-lists)，必要來源／時間改用可關閉詳情彈窗，媒體操作獨立，不展示技術版本字串。
- 定向結果分列：跨層 10/10（包含既有後端 8 項）、附件 focused 16/16、真 RN Web Modal 的有界 DOM 2/2。首 DOM 0/2 是 jsdom 沒有原生按鈕 Enter／Space default click 的測試方法錯誤，已保留並修正方法；真瀏覽器鍵盤仍未驗。8-root strict 512 MiB 檢查 exit137／無 diagnostics，原因未確定；不是完整或局部型別通過。精確版本、原紅及限制見[來源證據](artifacts/verification/ATTACHMENT_MEDIA_SOURCE_20261023.json)。
- 原來源交付只包含 `voice_assets`／`chat_file_assets` 各一個 `scopeTag ASC,state ASC,createdAt DESC,assetId DESC` composite index 定義，當時未部署；原型別與 GUI 限制仍見來源證據，不因合併改成通過。
- 2026-10-24 原站 API／worker 已更新為 `attachment-a84f349`：11 檔唯讀接線保留模型／通知／資料格式，頭像仍停用。單一 client→handler→store 合成流程、VM 候選 import、兩個 READY 索引的真 SDK 有界查詢及公開 health 通過。Web 及 APK v3 相容 OTA 已隨 `382d217` 更新；使用者已安裝 v3，實際附件清單待驗。首次候選失敗與索引核對器修正均保留於[交付證據](artifacts/verification/ANDROID_MODEL_CLOSEOUT_20261024.json)，不重跑原套測試。

<a id="source-readiness01"></a>
### SOURCE-READINESS01：來源索引與可用狀態

- 使用者於 2026-10-24 要求顯示已索引／未索引，避免把匯入連結當作 RAG 可用。先沿現行來源 owner／Server 真狀態投影，保留設計，不新增另一份索引狀態權威。
- 已查明私人來源目前沒有向量索引作業；Agent 依來源啟用、正文及本人授權摘錄直接讀取。畫面須分清「未建立向量索引」與「可讀取已授權內容／尚欠正文或授權」，不能用 `fetchState=ready` 假稱已索引或顯示不存在的排程。公共知識若呈現已索引，必須使用真正發布／檢索證據，不能只看網址名冊。
- 已實作共用列表／詳情標示，按正文、授權摘錄、完整性及目前讀取資格顯示可讀、待取得、待授權、失敗或待核對；私人來源一律如實標示未建立向量索引。單一投影檢查通過，保留公共網址私人副本的區別；[證據](artifacts/verification/SOURCE_READINESS_20261024.json)。已隨 `382d217` 發布 Web／相容 OTA，裝置效果待核；不在此包擴大私人向量化、抓取或模型工作。

<a id="shared-interaction01"></a>
### SHARED-INTERACTION01：準備單及讀取互動

- **2026-10-26 收束交付：**B 已 review 並合併 #328／#329；`330a905` 修正準備單新勾選後仍顯示舊保存提示，以及 Web 縮放下聊天載入的閱讀錨點偏移。沿用原 PR 的必要驗證，沒有重跑功能測試；Web 已更新並核對公開 hash／health，Android 已發布 v4 相容 preview OTA group `4f3f95a3`，毋須重裝。API／worker、配額及協作者 Agent PR 不變；未重新核手機畫面。精確版本、原建置權限失敗及回退見[既有交付證據](artifacts/verification/SHARED_READING_DELIVERY_20261024.json)的 `closeout20261026`。

- 使用者新增：準備單勾選可連續操作，短暫停止後合併保存；目前逐項寫入及整頁 busy 不符合使用方式。即時勾選是本機未保存草稿，Server 仍是權威；保留版本、原 opId、未知結果查回及身份清理。先核現有契約，不用另一份可寫文件取代原資料。
- 手機已截圖確認列表頭下拉箭嘴被拉成直條，修局部佈局；鈴鐺打開首幀顯示真載入狀態；聊天滾到頂部自動讀取較早記錄並維持原閱讀錨點，處理原按鈕載入會跳動的問題。保留錯誤重試，不無限自動翻頁或重試。
- 主模型處理 owner／契約及聊天錨點；Sol 承接不重疊的鈴鐺及列表頭呈現。只補連點／防重／衝突與分頁位置等必要檢查，不全量或呼叫模型。共用 Web／Android 來源，發布後再核受影響畫面。
- 同批新增：移除文件／語音彈窗「改用文字」冗餘入口；語音按鈕直接啟動本機錄音，原位顯示計時／停止／取消，試聽後才由本人送出。普通頁面掛載不要求咪權限或自動錄音；選取已有音訊仍保留。手機原生四個普通 Tabs 共用 Web 的選中短線，核對手勢保留。
- **首批 #282 已合併並發布：**列表頭、鈴鐺、聊天錨點、直接錄音及導航短線沿同一共用前端。定向檢查及兩端匯出通過；[實作證據](artifacts/verification/SHARED_READING_INTERACTIONS_20261024.json)保留 fixture 失敗及未驗範圍，[交付證據](artifacts/verification/SHARED_READING_DELIVERY_20261024.json)記 Web 首頁 hash、API health、原映像回退與相容 Android OTA。未強制重啟手機，不把發布當真機通過。
- **剩餘保存要求（2026-10-24）：**保持原勾選按鈕，不因背景寫入換成文字、轉圈或鎖住其他項目。最後一次點擊後約 3 秒合併同文件的最後狀態；反覆改回原值不送無效寫入。在同一孩子工作區離頁／關閉閱讀／轉選文件時立即 flush，請求由共用 owner 接續，不等待完成才導航。保存中可繼續累積下一批；版本衝突或未知結果保留待處理狀態，先查原操作，不盲重做。身份／孩子切換及登出仍保留必要隔離與未決操作保障。照片聊天與頭像不在這份介面交付冒稱完成。
- **背景保存已合併並發布：**#284／`015deb8` 共用 owner 保留未保存意圖及 3 秒合併；`check_items` 在同一交易提交最多 128 項，保存中可繼續點，原收據恢復及衝突仍保留。正常保存不再重讀全列表，離頁不等待請求。[定向證據](artifacts/verification/PREPARATION_BACKGROUND_SAVE_20261024.json)及[交付證據](artifacts/verification/PREPARATION_BACKGROUND_DELIVERY_20261024.json)分列實作與公開核對：API／worker／Web 已更新，Android preview group `a46b49b0` 與 v3 相容，首次 Expo 資產處理逾時經查明未發布後沿同產物補送一次成功。零模型／通知，未做真機確認；突然關閉程序前尚未送出的修改仍可能遺失，不是 Server 暫存或離線主庫。
- **下一版 APK 品牌已準備（2026-10-24）：**Android launcher 指向既有品牌 icon，Expo 57 對應 splash plugin 使用既有透明標記及白底；必要 config／原生資源生成與圖片核對通過，[證據](artifacts/verification/ANDROID_BRAND_STARTUP_20261024.json)。未建置／上傳，新 native 配置會改 fingerprint，待下一次必要 APK 一起交付，不能向 v3 強推 OTA；現有 v3 及其 runtime 保留。

<a id="chat-photo01"></a>
### CHAT-PHOTO01：照片隨聊天送出與附件重讀

- 使用者於2026-10-24重申：照片像一般聊天附件，拍攝／選圖後附加至訊息，送出交給 Agent；不先轉核對頁、強制執行照片提取或確認成記錄。附件庫查看 Server 已保存、可供 Agent 重讀的附件；核對頁檢視 Agent 已整理保存的資料，兩者不可混淆。
- 本包接通 composer 的照片傳送、聊天引用、正式模型多模態及原圖重讀。原 `AgentPhotoInput` 提取／核對通路退出聊天；既有人工提取備援保留。照片不是不支援讀取的通用文件。
- 復用既有私有 Storage／Firestore、hash／版本、原操作及刪除生命週期；新訊息及附件共用同一權威。清楚低風險指令沿原授權，重要事實／共享寫入仍在對話內確認，不把上傳附件當成已確認事實。保留舊記錄／提取證據，不接管協作者 Agent PR。
- 獨立核對一條照片附加→送出→模型可讀→附件庫／新對話重讀，機械接點先用合成資料；不重跑照片品質或各模型矩陣。完成相容 Server 接線後才啟用前端送出，不能在後端未支援時提供假成功。
- 2026-10-24 使用者明確允許在獨立分支加入照片專用 Agent 接線，保留協作者審核工作、不代合併其 PR。`codex/chat-photo-backend` 由 `60b42c1` 開包；新增 #286 的 PhotoInputDomains 修復也須保留，前端整合前核對。後端訊息引用／原圖讀取、原生多模態及審核證據接點已實作；兩條合成連貫情景與定向 strict 型別通過。後端已合併 #287；[後端證據](artifacts/verification/CHAT_PHOTO_BACKEND_20261024.json)。共用前端已接原圖保存／原操作查回、聊天送出、照片查看及附件庫同 ID 重用；[前端證據](artifacts/verification/CHAT_PHOTO_FRONTEND_20261024.json)包含單一連貫 client 情景、窄型別及 Web／Android 匯出。已合併 #288，原站與 Android OTA 發布完成；[交付證據](artifacts/verification/CHAT_PHOTO_DELIVERY_20261024.json)保留封包失敗／相容修正及回退。實際 runtime 只把兩項照片注入接回現網組裝，不帶入未發布頭像／APNs。真模型照片理解及手機效果未驗，不代替角色品質驗收。
- 手機輸入框說明文字延遲：使用者回報彈窗初開先空白、等一會或 focus 後才顯示。共用 Paper 原生 label 有量度前 opacity gate，根因未經真機確認；原生單行 outlined 空欄位改用原生 placeholder，focus／有值時恢復浮動標籤，不改 Web、flat 或多行。三項共用元件檢查通過；實機結果另列，不承諾零延遲。

<a id="avatar-01"></a>
### AVATAR-01 本人／孩子頭像

- **裁切體驗增量：**原生啟用已安裝 ImagePicker 的方形裁切，返回副本只預覽／保存；Web 用 `react-easy-crop` 的拖曳、縮放及鍵盤，移除自製手勢／方向按鈕。原網站 CSS zoom 僅在裁切容器內抵消，避免大圖圓框被放大截斷；Server 裁切、授權、防重及刪除不改。[採用依據](docs/TECH_REUSE.md#avatar-crop-reuse)／[實際結果與原失敗](artifacts/verification/AVATAR_CROP_REUSE_20261025.json)；原生實際選圖／EXIF 待驗。#305／`1f07fab` 原 Web 已更新，Android v4 已完成同簽署及品牌資源核對；交付與真機狀態見[本批交付](artifacts/verification/AVATAR_CROP_DELIVERY_20261025.json)。
- **目標及範圍：**本人及有既有寫入權限的孩子可選圖、裁切、更換、明確移除；獨立私人資源，不進照片分析、模型或分享。沿[API](docs/API.md#avatar-api)及[資料生命週期](docs/DATA_MODEL.md#avatars)，復用共用 Web／Android 畫面。
- **已實作／部署：**#264 來源與後續生命週期修正、#298 正式 runtime 接線已合併。2026-10-25 `652edad` 已同版更新原 VM API／worker，補齊 sharp、還原與清理依賴；Web／Android 不變。索引 READY、候選正式組裝、兩服務健康、公開 health 及部署後 Scheduler 喚醒通過；[部署證據](artifacts/verification/AVATAR_DEPLOYMENT_20261025.json)。
- **已啟用：**使用者明確批准後，#300／`0ebfbfa` 只更改 source release flag，於 2026-10-25 09:08 UTC 在原站同版 API／worker 開啟 `AVATAR_WRITES_ENABLED=true`。候選正式組裝、健康、公開入口及配置讀回通過；Web／Android 沿已發布畫面，無需重裝。[啟用證據](artifacts/verification/AVATAR_ENABLE_20261025.json)。停寫回退保留相容 `avatar-runtime-652edad` reader／cleanup，不能退回不認識頭像 schema／journal 的舊版本；權限、防重、刪除及配額均不改。
- **本次收尾：**本機真 Web 選圖／裁切發現刷新期間保存會被略過，已修正為寫入取代唯讀刷新，保留原操作與版本。保存／內容讀回／重開／明確移除及附件庫下載已通過，[證據](artifacts/verification/ANDROID_FINAL_CLOSEOUT_20261025.json)保留原失敗。#302 已合併，`15fdb50` 原 Web 已更新及公開 hash／health 讀回；API／worker／資料不變，[交付](artifacts/verification/AVATAR_SAVE_DELIVERY_20261025.json)。Android v4 交付見上方增量；手機裁切／EXIF 待驗。裁切體驗已按上方增量改用成熟能力，接續同批 Web／APK 交付，不以保存通過代替原生操作品質。
- **已有必要證據：**[正式 Server 型別及恢復修正](artifacts/verification/AVATAR_LIFECYCLE_FIX_20261024.json)、[Linux codec／license](artifacts/verification/AVATAR_PLATFORM_20261024.json)、[中斷副本放棄](artifacts/verification/AVATAR_RESTORE_ABORT_20261024.json)、[原生副本 CAS](artifacts/verification/AVATAR_NATIVE_20261024.json)、[原生准入／更換／清理](artifacts/verification/AVATAR_ADMISSION_NATIVE_20261025.json)、[journal 接續](artifacts/verification/AVATAR_JOURNAL_RESTORE_20261025.json)、[原生配對還原](artifacts/verification/AVATAR_PAIRED_NATIVE_RESTORE_20261025.json)、[正式 runtime 接線](artifacts/verification/AVATAR_RUNTIME_20261025.json)。沿證據復用，不重跑整批；臨時帳號、兩庫及專用 bucket 已清理。
- **保留限制／門檻：**Android v4 的真選圖、EXIF-6 方向、裁切拖動、App 預覽及取消已核；未在本人孩子上保存合成頭像，保存生命週期沿既有 Web／Server 證據。Web 合成圖片流程見上方增量證據。原生每日備份／Secret Manager 災備未因配對快照核對而完成。真 Tasks 新增頭像工作沒有另發一輪，沿既有 OIDC 喚醒、正式路由及原生 cleanup 證據。來源／Auth／journal／provenance 改變與 unknown 不盲重做；歷次 fixture／PITR／OOM／舊測試失敗均保留於原證據。啟用方法見[部署門檻](docs/PRODUCTION_FRONTEND.md#avatar-deployment-gate)。

### 保留的 Android 交付狀態

- 管理員總控已於 #233 合併；每日及每輪設定只有一個權威。部署觀察、期限與未核對項只見 [STATUS](STATUS.md#deployment)。
- 當前實作：[S12-W05](#s12-w05) 首頁快捷輸入及通用文件附件，Server／Web及相容Android OTA已交付，Android選檔及Web本地檔案／錄音adapter已有證據；正式頁面上傳／下載及真人流程等gate仍待驗。#229 已整合；[S04-W01](#s04-w01)首條真人聊天仍由使用者驗收；鍵盤輸入可見及收起回位的既有真機結果保留，不宣稱每幀動畫已驗。
- 504處理已交付：原站API／worker、Web及APK v2相容OTA已更新；管理員政策v3為單次90秒、互動300秒、最多額外3次有計量重試，每日200／400不變。已成功工具不重做，未知副作用不盲重送。兩項必要本機流程、舊政策相容補核及局部型別已通過；零真模型／通知。Google實際恢復及使用者首條聊天未驗，手機鎖定時未追加真機操作。依使用者要求收束當前修正，餘下Android門檻見各包，不開新功能。
- 後續獨立接線與必要本機檢查已由 #234～#239 合併：會話、同步、原運行查回、語音／附件、原生通知與固定發布工具。`bf47c47` 的新增索引、相容 API／worker／Web 已交付原站；新版 APK已完成並記錄發布基線，使用者已回覆覆蓋安裝；使用者已確認正常開啟、原登入及資料保留；其餘功能真機仍未完成，依賴已按本批安排合併。
- Android Firebase／最小 FCM 權限及 Expo preview 描述檔已配置，新版 APK已安裝；本人已允許通知，一則指定FCM測試已在手機顯示，不重發。具體範圍／gate 只在[各工作包](#s13-w02)，不在此重複工作史。
- 主模型實作、指導及 review；使用者最新容許 Luna 按規則唯讀定位。最低必要檢查，優先局部原文或日誌尾部；需本人／手機的項目待驗時繼續獨立工作，不能把待驗寫成完成。
- OPT／LAY 已交付；[STR01](#p2-str01)及[原生備份還原](#p2-backup-followup)仍未完成。#214～#216／#243 已合併，真模型／長來源等尚欠成果按 DEV02 及所屬角色包承接，不把合併當整體完成。
- 每包交付按本機協作文件及主責切換帳號、單作者提交；B提出Android／共用前端需求，C實作所需後端，接口穩定後由B接線。人工驗收仍保留，已合併 PR 不再作重複前置。新包及合併前重核 master、相關 head 及本機修改。

<a id="local-agent-personal-model"></a>
## 四 Agent 本地開發環境與個人模型設定

<a id="model-self03"></a>
**2026-10-25 最小 Vertex 向量增補（已合併及發布）：**原香港 VM 以既有本人 Gemini key 單次查詢向量返回 `embedding_region_unavailable`，沒有重試或平台回退。補獨立向量供應商及本人 Vertex key／專案 ID／地區，復用固定 SDK 與 `gemini-embedding-001`／1024 維索引；不重算語料、不改四 Agent。新設定沿版本、原操作、加密及共同配額，舊客戶端不得覆蓋新路由；Web／Android 共用表單。只補設定／路由／SDK 請求的定向檢查及一條可行的本人憑證代表流程，不重跑已驗 Android／頭像／附件。 v4 設定／原收據／舊客戶端保護、SDK 真請求結構、共用表單／client、限定型別及兩端匯出通過；本人 Vertex key 單次向量成功（1024 維、2 input tokens），臨時 key／新增權限已清理。PR #317／`34f80a9` 已相容更新原 API／worker、Web 及 Android preview OTA（group `33a2e0a3`，同 v4 runtime，毋須新 APK），公開 hash／health 通過；使用者其後回覆「已有 Vertex AI 選項」，手機新選項顯示已核；原有一條離線檢查再接入正式 routing／embedding gateway，重讀保存設定、本人持久用量及原嘗試不重送通過，零真模型；本人 Vertex 完整 Agent／RAG 的後續真模型結果見下方 MODEL03；手機 key 輸入仍待人工，不把 provider 或畫面通過當成四 Agent 完整驗收。[證據](artifacts/verification/PERSONAL_VERTEX_EMBEDDING_20261025.json)。
### MODEL-SELF03 自行試用相容模型接口

- **2026-10-26 本人 Vertex 完整流程已核：**在 `226a848` 的隔離本地 Web/API，沿正式共用設定／聊天 client 保存本人聊天及向量 key，原操作、新登入會話讀回通過。平台停用下，3 次生成／1 次向量完成官方引用、獨立審核、保存及原 run 讀回；全部 4 次記本人，平台增加 0。臨時 key、IAM 及本地 key 已清理，原帳目保留；[完整證據](artifacts/verification/PERSONAL_MODEL_COMPLETE_20261026.json)。這補齊本人設定至 Agent 的代表流程，Android 本人 key 實際輸入／跨端畫面仍待人工；四角色聯合品質仍等協作者。先前 6／2 限額的 [embedding_limit 失敗](artifacts/verification/PERSONAL_MODEL_FLOW_20261026.json)保留，不倒推原反覆搜尋原因；之後 ADC [診斷](artifacts/verification/KNOWLEDGE_RETRIEVAL_CHECK_20261026.json)及工具額度指引修正已隨 #324／`14e0f60` 更新原站。

- 2026-10-25 收尾補核：原香港 VM 的正式 Vertex ADC 文字及 1024 維向量已通過；首個臨時個人 Vertex key 返回 403，失敗與清理證據保留。使用者另批准修訂批次後，同一身份／兩項最小權限等待 180 秒，經正式個人 provider 一次短生成成功（5 input＋1 output tokens），無平台回退；臨時 key 及新增權限已清理，沒有改網站設定／配額。這證明個人 Vertex key 生成接線可用，不倒推首個 403 的確切原因。[實測證據](artifacts/verification/ANDROID_FINAL_CLOSEOUT_20261025.json)。該日未驗的「保存設定→Agent／知識檢索」完整流程已由上方 2026-10-26 本人 Vertex 批補核；原批個人 Vertex／相容模式只接本人 Gemini 向量 key；本節上述 #317 已補本人 Vertex 向量路由，沿同一索引，真請求與後續完整 Agent 證據分開保存。原 Gemini 地區拒絕不推廣為用戶限制。

- 2026-10-24 Android 補核：使用已登入帳號只保存同一平台模式／模型設定一次，Firestore metadata 確認版本 2；關閉及重開 App 後登入保留並讀回相同設定。沒有輸入 key、呼叫模型、發通知或修改配額。此為真機保存／重開證據，不代表本人 key 真生成或完整跨端流程通過；證據合併至當前 S16 收尾。
- 2026-10-23手機補核發現捨棄後殘留草稿；#267已修正並發布`4bfdf98`，保留原失敗及兩項React檢查。2026-10-24補核先觀察到手機仍載入舊圖標／舊表單，停止該批；新圖標出現後，只補同一流程，確認未保存個人模式／相容服務草稿可捨棄，實際離頁再返回會恢復平台模式且不再dirty。沒有輸入key、保存設定或呼叫模型，精確OTA ID未讀取，真key仍未驗。[原修正](artifacts/verification/MODEL_SELF03_DRAFT_RESET_20261023.json)／[發布](artifacts/verification/MODEL_SELF03_DRAFT_DELIVERY_20261023.json)／[本次補核](artifacts/verification/SHARED_NATIVE_NAVIGATION_20261024.json)。
- 共用導航：按使用者要求，五個原生Tabs及核對按鈕的圖標／標籤讀同一`frontend/src/components/navigation/app-navigation.ts`，圖案沿`AppIcon`；核對／更多目的地亦沿共用href。手機五入口、手勢、選中狀態與離頁guard保持。修改共用metadata會同時影響Web／Android來源，發布仍沿原Web／相容OTA流程，不代表網站發布會自動更新已安裝App。本批只改兩個產品檔案、兩項現有定向檢查通過；現有顯示值不變，未為此重建／發布，下一次相容Android更新帶入。
- 後端／本地入口#255、#256及共用畫面[#260](https://github.com/2NTTY/child-ai-caregiver/pull/260)已合併。A單作者；#260合併版本`1282e09`於2026-10-23更新原站與相容Android preview OTA，沒有改#254／#259。主模型統籌契約、整合及review，本輪特許的原Astra子代理接續獨立核對；[交付證據](artifacts/verification/MODEL_SELF03_DELIVERY_20261023.json)分開已發布、未驗及回退邊界。
- 沿同一Web／Android設定、加密保存、原opId、配額及ADK Agent，新增相容API base URL、key與直接輸入模型ID。普通Chat Completions、工具往返及可轉換媒體接薄adapter；不另造Agent、不換模型、不新增自動重試或逐模型測試。供應商不接受某請求時回報錯誤，不把未知能力當作禁止選用。
- 自訂地址限公開HTTPS，不把憑證送到內網／metadata服務或重新導向；不開任意headers。必要資料外送說明改為用戶所選服務，私人內容與key不入日誌。
- 向量保留`gemini-embedding-001`／1024維／現有索引。提供可分開保存的本人 Gemini 或 Vertex 向量 key（後者另填專案／地區），聊天可用另一供應商；舊Gemini設定維持同key行為。未配置相容查詢憑證時如實回報，不借平台ADC／額度，不拿其他模型的向量查舊索引。其他向量模型及索引重建留後續，不以本包宣稱通用向量已完成。
- 最少驗證：一條合成工具往返與用量轉換；共用設定保存／原操作及密鑰遮蔽；地址拒絕及舊契約相容。只跑受影響檢查及必要型別，零真模型／通知／全量。部署及私有封包傳送另依有效範圍，不把本機接線當已上線。
- 已接：`server/personal-model-providers.ts`復用同一ADK gateway；Chat Completions文字／工具、圖片及WAV／MP3轉換；其他媒體明示不支援。Gemini／Vertex舊路由保留；另填Gemini向量key，不配置時明確回報`embedding_not_configured`。密鑰、模型不存在、餘額不足、限流、工具／媒體、連線及HTTP拒絕分開回報；只輸出受控分類，不把可能夾有key或私人正文的供應商原始錯誤放到聊天。
- 設定契約：`Accept: application/vnd.yuyoufang.model-settings.v3+json`沿既有`/api/ai/settings`及operations接口；新增`provider: openai-compatible`、`baseUrl`、`embeddingApiKey`／`removeEmbeddingKey`，只讀回`embeddingKeyConfigured`。地址改變須重新提供聊天key，避免轉送原憑證；舊v2保持既有Google設定，遇新設定回`client_update_required`，其保存資格在同一交易內核對，保留原opId恢復。
- 本次接線：在#253現有`ModelSettingsView.tsx`加入相容服務、API地址及獨立向量key，保留現有視覺和七項限制。切換身份／供應商／模式、離頁、保存與失敗時清理兩份密鑰；地址改變不沿用原聊天key，同意內容對應所選服務及Google向量用途。共用client採v3，舊v2 Server相容保留；unknown只查原opId，不重播key。最低client／form／三項React接線及限定型別通過，Web與Android本機匯出成功；Android runtime相容APK v2。首次Hermes暫存權限失敗及修復保留於[UI證據](artifacts/verification/MODEL_SELF03_UI_20261023.json)。不修改#254、#259分支或Prompt Pack；正式部署及OTA已完成，真key與新表單真機操作未驗。
- 證據見[MODEL03後端核對](artifacts/verification/MODEL_SELF03_BACKEND_20261023.json)。一次v2恢復檢查失敗已修正為交易內核對並局部補驗；更廣的Server型別入口帶入未改前端／舊測試錯誤，限定本包及模型設定畫面型別均通過。原後端核對未跑真模型、雲端、裝置或全量；其後部署結果另見本包交付證據，不回寫原結果，真key與裝置操作仍未驗。
- 本地接續：從#255／`d1cfac6`接入同一相容provider，`agent:local`、知識初始化及獨立維護共用工程外配置與獨立向量key。明確模型ID不再被管理政策的固定模型覆蓋，配額仍由原政策控制；角色／提示詞未改。兩項合成路由／憑證檢查及限定型別通過，沒有新增真模型或emulator全流程；方法見[本地入口](docs/AGENT_LOCAL.md)，證據見[本地相容接線](artifacts/verification/LOCAL_COMPATIBLE_MODEL_20261023.json)。

**目標：**協作者在自己的分支改完即可用真模型測聊天、資料編製、審核、背景知識維護、工具、保存及頁面結果，毋須部署 GCP；之後 Web／Android 共用本人憑證、模型及限制。以下取代前版本地／個人 key 安排，未實作部分不得寫成已具備。

### 共同不變條件

- 沿用同一正式 ADK、ModelGateway、Prompt Pack、工具及業務服務；只替換外部環境接點，不複製測試 Agent／提示詞，不重做 UI 或雲端架構。
- Google 優先：Gemini／Vertex API key，開發者亦可用本機 ADC；Web／Android 不上傳服務帳戶 JSON。個人模式完全使用本人憑證，不借平台模型或 embedding 額度。
- Firebase Auth／Firestore／Storage Emulator 使用固定版本、`demo-` 專案、本機端點及 Node／Java 檢查。業務資料專案與模型計費專案分開；缺本地依賴不回退正式 GCP，正式啟動拒絕本地接口／設定。
- 身份、准入、session、權限、交易、版本、確認、原 opId、防重、加密、附件 hash／版本及刪除仍經正式服務。物件 emulator 缺口才用薄 adapter，不另寫附件規則。
- 工作台帳、claim／租約及 worker handler 不變，只替換喚醒接點；通知／寄信預設本地收件箱並明示未實際發送，不能返回假渠道成功。
- 官方種子保留原文／版本／位置；缺向量才用本人憑證小批初始化並按 hash 復用。先核 emulator 向量支援，若缺 findNearest，只替換有界候選查詢、使用相同距離，保留正式過濾、關鍵詞、RRF及引用；不假搜尋或固定答案。
- 照片／錄音／附件／PDF 沿分支既有服務；缺失或不支援能力明示。本地結果不代替真 GCP IAM、雲端投遞及容量驗收。

<a id="dev-agent01"></a>
### DEV-AGENT01 本地正式運行環境

- 狀態：#241 交付可用的本地開發入口；本地基礎、首條必要真聊天／引用、保存／重啟讀回及 Web 接線已核對，前置 #239 隨本批依序合併。操作見[本地入口](docs/AGENT_LOCAL.md)，結果與原失敗見[DEV01 證據](artifacts/verification/DEV_AGENT01_LOCAL_20261018.json)。四角色品質與其餘功能按 DEV02 分開追蹤。
- `npm run agent:local` 一次啟動既有 Web、本機 API、正式 Agent及持久隔離資料；首次準備依賴後只需 key，ADC 使用者另設模型專案／地區，不需雲端資料庫、正式帳號或正式密鑰。
- Web 熱更新、Server／提示詞重新載入；下一操作使用新版本，途中重啟不重送問題。顯示分支／SHA／模型／Prompt Pack及角色狀態；原 run／收據可查回。
- 帳號、孩子、聊天、文件、工作重啟保留；worktree 各自端口及資料目錄。重設只清本地資料；憑證不進 Git、前端 bundle或日誌。
- 初始化、重啟與日常啟動不自動執行付費驗收；首批缺失知識向量另以明確準備操作產生，顯示用量。
- gate：本地真聊天／工具保存／頁面與重開讀回，改程式或提示詞後可再測；無正式資料寫入／通知。只作必要依賴及接線核對。
- 本次真模型回覆只有文字準備單草稿，未保存為文件；不得算編製／審核／四角色聯合驗收。另以零模型正式 client 核對同一準備單修改／讀回／版本衝突及加密附件保存／讀回／刪除，共19次本機API；沒有聲稱照片／錄音／PDF全部驗收。背景派送已復用正式 consumer；非郵件本地收件箱已接線，Telegram／Web Push 正式 client 流程通過，原生完整路徑仍待驗。角色聯合缺口不以重跑既有聊天或登入代替。

<a id="dev-agent02"></a>
### DEV-AGENT02 四角色聯合接線

- 前置：DEV-AGENT01。狀態：#244 整合 #214／#215／#216 及 #243 的後續確認修正，保留個人模型／Android 語音及共用錯誤接點；本地基礎及非郵件收件箱可用，完整角色成果仍待下列驗收。先前 `ce1d6f9` 的正式組裝 scripted 編製／審核／同文件確認保存、原操作防重、錯誤引用及背景無動作證據保留；一次真模型流程遇自動重載中斷，原 run 已查回 unknown／interrupted，僅有一次未回報結果的模型預留，未重跑。詳見[DEV02 證據](artifacts/verification/DEV_AGENT02_LOCAL_ROLES_20261018.json)。本次整合沿原作者，未驗項按本批新安排合併後追蹤。
- 載入當前分支正式角色；聊天語義委派編製、Server控制審核，不要求每句啟動全部角色。編製更新同一資源，頁面同步；「處理頁面」是業務工具改資料，不是模擬點按。
- 聊天／編製／審核共用根 run、取消／期限／計量；背景維護使用獨立工作預算。角色模型缺省繼承共同模型及開發者憑證，不因子 Runner／重試繞限。
- 獨立背景入口可手動／本地排程啟動，樣本與受限真網站模式分明；遵守既有網域、路徑、頁數及用途，只發布本地知識庫。私人資料不可進公共維護上下文。
- 審核綁定正文／來源／對象／版本；未核准不正式保存。顯示角色、工具、審核、收據、耗時及停止原因，不預設完整私人正文／內部思考日誌。
- 聯合測試可用獨立本地整合分支及固定提交，保留原作者；已按使用者新授權合併協作者 PR；沿既有角色及服務補缺，不重造測試 Agent。缺接口列清由本輪承接；環境可啟動、角色已接及真模型已驗分開，#216 stub 不計真審核完成。
- 真編製／獨立審核與同一文件確認保存已通過：修正 Java 子程序路徑及多餘的待確認狀態審核後，沿原限額完成一次真模型流程，文件只改指定標題，其餘章節不變；重新讀取同一版本。[失敗與成功證據](artifacts/verification/DEV_AGENT02_REAL_COMPOSE_20261020.json)分開保留，不重跑已通過項目。
- 背景接線：共用原文整理／獨立審核已接 Firestore 工作、共同計量、模型結果保存、發布交易及 `agent:local -- --maintain-knowledge`。一條真 emulator／scripted provider 流程核對發布、重建服務後原工作查回、原文檢索與 unknown 不重送；兩項模型契約檢查及局部型別通過。[本次證據](artifacts/verification/DEV_AGENT02_KNOWLEDGE_RUNTIME_20261020.json)保留所有失敗，沒有把 scripted 當真品質。
- 真背景結果：舊樣本六次生成及首輪 PDF 兩次生成的失敗／保留結果不改寫。`d3127a4`／Prompt Pack 0.1.53 沿相同正式 PDF 範圍補一次，兩次生成及一次缺少向量完成整理、獨立審核與本地發布，沒有重試。此為已登記第3頁，不代表整本手冊或圖片多模態完成。聊天入口已改用同一核准來源清單，讀已發布版本，不重新初始化向量。[完整證據](artifacts/verification/DEV_AGENT02_KNOWLEDGE_RUNTIME_20261020.json)。
- 本地背景查閱：`agent:local -- --inspect-knowledge[=<工作指紋>]` 直接讀原工作及候選／審核，不需要模型 key、不領取 lease 或發布。一次原 emulator 候選查回成功，原用量及待處理結果不變；確認本次候選沒有既有 `solid_food` 規則所綁定的 `starting-solids` key。保留該依賴待核，不放寬發布閘。方法見[本地入口](docs/AGENT_LOCAL.md#獨立背景知識維護)。
- 已修正 Gemini key 初始化／維護誤用查詢專用 adapter：兩個受控 operator 入口可建立文件向量，一般個人 key 不擴權；沿用原模型、1024維及計量，不重算既有向量。兩項 SDK 契約檢查通過，真 key 未驗；文件標題加片段超過2,000 UTF-8 bytes仍明確拒絕，長來源分批gate不變。
- 本地非郵件收件箱已接正式 runtime／worker：Telegram 本機開始與確認、Web Push 合成訂閱、原操作防重及撤銷均通過；只保存加密預覽並回報未實際發送，不假報渠道接受。零真模型／通知；[證據](artifacts/verification/DEV_AGENT02_LOCAL_ROLES_20261018.json)的 `localDelivery20261020`。原生 Android 完整路徑未驗。
- 正式 Web 聯合：Chromium 沿正常登入／孩子選擇，重新讀到原文件 `3b1171d2…` 的 v2「下次到診問題」，未改章節。隨後同孩子的一個真聊天讀文件並搜尋知識，4次生成／1次查詢後因每日上限停止；本地政策初始20／100、本人已用20，未保存完整引用回覆。沒有重送、調額或清零；啟動及操作文件已指向本地 `/admin`，明示與現網200／400分開。
- 2026-10-20 獲批的單次補驗：本地每日20→26，另收緊為最多4生成／2查詢／零重試。實際4生成／零查詢後因 `model_limit` 停止；能力載入有一次參數拒絕，讀回原文件後的呈現因缺引用被拒，沒有完整回覆。已恢復原政策20／100及8／16／4、保留本人當日24次用量，未重跑。原文參數未保留，不臆測具體錯填欄位或以放寬引用閘修正；[追加證據](artifacts/verification/DEV_AGENT02_KNOWLEDGE_RUNTIME_20261020.json)。
- 已補此次失敗涉及的指引：能力載入strict拒絕附本次有效ID及有界修參資訊，既有核心搜尋毋須載入；缺引用回覆說明按餘額補查，不能改標逃避。Prompt Pack 0.1.54明列呈現及審核共用預算，沒有加額或移除檢查。scripted拒絕／計數／隔離及Prompt Pack／局部型別通過，真模型改善未驗；見[修正記錄](WORKLOG.md#log-20261020-dev02-tool-repair-guidance)。
- 2026-10-23 接續核對：原本機快照缺失，使用新隔離資料，沒有聲稱恢復原成果。官方 PDF 第3頁再次經2次生成／1次向量完成真整理、獨立審核及發布；隨後只送一條聊天，讀文件及搜尋成功，但能力參數與引用修正耗盡8次生成／1次查詢，終態為 `delivery_review_incomplete`。未重送；恢復本地原政策20／100及關閉狀態，保留12次用量與失敗快照。[本次證據](artifacts/verification/DEV_AGENT02_CONTINUITY_20261023.json)分開準備失敗、發布成功與聊天未通過。
- 尚欠：背景新版的最終已審核聊天引用及新對話成果接續。**2026-10-24依使用者決定延後：等待四個Agent真正完成，並由協作者先自行檢查，才重新安排聯合補驗。**保留`delivery_review_incomplete`現場；本聊天停止這部分調查／整合／模型重跑，不接管協作者修改。個別審核／預算PR合併並非單獨的恢復條件；重新開始時先核對四角色完成與自查證據，再只補剩餘必要流程，不重跑編製／發布、不擴配額。多模態與長來源分批仍未完成，不以單頁PDF達標。普通本地入口仍可供協作者改完即試；角色功能／品質缺口不改寫成環境失效或已通過。MODEL真憑證及Android未驗項分開保留。
- gate：聊天→編製→真審核→保存→頁面／新對話讀回；另無聊天時背景讀來源→整理／審核→本地發布→聊天引用新版。缺角色真實實作時保留待驗，不能以替身達標。

<a id="model-self01"></a>
### MODEL-SELF01 個人模型與共同策略

- 前置：DEV-AGENT01，DEV-AGENT02可用接口已核對；協作者未實作及真模型gate獨立保留。狀態：後端／共用client已接Gemini／Vertex key、模型目錄、本人進階限制、生效值及原操作查回；兩條合成設定／SDK流程及兩項既有client檢查、局部型別通過。程式已隨MODEL02部署，真個人key生成仍未驗；原結果見[MODEL01證據](artifacts/verification/MODEL_SELF01_SETTINGS_20261018.json)。
- 擴充現有加密設定／收據／用量及 command／view：provider、model、能力、進階限制及實際生效值；Server提供模型目錄，保留 expectedVersion／opId／unknown恢復。
- Gemini／Vertex API key使用正確SDK模式；ADC只限本機。依供應商可用模型及已接能力提供選項，thinking／工具／圖片／音訊／串流按型號處理，不偷換模型。metadata與真生成分開；保存設定不自動試多模型。
- 2026-10-20依使用者澄清：參考目錄不再作保存／生成白名單，可直接輸入合法Gemini ID；新型號省略可選thinking參數，由相同SDK／Agent處理，不逐模型驗收、不自動換型號或借平台額度。供應商metadata不再只取本地profile交集，仍最多兩頁／20項回傳並標截斷；能力未知與不能使用分開。共用表單、保存／原操作及SDK接線檢查通過，修正已隨 #246 部署並發布相容OTA。契約見[API](docs/API.md#personal-model-http)。
- 同日進一步收窄：只提供Web／Android共用的憑證、模型及限額接口，由用戶自行配置；不代每位用戶建立Google身份或要求逐key／逐模型先驗收。不按國籍、居住地或本機測試結果封鎖；metadata核對屬可選診斷，不作保存或使用前置。實際請求由供應商判斷憑證、權限、地區及配額，失敗回報對應原因；取得key不等於所有請求必然成功。既有基本保存、隔離與呼叫接線仍須正確，未接能力不能因有表單便標為完成。
- 地區、憑證、模型、配額、逾時回傳安全且可分辨原因。embedding路由與聊天模型分開，維持原向量空間；本人憑證缺embedding時明示混合檢索不可用，不借平台額度／偽造引用。
- 可調每日、每輪生成／工具／embedding、整輪期限、單次等待、重試及背景授權；共同解析器計算個人設定與管理員保護的實際值。模型知道可用預算，硬上限防失控而非要求用盡。
- run固定模型／預算快照，重試沿原run計數、不重做成功工具／未知副作用；舊設定缺欄位維持舊行為。聊天／編製／審核／媒體／轉錄／背景用同一解析器；公共知識維護不用家長key，本地用開發者明確設定的維護憑證。
- 版本邊界：v2明確保存才採共同管理上限；舊設定不默改。Vertex AI本身支援向量，原 MODEL-SELF01 的個人 `vertex` adapter 只接 Express 生成；MODEL-SELF03／#317 已補獨立 key／專案／地區的 embedding，metadata 仍非通用目錄；這是接入路徑缺口，不能概括為Vertex不支援。平台／本機ADC向量路徑已有實作，但不借其付款身份補個人請求。保留該缺口及[官方向量接口](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings)，不為本輪另建認證平台或改組織政策。新收據含備份／還原與帳戶清理接點，未跑真雲端還原；角色及Android待驗不變。
- 2026-10-20 已按使用者要求建立僅限Gemini API的受限授權key，工程外保存。正式本地設定服務可保存，唯一metadata核對回 `region_unavailable`；已移除業務設定中的key並恢復原模式，用量不變。這只代表該次Developer API請求被拒，不是生成／embedding通過，也不能推論所有香港用戶、GCP／Vertex或其他key不可用；ADC本地流程維持可用。真key結果保留未驗，不再把取得另一把key列為入口交付前置。

<a id="model-self02"></a>
### MODEL-SELF02 共用設定及交付

- 前置：MODEL-SELF01；共用owner及表單已接同一v2契約，#242／#244 程式已部署原站並發布相容Android OTA。Web／Android共用供應商／模型、七項限制、背景授權、用量及Server生效值；沒有另一份UI限額權威。保存回應丟失時查原opId，未見收據不能清成成功或重播key。原兩項表單／原操作流程及局部型別證據保留，真服務及真機仍待驗。
- 2026-10-20 正式本地Web已保存合成key、模型與七項限制；原生session API讀到同版本及生效值，Web刪除key後回復平台模式，用量未變。修正編輯中自動重讀覆蓋草稿，以及launcher的CI旗標停用Metro監看的問題。原瀏覽器批次尾部因腳本150次請求上限停止，保留失敗；只補兩次唯讀確認清理，未將整批改稱通過。[MODEL02證據](artifacts/verification/MODEL_SELF02_SETTINGS_UI_20261020.json)。真個人key、Android實機設定／頁面重讀仍待驗；本機API讀回不等於真機通過。
- key不進prompt、日誌、URL、瀏覽器儲存或Android持久草稿；移除／替換沿原身份與版本檢查。部署沿原站及相容Web／OTA，不另建網站。
- 共用表單切換服務只讀該服務的參考選項，不保存key或自動換模型；Android已核對供應商切換及七項限制顯示。新增模型ID輸入及解除目錄禁用已完成局部檢查及部署；不將參考能力當可用性保證。
- `d53c203` 的API／worker／Web已部署原站，候選無網絡載入、服務健康及公開HTML hash核對通過；沿用原私人收據索引設定。相容OTA已發布，毋須新APK；本次新模型ID欄位已在手機顯示。發布本身零模型／通知、沒有業務資料遷移或配額修改；保留原映像及受保護配置，開放新寫入後不退回無法讀新設定的舊API。[交付及續期證據](artifacts/verification/MODEL_SELF02_DELIVERY_20261020.json)保留 `ad4de88` 交付、首次自動批准拒絕及後續具體批准；VM續期14天已完成，版本／期限只在STATUS投影。
- 2026-10-20 裝置核對發現首次 OTA 匯出漏合併 EAS profile 的身份供應商配置，重開後不能確認登入；該批即停。已用同版產品程式、完整既有發佈配置重新匯出並補發相容 OTA，本人重新登入後，裝置已讀到新版設定、供應商／模型及七項限制；測試草稿已清除，重開仍登入且維持原平台設定版本0。沒有保存個人設定、輸入key或呼叫模型，真key及Android保存仍待驗；原失敗另記於同份交付證據，不改判首次發布通過。
- 2026-10-20 14:38 UTC後續真機：新OTA的「聊天模型ID」及直接選型說明已顯示；個人模式只作未保存草稿，沒有輸入key。恢復原平台模式並只保存一次，Server版本0→1；完全關閉App後再進設定仍讀到版本1、原模型及未配置key，登入保留。沒有改限額或呼叫模型／通知；這證明原生表單寫入及持久讀回，不代替個人key／七項限制的實機保存或供應商生成。結果追加至同份證據的`modelChoiceAndroidAcceptance20261020`，不重跑已核項目。
- 交付短指引：啟動、key／ADC、選分支、改完再試、背景觸發、角色結果、資料重設及仍需雲端確認的差異。

### 最少驗證及完成門檻

只使用三組連貫情景：①本地產品流程串一次衝突／原操作查回／錯誤引用拒絕；②獨立背景流程串重投遞／私人隔離；③設定跨端同版及角色路由，無平台回退／用量重設。機械拒絕用scripted provider，真模型只補必要理解／編製／審核／整理，不每角色或每模型開一套E2E，不全量、壓測或Computer Use。

完成須區分環境、角色接線、真模型證據及協作者待辦；不得以stub或靜態review宣稱四角色可用。按包review／最低驗證／PR交付，Android原未驗、draft及備份待驗不改寫。

<a id="doc-r05"></a>
### DOC-R05 — 歷史計劃移出日常入口

- 本輪文件整理：P1／P2 及早期文件包已搬至[凍結歷史](_archive/README.md#plan-p1-p2-20261018)，根 PLAN 保留當前工作、未完成門檻、P3 以後與相容錨點。
- 來源 `92107bb`，文件 PR #240 的成果隨 Android #239 合併；歸檔與導引已進 master，不改產品／部署或原驗收結果。

## 尚未結束的 P2 門檻

歷史正文已移走，但下列待辦仍有效；不要求為理解目前 Android 包讀整份 P2。

<a id="p2-str01"></a>
#### P2-STR01 灰色正文串流

- 前置：OPT02、OPT05、LAY05 已交付；#214 審核接口已合併；本包仍未開始，須沿最新介面接線，不因前置合併即標完成。這是 OPT05 完整正文交付之後的額外能力。
- ADK TypeScript 2.1.0 [原生文字串流](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/models/google_llm.ts)可用；現有 gateway 非串流且 StreamingMode.NONE。present_answer 正文在工具參數內，而 [Gemini 3.1 Flash-Lite 不支援工具參數串流](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling#streaming-fc)，不是升 SDK 或單改旗標便完成。
- 收尾使用原生文字串流代替原呈現生成，不先全文再重生一遍；完整正文／引用／收據仍進原校驗、審核、保存管線。工具參數須完整才執行，不從 partial 執行副作用。
- Gateway 聚合回應／終態／用量，每次生成計一次，不按 chunk 計數；中斷缺用量保留未知。送草稿前保留身份／來源／權限／隔離及禁止披露檢查，全文後才語義審核；限額不足停止，不加 run／配額。
- 前端生成中灰字標「未審核草稿」，審核中仍灰；通過並保存後以權威結果原位替換；修正通過只留核准版本，拒絕／取消移除灰正文並留狀態。斷線停增量並查原 run，不改 Server 終態／重做。
- 使用者已明確同意灰色預覽；草稿已披露，不能聲稱未披露，但不入正式歷史、記憶、報告、通知或當執行證據。不傳思考／signature／raw args／其他角色內部，不逐字寫 Firestore、不用假動畫。復用 OPT05 SSE，不加 WebSocket；固定醫療卡獨立即時顯示。
- gate：同批受控正常／拒絕／一次中斷查回，然後一條必要真模型代表流程證明真增量，沿有效授權／費用上限，不擴模型比較或全量。

<a id="p2-str01-handoff"></a>
**接續備忘（2026-10-20 更新前置；串流尚未實作）：**

- **固定基線／未完成：**遠端 master `d4686b7`；正式部署另見 STATUS，不把本地或 master 當成已上線。OPT01～05、LAY01～05 已合併及部署；STR01 尚未實作。已有真進度與最終完整正文，不是逐字草稿。兩份計劃不能整體標完成。
- **外部前置與責任：**#214／#215／#216 及 #243 已合併至 master `3795858`，本次只接回既有成果；角色真模型及完整背景流程的剩餘門檻在 #244 分開保存。恢復 STR01 時核對最新審核契約，不能直接沿用先前未合併快照。
- **最小閱讀與修改接點：**先讀本節及 #214 合併後的正式審核契約，再讀 [ModelGateway](server/model-gateway.ts)、[ADK adapter](server/agent-model-gateway.ts)、[Runner](server/agent-runtime.ts)；傳輸復用 [SSE](server/agent-feedback-stream.ts)、[事件契約](src/shared/agent-feedback.ts)、[客戶端 reader](src/client/agent-feedback-reader.ts) 與 [ChatController](src/client/chat-controller.ts)，畫面沿 [ChatTimeline](frontend/src/components/chat/ChatTimeline.tsx)。按相依符號局部追讀，不重新盤點全倉。
- **恢復次序：**審核接口穩定且合併 → 核對成果／來源版本與審核、保存結果的綁定 → 用同一收尾生成輸出真正文字增量 → 接灰稿／核准替換／拒絕移除 → 只補本節必要驗收。不要以現有引用 ID 校驗代替語義審核，也不要提前展示工具參數、內部思考或自行提高預算。
- **已有證據及限制：**復用 [交付 EV](artifacts/verification/P2_OPT_DELIVERY_20261015.json) 與 [交付 LOG](WORKLOG.md#log-20261015-p2-opt-delivery)。兩次真生成已核持久摘要及公開 SSE／聊天讀回；不重跑已通過項目。灰稿、語義審核交接與真正正文增量仍未驗；原生備份還原仍按原決定延後。回滾與部署限制只見 [正式部署](docs/PRODUCTION_FRONTEND.md#firestore-deployment) 及 STATUS。
- **目前替代工作線：**沿 [共用手機產品](#p3-mobile) 推進；2026-10-24 再批准 [iOS 接線](#p3-ios) 即時開始。STR01 的範圍、前置與證據不取消；備份真還原仍須使用者另行恢復，協作者角色與 P4 家庭功能不納入手機接線。

<a id="p2-backup-followup"></a>
#### 延後驗收：原生每日備份還原

- 使用者 2026-10-13 明確要求「這個測試等以後做」，不阻塞 F08／本輪 P2 合併及日常功能使用。每日 14 天排程保持，現有配對備份、獨立刪除日誌及已驗恢復能力不撤回。
- 保留 `scripts/firebase-recovery.mjs` 的 managed restore 入口、相關測試及[還原操作方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。原生備份已有 READY metadata 證據，最近觀察見 STATUS；真原生還原仍未驗，不能用排程存在、本機檢查或其他備份證據代填。
- 下次使用者要求續做時，只核 READY 備份並做一次獨立還原；沿最新 Auth／journal、來源停機與新世代檢查，目標保持暫停，不切產品流量或發通知。重新核實當時資源與本輪 US$1 上限的實際剩餘，不沿用舊餘額假設。沒有續做指示不持續輪詢或新增測試。


<a id="later-phases"></a>
## P3、P4、P5 及暫緩目標

**2026-10-13 本次只更新 P3 手機計劃，不啟動實作。** P2-A09 完整成果 gate 已由 F07／F08 交付並隨 #201 合併；手機包追加 P2-R04 前置，不再把 #140 或過時的待合併快照當作未完成前置。其餘仍寫 P2-A09 的包沿同一承接關係；原生備份還原待驗維持獨立，不取消。

舊 PostgreSQL／pgvector／Compose 是原技術方案或已交付實作對照。使用者已決定捨棄 SQL，F01～F08 為既定遷移方向；S17-W05 等自部署包的歷史 SQL 技術描述不構成新 SQL 建置指令。這是原 P2 遷移對照；現行自部署階段與完成條件依 ADR-028／P5，不重啟 SQL 規劃。

### 原工作包前移與延後對照

保留原 Sxx 錨點及歷史，只前移本目標所需子範圍，不整包改稱完成；原表各包須與本表一起讀取。

| 原範圍 | 本輪 P2 子範圍／承接包 | 原階段剩餘範圍 |
|---|---|---|
| S09-W03／P3 | Web 歷史、記憶與新對話接續 → P2-A02 | Android／iOS 跨端記憶與既有功能接點 |
| S07-W01／W02／P3 | Web 一致性、重連、未知操作恢復 → P2-A02、P2-A07、P2-A09 | Android／iOS 留 P3；集中故障覆蓋 P4、自選及跨 Server 部分 P5 |
| S10-W03／P4 | 官方 PDF、語義換版及必要發布維護 → P2-A04 | P4 大型管理、規模／效能及知識資料移轉；跨 Server 權威搬遷 P5 |
| S14-W02／P4 | 日常成長檔案、季度／年度與同版 PDF → P2-A05 | 非核心分析及進階分享；既有 PDF 的手機開啟／儲存／分享出口由 P3 S12-W01 承接，不含分享導入 extension |
| S15-W02／P4 | GCP 資料退出、必要備份保留與恢復 → P2-A08、P2-A09 | 集中服務剩餘恢復 P4；跨 Server／通用遷移 P5 |
| 身份／服務缺口 | 邀請、找回、真實資料及穩定交付 → P2-A08、P2-A09 | Google／Apple 登入 P4；電話登入保留原後續範圍；裝置配對已取消 |


<a id="p3-agent-roles"></a>
### P3 三個後續 Agent

P2 只留最小角色配置／契約；此處明確承接內部實作與原 AC-P2M，不另造通用 runtime、四套服務或資料庫。保留下方原 Android／跨端等工作包。

<a id="p3-m01"></a>
#### P3-M01 審核 Agent

- 階段／狀態／前置：P3；PR #214 已合併（`2f8e339`），DEV02 後續已有真模型獨立審核證據；完整角色門檻未結案，不能把局部成功當整包完成；P2-F08。最新聯合結果只見 [DEV02](#dev-agent02)。
- 後續 #243 修正候選回覆：Server 查回該 run 唯一有效問題後，可用固定待確認文字取代純操作草稿，候選不冒稱已執行；測試不再塞入無關保存收據。三項定向檢查及局部型別通過，沒有在本包追加真模型或部署，見[review 證據](artifacts/verification/P3_M01_POSTMERGE_REVIEW_20261020.json)。本地整合分支的真編製證據仍與 master／線上審核品質分開。
- 交付：Server 控制的唯讀審核，核原始證據／適用性／內容 hash、版本及輸出範圍；不能創造授權或修改業務。共享 ModelGateway／根預算，不由聊天自行決定免審。審核與生成沿同一根預算及目前設定，審核占用剩餘一次；`AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS=6` 只在未綁定 run 時採用提案，不提高每日配額，也不覆蓋正式設定快照。
- 必要驗收：沿一條成果核對支持與錯誤引用／版本變更拒絕，保留 P2 程式檢查；對照 AC-P2M-02，不宣稱臨床有效性。合成腳本已覆蓋真實引用但含義不支持、版本變更失效，以及未審核不等於正式成功。真 Vertex／Gemini 與線上驗收仍待使用者批准。M02 的「改一項、其餘保留」不在本包。2026-10-20 修正獨立審核上下文、no_action 型別與收據免審：只有重新核對真收據後由 Server 替換的固定回報可免審，模型寫「已保存」不算收據；保留分段 kind。6 項定向 scripted 核對及局部型別通過，零真服務。

<a id="p3-m02"></a>
#### P3-M02 資料編製 Agent

- 階段／狀態／前置：P3；PR #215 已接回 #214，修正及局部檢查後合併（`fbf5274`）；P3-M01。
- 交付：透過 ADK AgentTool 按需編製可保存／重用、嚴格格式或專門風格的資料；原領域 schema、同 ID 局部修改、審核及必要本人確認後由權威服務保存，不限於 PDF 或另造事實副本。
- 必要驗收：一條指定項修改→其餘保留→保存→新對話讀回，與父 run 共額及取消；承接 AC-P2M-01／02／04 的互動部分。
- 本次範圍是既有家庭文件的同 ID 局部編製／審核／確認；尚非全部領域資料編製。修正精確輸出 schema、實際 run 模型綁定、不同意圖的呼叫識別，以及已處理候選的真實狀態。3 項定向 scripted 及局部型別通過，見 [review 證據](artifacts/verification/P3_M02_PR_REVIEW_20261020.json)。DEV02 後續真編製、獨立審核、確認保存同文件及頁面讀回已有證據；新對話成果接續與其他資料類型仍未完成，結果只見 [DEV02](#dev-agent02)。

<a id="p3-m03"></a>
#### P3-M03 背景知識維護 Agent

- 階段／狀態／前置：P3；PR #216 的離線候選流程已完成 review 修正及必要局部檢查，已合併（`4132e1a`）；DEV02 後續已接共用模型 runtime、持久工作及原子發布，整包仍未完成；P3-M01（不依賴 M02）。最新聯合結果只見 [DEV02](#dev-agent02)。
- 交付：排程啟動獨立 Runner，在指定網站範圍讀 HTML／圖片／PDF、整理與核對新版並受限發布；不讀家庭私人資料，不作聊天搜尋子模型。沿現有知識、Storage、Tasks 和發布服務。
- 必要驗收：沒有聊天請求時完成一批有界更新→審核→發布→之後聊天引用；疑義保持候選、越界拒絕及重投防重，承接 AC-P2M-03／04。不得另開 run 重置邏輯工作預算。
- 已保留來源白名單、候選比較、程序檢查替身及預算／結果接口；補正關閉 live fetch 時只讀明確離線 fixture、PDF 完整頁窗獨立檢查，以及同一邏輯工作換 worker 不另開預算。4 項定向檢查及局部型別通過，見 [review 證據](artifacts/verification/P3_M03_PR_REVIEW_20261020.json)。
- **下一步門檻：**補長來源分批、圖片多模態及正式自動排程的接線／完成證據，完成背景新版的最終聊天引用。早期 `background_knowledge_live_not_connected` 是 #216 當時未接原子發布的限制；後續已由 DEV02 同一持久服務接通，原失敗／替身證據不回寫，也不再以舊限制重做 runtime。官方 PDF 單一登記頁已有真整理、審核及本地發布；不能擴稱整本手冊、正式雲端排程或完整角色流程通過。

<a id="p3-mobile"></a>
### P3 Web／Android 共用產品與 Android 成品交付

**目標：**Web／Android／iOS 是同一產品的不同入口，共用功能、資料及業務規則。Android 沿本節的 APK／EAS 交付，iOS 沿 [TestFlight 計劃](#p3-ios)；不包含 Google Play 或公開 App Store 上架。本節保留 2026-10-15 的共用功能及有效證據，2026-10-24 的 iOS 計劃取代「Android 成品後才開始 iOS」次序。

開工核對 master `21e848b`（#227），#214／#215／#216 仍由協作者處理。沿用現有 Expo 前端、Server、Firebase、ADK、Prompt Pack、原網站及 [DESIGN_SYSTEM](frontend/DESIGN_SYSTEM.md)，不重做設計、不另建手機後端或資料副本。STR01 灰色正文保留原前置，手機先接已交付的真進度 SSE／正式完整回答。只有本計劃相關接點可改，不接管三角色。

#### 已有能力及實際缺口

以下是 2026-10-15 開工盤點，保留作接線前後對照，不是目前待開發清單。Android 身份、音訊、FCM、APK／OTA 等後續成果及未驗項，以 [S04～S17 各包](#s04-w01) 為準，不按此表重做已交付能力。

| 範圍 | 可復用程式／成果 | 尚需接通 |
|---|---|---|
| UI／配置 | Expo 57.0.24、RN 0.86.3、Router 57.0.22、Paper、TanStack Query；NativeAppShell 及共用畫面 | app.json 仍用 preview ID，無 EAS 設定。Android JS 匯出不是 APK／真機證據 |
| 身份／資料 | Firebase client、Server 裝置會話、正式 owner、各領域 API／收據 | owner 依賴 window.location、Cookie 及 Web Origin；需要共同原生 transport／安全會話交換 |
| Agent／同步 | 真進度 SSE、run／操作查回、changes cursor、確認及領域 owner | 原生串流 fetch、AppState／網絡狀態、跨設備接續；背景不能持續輪詢 |
| 輸入／成果 | 照片服務、私人來源、同版文件／PDF、私有加密 Storage | 相機／相簿、原生保存／分享；完整音訊服務及兩端錄音、轉錄、搜尋／播放尚未實作 |
| 通知／更新 | Tasks、授權、安靜時段、投遞台帳、Web Push／Telegram | Android FCM token／投遞接點、簽署、APK／OTA、固定更新入口；iOS 後續另補 |

#### 共用功能、薄 UI 及跨端接續

| 層次 | 唯一責任 |
|---|---|
| Server／業務服務 | 權限、確認、任務／提醒、記憶、引用、Agent、版本、防重及保存 |
| 共用 owner／controller | API、快取、本機草稿、同步、原操作恢復及身份清理 |
| 共用畫面 | 顯示、輸入、互動及載入／錯誤狀態 |
| 平台 adapter | 身份憑據、生命週期、錄音、相機、檔案、通知及系統開啟 |

- 同步已提交訊息、附件、轉錄、執行結果、持久待確認及業務資料。未發送文字、照片、錄音留在原設備，不做雲端草稿同步或離線自動寫入佇列。
- 已提交工作以 Server run／原 opId 為準。另一設備讀取目前工作及已保存結果，不必回放全部進度事件、不重新發問；斷線不是取消，不重新 POST。明確取消沿原 run 更新狀態。
- Web 保持 HttpOnly Cookie；Android 以 Firebase ID token 交換受控裝置會話，用 SecureStore 保存必要憑據。同一身份服務核對邀請、驗證、裝置撤銷及重新認證；不偽造 Origin 或放寬 Web 防護。
- 所有領域共用受控 transport，包括照片、下載、聊天、來源及設定；只向核准 HTTPS API 附帶身份，不讓跨站 redirect 洩露憑據。前端與 Agent 均不直接讀寫 Firestore 業務資料。
- Web 前景事件及 Android AppState／網絡狀態接同一 changes cursor／Query owner。背景停止輪詢，回前景立即核對；修改、確認及完成在其他可見設備同步同一版本，通知執行前再核終態。
- 登出、撤權、切換孩子／身份清快取、停止舊讀取及拒遲到回應。新裝置先核 Server 會話；不把卸載當撤權，不將密碼／key 或業務主庫放普通裝置儲存。
- 聊天、記錄、記憶、待辦、準備單、關注、成長、歷史、私人來源及本人設定兩端承接；管理員後台維持 Web 專用。App 關閉後由 Server 繼續工作，不讓手機常駐 Agent。
- 後端內部、Prompt Pack 或知識更新只要 API 相容，兩端不必重新發布。契約先向後相容部署，不假設每個 App 即時升級。

#### 共用語音及 Android 系統能力

**兩端完整流程：錄音 → 預聽／發送 → Agent 直接理解及辦事 → 背景補轉錄 → 另一設備查閱、搜尋及定位播放。** 不只讓 Web 播放 Android 音檔；不含即時通話或語音回答。

- 優先 Expo Audio 共用操作及畫面，薄 Web／Android adapter 處理權限、編碼與原生差異；沿現有 Gemini 音訊輸入，不增加語音供應商。固定相容版本後才接線，不藉此升整套 SDK。
- 每則首版最多兩分鐘、5 MiB。Server 驗支援格式、大小及實際時長，不能信任副檔名或客戶端宣告，超限不靜默截斷；WebM 等時長 metadata 缺失須正確處理。
- 原錄音沿既有私人加密附件儲存，連結同一訊息、孩子及版本。聊天／孩子刪除連帶音訊、轉錄及搜尋；下載與播放重核權限，不發永久公開 token。
- Agent 直接讀音訊，不等轉錄。清楚普通指令沿有效授權執行；含糊、重要資料及高影響操作沿原確認，不增設一律先確認轉錄的關卡。
- 背景轉錄只產生文字及段落時間標記，沒有業務工具；每份音訊版本最多一次自動生成，不再次執行指令。沿既有 worker、防重、付款路由及每日配額，額度不足保持待轉錄，不提高配額或另開聊天。
- 轉錄標示自動辨識及不清楚部分，保存後復用。搜尋返回原訊息；可靠時間標記可跳播，否則只定位整則，不虛構逐字對齊。後續取相關轉錄／摘要及按需原音訊，不反覆送多年錄音。
- 照片用 Expo ImagePicker（相簿／系統相機），PDF／匯出用 FileSystem／Sharing；共用 Server 校驗與同版成果。按需權限、取消及暫存清理；只補鍵盤、安全區、返回，不重畫 UI。系統分享導入 extension／其他文件輸入仍留 S12-W02。
- Android Expo Notifications 取得 FCM token，Server 加薄投遞 adapter；同一任務／授權台帳保留安靜時段、終態、防重及 unknown。各設備獨立授權訂閱，Web Push 沿用。
- 通知只載最少提示／資源關聯；點擊重新核權，不依 payload 自動確認或完成。完成後停止後續催辦，不聲稱能撤回已送通知。
- 原生採 Expo 串流 fetch 讀現有 SSE，維持 JSON／原 run 查回；不另造 WebSocket 或假打字動畫。

#### 固定更新入口

**改共用畫面就是改同一份程式，不是先改 Web，再重畫 Android。** S04-W03 交付 `mobile:release` 及短交接；後續 AI 沿固定入口判定，沒有必要便不重研原生工程。

| 改動 | 交付 |
|---|---|
| Server／Agent／知識且 API 相容 | 只部署後端 |
| 共用 JS／樣式／資產、原生 runtime 不變 | 更新 Web，發布相容 Android OTA |
| Web 專用接點 | 只更新 Web |
| 原生套件、權限或 runtime 改變 | 新 APK；共用修改另更新 Web |

- `--plan` 零發布，列影響平台、必要檢查、OTA／APK 判斷及未完成前置；再提供 preview、production 及相容 OTA rollback。預設不直接 production，不每次 commit 雲端 build，不購買方案。
- 用 Expo fingerprint／runtime 比較與已發布 build 的相容性；無基線或無法核實須 build／停止，不能猜測、手填舊 runtime 或忽略差異強發。
- 集中固定 application ID、簽署、API 地址、profiles／channels，保存 Git SHA、App／runtime／update ID 及回退位置。私鑰／token 不入 Git、prompt 或公開 App 配置。
- OTA 在安全啟動時套用，不在聊天、待確認或未知提交期間強制 reload；新 APK 同簽署、遞增版本，可覆蓋安裝保留資料。回退畫面不等於回退業務資料。
- EAS 帳號已設定；後續雲端 build、私有程式上傳及新增費用按具體範圍授權。額度用完才決定，不能假定永久免費。原 VM 期限另核，不自動續期。

**官方核對（2026-10-15；非原生實測）：**[Expo Firebase](https://docs.expo.dev/guides/using-firebase/)、[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)、[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)、[Gemini 音訊](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)、[Expo fetch](https://docs.expo.dev/versions/latest/sdk/expo/)、[FCM](https://docs.expo.dev/push-notifications/sending-notifications-custom/)、[APK](https://docs.expo.dev/build-reference/apk/)、[OTA runtime](https://docs.expo.dev/eas-update/runtime-versions/)、[EAS 費用](https://expo.dev/pricing)。版本及 license 隨實際模組接入固定；文檔能力不當工程已驗。

<a id="p3-android-milestone"></a>
#### 次序與 Android 成品門檻

**S04-W01 → S05-W03 → S07-W01 → S09-W03 → S12-W01 → S13-W02 Android → S04-W03 Android → S16-W03／S17-W03 Android 里程碑。** 每包獨立分支、必要驗收、review、PR／合併後才開依賴包；同一批資料隨包累積證據，不到最後才接後端。

S04-W02 按 2026-10-24 批准的 [iOS 計劃](#p3-ios) 現在開始，不以 Android 尚欠真機驗收阻塞程式接線。共用包分列兩平台結果，不能將 Android 交付寫成整個 P3 完成；三角色仍依原 M01～M03 及協作者前置，與手機里程碑分開。

**最少三條連貫情景：**

1. Web 提交工作 → Android 讀同一 run／結果／確認 → Android 修改或確認 → Web 同步；串一次原操作恢復、版本衝突及身份清理。
2. 兩端錄音／上傳各驗 adapter，只用一段代表錄音跑真 Agent／轉錄；另一端搜尋、定位播放及同一準備單／PDF讀回，不重跑同一模型品質。
3. 一則已授權 FCM → 點擊核權並完成；一次共用畫面修改發布 Web／Android OTA，核相容回退及正式 APK 覆蓋安裝。

使用同批合成資料、一部 Android 手機及一個受支援瀏覽器；復用 Web Push、隔離、防重證據，只補受影響接點。不逐頁 E2E、不全量、機型矩陣、壓測、Computer Use。scripted／bundle／Expo Go 不能代替真模型／正式 APK／真人結果。帳號、權限及真機操作保留必要本人步驟。

完成門檻是**Web／Android 隨時接續已提交工作、核心功能及完整語音共用、正式簽署 APK 可安裝更新、薄 UI 同一權威服務及固定 Web／OTA／APK 交付入口**。首次登入／聊天只是中間里程碑。

### P3 工作包

<a id="s04-w01"></a>
#### S04-W01 共用原生基礎與 Android 首條流程

- 階段／狀態：P3；APK 已安裝登入，主頁、助手及重開、孩子表單展開、鍵盤避讓與清空後輸入框縮回已有真機證據；首條有來源聊天／重開讀回仍待驗。PR #229 已合併；上述未驗項改為合併後追蹤。
- 前置：P2-R04、S06-W05；開工基線 `4f88948`，不依賴 STR01／三角色／iOS。
- 交付：正式 App ID／API base、EAS Build／Update、共用 transport、Firebase 原生會話／SecureStore；Web 保留 Cookie／Origin。普通操作與資料沿同一正式 owner，不另建手機業務副本。
- 已驗與修正：合成會話交換／重開／撤銷經正式 Node／API；第三次免費 build `b2fb7fe9` 產生 0.1.0／1，前兩次失敗保留。原生刷新、Paper flat outlineStyle 及折疊量度缺陷已局部修正；真機助手、表單、鍵盤及輸入框核對通過。`8992ce9` 共用送出時清除頭尾空行、連續換行最多兩個，未知保存沿同一文字查回；停止原因直接進保存回覆，來源及收據仍核對。只補兩個定向情景、受影響型別與必要產物，詳見[同一證據](artifacts/verification/S04_W01_ANDROID_FOUNDATION_20261015.json)。
- 發布：相容 Android preview `b44fb753`；原 VM API／worker／Web 已於 2026-10-15 15:49 UTC 更新 `s04-8992ce9`，健康及正式靜態入口通過，保留回退，零遷移。本人明確要求的每日每人 200／全站 400 已保存為政策 v1，不清零用量、不重發停止訊息；其後 #230 已於 16:26 UTC 接入逐輪預算及終結預留，政策 v2 為 8 次生成／4 查詢向量、工具 16，見[預算修正](#agent-budget-followup)。
- 下一步／gate：完成一次正常家長語句的有來源聊天與重開讀回；測試資料身份與問題措辭分開，不在問題硬塞「合成／假設」。使用者手動訊息曾因額度停止，不能算通過，也不自動重送。首條聊天改由使用者驗收；其服務失敗已按 #231 修正但未代填通過。使用者於 2026-10-16 明確允許先準備下一包，合併仍保持 S04 在前；保留已批准最多 1 run／4 生成／2 embedding、<$0.10、無通知的代表核對界線。
- 其餘：搜尋標籤延遲與切頁不順仍待定位，不因此擴大測試或重寫導航。語音、拍照／相簿、PDF、FCM 依下列 Android 工作包接續，未交付圖示不算已接功能；iOS 仍延後。需本人步驟時先做可獨立工作，私有發布依有效授權與工具審查。


<a id="s05-w03"></a>
#### S05-W03 原生憑據、生命週期與清理

- 階段／狀態：P3；兩處會話修正及最低必要本機檢查已完成，相容客戶端已交付；使用者已確認重開保留登入及資料；2026-10-25 使用者在 Web 撤銷其他裝置後，Android 回到登入頁，冷啟動亦未恢復舊會話／孩子畫面。撤權／重開已核，跨身份真機隔離仍待驗；PR #234 已在 #229 後合併；原未驗項按本批安排繼續追蹤。
- 前置：S04-W01。
- 交付：SecureStore／裝置會話重開、到期、撤銷／退出及近期重認證，暫存與備份排除、身份切換拒遲到回應。基本安全登入已屬 S04-W01；未發送草稿仍本機，不形成業務主庫。
- 本輪修正：無效／到期本機憑據清理後可正常登入；新會話交換令舊請求失效。沿既有 Server 撤銷與近期驗證，不把 Firebase SDK 的暫時清理誤當網站登出。鍵盤過渡仍需真機定位，保留已證實可見的避讓，不盲目撤回。
- 證據：原有正式 Node／API 原生會話情景及失效憑據／遲到回應情景兩項通過，兩個受影響型別入口零診斷；零手機、模型或雲端操作。[本包 EV](artifacts/verification/S05_NATIVE_LIFECYCLE_20261016.json)。
- gate：併入同一帳號流程核重開／撤銷及另一身份不可見；iOS 結果待 S04-W02，不代填通過。

<a id="s07-w01"></a>
#### S07-W01 App／Web 在線同步

- 階段／狀態：P3；程式及最低本機檢查已完成，PR #235 已合併。2026-10-25 已用 v4 及原 Web 核對同帳號待辦：手機建立、使用者在 Web 完成、手機原頁自動讀到完成／提醒停止；未重新整理或重送。[同次設備證據](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)。跨端運行接續、撤銷及其他未驗邊界仍按原包保留，不將一項待辦當全端驗收。
- 前置：S05-W03、S07-W03、P2-F08。
- 交付：AppState／網絡 adapter 接 Query、changes cursor；背景停輪詢／前景核對，跨端同版本、原操作恢復及身份清理，不建離線重送。
- 本輪接點：共用 metadata observer 接 Web 可見事件及 Android AppState／expo-network；前景五秒核對，背景／離線停止，恢復以同一權威服務讀回。原生取消使用可清理的 AbortController／timeout，不假定有瀏覽器 AbortSignal.any／timeout。只取消讀取，不重送業務操作。
- 證據：一條游標／變更／失聯／遲到讀取情景與兩個型別入口通過，零雲端／模型／手機；[S07 EV](artifacts/verification/S07_NATIVE_ONLINE_20261016.json)。新增原生套件必須新 APK，不能向舊 runtime 直接發 OTA；後續原生功能合併建置以免重複。
- gate：復用三條情景中的共用更新／版本衝突／原 opId 查回，不重驗全部 Firestore。

<a id="s09-w03"></a>
#### S09-W03 原生歷史、記憶與既有能力承接

- 階段／狀態：P3；原運行查回及共用畫面接線已實作／本機核對，API／Web 已隨 `mobile-bf47c47` 部署，新版APK已安裝，跨端真機仍待驗；PR #236 已在 #235 後合併；跨端真機及原 UI 接點驗收仍保留追蹤。
- 前置：S07-W01。
- 交付：同一 owner 的聊天、歷史、記憶、任務、文件、關注、來源及本人設定；跨設備接續原 run／待確認／已提交附件，不要求重問。不掛 fixture、不同步未發送草稿；管理後台只留 Web。
- 本輪接點：沿原訊息唯讀查回 runId／狀態；重開後目前最後一則未有回覆的訊息可自動查核，其他舊訊息在「取得／查核原回覆」時先讀原台帳。已存在運行不重新 POST；前景只核對已知處理中的原運行，完成讀回原聊天，未提交草稿不跨設備同步。新設備沿同一取消入口；私人候選及歷史仍讀原 owner／API。
- 證據：一條正式 HTTP／ADK scripted 情景補新客戶端查回、錯身份／孩子、終態及草稿保留，通過；4 個 Server／client 型別入口及 2 個 UI 入口零診斷。首輪錯孩子錯誤映射失敗保留於 [EV](artifacts/verification/S09_CROSS_DEVICE_RECOVERY_20261016.json)，局部修正後只補同一情景。零真模型／手機／雲端。
- gate：已保存成果及目前工作讀回，靜態核對 [UI 接點](docs/P2_UI_HANDOFF.md)，不逐頁 E2E。照片／PDF平台出口與語音交 S12-W01。

<a id="s12-w01"></a>
#### S12-W01 共用語音與原生檔案出口

- 階段／狀態：P3；共用語音／照片／PDF、同一 ADK 音訊、持久轉錄／搜尋／播放、清理／匯出與恢復接線及必要本機證據已由 #237 合併。新增索引與 API／worker／Web 已隨 `mobile-bf47c47` 部署；新版 APK已完成；一段合成錄音經正式 Agent 理解、原運行讀回、真 worker 轉錄及歷史搜尋通過（合共5生成／1查詢）。Android本機錄音及修正版預聽已觀察到播放進度；Web正式adapter配真Chromium錄音／播放及Server解析已核；正式頁面完整流程、聽感與跨端真機仍待驗。沿 [S12 證據](artifacts/verification/S12_VOICE_PREPARATION_20261016.json)及[同版交付](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)，不把啟動核對當完整語音流程通過；原生備份真還原仍延後。
- iOS 子範圍：2026-10-24 接續 #272／`9f500a5`，分支 `codex/s12-ios-media`。已用既有 ImagePicker 57.0.19 JPEG 輸出補 HEIC 相容，原 JPEG／PNG 優先；原檔與副本各守 4 MiB、decode 前後校驗，hash／metadata 沿正式路徑。三項必要 adapter 檢查通過，沒有新增套件或修改 Android 轉檔；錄音、檔案及 PDF 分享沿固定 SDK／既有 native adapter。原生轉檔、iPhone 權限／返回／播放仍待簽署後一次驗收。[證據](artifacts/verification/S12_IOS_MEDIA_20261024.json)。
- 前置：S09-W03、S12-W03；Android 不依賴 S04-W02。
- 交付：兩端完整錄音／預聽／發送、Agent 直接理解、持久背景轉錄、搜尋及定位播放；兩分鐘／5 MiB、權限／加密／刪除／付款防重。Android 相片、既有 PDF／匯出與 Sharing；按本節規則不設全體轉錄確認關卡。
- gate：兩端輸入 adapter 加一段代表真音訊及轉錄、另一端讀回／搜尋／播放與同版 PDF；不重複模型品質測試。iOS 另補平台差異，分享導入仍留 S12-W02。

<a id="s12-w05"></a>
#### S12-W05 共用聊天附件與首頁快捷入口

- 階段／狀態：P3；正式runtime、Agent閱讀工具、Web／Android共同owner、下載、匯出、清理及恢復已接線。本機一條連貫情景及受影響型別通過；2026-10-18原站API／worker `files-a12da46`、Web `files-c4ac1b9`已健康並核公開產物hash。一份真Storage合成Word已保存／連聊天，原檔讀取及刪除以原個案補齊；腳本啟動／回傳型別失敗與撤權保留。Android相容OTA已發布（同APK v2 runtime、毋須新APK）；Android首頁原生相機開啟／取消、測試Word選取／草稿／移除已核；原預聽0秒失敗保留；原生修正版0f0144a相容OTA已發布，4秒錄音可播放並前進至1秒，隨後丟棄，沒有上傳或模型。Web選檔／兩端下載及真Agent內容理解仍未驗，見[S12附件證據](artifacts/verification/S12_CHAT_FILES_20261018.json)。
- 前置：S12-W01；接續現有 Android 工作分支，保留原網站、共同 owner、身份、附件服務及原操作恢復。
- 範圍：首頁左下角保持一按開原生相機，確認／取消後返回 App；語音及文字快捷入口連回同一聊天草稿。附件入口允許選取各類檔案，包括 PDF／Word；不做文件內容預覽，附件卡顯示檔名、大小及「不支援預覽」，另保留必要的上傳狀態；不預先顯示「尚未讀取內容」。首版每則一份、最多20 MiB，未送出原檔留本機。
- 保存／讀取：使用同一 Server、Firestore metadata／原收據及私人加密 Storage；已提交附件連回原訊息，兩端可查回及下載。未知上傳先查原操作，身份切換清除本機資料；孩子／帳戶刪除、匯出及隔離還原須納入相同附件生命週期。
- 內容能力：檔案可上傳不等於 Agent 已讀懂。復用成熟解析器處理 PDF／DOCX／純文字等已支援格式；輸出有界片段及完整度，不把原始二進位直接塞進 prompt。所有格式均可保存及下載；是否支援畫面預覽不限制 Agent 讀取。實際處理不支援、受保護、損壞或抽取不足時，才回報具體原因並保留原檔；不執行檔案、不虛構已讀內容。
- 最少 gate：一條共用選檔→原操作保存→聊天引用／讀回→下載及刪除流程，串核一次隔離與未知查回；復用既有音訊／照片及備份證據，只補新增文件接點，不全量測試或逐格式跑模型。PDF／Word 內容品質與任意檔案保存分開報告。

<a id="s13-w02"></a>
#### S13-W02 原生本人通知

- iOS 設定子包：#276 已合併至 `6871bab`；同一 client／owner 依平台使用 v1 Android 或 v2 iOS，沿原收據恢復及點擊核權。原共用卡片保留設計，增加 iOS 文案及各訂閱實際 provider；APNs token／provisional 權限及輪換接既有 Expo，不自動登記或發測試。指定 Node 24.19 的兩項必要檢查及 client／native adapter 窄型別通過；[原證據](artifacts/verification/S13_IOS_CLIENT_20261024.json)不回寫。其後整合 iOS 匯出見 S04-W03；簽署、部署與真機仍待。
- 部署補接：基線 `83a4241`補原VM的`compose.firestore.apns.yaml`，按需掛同一私鑰到API／worker，不自動開啟渠道。一次合成Compose合併核對確認storage／原渠道秘密仍在、Web不獲APNs私鑰；沒有容器啟動、真key或部署。Linux實際UID／mode及Apple投遞仍待憑證就緒後核對。[證據](artifacts/verification/S13_IOS_COMPOSE_20261024.json)。
- iOS 後端子包：C 於 `405f3ed` 接續 #274，已接 APNs 與 `/api/native-push/v2`，保留 v1 Android 收據／嚴格回應；已由 C 合併為 #275／`b4dfd5a`；B 接續共用設定頁。測試與照護提醒共用原台帳，配置不符或投遞未知不改環境重發。APNs adapter、真 API／收據／worker 合成流程、舊 Android 兩項及 adapter 窄型別通過；測試首次誤讀孩子範圍的失敗保留。[證據](artifacts/verification/S13_IOS_SERVER_20261024.json)。沒有 Apple 憑證、真 APNs／Firestore、部署或 iPhone 驗收。

- 階段／狀態：P3；PR #238 已在 #237 後合併。FCM adapter、索引與原站 API／worker 已啟用，APK v2已安裝。使用者親自允許通知；一則指定測試已保存投遞收據、渠道接受並在手機顯示，點擊可返回App。照護目標核權導航／完成停止仍待核，iOS 待後續。
- 前置（Android）：S12-W01 Android、S07-W01、S13-W07；iOS 另依 S04-W02。
- 本機結果：固定 Expo Notifications 57.0.21；FCM 單次 adapter、Firestore 加密綁定／原收據、同裝置 token 輪換／會話撤銷、提醒／通知歷史／匯出及還原、正式 API／worker、共用設定及核權點擊已接線。新增一條本機合成流程通過，受影響型別及配置語法通過；不把替身當真 Firestore 競爭或真 FCM。證據見 [S13 準備](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)。
- 雲端配置（2026-10-18）：同專案 Android package、專用受限 key、原 VM 最小 FCM IAM 及 Expo preview secret file 已配置。10 個共用語音／通知索引、6 項欄位設定均 READY；`mobile-bf47c47` 已部署並啟用原生通知 adapter。部署當時只有啟動／資料查詢與公開入口證據；其後同機註冊及唯一一次真FCM結果見[S13 EV](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)，[交付 EV](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)。
- 下一步／未驗：APK正常開啟、原資料保留、本人授權及一則指定FCM顯示已有證據；2026-10-25 Web 完成後手機自動顯示「已完成，提醒已停止」。真正終態／不重發沿 [F06 原生 Firestore 證據](artifacts/verification/F06_FIRESTORE_BACKGROUND_20261013.json)復用，不重跑。收尾發現前端遺漏 Server 已核對的 `taskId`，只開待辦列表；已合併 #315／`f987b0b` 局部接回既有指定項目路由，保留孩子／身份及離頁守衛。另依使用者要求將共用設定按鈕改名「重設密碼」。單一 production callback 核對及 Web／Android 匯出通過，runtime 相容；14:30 UTC 已交付原 Web／preview OTA group `aea3c202`，API／worker 不變。照護通知真機目標核權仍待補，不重發一般測試。
- 交付：Expo Notifications／Android FCM token 註冊、輪換／撤銷與薄投遞 adapter，沿既有 Tasks／授權／偏好／安靜時段／終態／unknown；Web與App各設備授權、同一任務。
- gate：一則明確批准通知、點擊重新核權及完成停止；不重發 Web Push／Telegram。iOS APNs 是另一平台子範圍，不能拿 FCM token 代替 APNs。

<a id="s04-w03"></a>
#### S04-W03 固定發佈入口與 App 更新交付

- 階段／狀態：P3；PR #239 已合併；固定入口、相容 Web／OTA 發布及同簽署 APK 升級已有結果。2026-10-25 v4 真機亦完成回退至內置版本、再恢復同 runtime 修正版：同一未送出測試檔的舊／新檔名行為均可見，登入及原資料保留。首批鎖屏未能觀察、立即恢復的結果原樣保留；最後 preview group `44dca896`。[回退證據](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)。iOS 與 Android 其餘 gate 分開追蹤。
- iOS 子包：接續 #276／`6871bab`，已補平台判定、官方 runtime、同平台 STORE／非 simulator build與回退，以及指定 build 的 TestFlight 提交。保留 Android預設及舊操作記錄，submit不自動邀請／建群組，結果與Apple處理／可安裝狀態分開。共同 UI 的另一端交付明列待辦，沒有一端成功當三端完成。
- 必要本機結果：一條 release policy／CLI 檢查、合成公開設定的 iOS fingerprint、整合 iOS JS／Hermes匯出通過；首次匯出因命令錯指未 hoist 的 Expo 路徑停止，修正命令後只補同一次匯出，沒有改產品。[證據](artifacts/verification/S04_IOS_RELEASE_20261024.json)。付費團隊、App Store Connect 身份、簽署、實際上傳、OTA／回退及 iPhone驗收仍未完成；不購買會員、不宣稱已有TestFlight成品。
- 本包範圍：離線發布判斷、官方 fingerprint 核對、固定 EAS CLI／channels、相容 OTA 回退及有界 manifest；Web 沿原 VM 產物／部署，不改產品設計或自動購買／上傳。
- 結果：固定入口及短交接、離線判斷與兩端正式 bundle 已通過；`bf47c47` Web／API／worker 已部署。一次 preview APK `82cb911e` 已完成（versionCode 2），固定發布工具已記錄相符的 runtime／fingerprint 基線；兩個實際 APK 的官方簽署驗證、同 applicationId／證書及遞增 versionCode 已核對。使用者於2026-10-18確認覆蓋安裝後能正常開啟、原資料仍在；ADB亦核對versionCode 2。鍵盤遮擋及站內導航誤擋已局部修正並交付同版Web／相容OTA，一條真機輸入／清除／鍵盤開合有結果；動畫細節及其餘功能仍待驗，回退沿上述 v4 結果。[交付 EV](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)／[固定入口](docs/PRODUCTION_FRONTEND.md#mobile-release)。
- 前置（Android）：S12-W01 Android、S13-W02 Android；iOS 待 S04-W02 後補同平台結果。
- 交付：本節 `mobile:release --plan`／preview／production／OTA rollback，fingerprint、固定身份與 channels、release manifest／短交接。Web及Android共用修改沿同入口交付，新原生 runtime 出 APK、相容 JS 出 OTA。
- gate：一次共用修改 Web＋OTA、相容回退及正式同簽署 APK 升級；不為每個判斷分支另做雲端 build，不在未完成工作／unknown 中強制 reload。

<a id="s16-w03"></a>
#### S16-W03 P3 必要整體驗收

- **語音驗收暫緩（2026-10-26）：**修正上線後，使用者回報「仍有問題」，其後因 Agent 尚未完成，決定「算了不驗收了」。本輪停止這項排查、模型重跑及人工重試要求，待四個 Agent 完成且協作者先自查後，再按 DEV02 一併安排剩餘必要驗收。新問題的具體症狀／根因尚未核實；保留已取得的後端證據與失敗回報，不標為 Web 語音完整通過。以下 US$5 授權仍是成本上限，不構成恢復本項驗收的指令。
- **Web 語音審核修正（2026-10-26）：**使用者回報錄音後 `delivery_review_incomplete`，本包從 master `3ee5df9` 的獨立 `codex/voice-review-evidence` 處理。原錄音現按同一 ID／版本／hash 送交獨立審核，每次重讀核權；審核與修正提供完整輸出 schema，普通招呼／真正補問不再被當成需要逐字來源的事實。順帶修正資料版本變動時的未完成收據不能解密讀回。正式 Web HTTP／共用 client＋真 Vertex 模型已完成錄音理解、獨立審核、保存及原 run 讀回（2 次生成）；定向機械檢查及限定型別通過。本包 #321／`85356d6` 已合併並更新原站 API／worker，候選組裝及公開健康核對通過，毋須 APK；[證據](artifacts/verification/WEB_VOICE_REVIEW_20261026.json)保留初次失敗、背景資料變動中止及歷史情境干擾招呼的另項缺口，不宣稱四角色或瀏覽器播放全部通過，不動協作者 PR。
- **模型驗收授權（2026-10-26）：**本聊天後續必要真模型測試毋須逐次詢問，所有測試及其自動轉錄／摘要合計採滾動 12 小時最多 US$5；先記已知用量及保守預留，計費未知不能當作零。沒有必要不重測，不提高正式產品配額、不自動重送未知副作用；此授權不自動涵蓋新身份／雲端資源／外發通知。

- 2026-10-25 v4 真機補核：登入／孩子資料、系統選圖、EXIF-6、裁切／預覽及取消沿[原證據](artifacts/verification/ANDROID_V4_DEVICE_20261025.json)。108-byte TXT 正式保存、聊天／附件庫下載至系統分享、重開讀回、原檔名及品牌 splash 已核；其後真機回退至內置版本再恢復修正版，以及手機建立待辦→Web 完成→手機原頁自動顯示完成／提醒停止均通過。[續驗](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)保留原失敗及各層限制。個人 Vertex provider 短生成另已通過；本人 Vertex 完整 Web/API 流程已由 MODEL03 補核；仍欠手機本人 key 輸入、跨端 Agent／確認接續、另一身份的真機隔離及照護通知目標核權。四 Agent 仍等協作者，不以這批結果宣稱 Android 或整個 P3 全部完成。

- 階段／狀態：P3；Android／頭像／附件庫／個人模型收尾中，完整 P3 未完成。最新 #305／`1f07fab` 成熟裁切已合併及更新 Web；新 APK 交付見[本批記錄](artifacts/verification/AVATAR_CROP_DELIVERY_20261025.json)。不修改協作者未合併 Agent PR、不提前恢復 DEV02 聯合補驗。
- 2026-10-25 接續：以 `2fb8865`／`codex/android-final-closeout` 收 Android、已啟用頭像、附件庫及個人模型。先對照既有證據與正式接點，再只補確實欠缺的保存／讀回／設備或模型路由核對；不逐頁或逐模型測試，不重驗四 Agent。手機未連線、需登入／系統權限等本人操作及不可取得的本人憑證如實待驗；不因此停止其他可做工作。下一版原生圖標與 splash 沿既有配置，沒有必要的新 APK 不單為此重建。原失敗及已核準延後的備份／角色驗收保留。
- 本批結果：頭像 owner 的刷新／保存競態修正及 21 項定向檢查通過；本機正式 Web 保存／重開／移除、附件庫列出同一已提交文件及下載 hash 核對通過，合成附件已刪除。本地入口可明確啟用頭像，預設仍停寫。個人 Gemini 地域拒絕保留，後續個人 Vertex 短生成通過，沒有四 Agent 或額度變更；[結果與保留失敗](artifacts/verification/ANDROID_FINAL_CLOSEOUT_20261025.json)。頭像成熟裁切與 Android 補驗沿上述最新證據，未驗項不重複另列。
- 最新交付：#305／`1f07fab` 已更新 Web；唯一免費 APK v4 的同簽署、package、runtime 及新品牌資源核對通過，[下載](https://expo.dev/artifacts/eas/tqzvvQXmWmc7RqelWQgCcJoXiTrfBmDEKET4fjyLda8.apk)。不用重跑模型，使用者已覆蓋安裝；版本、登入／孩子資料保留、原生裁切／EXIF／取消已核；餘下設備流程待驗；[交付證據](artifacts/verification/AVATAR_CROP_DELIVERY_20261025.json)保留下載／工具問題及本地 emulator 關閉快照失敗，後者保留上一快照、沒有宣稱還原通過。
- 本批順序：先核部署／手機及可復用證據；把個人設定保存與跨端同版、既有成果讀回／附件出口串成最少流程，再處理原通知終態與相容更新／回退缺口。保留本人首條聊天的驗收安排；不自動發新通知、重跑已通過音訊模型或擴配額。未具備有效憑證／設備便如實保留該項，不以合成結果代填真機或真模型通過。
- 本批進展：設定同值保存／重開及本機 Android 匯出通過。`c58459a` 的唯一免費 build `c678d433-3410-4d78-b831-011ac4f5a70a` 已成功，APK v3 的 package、同簽署及實際 runtime `5fd1446…` 已核，不能向 APK v2 `3369957…` 強推 OTA。使用者已回覆安裝 v3；資料保留及附件庫完整設備流程未補驗。現接續 v4，沒有新增模型／通知。[交付證據](artifacts/verification/ANDROID_MODEL_CLOSEOUT_20261024.json)分列 API 已部署、Web 畫面待更新及個人 key 真生成未驗。
- 前置（Android）：S04-W01、S05-W03、S07-W01、S09-W03、S12-W01 Android、S13-W02 Android、S04-W03 Android。
- 交付／gate（Android）：合併本節三條情景證據，只補跨包缺口；不重跑各包已通過項目。無 iOS／三角色前置，不把有限檢查當整個 P3 完成。
- 完整 P3 gate：另完成 S04-W02 及共用包的 iOS 子範圍、P3-M01／M02／M03；保留其依賴及未驗結果。

<a id="s17-w03"></a>
#### S17-W03 P3 發佈與維護交付

- 階段／狀態：P3；Android APK／更新工具已有交付，成熟裁切及品牌修正的 APK v4 已交付；里程碑所需的剩餘真機驗收仍未完成，完整 P3 未完成。
- 前置（Android）：S16-W03 Android。
- 交付（Android）：正式簽署可安裝／更新 APK、同版正式 Web、Git／App／runtime／update／API版本、安裝、權限、固定更新、回退及限制。Google Play 上架不在本輪。
- 完整 P3 gate：另完成 S16-W03 全範圍及 iOS 受控交付，才可宣稱整個 P3 完成；不將 Android 中間結果提前作 P4 全範圍前置。

<a id="s04-w02"></a>
#### S04-W02 iOS 接線與可安裝首版

- 階段／狀態：P3；2026-10-24 已由 #272 合併至 `9f500a5`，開工基線 `560f051`。iPhone 配置、獨立 `ios-preview` store profile／channel、原品牌不透明圖標及 Apple 憑據封包排除已實作；共用身份／聊天／同步入口沿現有 native adapter，沒有重建第二套頁面。
- 必要驗證：3 項配置檢查及靜態 review 通過，Android descriptor gate 保留。首次 iOS export 因 Windows sandbox TEMP 拒絕 Hermes 寫入失敗；只把暫存移至本 worktree 後，既定同一 export 通過。這只證明 JS／平台解析及 Hermes 產物，不是 IPA、Keychain／鍵盤或 iPhone 驗收。[證據](artifacts/verification/S04_W02_IOS_BOOTSTRAP_20261024.json)。
- 前置：已合併的共用原生身份／transport／owner／同步程式；解除原 S17-W03 Android 全部驗收的開工前置，但保留其未驗項。
- 交付：同一 Expo 應用啟用 iOS、固定候選 bundle ID、獨立 TestFlight profile、Keychain 及共用登入／聊天；照片等差異與通知／發佈沿下列包，不重畫頁面。
- gate：本機程式核對已達先合併條件；Apple 團隊、首次封包核對／簽署、TestFlight 及 iPhone 人工流程仍待辦，不宣稱已有可安裝 iOS 成品。合併後先接 S12 iOS 媒體差異；不以人工條件阻塞獨立實作。

<a id="p3-ios"></a>
### P3 共用前端與 iOS TestFlight 交付（2026-10-24）

**完成目標：**iPhone 經 TestFlight 安裝育有方，與 Web／Android 共用帳號、功能、權威資料及既有 Agent；可接續工作、處理附件、接收本人通知。修改共用畫面只改一份程式，固定工具分流 Web、兩平台 OTA 或新二進位版本。本輪先做 iPhone，不包含完整 iPad、公開 App Store、四 Agent 增補或 STR01；Android 未驗及 DEV02 延後安排保留。

#### 帳號與發佈前置

- 使用者有 iPhone、普通 Apple ID，選擇 TestFlight；尚無已確認的付費簽署團隊。先完成程式／配置，不自動購買會員、註冊 Bundle ID、取得簽署或建立 App Store Connect App。
- 導師／學校的組織會員可正式邀請使用者並授予必要團隊權限；個人會員的邀請只提供 App Store Connect 權限，憑證／描述檔仍需會員本人處理。不共用密碼，不猜 Team ID。
- 首次註冊前確認團隊、App 歸屬及 `org.yuyoufang.app` 可用性；之後固定 Bundle ID。Apple 現行轉移要求至少一個 App Store 已發布版本，不能承諾 TestFlight-only App 日後直接轉戶。
- 沿現有 Expo `@2ntty/yuyoufang`，從 Windows 使用 EAS 雲端建置；不因此要求購買 Mac。首次私有封包上傳核對範圍與額度，遇付費要求停止，不自動購買方案。
- 本人先作 TestFlight 測試；普通外部測試者依 Beta Review，不為測試授予管理權限。build 最長 90 天有效，OTA 不能代替新 build 續期。

#### 共用原生接線

- 保留 Expo 57／現有 React Native、頁面、導航 metadata、美術、正式 owner 及 Server，不升整套 SDK。新增 iPhone 配置及 iOS TestFlight profile／channel，Android preview 不變。
- 身份沿 Firebase 原生 session 交換、SecureStore／Keychain、同一受控 transport。重開核 Server 會話，登出／撤權／切孩子清理舊資料；不把卸載當登出。已提交工作查回原 run，不因 App 關閉重送。
- 安全區、鍵盤、返回與權限只補必要平台差異，不破壞 Android 已修行為；共用 AppState／網絡及 changes cursor 保持跨端同版，背景不持續輪詢。
- 相機／相簿、錄音、附件、PDF／分享沿現有服務。HEIC 利用現有 ImagePicker 的 JPEG 輸出轉成相容副本，再核真 bytes／容量／hash；原圖不變，副本不假稱原始 HEIC。只讀一張、有界記憶體及既有暫存清理，超限不裁切或截斷。
- 錄音、轉錄與檔案保存沿既有規則，不新增解析／背景錄音。系統選取完成／取消返回 App；不承諾原生相機內一定有相簿入口。

#### 通知與接口相容

- Android 保留 FCM；iOS Expo native token 接 APNs，不能送到 FCM。新增薄 Server HTTP/2 adapter，沿現有授權、工作／投遞台帳、防重、安靜時段、終態及 unknown；不另建通知佇列。
- 用 Node 原生 HTTP/2 提供涵蓋整次請求的期限／取消及單次發送；不加入隱藏自動重送。已研究 APNs 客戶端有內建重試或逐請求取消／總期限缺口，採用理由及固定來源存 TECH_REUSE。
- 綁定增加平台／provider，缺欄位舊資料按 Android／FCM；新 DTO 以版本協商保留舊 APK 嚴格 schema，不向舊客戶端回傳不認識欄位或誤標 iOS 設備。
- APNs Team／Key ID、Bundle ID、環境及私鑰由受保護 Server 配置控制；TestFlight 用 production APNs，拒絕時不切 sandbox 重送。憑證不入 App／Git／EAS 前端封包。
- token 輪替、撤銷、權限拒絕及投遞未知如實回報；點擊只帶最小關聯，重新核權讀資料，不直接確認／完成事項。

#### 固定更新及順序

擴充現有 `mobile:release`，增加平台選擇及獨立 runtime／fingerprint／build baseline／回退，保留既有 Android 命令相容。`--plan` 不登入或上傳，列出受影響平台與未滿足前置；共用 UI 改動需 Web 與相容 Android／iOS OTA，平台檔只影響該端，API 相容後端改動不要求 App 更新。原生套件／權限變更建立該端新 build；不手填 runtime、不在操作中強制 reload，不把部分平台發布當全部完成。

| 次序／原錨點 | 本輪交付與依賴 |
|---|---|
| [S04-W02](#s04-w02) | 先配置、身份／共用畫面及簽署準備；簽署待團隊確認 |
| [S05-W03](#s05-w03)／[S07-W01](#s07-w01)／[S09-W03](#s09-w03)／[S12-W01](#s12-w01) iOS | S04 程式接點合併後，補平台差異／跨端接續及媒體；沿既有服務，不重做四包功能 |
| [S13-W02](#s13-w02) iOS | APNs、本人設定及點擊；真投遞依簽署／Server 憑證 |
| [S04-W03](#s04-w03) iOS | 三端固定更新工具、TestFlight 提交及相容 OTA／回退 |
| [S16-W03](#s16-w03)／[S17-W03](#s17-w03) iOS | 只補整合缺口、iPhone 驗收及可安裝成品；不代結整個 P3 |

每包獨立分支、必要 review／驗證及 PR／合併。主模型親寫契約與計劃、整合共享配置；2026-10-24 使用者撤銷 Astra 子代理特許，恢復根 AGENTS 的 Sol／Luna 分工。B 主責 iOS、以接口契約交 C 處理後端；提交帳號按實際主責及本機協作指引核對，單作者，不把權重當共同署名。

#### 最低必要驗收

只用一部 iPhone 與既有 Web，累積三條連貫情景：①登入／鍵盤／提交後關閉與重開、跨端同結果及一次身份清理；②相機／HEIC、短錄音、附件及 PDF 系統接點；③一則已明確授權 APNs、點擊核權及一次 OTA／相容回退。復用後端／Android 證據；機械接線只補取消／unknown、舊 APK 契約及發布平台判斷。真模型最多先安排一條代表聊天，未批准具體費用不自動啟動。

不全量、不壓測、不機型矩陣、不 Computer Use；人工安裝／登入／系統權限保留本人操作，等待期間繼續獨立工作。真機、簽署、發佈、程式及本機檢查分開記錄；原備份還原、Android 未驗與四 Agent 最後補驗不因 iOS 合併而消失。

官方依據（2026-10-24 文件核對，非實測）：[Apple 團隊權限](https://developer.apple.com/help/account/access/roles/)／[轉移條件](https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria/)／[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)／[EAS iOS](https://docs.expo.dev/submit/ios/)／[Expo 原生通知](https://docs.expo.dev/push-notifications/sending-notifications-custom/)／[SDK 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/)。

<a id="p4-integrated"></a>
### P4／P5 完整整合計劃（P4 已獲准執行，功能待實作）

本節取代前兩份 P4 方案，保留 Sxx 錨點及有效範圍；替代映射見 [ADR-028](docs/DECISIONS.md#adr-028)。**個人及班級先獨立使用，需要時才共享；組內同源，跨人交接使用獨立副本。**沿用原站、Expo、VM／Compose、Firestore、Firebase Authentication、Storage、ADK、Prompt Pack 及業務服務，不重建架構、不重新引入 SQL。

產品規則與 AC 的唯一正文見 [SPEC](SPEC.md#p4-p5-product)；API／資料／架構只記目標契約，不代表已實作。每包前後端同包接通、UI 保持薄層；主模型親寫契約，提交身份依本機協作文件核對，維持單作者。

#### 完整範圍

- 個人使用不需家庭；可在軟件內單選或組合孩子資料、記憶、待辦等模組共享原資源，不要求全孩分享或匯出再匯入。修改同源同步、撤回共享不刪本人原資料；角色只授權已加入範圍，未選私人內容、key、session 及付款授權不隨共享。
- 獨立班級可直接匯入使用，按需加入教師空間。組內共用資料，不建複雜逐班授權平台；名冊／搜尋／分頁以 50 名合成孩子作代表規模，並非硬上限。
- 管理權由原管理員提出、已加入接收者接受後一次轉交；儲存身份與管理員分開。已轉交的空間資料不因原管理員退出／刪帳消失；未轉交時同一流程選轉交或解散，解散共享不刪他人的個人原資料。班級移出保留同一班級／資料，轉為指定負責人獨立管理，終止原空間存取。
- 同一助手處理單孩／多孩／班級，按需召回，不讀入全班歷史。固定目標／版本，持久批次保留逐項結果／收據；可部分成功及接續，不逐孩確認或重跑整套 Agent，不開新 run 繞過預算。
- 混合聊天屬發起帳戶，不因涉及共享孩子而公開；訊息／工具結果可追溯目標並重核權。成果寫回相應孩子／班級；單孩匯出不夾帶其他孩子，完整混合對話須有權且明確選入全部範圍。
- 交接／本人備份共用版本化文檔包，含結構化資料、版本、來源、附件、範圍／完整度及可閱讀摘要。跨人為獨立副本，不自動同步／覆蓋或遠端撤回；本人備份可包括有權備份的私人聊天、記憶及私人來源。憑證、session、key、執行授權及投遞工作不作普通資料搬移；不取代伺服器災難恢復。
- 包通過可信完整性、格式、相容及權限檢查後可直接匯入正常資料；AI／人工內容檢查可選，不強制待採納區或逐條接受。完整性不等於正確；保留來源、確認者及事實／推測標記，不按同名合併。所有匯入結果均有操作／逐項紀錄及可恢復狀態。
- 全產品共用一個「匯入資料」入口，選目標／模組／範圍，完成後顯示各類數量及略過／衝突／失敗。缺可信證明時明示後可選擇繼續；簽章／hash 不符則拒絕，不降級為缺證明。匯入待辦沿普通建立服務與當前通知設定運行，不另設啟用開關、不重播舊投遞。本人還原預設保留目前較新的修改／刪除，提供差異摘要及整批覆蓋衝突／明確恢復已刪項目；自動災難恢復仍重放刪除紀錄。
- 電郵／Google／Apple 共用 Firebase UID 與裝置撤銷；先驗原身份才連結 provider。Apple 隱藏電郵以原邀請地址驗證接續資格，再綁定 UID，不猜測合併；provider-only 帳戶不用不存在的密碼重新驗證。

<a id="p4-packages"></a>
#### P4 工作包與真正依賴

執行契約已合併，FAMILY-A 正在實作。前置指相關接口可用並完成必要驗證，不一律等待全部 P3／S17-W03；D 的角色只等實際使用的接口穩定，不改或代合併其 PR。

| 工作包 | 交付與局部門檻 | 前置 |
|---|---|---|
| <a id="p4-auth01"></a>**P4-AUTH01** | 電郵／Google／Apple、同 UID 連結、隱藏電郵邀請接續、重新驗證及跨端會話 | 現有 Firebase 身份／邀請／session，可獨立開始 |
| <a id="p4-family-a"></a>**P4-FAMILY-A** | 操作者與穩定儲存身份分開；原資源模組共享、角色／撤權、轉交及刪帳；背景／附件同一授權 | 既有本人權限；第一個功能包 |
| <a id="p4-family-b"></a>**P4-FAMILY-B** | 個人優先、可選家庭及軟件內模組加入；未選資料不外露 | FAMILY-A 契約，不依賴快捷登入 |
| <a id="p4-class01"></a>**P4-CLASS01** | 獨立班級、名冊／搜尋／分頁、匯入目標、加入／移出教師空間 | FAMILY-A；不等家庭 UI |
| <a id="p4-handover01"></a>**P4-HANDOVER01** | 統一匯入、交接／備份格式、完整性、紀錄、去重、衝突及差異還原；匯入待辦與普通建立一致 | FAMILY-A／B、CLASS01 的範圍／目標接口及現有匯出／附件；不必等其所有 UI |
| <a id="p4-class02"></a>**P4-CLASS02** | 多孩／班級助手、混合聊天範圍、有界召回、批次結果／恢復 | CLASS01、HANDOVER01 範圍／來源契約及相關 D 工具／審核接口 |

**AUTH01 共用 provider／session 首段（#347 已合併、未開放）：**沿 Firebase 13.0.0／Admin 14.5.0、原 session／裝置台帳，接本人登入方式讀取、Google／Apple Web adapter、同 UID 重新驗證及明確連結。連結分為驗原身份、再親自按連結兩個手勢，避免串接 popup 被瀏覽器阻擋；取消後等不可取消的 SDK 結束並清理，才讀回連結結果。舊密碼、原生會話、共用 owner／刪帳／管理員重新驗證保持相容。定向機械檢查、局部型別及獨立 review 的競態修正已有[證據](artifacts/verification/P4_AUTH_PROVIDER_20261027.json)，不代替真人登入。Web `EXPO_PUBLIC_AUTH_PROVIDERS` 預設空，原生 adapter 尚未啟用；未改雲端 provider／郵件／帳號設定。**下一步：**核定 Firebase 自動連結／duplicate-email 配置與目前電郵准入的相容性，再完成原生 SDK 的新 binary／真人核對、Apple relay 原邀請地址驗證及實際配置；詳見[採用限制](docs/TECH_REUSE.md#p4-auth-providers)。不可只打開按鈕便宣稱完整 AUTH01。Apple 團隊／本人操作只阻擋相關項，FAMILY-A／B 可獨立繼續。

**AUTH01 原生接點（已實作、未開放）：**復用 Google Sign-In 16.1.5、Apple Authentication 2.5.1 及既有 expo-crypto；原生 credential 回同一 Firebase session／同 UID linking 流程。Google 清本機選擇，Apple 使用每次 nonce／state，沒有第二份登入權威。共用 production owner、平台配置、原生 adapter、iOS plugin introspection 及 Android Hermes 匯出已有[證據](artifacts/verification/P4_AUTH_NATIVE_20261027.json)，未跑付費 build／真 provider／真機。新增原生套件須新 binary，舊 runtime 不推 OTA。下一段仍是 Firebase 自動連結／電郵准入配置、Apple 原邀請地址接續及真正配置；只在其完成後開放登入方式。

<a id="p4-family"></a>
**P4-FAMILY 父包（進行中）：**由 FAMILY-A／B 承接原家庭 UI／API、成員邀請、owner／caregiver／viewer 及跨域共享；不以隱藏入口當完成。先共用契約，再開家庭／班級入口，P3 本人功能不以此為前置。

**成長／關注讀取前置（已實作／合成核對，未部署）：**原 HTTP／共用 client 已支援選定 `spaceId`，同交易核目前模組及成員權限；已保存成長內容只在內部核來源有效性，未共享即時近況／任務及私人 run 關聯不披露。共享寫入、背景與全局孩子選擇尚未接通，`canManage=false` 且拒絕寫入，不回退本人操作。一條真 handler／client 合成流程、受影響型別及獨立 review 通過；無新套件、模型、索引或部署。[證據](artifacts/verification/P4_SHARED_GROWTH_CONCERNS_20261027.json)。

**FAMILY-A 首段實作邊界：**`firestore-sharing` 提供持久空間／成員／模組分享、邀請、撤權、管理權轉交、原操作收據及同交易來源核權；私人資料不複製，舊個人服務仍只允許本人。新增資料納入既有備份識別、清理與恢復，目前權限優先於舊備份。合成角色／分享、轉交／退出及隔離恢復已有定向證據；未部署。下一段接各領域的共享讀寫、附件／背景、變更同步及公開 API／共用畫面；未接前不開放共享、不宣稱 FAMILY-A／B 完成，也不以合成結果代替真 Firestore 競爭或雲端恢復。

**記錄／概況接線：**本段沿同一領域服務／API／共用 client 接共享選擇、實際操作者、原資源及操作者收據；同交易核權，撤權／解散遮蔽舊收據，非 owner 的恢復署名需密文內 Server 證據。共享原始記錄→正式 HTTP／client→概況修改／刪除後重建→刪除重放的合成流程及舊收據相容檢查已通過，未部署。其餘領域進度見下段；附件／背景、其他成員變更同步與家庭／班級公開入口仍待接線。[本段證據](artifacts/verification/P4_SHARED_CARE_20261027.json)。

**待辦接線：**復用同一 `prepareTask`、終態規則及提醒 worker；共享選擇只改存取與操作署名，不複製待辦。原資料仍屬來源帳戶，接收者與通知授權沿原設定；共享成員可以按角色建立／改期／完成／取消，不能藉此替他人授權渠道。共用 task client、正式 HTTP、原操作指標及帶共享署名的恢復核對已接線；一條合成流程及三項受影響的舊本人檢查已通過，未部署。[證據](artifacts/verification/P4_SHARED_TASKS_20261027.json)。多接收者指派、其餘共享領域及公開家庭入口仍待後段，不當已完成。

**記憶接線（本包已實作／合成核對）：**只共享 family 事實／主題及相同範圍歷史，私人候選、私聊 ID 及摘要不外露。手動新增沿明確確認方法；既有個人候選流程不改。正式 HTTP／共用 client、原件修改、原操作、防重、撤權／刪除及還原署名已在同一流程核對，另復用兩條舊記憶／摘要檢查；無新套件、模型或部署。[證據](artifacts/verification/P4_SHARED_MEMORY_20261027.json)。兩個歷史索引已定義但未部署，正式畫面在 Family-B 接回同一 client；跨成員同步及其餘模組未完成。

**文件接線（已實作／合成核對）：**沿用同一文件、固定版快照、分段續讀及 PDF。選擇 documents 模組包含已保存文件及其引用摘錄，不授予原始聊天／其他資料端點；內部只核對已引用資料的有效性。新增或刷新只從目前獲准的模組取材，不藉文件工具讀取其餘原資料。共享生成的背景報告保存原操作者、空間及授權 basis，接續仍重核，不靜默改用來源擁有人的較大權限。撤權後停止披露，舊 opId 不重做；正式畫面沿 Family-B。 共用 client／正式 HTTP、角色及版本、舊操作與來源失效、固定版內容／還原署名、背景取材與撤權已通過兩條連貫檢查；兩條舊本人文件檢查亦通過。review 找出的未共享新版引用洩露已重現及修正，沒有新增套件或部署。[證據](artifacts/verification/P4_SHARED_DOCUMENTS_20261027.json)。

**附件讀取（#343 已合併／合成核對）：**沿同一加密原檔、固定 ID 及版本，讓 attachments 模組讀取已提交附件清單、照片／錄音／一般檔案及已保存轉錄。下載前後及續頁均重核操作者、共享版本和儲存世代，撤權或換範圍後停止；不帶出原私聊訊息 ID、未完成上傳／未連結的檔案錄音或私人抽取草稿。正式 HTTP／Web／Android 共用 client 同包接線；共享新增／刪除、Agent 重用、背景及家庭畫面仍須接續，不以唯讀接線當 FAMILY-A 完成。已核一條含正式 HTTP／共用 client 的合成流程、三條舊本人相容檢查及受影響型別；不新增套件、部署或真模型。[證據](artifacts/verification/P4_SHARED_ATTACHMENTS_20261027.json)。

**附件寫入（文件／錄音刪除 #344 已合併）：**共用 HTTP／client 沿原刪除服務，交易核對當前共享角色、已提交原件及版本；來源原件保留儲存位置，收據歸實際操作者。立即遮蔽正文，日誌未知只記已受理；原 worker 可以在撤權後完成已受理的 journal／物件清理，不開新操作。刪除署名綁接受時的版本，恢復沿同一 schema 核對。已補連貫合成流程及舊本人相容核對；獨立 review 找到來源日誌同 ID 衝突，定向重現後復用來源操作映射修正，無新增套件、雲端、模型或部署；[證據](artifacts/verification/P4_SHARED_ATTACHMENT_DELETION_20261027.json)。照片刪除亦已接原配額／照護記錄、操作者收據及共用 client／HTTP；日誌失敗、撤權、原操作與合成還原後的真 cleanup consumer 已核，舊本人流程及局部型別通過，尚未部署。[照片證據](artifacts/verification/P4_SHARED_PHOTO_DELETION_20261027.json)。共享上載、私人聊天關聯、Agent 重用及畫面未完成，上載完成不能冒稱訊息已送出。

**共享同步接點（已實作／合成核對）：**沿原 changes projection、共同 observer 及前景輪詢，接選定孩子／模組的有界失效訊號。原擁有人與另一成員修改均可刷新；其他孩子、未共享事件及來源工作區序號不對外提供。游標綁身份／範圍／授權，撤權後拒絕，重授後刷新。記憶、文件、成長及關注亦因來源模組變更而重新核對有效性，僅提供失效訊號，不授予原來源讀權。正式 HTTP 一條連貫情景、共同 observer 新舊兩項及受影響型別通過；新增一項複合索引定義，尚未雲端建立或部署。Family-B 正式共享選擇／畫面已由下段接入共同 hook，尚未部署完整家庭功能。[證據](artifacts/verification/P4_SHARED_SYNC_20261027.json)。

**家庭管理入口（本包）：**復用原共享控制 store，接建立家庭、邀請／接受、角色／撤權、原資源模組設定、管理權轉交及退出／解散。本人／成員／分享／邀請列表每頁最多20項，沿當前權限及不透明游標；原操作查回不返回內部儲存身份。共用畫面不要求先選孩子，沒有另造SQL家庭owner。這段是管理入口；正式HTTP／共用client與控制器流程、舊共享還原、局部型別及Web匯出通過；獨立review的unknown版本衝突鎖定已定向修正。四項索引定義尚未部署，未發佈Web／App。[本段證據](artifacts/verification/P4_FAMILY_CONTROL_20261027.json)。全局共享孩子接線見下段；共享上載與 Agent 仍待接，不能把管理操作成功當完整共享體驗。

**全局共享孩子／頁面（#351 已合併，未部署）：**家庭頁選空間＋孩子後，原共用 owner 接 care／profile、tasks、memory、documents 及唯讀 growth／concerns。未共享模組不讀，未接私人聊天／摘要／上載明示，不借本人入口執行。角色／版本變更清舊快取；帳號失敗保留目標並隱藏資料。頁面、標頭及展開側欄各用有界 changes cursor；組合選單 ID 不傳作業務 childId。共享表單保留原 basis，新增記憶沿明確確認，新增文件在交易核對原 basis。定向 Server／owner／同步／記憶檢查及 Web 匯出有證據；前端型別仍有四項原診斷，不宣稱全數通過。無雲端／真機驗收，見[證據](artifacts/verification/P4_SHARED_CHILD_CONTEXT_20261027.json)。上載／聊天、其餘背景及完整 P4 未完成。

**共享附件頁面（本包已實作，未部署）：**原附件庫接選定空間的照片、錄音／轉錄及一般檔案；重用同一下載／播放元件與原刪除服務，不建立資料副本或假聊天 ID。私人來源／上載／提取／聊天重用不在共享模式啟動，viewer 只讀。檔案／錄音刪除未知時查原收據，受理後以同一 opId 接續核實日誌；只有端點返回 deleted 才顯示確認，清理與備份期限另列。獨立 review 的自身 pending 鎖阻擋原操作重試已重現並修正。定向檢查及型別結果見[證據](artifacts/verification/P4_SHARED_ATTACHMENT_PAGES_20261027.json)；仍有四項既存前端型別診斷，舊 DOM 檢查缺依賴／fixture 未完成，未宣稱全數通過。共享上載／Agent 與正式交付仍待接續。

<a id="p4-execution"></a>
#### P4 執行次序、接線及最低驗證

**執行次序：**先更新根 PLAN／受影響契約並 review 合併；FAMILY-A → AUTH01 → FAMILY-B／CLASS01 → HANDOVER01 → CLASS02。AUTH01 可與不重疊授權工作並行；S10-W03 知識、S12-W02 分享、S14-W02 分析按實際接口穿插；S07-W02/P4 隨功能驗證，S15-W02/P4 在資料結構穩定後收束，最後 S16／S17/P4。依賴 D 的部分等相關接口／自查，其餘不因整個 P3 未結案停工。

| 接點 | 採用與修改邊界 |
|---|---|
| 共享授權 | 擴充現有 Firestore 權威服務；操作者、資料儲存身份、共享範圍及管理員分清。舊個人 ID／密文及客戶端相容，不全庫搬移／重新加密；交易保留版本、收據、變更及 outbox |
| 身份 | Web 沿 Firebase provider／連結；原生 Google 用 `@react-native-google-signin/google-signin`、Apple 用 `@invertase/react-native-apple-authentication` 取得憑證，再沿既有 Firebase／session 接線；不另建身份服務 |
| 文檔包 | 授權領域匯出＋版本 manifest／結構資料／來源／附件／摘要；Server 用 `yazl`／`yauzl` 有界逐項寫讀、Node 標準簽章／hash；既有 JSZip 用途保持，不把恢復 envelope 直接披露 |
| 系統分享 | Android 優先既有 Expo Sharing；iOS 使用標準 Share Extension／`expo-share-extension`，先核 SDK 57 相容，不能以官方實驗性接口存在當成交付。接回既有草稿／附件及統一匯入 |
| 助手與工作 | 既有 ADK／業務工具／持久工作台帳；固定目標及逐項收據，共用 run 預算，不另造教師 Agent、隊列或通用平台 |

新依賴只補具體缺口，選維護活躍、廣泛使用、相容目前版本的穩定版並鎖定；不連帶升級整套框架。採用依據與實際相容結果留 TECH_REUSE，不以文件核查冒充實測。共享權限、遷移及高耦合修改由主模型處理；規範文件／提示詞親寫，簡單中等實作及唯讀核查按 AGENTS 分給 Sol／Luna，不使用 Astra 子代理。前端／手機與後端按本機協作文件切換實際交付帳號，單作者提交。

**四組連貫驗證：**①登入連結同 UID、選模組共享／撤權／轉交／退出；②50 名合成孩子名冊、統一匯入數量、去重／衝突／中斷接續與普通待辦同規則；③包往返／附件／私人範圍、無證明與遭修改的包、差異恢復及一次隔離災難恢復；④D 接口穩定後的一條多孩／混合對話，分享、分析、跨端只補新接點。復用已有證據，不全量／壓測／逐頁 E2E；真模型只補代表流程，沿本聊天已授權 12 小時 US$5 上限，不改產品配額。

按包使用 executing-plans／using-git-worktrees；必要規則定向 TDD、失敗才 systematic-debugging；Agent 用 adk-typescript-runtime，正式 Web／部署只採適用目前架構的 Skill 部分。合併前 requesting-code-review／verification-before-completion，亦核對是否漏用現成能力。後端先相容部署，Web／App 同源接線；原生 runtime 變動才建新 binary，保留回退。本人登入、設備及外部前置只留受阻項，未驗／延期不計完成。

<a id="s10-w03"></a>
#### S10-W03：完整知識管理（P4，未開始）

- 前置 S10-W02、P2-A04／現行 Firestore 知識接口；只等實際需要的 D 維護接口。
- 保留大型管理頁、大規模導入／批量重建、進度／停止／恢復／失敗、效能、維運及知識資料遷移。已前移的官方 PDF、語義換版及必要發布維護不重做。
- 公共知識包與 HANDOVER01 私人資料包分清；完整跨 Server 權威搬遷屬 P5，不取消 P4 知識資料導入／移轉能力。

<a id="s12-w02"></a>
#### S12-W02：系統分享導入（P4，實作中）

- 前置 S12-W01／S12-W04 的草稿／附件及受影響平台 adapter，不等所有 P3。
- 保留系統分享及其餘既定平台接點、來源／確認／權限與失敗處理，接回現有草稿／附件，不另建業務副本。
- Android 首包沿 Expo Sharing 原生 `getSharedPayloads`／config plugin 及 Router intent 接點；不用會自動解析網址的 resolver。文字／網址保留原文，照片／音訊／其他檔案沿現有本機副本與大小／格式檢查；只把用戶選中的項目加入目前個人孩子草稿，每則一份附件規則保持。登入、孩子切換、已有草稿、取消與遲到讀取要有明確狀態，不自動上載或觸發 Agent。
- 新原生配置、API 接線與真機接收分開記錄；iOS 不啟用 Expo 的非標準主 App 喚起 extension，仍按既定標準 Share Extension 方案接續。HANDOVER01 完成後資料包接統一匯入入口，首包不把一般檔案上載宣稱為資料匯入。
- **2026-10-28 Android 首包：**本機接線、定向檢查及 Android JS 匯出完成，未建置／發布新版 APK。獨立 review 的原附件離頁保護、孩子 A→B→A 遲到讀取，以及 SDK 文字檔案解析均已修正；沿固定 Expo Sharing 加標準版本補丁，不重寫原生模組。必要失敗、型別限制及真機待驗見[證據](artifacts/verification/P4_ANDROID_SHARE_INPUT_20261028.json)。後續只補新 binary／外部 App 分享接收，不重驗既有附件保存；其餘 P4 可繼續。

<a id="s07-w02"></a>
#### S07-W02：可靠性（P4／P5 父包，分項未完成）

<a id="s07-w02-p4"></a>
- **P4 集中服務：**前置 S07-W01 及受影響附件／分享／權限接口。保留有效跨端故障覆蓋、附件中斷、重連、版本／防重、刪除與撤權一致性；復用前移證據，只補缺口，不每次全量重跑。
<a id="s07-w02-p5"></a>
- **P5 跨 Server：**前置 S06-W04 及本包 P4 契約；核身份、快取、附件、未完成操作及舊世代邊界，不再依賴 S08-W01。

<a id="s14-w02"></a>
#### S14-W02：報告與分析（P4，未開始）

- 前置 P2-A05／現行報告與來源有效性接口；分享只等 S12-W02 對應 adapter，多孩分析只等 CLASS01 範圍，不以全部知識管理作前置。
- 保留原生分享、雙端預覽、趨勢及非核心分析，使用可追溯資料、期間統計、變化與缺漏；不新增診斷、發展評分或排名。日常成長、季度／年度及同版 PDF 已前移，不重做。

<a id="s15-w02"></a>
#### S15-W02：備份／恢復（P4／P5 父包，分項未完成）

<a id="s15-w02-p4"></a>
- **P4 集中服務：**前置現有 Firestore／Storage 備份、刪除日誌及工作世代接口。保留配對備份、保留期限、隔離災難恢復、刪除重放及保留新寫入回退，不等跨 Server 遷移或報告 UI。原真備份還原待驗維持原歸屬；用戶文檔包不替代此機制。
<a id="s15-w02-p5"></a>
- **P5 跨 Server：**前置 S15-W01 及本包 P4 恢復契約；完成通用遷移／災備及不丟新寫入的 rollback，不復活已撤權身份或終態工作。

<a id="s08-w01"></a>
#### S08-W01：配對／臨時會話（取消）

QR／短碼、已登入裝置批准配對及臨時電腦會話取消，不移至 P5、不作依賴、不標完成。正常登入、獨立裝置會話及撤銷沿既有身份／AUTH01 保留；歷史見 ADR-028／Git。

<a id="p5-future"></a>
### P5 工作包：延後的必要能力

<a id="s06-w04"></a>
#### S06-W04：自選相容 Server（P5，未開始）

前置既有身份、共用 transport、能力核對及集中服務相關可靠性；地址／版本／能力及憑據隔離可先做，不等搬遷。切換不得自動外送舊 Server 的私人資料。

<a id="s17-w05"></a>
#### S17-W05：Windows 自部署（P5，未開始）

前置 S06-W04／現行 Compose 配置；Docker Desktop／WSL2、API／worker、Firestore 接點、持久儲存、私密配置、TLS 及操作說明。無 GCP 附加身份且關閉 AI 時仍能用核心資料／確定性任務；不重引 SQL、不宣稱離線模型。

<a id="s13-w03"></a>
#### S13-W03：任務／授權交接（P5，未開始）

前置 S07-W02 跨 Server 接口、S13-W02 工作／投遞台帳；切換唯一執行、舊執行者失效、授權接續及審計。不把普通文檔包匯入當作授權搬移。

<a id="s15-w01"></a>
#### S15-W01：跨 Server 搬遷（P5，未開始）

前置 S13-W03、S17-W05；核對資料、身份、附件、知識及工作，確認後切換權威，失敗不提早停用來源。和跨人獨立副本不同；處理 unknown、切單主，回退保存新寫入。

<a id="s16-w04"></a>
### S16-W04：P4／P5 驗收父包（未開始）

<a id="s16-w04-p4"></a>
- **P4 子包：**等 P4 各功能的相應交付，不等 P5；追溯原有效 REQ／AC 與 [AC-P4](SPEC.md#ac-p4-p5)。同批合成資料覆蓋登入／共享、班級批次、交接／備份往返及新增營運接點；保留有效故障範圍、復用已有證據。按下表已確認決定驗證；真 Agent 等 D 相應接口／自查，設備或本人操作留待驗。
<a id="s16-w04-p5"></a>
- **P5 子包：**等 P5 功能；按 [AC-P5](SPEC.md#ac-p5-01) 驗自選／自部署、搬遷／恢復、完整性、單主及保留新寫入的回退。P4 通過不代表本子包通過。

<a id="s17-w04"></a>
### S17-W04：P4／P5 交付父包（未開始）

<a id="s17-w04-p4"></a>
- **P4 子包：**前置 S16-W04/P4；集中服務 Web／App、源碼／配置、知識、分享／分析、文檔包、備份恢復、許可、操作文件及證據，另一組員可重現。P3 APK／iOS 未驗仍未完成，Windows 不列本子包門檻。
<a id="s17-w04-p5"></a>
- **P5 子包：**前置 S16-W04/P5；自部署／搬遷工具、Windows 文件、地址／身份／權威切換、恢復／回退及證據，另一組員可重現。父包兩子包均完成才結案。

<a id="p4-pending"></a>
### 原待決表：2026-10-27 已確認（保留 PD 識別）

| 識別 | 決定範圍 | 已確認行為／受影響包 |
|---|---|---|
| PD-01 | 家庭模組加入 | 共享選定原資源、修改同步；撤回不刪本人原資料，不搬移／複製；FAMILY-A／B |
| PD-02 | 班級移出空間 | 同一班級／資料轉為指定負責人獨立管理，終止原空間存取；CLASS01 |
| PD-03 | 缺證明／完整性失敗 | 缺可信證明明示後可選繼續，仍核格式／相容／權限；簽章或 hash 不符拒絕且不能降級；HANDOVER01 |
| PD-04 | 匯入待辦 | 與自己建立完全相同，依資料狀態／時間／當前本人通知設定運行，不另設啟用開關；不重播舊投遞／授權，缺項沿普通建立規則；HANDOVER01 |
| PD-05 | 未轉交退出／刪帳 | 同一流程轉交或解散，列清影響；解散共享不刪他人的個人原資料，已轉交空間資料不隨原管理員刪帳消失；FAMILY-A／CLASS01 |
| PD-06 | 本人差異還原 | 預設保留目前較新修改／刪除；摘要後可整批覆蓋衝突或明確恢復已刪項，留新操作／來源關聯；自動災難恢復照常防復活；HANDOVER01／S15-W02 |

新增決定及統一匯入見 [ADR-029](docs/DECISIONS.md#adr-029)／[SPEC](SPEC.md#p4-p5-product)。原文件定案包只核 diff、錨點／連結、依賴及條款，未做產品測試；後續依上方執行計劃逐包實作驗證，文件、畫面、合併或部分平台通過不當階段完成。


<a id="p2-agent-roles"></a>
### 四角色 Agent：保留接口目標，內部實作轉 P3

本節保留 2026-10-08 的四角色目標作接口與後續範圍對照；2026-10-09 已由 [ADR-021](docs/DECISIONS.md#adr-021) 收窄當前實作。依 ADR-024，下列角色內部、兩條四角色流程、6 次預算提案及 AC-P2M 全量門檻由 [P3-M01～M03](#p3-agent-roles) 承接，不是本輪 F01～F08 依賴；只有聊天與接口按 [當前入口](#active) 推進。原提案取代「文件生成 Agent」／聊天搜尋子模型式資料收集，但不授權現在開始內部實作。產品要求與四條 AC 見 [SPEC](SPEC.md#p2-agent-roles)，編排見 [架構](docs/ARCHITECTURE.md#p2-agent-roles)，決策見 [ADR-020](docs/DECISIONS.md#adr-020)。

#### 目標、現況與交付範圍

家長只面對同一育有方助手：自然交代、查證及辦事，必要時編製可保存／重用的資料，再看真實結果。不是每輪都運行四個 Agent，也不把所有普通操作改為生成文件。

| 角色 | 工作與邊界 |
|---|---|
| 聊天 | 理解口語及多輪指向、補問、檢索已發布知識／歷史、使用業務工具與按需委派，保持唯一對話入口 |
| 資料編製 | 整理需保存／重用、嚴格格式或專門風格的資料；包括準備內容、成長整理、照護說明、有用記憶／摘要與待辦草案，不限文件 |
| 審核 | 唯讀原始證據，核對實質回答／編製成果／知識更新的含義、引用、適用性與披露範圍；不能代家長同意或自行寫業務／發布 |
| 背景知識維護 | 獨立於聊天，在核准網站／路徑內自主讀目錄與連結、取得圖片／PDF 等新版、整理資料並經檢查後更新知識庫；沒有家庭私人資料權限 |

基線 `e6842fc` 已有單一 ADK 工具循環、引用身份／版本校驗、文件版本與局部修改、來源刷新／發布及文字 PDF 抽取；尚缺四角色委派、獨立語義審核、官方視覺資料理解與跨角色共同預算。已有能力與失敗／未驗證據保留，不把本文件當 runtime 已接通。

#### 暫緩的四角色流程與結果對照

- **互動：**家長交代 → 聊天查詢／操作 → 必要資料編製 → 審核 → 按授權保存或待確認 → 真收據回報／各頁同步。清楚的普通記錄、勾選、改期仍可直接走現有工具；不為確定性操作額外調模型。
- **知識維護：**排程或管理入口 → 背景讀取指定網站 → 整理／比較新版 → 審核與程式檢查 → 自動發布／更新／停用 → 供之後查詢。沒有聊天請求亦可運作；聊天搜尋直接用 KnowledgeRetriever，缺口只記待補，不擴大爬取或採信未核內容。
- **資料而非副本：**輸出依領域 schema 進原記憶／任務／文件服務；待辦是任務，網頁／卡片／PDF 是同版資料的呈現。既有成果局部修改保持 ID／版本／原 opId；草稿和正式成果分開，推測不升格事實，審核不代替重要操作確認；更正／撤權／失效同步影響衍生物。
- **審核：**重要含義以原始證據核對，不只驗引用 ID／hash。結果綁成果內容、來源版本、對象及範圍；改動須重新核對，未通過不正式保存或呈現。純澄清／確定性收據免額外模型，官方緊急求助內容可立即呈現；不宣稱零錯誤或臨床有效性。
- **自主維護：**指定網域／路徑／主題／使用範圍內，可有界跟進站內連結；原文、模型抽取與整理分開，圖片／PDF 保留原始頁面、版本與完整度。未變內容復用，長資料分批保存進度；檢查通過自動更新，含義不明／矛盾保留候選，抓取暫失不當失效。不得修改執行醫療／成長規則或把家庭／私人付費來源混公共庫。

#### 暫緩的預算、次序及驗收提案

以下保留原規劃，未啟用，不提高現行限額。互動的所有角色共用最多 **6 次生成**，包含委派、審核及修正；不是每角色 6 次。8 工具、2 次 query embedding、90 秒、每次輸出及上下文上限與每日配額不提高，本人更低上限仍有效。預留審核呼叫，餘額容許才最多一次修正／重核；耗盡保存進度，不新開 run 繞限。背景知識維護使用獨立有界工作／平台預算，不用家長私人 key；未變內容不重做模型整理。細節與目前配置分界見[運行配置](docs/ARCHITECTURE.md#p2-agent-budgets)。

角色工作次序改由 P3-M01 審核 → P3-M02 資料編製／P3-M03 背景維護承接；原把角色內部塞入 F03～F05 的安排不再有效。主模型親寫契約及角色 prompt，沿既有 manifest 按需補模組，不複製四套 Prompt Pack，不重做前端。

四角色日後恢復實作才適用的驗收為 [AC-P2M-01～04](SPEC.md#ac-p2m-01)：模糊交代後有依據的可重用成果／新對話及跨頁讀回；指定項修改與版本／引用拒絕；無聊天時取得視覺來源新版、核對發布後可引用；範圍／私人隔離、重投遞及根預算控制。合併連貫情景並復用有效證據，不為四角色各跑整套 E2E；真服務／雲端沿各包批准成本邊界，不用 Computer Use。

2026-10-08 該次只有文件定案、連結／依賴／diff review，未修改程式或 Prompt Pack、未呼叫模型、部署或建立資源。現在的唯一實作入口是 [#active](#active)；#140 已收束，F02 實證及原 A09 聊天成果門檻仍保留。

<a id="steps"></a>
## 步驟範圍與結案

Sxx 是跨階段範圍；結案須其所有有效包及 AC 完成。此表只列範圍、完成條件與唯一正文入口，不另維護狀態或下一步。目前正式服務沿 Firestore／Firebase Authentication；SQL／Better Auth／pgvector 只作已歸檔實作追溯。

<a id="s04"></a>
### S04 Android／iOS 同一縱向流程

- 範圍：重用 Server、共享業務與既有設計的在線 App、原生接點及可維護更新
- 完成條件：兩平台可安裝並完成必要真機流程；不以 Web／bundle 代替，OTA 與 API 相容／回退可核對
- 工作包：[S04-W01](#s04-w01)、[S04-W02](#s04-w02)、[S04-W03](#s04-w03)。

<a id="s05"></a>
### S05 記錄與資料保護

- 範圍：確認、更正、時間軸、搜尋、Server 加密／刪除／備份及平台安全保存
- 完成條件：原文、約數、時間、修訂與來源保留；備份還原可核對；[資料規則](docs/DATA_MODEL.md#section-5-1)
- 工作包：[S05-W01](#s05-w01)、[S05-W02](#s05-w02)、[S05-W03](#s05-w03)。

<a id="s06"></a>
### S06 Server 身份與資料

- 範圍：TypeScript、Firestore、Firebase Authentication、個人／共享空間權限及 P5 相容 Server 連線
- 完成條件：真實登入／持久化、跨家庭隔離、私人聊天邊界及 Server 選擇；[權限驗收](SPEC.md#section-10-5)
- 工作包：[S06-W03](#s06-w03)、[S06-W01](#s06-w01)、[S06-W02](#s06-w02)、[S06-W05](#s06-w05)、[S06-W04](#s06-w04)。

<a id="s07"></a>
### S07 在線更新與一致性

- 範圍：請求冪等、版本／衝突、跨端更新、附件狀態、刪除與撤權
- 完成條件：中斷／重試／並行操作不靜默丟資料，終態不復活；[一致性驗收](SPEC.md#section-10-2)
- 工作包：[S07-W03](#s07-w03)、[S07-W01](#s07-w01)、[S07-W02](#s07-w02)。

<a id="s08"></a>
### S08 已取消的配對／臨時會話

- 原配對／臨時會話取消，不標完成；正常登入、裝置管理及撤銷沿 S06／AUTH01 保留。
- 替代條款：保留歷史錨點；[正常登入契約](docs/API.md#section-4-1)
- 工作包：[S08-W01](#s08-w01)。

<a id="s09"></a>
### S09 聊天與長期記憶

- 範圍：原始聊天、確認事實、摘要、話題與任務台帳
- 完成條件：新會話／換端／清空模型快取後從 Server 重建授權記憶；[記憶驗收](SPEC.md#section-10-3)
- 工作包：[S09-W01](#s09-w01)、[S09-W02](#s09-w02)、[S09-W03](#s09-w03)。

<a id="s10"></a>
### S10 知識與資訊更新

- 範圍：官方來源、Firestore 向量／embedding、引用、版本、近期資訊、定期更新及管理擴充
- 完成條件：最小向量 RAG、穩定／近期隔離、發布／停用及 freshness 正確；[知識驗收](SPEC.md#section-10-4)／[向量驗收](SPEC.md#ac-p2-vector-rag)
- 工作包：[S10-W01](#s10-w01)、[S10-W02](#s10-w02)、[S10-W03](#s10-w03)。

<a id="s11"></a>
### S11 Gemini 與 Agent 編排

- 範圍：P1 文字聊天；P2 ADK 基礎、Prompt Pack 接線、結構化草稿／確認及互動／背景工具循環
- 完成條件：真實工具及結果回饋，模型不能繞過權限；配額及失敗可核對；[Agent 驗收](SPEC.md#ac-p2-agent-loop)
- 工作包：[S11-W01](#s11-w01)、[S11-W03](#s11-w03)、[S11-W02](#s11-w02)。

<a id="s12"></a>
### S12 照片、語音與分享輸入

- 範圍：Web 照片、主動分享、公開來源及 Android 語音／相機／系統分享
- 完成條件：來源可追溯；數字及不確定內容確認；拒絕權限與失敗明確；[輸入邊界](SPEC.md#section-1-5)
- 工作包：[S12-W03](#s12-w03)、[S12-W04](#s12-w04)、[S12-W01](#s12-w01)、[S12-W05](#s12-w05)、[S12-W02](#s12-w02)。

<a id="s13"></a>
### S13 主動任務、聯絡與家庭交接

- 範圍：Server worker、任務／授權、成長階段關注、Web Push／Telegram／FCM、fallback 與交接
- 完成條件：唯一執行、撤權即停、終態不復活；發送／回應／完成分開；[任務驗收](SPEC.md#section-10-3)／[成長關注驗收](SPEC.md#ac-growth-attention)
- 工作包：[S13-W01](#s13-w01)、[S13-W04](#s13-w04)、[S13-W05](#s13-w05)、[S13-W06](#s13-w06)、[S13-W08](#s13-w08)、[S13-W07](#s13-w07)、[S13-W02](#s13-w02)、[S13-W03](#s13-w03)。

<a id="s14"></a>
### S14 摘要與報告

- 範圍：多孩子、到診準備、日／週摘要、趨勢及 PDF
- 完成條件：數字由程式計算，來源／版本可追溯，更正後產生新報告；[報告規則](SPEC.md#section-5-8)
- 工作包：[S14-W01](#s14-w01)、[S14-W02](#s14-w02)。

<a id="s15"></a>
### S15 Server 搬遷與災備

- 範圍：統一匯出、Server 搬遷、加密備份、空環境恢復與 rollback
- 完成條件：身份／資料／附件／知識／任務完整，切換單主，rollback 保留新寫入；[災備驗收](SPEC.md#section-10-6)
- 工作包：[S15-W01](#s15-w01)、[S15-W02](#s15-w02)。

<a id="s16"></a>
### S16 驗證與成本核對

- 範圍：相關功能、四年齡段、權限／故障／成本及可用性驗收
- 完成條件：全部有效 AC 有證據；高成本驗證先獲批准，缺驗收用待驗收；[驗證制度](#verification)
- 工作包：[S16-W01](#s16-w01)、[S16-W05](#s16-w05)、[S16-W02](#s16-w02)、[S16-W03](#s16-w03)、[S16-W04](#s16-w04)。

<a id="s17"></a>
### S17 交付與接續能力

- 範圍：Web／APK、Windows 部署、源碼配置、操作及接續資料
- 完成條件：另一位組員可依說明使用並重現；[交付驗收](SPEC.md#section-10-8)
- 工作包：[S17-W01](#s17-w01)、[S17-W02](#s17-w02)、[S17-W03](#s17-w03)、[S17-W05](#s17-w05)、[S17-W04](#s17-w04)。



<a id="roadmap-packages"></a>
### 工作包、階段與依賴

前置原則上指已驗收並合併的工作包；既有 P2 隔離分支依[收束安排](#p2-deferred-acceptance) 完成必要驗收及合併，不再新增延後驗收的接續例外。S16 的「本階段全部功能包」按該次結案範圍固定：S16-W02 只涵蓋原 P2 功能包，不包括 S06-W05、INT 或 P2-A01～A09 等後續增補，避免把已結案 S17-W02 反向接回新包。未結案階段包括其所有有效功能包；S17-W05 已移 P5，取消的 S08-W01 不再是依賴。跨階段父包按子範圍核對，功能包不反向依賴本階段 S16／S17 結案包。父 Sxx 的有效 AC 與局部驗收共同適用。

新增驗收包括 [Server／授權外發 AC](SPEC.md#ac-server-agent)、[freshness AC](SPEC.md#ac-knowledge-freshness)、[P2 知識 AC](SPEC.md#ac-p2-knowledge)、[成長關注 AC](SPEC.md#ac-growth-attention)、[ADK／完整流程 AC](SPEC.md#ac-p2-agent-loop)及[最小向量 RAG AC](SPEC.md#ac-p2-vector-rag)，隨所屬功能包驗收；原 AC 的修訂按 [替代索引](docs/DECISIONS.md#adr-008-replacements) 追溯。

通用能力先復用現有程式／Skill，再核對同版本 Google／Expo 原生能力及必要成熟候選；[選型與驗證閘](docs/TECH_REUSE.md#decisions) 按包使用，文件相容不代表已實測。已完成 P1／P2 成果不為換框架返工。前端聊天／主聊天的責任及共享修改次序依 [AGENTS](AGENTS.md#frontend-backend)，混合工作包須兩邊交付並完成相關整合驗收才結案。


- [原 P2](#p2-delivered)／[INT](#production-integration)／[P2-A](#p2-agent-service)／[P2-F](#p2-firestore-migration)。
- [P3／P4](#later-phases)；P1 的完整正文見下方。



<a id="states"></a>
## 状态

步骤和工作包仅使用下列五种状态。实现与证据层级不是额外状态。

| 状态 | 含义 |
|---|---|
| 未開始 | 尚未開始該步驟／工作包；已有研究只是輸入 |
| 進行中 | 正在實施，或驗證失敗後繼續修復；跨階段 Sxx 部分包完成亦屬此狀態 |
| 受阻 | 缺少必要条件导致无法推进；记录原因、所缺条件及解除方法 |
| 待驗收 | 实现准备完成，但必需测试或人工确认尚未完成 |
| 已完成 | 实现、全部必需验证和记录均完成 |

<a id="verification"></a>
## 验证与证据层级

| 用语 | 含义 | 依据 |
|---|---|---|
| 已确认 | 设计或需求确定 | SPEC／ADR／用户决定 |
| 已实现 | 代码确实存在 | 文件与修改版本；文档迁移只能说明文档已写入 |
| 已验证 | 指定场景实际通過 | 命令或人工步骤、环境／版本、結果与证据 |
| 已完成 | 实现、全部必需验证和记录齐备 | 本步驟必要驗收及證據齊備；按文件職責更新受影響位置 |

驗證範圍、成本、批准與失敗停批統一依 [AGENTS 驗證與收尾](AGENTS.md#finish)。此處只定義證據層級及下列既有分支例外，不複製另一份測試規則。

<a id="historical-entry"></a>
## 歷史及相容入口

整理前完整原文、Git 版本與 SHA-256 見 [固定快照索引](_archive/README.md#plan-20261011)。當時的未完成、下一步、批准及分工不因保留而成為現行指令。

<a id="current-capability-gaps"></a>
### 新前端能力差距（2026-10-07 源碼核對）

`0a39e018` 的七項完整差距快照保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#current-capability-gaps)。A02～A07 後續已合併；真引用、同文件修改、新對話讀回及正式服務仍由 [F07](#p2-f07)／[F08](#p2-f08) 承接，不能把舊快照再次當未開始清單。前端原深連結保留此入口。

<a id="team-package-allocation"></a>
### 四人工作包責任預分配

人員責任、歷史預分配、權重／份額及署名操作已歸既有本機協作文件；只在分配／署名／交付時按 [AGENTS 本機協作指引](AGENTS.md#team-contributions) 讀取，不納入 Git。沒有重算或改寫歷史貢獻。

<a id="extension-boundaries"></a>
### 共享邊界與漸進實作

原 P2 接續的版本／分支／驗收批准保留於[固定歷史原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#extension-boundaries)，不是新的待辦。DataStore／ModelGateway／AgentRuntime／AttachmentStore／KnowledgeRetriever／TaskExecutor／NotificationGateway 及 SyncEngine 的職責由 [API](docs/API.md#section-3-3) 維護；共享 TypeScript／薄 adapter／Server 權威依 [架構](docs/ARCHITECTURE.md#section-3-1)，執行範圍依 [AGENTS](AGENTS.md#scope)。

<a id="packages"></a>
### 工作包与有限并行

工作包範圍、前置合併、Git、模型與並行、前後端修改歸屬統一依 [AGENTS](AGENTS.md#scope)／[Git 工作流](AGENTS.md#git-workflow)／[模型分工](AGENTS.md#models)／[前後端分工](AGENTS.md#frontend-backend)。預覽不當正式接線；S16-W05 的共用基礎由 S16-W03／W04 延續，不延後各功能包必要驗收。

工作包记录格式：

```text
工作包 ID：Sxx-Wxx
所属步骤：
階段／前置工作包：
狀態：未開始 / 進行中 / 受阻 / 待驗收 / 已完成（選一）
目标：
关联 REQ／AC：
修改范围：
前後端交付／共享契約與修改歸屬（適用時）：
復用結論／必要候選及未驗證項（一句或引用既有研究即可）：
範圍外：
验证方法：
完成证据：
```

<a id="section-7-reuse"></a>
### 技術與開源復用原則

<a id="rule-7-reuse-01"></a>
<a id="rule-7-reuse-07"></a>
執行及許可／歸屬保留規則見 [AGENTS 技術研究](AGENTS.md#technical-skills)；家庭授權、任務終態、外發去重與安全由項目掌管，採用見 [TECH_REUSE](docs/TECH_REUSE.md#decisions)。

<a id="rule-7-reuse-02"></a>
<a id="rule-7-reuse-03"></a>
<a id="rule-7-reuse-04"></a>
<a id="rule-7-reuse-05"></a>
<a id="rule-7-reuse-06"></a>
S01 的 coo-ai-agent、Baby Buddy、CareLoop、BreastfeedingTracker、UNICEF Bebbo 研究用途與不採用／參考邊界保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#section-7-reuse)及[研究歷史索引](_archive/README.md)；不是新的預設首查或產品底座。已完成成果不為換框架返工。

<a id="p2-deferred-acceptance"></a>
### 按包驗收與既有 P2 隔離分支收束

2026-09-28 的集中驗收安排、2026-09-30 恢復按包驗收及既有分支收束方式是歷史；原二十包已結案。固定前置、未驗項及原證據仍按各包保留，不必重建成果，不得用歷史例外開新的未驗依賴包。原主聊天 `01a0c876-a538-7a51-8b99-648131cc56f4` 的免逐次詢問只限該聊天及原操作／成本，不延伸本聊天、部署、續期或新資源。

完整歷史條款與當時批准見[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#p2-deferred-acceptance)；現行批准、失敗停批、必要驗收／合併及真機反饋依 [AGENTS](AGENTS.md#finish)。程式準備好不等於完成，真機欠驗用待驗收；必要環境缺失且無法繼續用受阻。

<a id="maintenance"></a>
### 计划与规范维护

文件職責、更新及凍結／歷史追溯只依 [AGENTS 文件更新邊界](AGENTS.md#document-updates)。保留穩定 REQ／AC／S／工作包／ADR／LOG／EV／SRC 與舊錨點；替代關係見 [ADR-001](docs/DECISIONS.md#adr-001)／[ADR-005](docs/DECISIONS.md#adr-005)／[ADR-008](docs/DECISIONS.md#adr-008)／[ADR-009](docs/DECISIONS.md#adr-009)，回查歷史先讀 [_archive 索引](_archive/README.md)。




<a id="p1-p2-archive"></a>
## 舊錨點相容入口（不屬日常閱讀內容）

以下只保留外部連結與舊包依賴；不是第二份當前計劃。歷史詳情只在指定歸檔位置，未驗／失敗證據保持原狀。

| 原入口 | 按需查看原文 |
|---|---|
| <a id="agent-budget-followup"></a>`agent-budget-followup` | [歷史原文](_archive/plans/P1-P2-20261018.md#agent-budget-followup) |
| <a id="p2-optimization"></a>`p2-optimization` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-optimization) |
| <a id="p2-opt01"></a>`p2-opt01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt01) |
| <a id="p2-opt02"></a>`p2-opt02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt02) |
| <a id="p2-opt03"></a>`p2-opt03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt03) |
| <a id="p2-opt04"></a>`p2-opt04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt04) |
| <a id="p2-opt05"></a>`p2-opt05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt05) |
| <a id="p2-layering-streaming"></a>`p2-layering-streaming` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-layering-streaming) |
| <a id="p2-lay01"></a>`p2-lay01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay01) |
| <a id="p2-lay02"></a>`p2-lay02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay02) |
| <a id="p2-lay03"></a>`p2-lay03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay03) |
| <a id="p2-lay04"></a>`p2-lay04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay04) |
| <a id="p2-lay05"></a>`p2-lay05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay05) |
| <a id="p2-adm01"></a>`p2-adm01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-adm01) |
| <a id="p2-review-repair"></a>`p2-review-repair` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-review-repair) |
| <a id="p2-r01"></a>`p2-r01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r01) |
| <a id="p2-r02"></a>`p2-r02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r02) |
| <a id="p2-r03"></a>`p2-r03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r03) |
| <a id="p2-r04"></a>`p2-r04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r04) |
| <a id="p2-completion-execution"></a>`p2-completion-execution` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-completion-execution) |
| <a id="chat-capacity-recovery"></a>`chat-capacity-recovery` | [歷史原文](_archive/plans/P1-P2-20261018.md#chat-capacity-recovery) |
| <a id="p2-firestore-migration"></a>`p2-firestore-migration` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-firestore-migration) |
| <a id="f02-candidate-disposition"></a>`f02-candidate-disposition` | [歷史原文](_archive/plans/P1-P2-20261018.md#f02-candidate-disposition) |
| <a id="p2-f01"></a>`p2-f01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f01) |
| <a id="p2-f02"></a>`p2-f02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f02) |
| <a id="p2-f03"></a>`p2-f03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f03) |
| <a id="p2-f04"></a>`p2-f04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f04) |
| <a id="p2-f05"></a>`p2-f05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f05) |
| <a id="p2-f06"></a>`p2-f06` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f06) |
| <a id="p2-f07"></a>`p2-f07` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f07) |
| <a id="p2-f08"></a>`p2-f08` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f08) |
| <a id="p2-delivered"></a>`p2-delivered` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-delivered) |
| <a id="s11-w03"></a>`s11-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w03) |
| <a id="s06-w02"></a>`s06-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w02) |
| <a id="s05-w02"></a>`s05-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s05-w02) |
| <a id="s09-w02"></a>`s09-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s09-w02) |
| <a id="s07-w03"></a>`s07-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s07-w03) |
| <a id="s13-w01"></a>`s13-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w01) |
| <a id="s13-w04"></a>`s13-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w04) |
| <a id="s10-w01"></a>`s10-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s10-w01) |
| <a id="s10-w02"></a>`s10-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s10-w02) |
| <a id="s11-w02"></a>`s11-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w02) |
| <a id="s12-w03"></a>`s12-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s12-w03) |
| <a id="s12-w04"></a>`s12-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#s12-w04) |
| <a id="s13-w05"></a>`s13-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w05) |
| <a id="s13-w06"></a>`s13-w06` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w06) |
| <a id="s13-w08"></a>`s13-w08` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w08) |
| <a id="s13-w07"></a>`s13-w07` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w07) |
| <a id="s14-w01"></a>`s14-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s14-w01) |
| <a id="s16-w05"></a>`s16-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w05) |
| <a id="s16-w02"></a>`s16-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w02) |
| <a id="s17-w02"></a>`s17-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s17-w02) |
| <a id="s06-w05"></a>`s06-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w05) |
| <a id="production-integration"></a>`production-integration` | [歷史原文](_archive/plans/P1-P2-20261018.md#production-integration) |
| <a id="int-w01"></a>`int-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w01) |
| <a id="int-w02"></a>`int-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w02) |
| <a id="int-w03"></a>`int-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w03) |
| <a id="int-w04"></a>`int-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w04) |
| <a id="int-w05"></a>`int-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w05) |
| <a id="int-w06"></a>`int-w06` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w06) |
| <a id="int-w07"></a>`int-w07` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w07) |
| <a id="p2-agent-service"></a>`p2-agent-service` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-agent-service) |
| <a id="p2-a01"></a>`p2-a01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a01) |
| <a id="p2-a02"></a>`p2-a02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a02) |
| <a id="p2-a03"></a>`p2-a03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a03) |
| <a id="p2-a04"></a>`p2-a04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a04) |
| <a id="p2-a05"></a>`p2-a05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a05) |
| <a id="p2-a06"></a>`p2-a06` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a06) |
| <a id="p2-a07"></a>`p2-a07` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a07) |
| <a id="p2-a08"></a>`p2-a08` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a08) |
| <a id="p2-a09"></a>`p2-a09` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a09) |
| <a id="qa-report-period--關注觀察的固定期間歸屬已合併待部署"></a>`qa-report-period--關注觀察的固定期間歸屬已合併待部署` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-report-period--關注觀察的固定期間歸屬已合併待部署) |
| <a id="qa-adk-runtime--指令資料分層與安全終結已合併待部署"></a>`qa-adk-runtime--指令資料分層與安全終結已合併待部署` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-adk-runtime--指令資料分層與安全終結已合併待部署) |
| <a id="qa-interactive-input--待辦意圖與互動容量已合併待部署驗收"></a>`qa-interactive-input--待辦意圖與互動容量已合併待部署驗收` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-interactive-input--待辦意圖與互動容量已合併待部署驗收) |
| <a id="chat-reliability-delivered"></a>`chat-reliability-delivered` | [歷史原文](_archive/plans/P1-P2-20261018.md#chat-reliability-delivered) |
| <a id="s00"></a>`s00` | [歷史原文](_archive/plans/P1-P2-20261018.md#s00) |
| <a id="s01"></a>`s01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s01) |
| <a id="s02"></a>`s02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s02) |
| <a id="s03"></a>`s03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s03) |
| <a id="vertical-slice"></a>`vertical-slice` | [歷史原文](_archive/plans/P1-P2-20261018.md#vertical-slice) |
| <a id="s01-w01"></a>`s01-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s01-w01) |
| <a id="s02-w01"></a>`s02-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s02-w01) |
| <a id="s06-w03"></a>`s06-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w03) |
| <a id="s03-w01"></a>`s03-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s03-w01) |
| <a id="s06-w01"></a>`s06-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w01) |
| <a id="s09-w01"></a>`s09-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s09-w01) |
| <a id="s11-w01"></a>`s11-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w01) |
| <a id="s05-w01"></a>`s05-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s05-w01) |
| <a id="s16-w01"></a>`s16-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w01) |
| <a id="s17-w01"></a>`s17-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s17-w01) |
| <a id="document-packages"></a>`document-packages` | [歷史原文](_archive/plans/P1-P2-20261018.md#document-packages) |
| <a id="doc-r01"></a>`doc-r01` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r01) |
| <a id="doc-r02"></a>`doc-r02` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r02) |
| <a id="doc-r03"></a>`doc-r03` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r03) |
| <a id="doc-r04"></a>`doc-r04` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r04) |
| <a id="s00-w01"></a>`s00-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s00-w01) |
| <a id="ac-s00-m01"></a>`ac-s00-m01` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m01) |
| <a id="ac-s00-m02"></a>`ac-s00-m02` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m02) |
| <a id="ac-s00-m03"></a>`ac-s00-m03` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m03) |
| <a id="ac-s00-m04"></a>`ac-s00-m04` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m04) |
| <a id="ac-s00-m05"></a>`ac-s00-m05` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m05) |
| <a id="ac-s00-m06"></a>`ac-s00-m06` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m06) |
| <a id="ac-s00-m07"></a>`ac-s00-m07` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m07) |
| <a id="ac-s00-m08"></a>`ac-s00-m08` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m08) |
| <a id="ac-s00-m09"></a>`ac-s00-m09` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m09) |
