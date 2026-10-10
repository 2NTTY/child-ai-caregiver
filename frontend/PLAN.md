# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## QA：載入、切換、路由、PDF 與家庭選項（v68 已發布、定向瀏覽器局部通過，單一 PR 待交付）

2026-10-10 UTC，基線 master `ae5d3e01b11632a62a54db68b77c7ed20e323471`。按使用者本輪前端 QA 範圍，把帳戶載入、孩子切換幕布、Care query、導航 owner 重新渲染、PDF 准入／pending 失效及家庭選項同名修補放在同一前端批次；後端收尾另由 Codex 承接。本包只改 `frontend/**`，保留現有設計、共用 owner、API 契約、身份／孩子隔離及原操作／unknown 邊界，不修改根文件、Server 或正式資料。

- **帳戶准入：**檢查中顯示既有品牌載入呈現，不把正常 checking 說成失敗；真正錯誤／離線仍提供原重試或退出，驗證／同意門檻及未准入頁面的 hidden／inert 保留。慢請求、20 秒 timeout、重新連線及舊身份晚到回應分開驗證，沒有以幕布代替授權。
- **孩子與當頁就緒：**真正切孩子時，舊 scope 立即被幕布隔離；等當前孩子 profile、目前 route／query 及已顯示側欄的必要資料。首次取得孩子不播放切換幕布，隱藏頁面／收起側欄不加入等待。錯誤、未註冊 readiness 或逾時保留有界重試／返回；重試沿既有 owner，包含 children list、對話及通知歷史，不新增另一套資料請求。快速切換、失權／登出、舊回呼與 reduced motion 不繞過私隱遮罩。
- **Care query：**畫面與 readiness 使用同一個 `view` 首值規則，避免重複參數形成陣列時，readiness 等待照片資料，畫面卻掛載 `CareWorkspace`。既有 compose／record 選取保持。同批 PhotoInputDomains 沿同一首值規則識別照片路由，保留未保存原檔／草稿及由聊天接收的獨立副本，真正離開才按原規則清理；身份／孩子切換、卸載及原 pending／unknown 守衛不放寬。舊v67的重複query錯頁另有真瀏覽器反例，v68桌面樣本已核實實際URL首值分支，但未直接讀取Expo內部參數型別或驗原檔生命週期。
- **導航更新：**只有寫入守衛使用穩定的 owner-only context，普通切頁不再喚醒無關 domain bridge 或重發其 summary。身份、孩子、online／role 等環境仍使用原 reactive context；不把單次 render／publish 計數下降說成 FPS 或實際流暢度提升。
- **同批可見初讀：**按17個業務路由的有界源碼掃描，候選已補 Care／Chat 可見 agentPending 首讀、tasks 的 URL taskId、care 的 record／recordId 指定詳情，以及 settings 當前實際開啟頁籤的首讀。指定詳情沿原 owner 的 exact-target 狀態與重試；query 改變使舊回呼失效。隱藏頁籤、未開視窗、手動明細及背景建置不加入等待，不改原 URL 導航語義。
- **PDF 晚到結果：**同一批微任務內，文件版本已失效但 React 尚未 commit 時，既有 pending PDF 仍可能沿舊投影建立 object URL。候選沿原 export token 同步標記 invalidated，在瀏覽器副作用前拒絕舊結果；整份讀集或指定 snapshot 的撤銷仍按原範圍處理，不誤取消其他有效 snapshot。原 inFlight／exportBusy 保留至請求 finally 才解鎖，取消後的晚到 403 仍撤權。不把關閉說成已確認取消或下載成功；此段證據涵蓋已存在的 pending 結果；新導出准入另按下段補驗。
- **PDF 新導出准入：**真 ProductionTaskKnowledgeDomains bridge／GrowthWorkspace／GrowthArchive 的受控微任務流程重現：版本索引已指出 authority 失效，owner 尚未下一次 render、仍未有 export token，畫面上的下載按鈕卻多發1次合成PDF POST；原紅 object URL及下載皆為0，不能寫成已洩出檔案。最小修正把成功讀頁的 `pageReadGeneration` 與既有同步讀集世代配對，入口不符即拒；失敗重讀或無關render不能重新放行，須成功讀回的新投影。原pending token／撤權／finally後段保持原樣。這證明真UI接點在受控排程的缺口，不是自然可信瀏覽器輸入時序；只涵蓋整個讀集失效及權威重讀恢復，不宣稱所有document轉態窗口已完成。
- **家庭選項名稱：**舊v67的有界真瀏覽器觀察中，家庭選擇與頁首孩子各自保持，成員／孩子集合隨家庭選項改變，符合獨立選擇契約，未見集合混串；實際問題是兩個可選家庭的文字及無障礙名稱相同。候選只在owner基本文字重複時，附上原identity已可讀 `records.children` 中 `workspaceId === family.id` 的孩子 `displayName`；名稱trim／過濾空字串／去重，選項value仍為原familyId。唯一文字維持短名，不新增API、重讀、UUID／序號顯示或權限。缺已載名字、孩子同名或名字集合相同仍可能無法區分，不把缺資料說成沒有孩子；完整消歧仍需可供人辨識的家庭名稱／標籤契約。v68桌面及390／1024寬樣本已見名字提示與窄屏換行；實際讀屏及完整權限矩陣仍未驗。
- **本批程式證據：**原30檔候選已封存，同批加入家庭名稱投影3檔程式及1檔測試，現為31檔產品／測試加3檔文件。真FamilyView／AppSelect／AppRadioItem、owner、QueryClient及API/parser在合成ports下重現重複label原紅；作者5/5及typecheck通過，獨立6/6為5項重跑＋1項孩子移除邊界，最終「孩子：」同一斷言亦在原30檔獨立重現紅例。31檔組合另重跑家庭5/5及typecheck通過，前27檔產品／測試hash不變；其他suite本次未重跑。前段PDF准入作者4／獨立4＋1／27檔組合4，以及pending作者7／獨立7＋2／26檔組合7均屬當時版本；照片、22檔與11檔舊證據保留，不重算重疊項。[固定摘要](verification/loading-switch-readiness-2026-10-10/checks.json)列明manifest、分段結果、原紅及未驗。
- **建置與產物核對：**當前34檔候選已在31檔產品／測試上另作官方 `--clear` build，exit 0、35靜態路由／61產物；新bundle `index-c98fec8b5d1c583f91a50a25e4bbe36f.js`，SHA256 `c76cd7255b011da6827d324dcf3a2f57b33e6ab5913133829cacb21f4509ba88`。31源與61產物hash／大小全符；實際Family owner／view的10接點確認已可讀名字投影、只處理重複label及familyId／原守衛保留。PDF完整module 22,860 bytes與原30逐byte相同，舊9份owner／詳情／settings／照片片段也在新產物保留。無新增讀取的執行證據來自合成測試，產物引用數不當runtime網絡證明；此產物覆核與另位覆核者的5＋1原碼審查分開。原30及完整dist已封存。前段30檔的 `index-5c744efb8f2b24bd38cf731ba856f2fb.js`（SHA256 `53a65f3bcf5ea9fe40574419b211ee806fae7299e2cd814cdc7da7c5721f5b1d`）為35路由／61產物，PDF11接點及先前9份片段已按該版本覆核，不能當新家庭修補已進產物。更早29檔dee89a7及27檔3842d5f實體dist已封存；未清快取export exit 0卻重用早期11檔bundle的失敗、其後各段clear成功及具體cache-key成因未明均保留。22檔build原實體缺失，只保留當時hash／log，不重新宣稱內容覆驗。上述普通export其後沿既有官方來源注入合成fixture並發布v68，產品bundle未重建或更改；發布及定向瀏覽器結果見下段。GitHub單一PR交付仍待主對話裁決。
- **原紅與未驗：**保留 account／child 初始反例、children retry／history／visible rail 覆核發現、Care query 陣列反例、導航 render／publish、Care／Chat pending、指定詳情與 settings 實際頁籤的原紅；首次 gate harness 缺 import 的錯誤另列，不當產品反例。舊 startup harness 有一個原生依賴 SyntaxError，另選的15項通過不代表該項修好。hook／native／animation 替身及 React DOM／jsdom 配合合成 owner 只驗程式邊界；真瀏覽器只完成下列有界流程與尺寸，並非四尺寸／完整鍵盤焦點／讀屏、真動畫幀／FPS、真HTTP／PDF、Android或完整服務驗收。17路由的可見初讀源碼掃描已完成；全站17路由及12類交叉狀態的實際互動仍只是驗收盤點，不當作已逐項通過。家庭選項的可見／AX重名原紅保留；修前草稿後綴「已載孩子：」後縮為「孩子：」，沒有改寫重名事實。PDF 同批版本失效的 object URL 原紅、新准入的POST1／URL0真bridge原紅及錯cwd準備命令另保留；前段direct-owner定位屬同一准入缺口，不另加總。合成 Blob 只是佔位 bytes，不驗 PDF 內容、分頁或真下載。PhotoInputDomains 的原檔／草稿／聊天副本3項owner反例及修後證據歸入本批；照片路由已有v68桌面觀察，實際原檔交接／草稿生命週期及完整照片互動矩陣仍未browser驗。
- **v68 發布與定向瀏覽器：**既有公開 [Sites 預覽](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site) 於2026-10-10 17:35:39 UTC發布成功，Sites source `c5063f5ef7827d6856646da0888a311328973912`；這不是GitHub master或正式後端部署。沿既有fixture僅補5條合成GET讀取回應，沒有新增寫入；產品bundle保持上述c98fec8。17:36–17:48 UTC在dot雲端Chromium的1180×757完成5個有界流程：冷啟動／導航、慢速雙向切孩子及兩個側欄頁籤、家庭標籤往返、photos-first／records-first重複query，以及偏好／模型／Push／Telegram的合成讀取畫面。沒有在被測範圍確認新的產品失敗，不當全讀集成功；Home另顯示「暫時無法顯示助手提醒」，browser當時未診斷；其後真ProductionOwner配v68 fixture、原Home projection／composition的2項窄核確認：這是既有未接權威提醒投影所保留的unavailable，非fixture缺GET。組合沒有新增讀取（合成檢查GET0／native0），4相關檔同master，文案忠實且未改產品；此未完成能力獨立保留，不拿其他pending事項假造提醒。
- **尺寸與互動界線：**沿既有可見驗收工具，實際iframe為1024×900及390×900；只抽查受影響導航、慢切孩子、家庭提示及偏好頁，radio／偏好頁籤可見鍵盤焦點與Care／Family／偏好根節點無橫向溢出。390截到一次幕布揭開中途，後續畫面已收幕，不因此聲稱每幀無閃、FPS或精確時間。這不是原390×844／768×1024、1440／320或全站各尺寸通過；完整焦點次序／返回、讀屏、200%縮放、逐domain延遲、快速A–B–A、PDF／照片bytes仍未驗。62份AX／25張PNG包括中途、工具限制及cleanup，不能當87個測試。
- **下一步：**保留同一34檔批次（31產品／測試＋原3文件），只本地準備單一英文PR；本輪已重核master仍ae5d、open PR空、34 patch可對基線乾淨apply，未混入後端或原多人client overlay。31檔產品不再改動，待文件／PR內文及主對話收尾裁決，不另拆包或新增待辦文件。真API、模型、家庭資料及後端部署仍屬獨立驗收；未將全站FE或P2標為完成。

**先前v67預覽與已交付修復（保留歷史）：**[#182](https://github.com/2NTTY/child-ai-caregiver/pull/182) 已合併；先前公開 [Sites v67](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/qa-viewport) 於 2026-10-10T08:45:53Z 發布，source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`。用途 radio 在 1440／1024／390／320 四尺寸的31項定向真瀏覽器觀察通過；#173／#177 已隨 v66／v67 保留。這些是舊預覽的局部證據，不包含本帳戶／切換候選，也不代表全站通過；原合成 adapter 的 PDF 錯誤不等於正式 endpoint 故障，真下載／pending race 仍未驗。來源依根 STATUS 的既有發布記錄，本文件更新不重跑或新增發布。

**舊v67本輪導航觀察：**2026-10-10 14:02–14:05 UTC，dot雲端Chromium、1180×757 CSS px的三條有界流程中，成長→指定歷史→Back／Forward及待辦連點後一次Back返回均完成；Forward首次擷取曾短暫只有圖片／空標題，隨後正常，時長及原因未量測。`/care?view=photos`顯示照片，`/care?view=photos&view=records`卻顯示記錄與核對，確認舊v67的CarePage分支錯頁後停批。這些不是當前候選或PhotoInput原檔保留修復的browser驗收，也不證明Expo內部參數型別或FPS；其餘矩陣未因此通過。

**舊v67家庭觀察：**2026-10-10 17:00:57–17:02:49 UTC，既有雲端瀏覽器用原合成資料完成家庭往返及頁首切孩子：所選家庭仍保持，兩家庭顯示各自成員／孩子集合，但兩個radio皆宣告相同家庭名稱。這是顯示／可讀名稱歧義，未讀實際familyId／API bytes，兩家庭均為owner；不據此判定越權、完整隔離或失權測試已通過，也不是新34檔候選驗收。

以下各節保留先前包的原交付／開工快照；當中的「未 PR／來源受阻／下一步」只適用當時。即時狀態、同一批次依賴及後端分工以上述入口為準。

## QA：報告用途鍵盤選擇（已合併及預覽局部驗收，保留原記錄）

2026-10-10 UTC，固定 master `69bc0693951490d3b5a2b30b6abda99b745a4785`；開工及交付前重核 master 未變、open PR 為空。本包只修既有導出視窗的用途 radio，不改版型、合成 adapter、PDF 契約或 Server。

- **既有預覽現況：**先前未能取得 v65 可重建來源，原因未明；本輪已經官方來源流程恢復。沿原公開範圍的 [Sites v66](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/qa-viewport) 已於 2026-10-10T08:11:10Z 發布，來源 `151b13770374969ff6696de6dacbf5dd55e724d6`，包含 #173 搜尋／準備單及 #177 導出回饋修正；這不是 GCP 或 #181 後端部署。
- **v66 已驗界線：**dot 雲端 Chromium 以原合成 fixture 實測 1440／1024／390／320 CSS px，四尺寸皆看過導出失敗同窗回饋及關閉／重試操作。搜尋名稱、準備單保存中焦點／導航守衛、導出 Enter／Escape／重開／重試及錯誤結束後切孩子按各自指定尺寸完成定向檢查，並非每項跑遍四尺寸；只有端點 1440／320 核量外層沒有橫向溢出。PDF POST 仍由原合成 adapter 即時拒絕，沒有實際下載或 pending late-response 瀏覽器證據。來源恢復及本輪局部驗收不改寫原失敗、未驗或暫緩事項。
- **新候選：**v66 發現未選用途按 Space 仍為 unchecked，同項按 Enter 可選；v65 原碼已有同一缺口。真 GrowthArchive／RN Web DOM 在 master 原碼先重現相同紅例，再局部補 Space／Spacebar、方向鍵環繞與焦點、單一 Tab 入口。已選項及長按 Space 不清除有效導出意圖／回饋；換用途仍失效原意圖並拒晚到回饋。只選用途不請求 PDF，原 pointer／Enter 及 scope／child／authority／snapshot 守衛保留。
- **原碼證據：**定稿 10 項真 React／RN Web DOM（4 新增＋6 既有）、23 項既有 archive／dialog 定向檢查及 frontend typecheck 通過；6 份作者 network audit 為零外聯。首次候選新測試把既有 `care_handoff` 誤寫成 `handoff` 的 3 通過／1 失敗原結果保留，只按原契約更正測試值，沒有放寬斷言。原2份程式／測試已 freeze，獨立程式 review Allow；[固定證據](verification/export-radio-keyboard-2026-10-10/checks.json)分開作者／reviewer 結果及 v66／新候選版本，不把 jsdom 當真瀏覽器。
- **下一步及未驗：**文件附錄及 dot 最終裁決待完成；本候選尚未建立 PR、發布或部署。須在獲准的既有預覽按候選重驗實際鍵盤／四尺寸；目前沒有候選 browser、build、全倉、真 PDF bytes／下載／版面、pending 關閉／切孩子／撤權後晚到 race、讀屏實機或 Android 證據。本包沒有真模型、真家庭資料、GCP／資源／權限操作，不解鎖其他包。

以下報告回饋、同批跟進呈現及搜尋／準備單三節保留各包當時的交付快照。#173／#174／#177 已合併；上列 v66 browser 結果只記該時版本，目前預覽及本批候選以[當前入口](#active)為準，不據此推定 #174 或其他後端已部署。

## QA：報告導出視窗回饋（原碼驗收通過，預覽發布受阻）

2026-10-09 UTC，固定 master `c48b2eb41ee5f19c914ab6bee07b39d9cdd939a7`。既有合成公開預覽 v65 三次導出嘗試均未取得 PDF；可確定的 P2 缺陷是失敗只出現在背景頁底，導出視窗仍開着而沒有錯誤，焦點回到整頁。合成 transport 未支援下載，不把此結果判作正式 PDF endpoint 故障。

- 導出視窗在操作列上方呈現該次 pending／失敗／瀏覽器下載交接結果，失敗用 assertive live region。只於原下載控制仍持有焦點時，在禁用前移到同窗回饋區；結果返回不搶回已移走的焦點，關閉仍可操作。
- 回呼綁定本次導出意圖及原 scope／child／authority／精確 snapshot。關閉、換用途／選項／版本、切孩子、切頁籤及卸載令舊意圖失效；owner 在下載及錯誤／409 重讀回應前再核對，不只把舊訊息藏起來。保留原 single-flight／撤權守衛；實際下載交接及失敗都清理 object URL，沒有 PDF 不回報成功。導出 pending 只由視窗持有，不污染共享文件 notice，避免取消後頁底永久顯示「正在準備」。
- 真 GrowthArchive／AppDialog／Paper Button／RN Web Modal 的 6 項 React DOM 檢查、真 owner＋真 client API 的 15 項合成 HTTP 定向檢查、4 項既有導出／期間選擇檢查，以及 frontend typecheck 通過。[證據及限制](verification/export-dialog-feedback-2026-10-09/checks.json)保留修前元件紅、取消後晚回應紅、DOM harness 載入錯誤與舊測試缺 online 的修正；不以測試數量代表全量驗收。
- 獨立 review 補驗真 React hook／runtime／client API → modal 的 2 條合成路徑。覆核另以紅證確認取消後共享 notice 殘留 pending，最後只移除 owner 起始 pending notice；修後 2 項 owner 及同 2 項真 React 整合補驗通過，舊 15／6／4 項與 typecheck 沒有因這行刪除而全數重跑，兩段證據不混記。獨立程式／測試／文件覆核均無剩餘阻塞，dot 最終原碼驗收 Allow 精確 11 檔正常 PR 交付；程式已再次 freeze，尚未建立分支／PR、未發布／部署。既有 v65 可重建來源被拒且原 staging 不可用，沒有另路下載、改 fixture 或重建替代預覽。修後真瀏覽器、四尺寸／讀屏實機、實際 PDF bytes／版面／敏感來源遮蔽及跨孩子檔案隔離仍未驗；既有首屏、原紅及暫緩工作保持原狀。

## QA：取消工作與同批跟進事件（原碼驗收通過，預覽發布受阻）

2026-10-10 HKT，固定 master `6ef63e8a70db014a68a79baee7fab85fa2d836c8`。兩項工作合併同一背景事件時，取消的工作可能仍帶同批 completed；現行資料沒有逐成員 outcome／取消時間，不能猜先後或改寫真正已完成的歷史。

- `PersistentWorkCards` 對 cancelled 工作優先寫「此工作已取消，不再接續」，原結果為 cancelled 時列明「此工作關聯接續」，其餘列明「同批跟進事件」，避免把仍排隊同批內的失效 link 說成整批取消。只有文字呈現，不改台帳／DTO、日期、owner、控制或樣式。
- 取消先於另一工作完成、以及原事件先完成才取消，加上取消成員／仍排隊同批的投影，共三項真元件 React 靜態 render 反例通過；native controls 用替身，只證文字及輸入不變，並非真瀏覽器／responsive 驗收。frontend／Server typecheck 與根包4項核心／受影響檢查通過；review 後最後字串分支只重驗三個 render，未重跑核心，見[固定證據](../artifacts/verification/CHAT_FOLLOWUP_RECOVERY_20261010.json)。
- 原 API per-work 斷言紅保留，未把本 UI 修正說成 API 精確 outcome 已提供。獨立 review 無剩餘阻塞、dot 最終原碼驗收通過，准予精確11檔正常 PR 交付，尚未建立 PR；既有預覽可重建來源受阻，不繞路重建或發布，真瀏覽器補驗待來源恢復。#173 已合併，下列搜尋／準備單段保留當時的交付快照與發布阻塞。

## QA：搜尋名稱與準備單鍵盤焦點（原碼驗收通過，預覽發布受阻）

2026-10-09 UTC，固定基線 master `d3f924e7fbd2bbbf47204df584270a8f2802b8be`。既有合成公開預覽 v65 的 `/tasks`「搜尋已載入事項」與 `/care`「搜尋已保存記錄」缺穩定讀屏名稱；準備單第二項用 Space 勾選時，保存期間被純文字節點替換而失焦。

- 兩個搜尋 consumer 沿既有 `accessibilityLabel` 配方補名稱；不改共用元件、樣式、比例或搜尋回調。
- 只在原已可勾選的準備單項目提交後，於仍可讀且同文件的 pending 期間保留該 checkbox 並停用。原權限／版本／unknown 守衛不變；沒有自動聚焦，使用者移走焦點後不搶回。歸檔、失權及失效來源仍不能操作。
- 安裝版 Paper／RN Web 搜尋 DOM 的 2 項定向測試、準備單 React DOM 的焦點／拒重入／unknown／移焦／撤權核查及最後前端 typecheck 通過；新測試 harness 的初次錯誤及修正保留於[結果](verification/search-preparation-a11y-2026-10-09/checks.json)。DOM runner 明確使用外置既有 jsdom，不新增產品依賴。
- 獨立 review 無阻塞；另補 11 個最小 DOM 反例，來源失效／唯讀／離線、換文件及權威等均未留下可寫控制。dot 已准精確 8 檔正常 PR 交付，產品程式及測試 freeze 不變；尚未建立 PR。
- 既有 v65 可重建源包及原 publisher 的本地 staging／合成 adapter 均不可用，預覽發布及兩點真瀏覽器回歸受阻。未以倉庫合成 fixture 替代重建或聲稱相同 v65。原碼驗收與此發布阻塞分開；未部署、未重跑全量 Server、真模型、正式家庭資料或 Android。下列首屏工作保留原狀態，本包不替其結案。

## QA：孩子首屏與切換動效（開工快照，現批次見當前入口）

2026-10-07 UTC，基線 master 9d1024c。使用者回報尚未載好孩子便退出首屏，只有一個孩子也播放切換幕布。讀碼確認原 FirstScreenGate 只等 hydration／插畫，沒有業務資料 readiness；首次 fallback identity → child scope 被誤當切換。

- 首屏按當前登入身份／有效世代等待孩子與當頁必要 owner 資料，不發另一套讀取、不等待無關頁面。明確失敗或離線應揭示既有錯誤／重試，不能永久遮蓋；裝飾圖片的有界 fallback 不代表業務載入完成。
- 首次無孩子 → 第一個孩子不播放切換幕布；只有前後皆有效且不同孩子才播放。真正切換仍立即隔離舊孩子內容；失權、登出及失效回呼清理優先。正常後續刷新及導航不反覆封鎖全站。
- 載入文字的三點依序輕跳，只改 transform、不改布局或 readiness；無障礙文字固定、減少動態時靜態、卸載／取消清理動畫。
- 必驗慢讀、失敗／重試、0／1／多孩子、刷新、快速切換、身份切換／世代、reduced motion與卸載。定向測試、建置、獨立覆核及正式瀏覽器驗收分開記錄；目前未聲稱部署或全部通過。


## QA：待確認發現與待辦詳情收合（已部署，保留交付快照）

2026-10-07 UTC，基線 master a75ebb6。正式合成驗收發現 Care 刷新後把未成功初讀當成沒有候選；啟動時其他 domain 的短暫 busy 守衛阻止首次讀取，解除後沒有補讀。Chat 初次及新回覆的候選發現也須共用同一 owner。

- 合併一次待讀意圖，守衛解除或既有讀取結束後補讀，不輪詢、不繞過寫入／unknown／權限守衛。孩子、身份或授權失效清除過期意圖，舊回覆不得覆蓋新 scope。
- UI 區分未讀、讀取中、失敗、失權及成功空頁；只有成功空頁可說沒有待確認。Chat 活動標記由同一持久候選資料決定，關閉視窗不清除待確認事項。
- 獨立覆核補正：一般導航與深連結維持 idempotent open，只有列互動明確傳 toggle；排隊選取保留 intent。`src/client/use-online-updates.ts` 傳遞 changed／forced／unavailable，metadata 失敗不能觸發候選每 5 秒重試，真實改變、focus／manual 及新回覆仍可更新。擴大測試的 39/40 中唯一舊 dashboard preview-provider 斷言在原 master 同樣失敗，沒有弱化斷言，原失敗保留。
- 同包最小修正待辦列再次點按收起詳情，以及安排記錄本地收合；收合不重發歷史 API，保留草稿、pending／unknown 守衛及離線可關閉操作。
- 32 項 owner／定向呈現測試及 2 項 preview 選取補驗與 frontend typecheck 通過，原 fixture 欄位失敗保留；[證據](verification/pending-discovery-2026-10-07/checks.json)。未宣稱新建置、部署、正式 UI 或全量回歸完成；後續獨立覆核及批次部署後須用持久合成候選重測。
- 其他來源工作區 404／捨棄草稿修復及 Agent context／數量 grounding 由獨立工作包處理，不在此包混改。

### 已部署成果與未驗界線

PR #99～#104 已按各包證據合併；正式 Web 為 b7dec9d、API 為 a75ebb6（2026-10-07 06:06 UTC 觀察）。孩子刷新選擇、成長頁讀取、完成時間篩選、準備單刷新／歸檔及 PDF coverage 已用合成資料重測。Agent 普通記錄寫入及私人重要候選明確確認已讀回；最終回覆驗證、輸入容量及模型自行補數量仍有獨立缺口，不能稱全站驗收完畢。

下列 FE-W45 為歷史交付範圍；當時「未部署」不代表目前部署狀態。

## FE-W45：正式聊天頁閱讀版型

2026-10-06 UTC。基線 master `e3060e2afa723de59ef45d867ae81f6b284ad3b1`（[PR #98](https://github.com/2NTTY/child-ai-caregiver/pull/98) 已合併）。使用者要求參照 ChatGPT 軟件的對話介面，移走主區多餘說明及四塊管理卡；不重新設計 backend 或新增聊天契約。

### 既定範圍

- 對照 [ChatGPT 官方產品介面](https://chatgpt.com/overview/)：單一限寬訊息欄、右側使用者泡泡、左側助手正文、穩定底部輸入框；空狀態採本案簡潔置中提示，並非宣稱官方空白頁逐像素還原
- 工具列移出聊天時間線；移除常駐讀取數量／最後讀取時間／正常重讀／重複空白說明。只有真分頁可用時提供較早對話入口，不新增假歷史／新對話操作
- 待確認及背景運行放按需活動詳情；原決定／unknown 不因關閉面板消失。逐則回覆可打開原 run，必要待確認保持可發現
- 自動記錄授權及私人備註移到助手設定，仍由原 owner、共享確認及原請求處理；沒有自動授權或第二套儲存
- 保留離線、保存不確定、失敗重試／停止、引用、照片及模型使用同意。Google 處理及合成資料試用要求收短而不隱去必要含義

### 狀態與驗收

修改限定 `frontend/**`，呈現已完成：聊天時間線外的輕量工具、空頁置中提示、正常訊息上方起排、穩定 composer、按需活動及助手設定。左側「助手」只供讀屏，不恢復使用者已刪的常駐標題。原 run／pending owner、照片、來源及送出守衛不變。

8/8 定向 shallow 測試、frontend typecheck 及一次 production Web export（35 路由、同源 `/api`）通過，見[結果與限制](verification/clean-chat-layout-2026-10-06/checks.json)。source review 無已確認阻塞。hash 核對首次因執行目錄錯誤找不到檔案，回 repository root 後同一 manifest 通過；保留記錄，沒有因此改程式或斷言。

沒有瀏覽器／真 API／模型／原生驗收或正式部署。彈窗捲動及焦點返回、窄屏鍵盤／IME、真聊天歷史位置仍待正式使用檢查；shallow 與建置通過不代表這些已驗。此包以獨立 draft PR 交付，不自動合併；實際 GitHub 交付狀態以該修訂 PR 為準。

正式網站最後公開讀取仍為 `053658b` 對應 bundle；PR #98 已合併但未證明部署。本包網站部署及使用者要求的真實保存／讀回驗收仍需正式部署存取與專用驗收登入，不能由舊預覽替代；不在前端文件記錄帳號密碼。真模型／通知、正式家庭資料、永久刪除不由此呈現包自行擴大。

### 前一包

FE-W44 文案及待辦 readState／重試修訂已隨 PR #98 合併。50 項定向補驗與 typecheck 通過，首次 stale harness 失敗保留，見[固定結果](verification/production-copy-2026-10-06/checks.json)；沒有因此完成 browser／正式部署／全量回歸。本包不得重新標它為未合併。

<a id="evidence"></a>
### 可追溯的舊證據

以下檔案已取回，只支持檔案內記錄的版本和範圍，並非本次新整合驗收：

- [v40 合成畫面摘要](verification/next-release-2026-10-05T16-06Z-single-worker-recovery/browser-v40/verification-summary.md)
- [關注確認／撤銷／恢復的定向測試](verification/growth-confirm-restore-2026-10-05T18-59Z/checks.json)
- [時間線標記的定向檢查](verification/growth-timeline-2026-10-05T19-00Z/source-and-checks.json)
- [Owner／外殼生命週期檢查](verification/scope-shell-stability-2026-10-05T19-38Z/checks.json)：含原失敗及修訂後局部補驗；明示沒有新 browser／export 證據

未取回的最終 v44 QA／manifest 不能補寫成既有證據。來源 hash 不同的歷史結果保留其原限制；文件內的舊下一步及舊「當前」不構成新授權。

<a id="fe-w32-design-review"></a>
### 較早設計核查入口

FE-W32 的既有引用保留於此；較早發現見 [DESIGN_REVIEW](DESIGN_REVIEW.md)。當前呈現規則依 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，本次整合與驗收狀態依[當前包](#active)，歷史核查不等同此修訂通過。

