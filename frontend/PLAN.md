# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## 實驗分支二：Care Workspace（2026-10-25，未採納至 master）

本分支按使用者要求由 UI UX Pro Max 主導全站重構，解除舊視覺與資訊密度約束；功能、安全及權限不放寬。固定 base `0b9f5d6`，共同修復另記；技能固定來源、全路由功能對照與分層驗收見 [實驗說明](EXPERIMENT_UIUX_REBUILD.md)。目前程式及合成測試已建立，Web export／有序 browser 檢查與獨立 review 待完成；不自動合併或發布。下方既有記錄只作原分支歷史，不代表本實驗設計要求。

## 頁面專屬歷史與安靜讀取（2026-10-23；source36／artifactfix1 本地交付）

沿用 `dot/frontend-simplify-20261021`／[PR #253](https://github.com/2NTTY/child-ai-caregiver/pull/253)，本輪以 `5a39776f703bc436528b858f393621bcf8030b03` 為基底，PR 仍 draft／未合併；此為交付時已知狀態，未另查 CI。新版尚未更新公開站點；最後已記錄的公開版本仍為04:59:33.978 UTC的Site87／snapshot31（Sites source `b1fb6db5cd7820cd2183a732f866d8673973bb10`），不把本地結果當新公開驗收。

- **精確來源：**相對 source31 共89檔＝45產品＋44測試；頁面專屬歷史卡／閱讀彈窗、概況四區、記憶入口／本地分頁、確認作用域、唯讀關閉及安靜讀取。server訊息歷史完整性只交源碼，不代表後端部署。需求文件、avatar及附件增量不在本包。
- **安靜讀取：**同scope保留舊內容／控制／焦點；settled refresh_failed 保留已顯示的checkbox為disabled。identity／scope／撤權仍清除敏感資料，沒有放寬寫入或原確認guard。
- **來源到產物：**559inputs無漂移；417個實際輸出的第一方文字來源hash＋1PNG來源／registry／輸出鏈通過，Router只指本版。原36共享cache帶入35舊模組的artifact已撤回；artifactfix1隔離cache重新產出並核來源，不改產品。公開bundle僅移除唯一末尾map註解，逆轉及模組bytes均已核，maps不公開。
- **分層證據：**source36兩個必要scripts 30／30；32–35各版184／66／79／16不相加、不當36重跑。fresh安全validator與archive逐檔readback通過。10:38:21 UTC封存的36-artifactfix1 GUI只針對同owner503 settled、disabled原生pointer／Space／Enter及聚焦後再讀，結果PASS_BOUNDED；1023×600 iframe，不是全站／手機驗收。原錯誤提示增加高度與scroll有明列，不宣稱整頁零位移。
- **未過門檻：**完整TypeScript歷史兩環境exit137、原因未確診，仍未通過；CI未新查。自然OS app-switch、Android、完整讀屏／四尺寸、真API與全站回歸未完成。源碼／export／有界GUI不能抵銷這些界線。
- **交付：**[精簡工程收據與三張合成原圖](../docs/verification/frontend-2026-10-23/focus-layout-29/snapshot36-artifactfix1/README.md)列精確89path、artifact身份、分版本紅綠與公開摘要hash；本階段僅本地source及文件，遠端PR／公開預覽狀態另按實際交付記錄，未合併。只用合成資料，沒有真家庭資料、真模型、正式刪除、GCP或OTA。

下方是較早批次的完整歷史；其「當前／待交付」不代表本輪狀態，亦不重用舊 browser 或 Sites 證據作本候選通過。

## QA：七修補 v70 定向驗收與 Family 可見回焦收尾（原 20 檔，v71 已發布、有界 browser 已核、20檔待交付）

2026-10-11 UTC。固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`；最後獲提供的 GitHub 觀察為 07:18 UTC、open PR 0，不當持續即時狀態。本包仍為 10 產品＋7 測試＋原 3 文件共 20 檔。相對原 Settings freeze，只替換 FamilyView 及既有 Family test；另 15 份碼測逐 byte 不變。所有原 55 checks 整值、PLAN 及英文 PR 歷史與原紅保留，不新增權威或 GitHub 待辦文件。

- **已發布與分層：**既有公開合成預覽 v70 於 06:48:16 UTC 成功，Sites source `b928356275b81313eb629be85b5689cb56f23ec0`；Family 增量 v71 於 07:06:38 UTC 成功，source `cf9353c4a38cbf5bc560b65e920771c078576231`，同[預覽網址](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site)。各 68 份 copied-manifest 均精確對應各自凍結 preview，hosting／公開範圍不變，沒有重建才發布。這是合成 Sites 預覽，不是正式後端部署或 GitHub 合併。
- **v70 有界 browser：**06:49:08–07:01:22 UTC，dot 雲 Chrome/CDP、1188×761、HTML zoom 1.4。Settings 原 Up 缺口及 Down、Contact 唯讀投影、Sources 含 normal 自動 refresh 的恢復、Care 兩條原返回／取消路徑、Family 原 exact active target、Document 兩 kind 依次 required 語意及清錯，六組原目標通過。Family 取消後 connected disclosure／focus-visible／清草稿雖通，rect.top1531.40625 在 761 高視野外，另記可見性未通；缺取消前 scroll/container 量度，不推論頁首位置全鏈因果。Archive 原錯誤已見、唯一 retry 後 AX 兩次及 screenshot／最小 DOM 取證分別遇 DOMSnapshot、getLayoutMetrics、getFrameTree timeout，後態 UNKNOWN；不重按、不定性為產品／後端故障。Settings/Profile responsive 當時未開始，不寫七項全過。75 原觀察／49 call groups 不是測試數。
- **最小 Family 增量：**只刪接受取消的一次 focus 呼叫的 `preventScroll:true`，改為原生無參數 focus；原 callback、model identity／scope、draft、locked、ready、operation none 及 owner guard 全保留。既有 test 包裝真 DOM focus 只記 options 再 delegate，原 active 斷言不變；新增 options 同斷言 baseline 0/1→候選完整 3/3，原拒絕／scope runner 原樣由作者重跑 2/2，單產品 noEmit 374 roots／0 diagnostics。這些是合成測試，不能當 native scroll／可見焦點的 browser 證據，也不合計為五項新全域驗收。
- **新組合及 root 覆核：**479 source、17 碼測按新 freeze 不變；正式組合 tsc 一次及官方 clear／單 worker／1536 heap cap build 一次均 exit0，07:00:49–07:02:57 UTC，沒有 suite 或 build 重跑。35 routes／61 bare 共10085338 bytes；bundle `index-0ffc65b75eba0e4155b05bb3634799ed.js`，5159275 bytes，SHA256 `2a107ed8850ea7c9cbc8827c4cfcfeaeb490238d05a6cb0362dc240bf38a9ce1`。作者全圖涵蓋1981 modules／7183 ordered edges／1 null，1980 body bytes 同；唯一 FamilyView 1879→1876 只刪一處 focus argument 即 whole-body byte 相等。root 以 AST 自行取實際 body，按作者 bijection 逐 edge 獨立核實；首逐行 matcher 漏83 multiline、只取1898的失敗保留，改 AST 後嚴格斷言通，無產品變動／rebuild。35 HTML只換 bundle引用，preview其他32檔及七fixture／viewport／hosting相同；68 preview、36 HTML／353 refs、CSP／bootstrap皆保留。811／817原包identity記錄各按自身集合保留，不相加。
- **build inputs 與歷史：**新舊 build 的三份文件仍為原18檔階段 bytes，後寫20檔文件及v70/v71結果不倒填。歷史 exit137、有限重試、核對器及封裝失敗全部保留，不由新成功改成 OOM 已確診或撤去原紅。
- **v71 剩餘 browser 定向結果：**同1188×761取消邀請後，Family精確persistent trigger／connected／focus-visible，rect.top401.40625及height56完整位於視野，review／email已清；原scope acknowledgement保持0。Archive一次已見error→Enter retry後settled局部error及頁底旧notice同時消失，10版本／current5保留。Settings與Profile以原qa-viewport的真iframe各1440×900／390×900（zoom1.4／1.2）代表responsive通過，沒有橫向overflow。Profile切合成小晴時精確BUTTON仍focus-visible且可見、年齡5；picker Y相同但操作前scrollTop0，不證非零scroll補償或內部gate。已還原小明／1440、無草稿／dialog並關自建tab45；browser最後只見原tab37。60原觀察／34call groups保留（不是測試數）；四組剩餘定向結果不當全四尺寸／全鍵盤或全部七組在v71重跑。原矩陣85715bytes前綴完整保留，只append3818bytes至89533；原v70UNKNOWN不改。
- **目前門檻：**原碼、build、v70既有六組與v71剩餘有界結果分層採用；v71早段每次UTC未嵌原觀察，只界定07:06:38發布後至07:18:05關tab前，不補造capture time。由主對話覆核新版三文件／英文 PR／精確20檔patch，再按正常 PR 流程交付。按使用者 07:16 UTC 最新安排，本批收尾後由 Codex 接手，dot 不另開新修補；其餘未驗作交接。History返回heading焦點仍未驗明因果，不屬本七修補完成項；保留條件性診斷及既有browser矩陣，不另開修補。各層結果及未驗見[既有 checks 的兩項新增記錄](verification/loading-switch-readiness-2026-10-10/checks.json)。全四尺寸、完整鍵盤／query／BackForward、读屏、Android、真API／PDF、自然race、實測動畫幀／FPS與完整FE/P2仍未完成。

以下保留原20檔及更早階段全文；其「當前／未發布／待驗／下一步」只適用當時，由本節及兩項新checks更新現況，不回寫歷史。

## QA：Settings 鍵盤失焦與共用容器量度併入既有六修補（20檔本地候選，組合已核、交付末核待定）

2026-10-11 UTC，沿固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`，在原18檔未發布候選加入共用hook及定向測試，形成10產品＋7測試＋原3份前端文件共20檔。主對話提供03:15 UTC官方觀察：master仍此SHA、open PR 0，既有公開合成預覽仍v69／Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`；此為有時間點的觀察。本輪在新目錄準備，原18檔及更早正文、原紅與既有53個checks keys整值保留；只新增本輪兩項增量，不新增權威文件或純狀態PR。尚未PR／merge／簽憑證／發布，沒有本候選browser結果。

- **SK69-F01原v69有界觀察：**03:00–03:03 UTC，dot雲端Chrome/CDP、自建tab38、1188×761 CSS px、產品原HTML zoom1.4／visualViewport scale1。direct `/settings?section=preferences`，減少動畫真Space由off→on，AX／native INPUT checked及文字相符、焦點留switch；只驗當頁切換。真Shift+Tab先到panel、再到已selected應用偏好tab後，一次Up使家庭成員selected／tabIndex0、family panel可見及原preferences panel隱藏，URL仍section=preferences，符合local tab契約；但DOM activeElement=BODY、focus-visible空，AX focus=WebArea。首次產品失敗即停；沒有後續Tab／Down／Home／End及route→Back／Forward，不推論keyboard trap、全面WCAG違規或live精確根因。
- **原紅及清理界線：**06 AX才是原紅前selected tab的實際focus；07／08／09是同一次Up的即時／精確／settled證據，不是三tests。04到panel、05雖名arrow-up仍在panel且未切tab，原始資料保留為操作編排界線。10 AX＋4原JPEG＋7 DOM／inventory JSON是21 artifacts而非tests。只觀察script filename，未hash live bytes、未作browser network instrumentation，不宣稱全部POST／transport=0。失敗後以原控制返回偏好，Space恢復motion off並核AX／DOM／畫面，保留通知off與22:00／08:00、normal及兩QA展收收起，無草稿／保存／模型／訊息／照片／權限操作；tab38已關。新會話initial inventory與openTabs為空，舊18／19不可見且沒有存取，不能宣稱已核它們保留。
- **充分失敗機制及最小修補：**獨立DOM診斷用真SettingsNavigation／Paper5.15.3／RNWeb0.21.2／React19.2.3；固定vertical時原onChange→focus保留同一family node。合成workspace rect818.4／offset584跨720門檻，真RNWeb ResizeObserver→UIManager原setTimeout0的高度回報令原hook量度818.4→584→818.4、wide→compact→wide，原node卸載且焦點到BODY。這是source及browser相容的充分機制；browser未採workspace offset／rect對、observer時序或node identity，因果仍待縮窄。run01有固定分支綠與量度BODY trace，但reporter只file-level failure、缺after artifact且原因未核；run02以同identity的boolean表達及finally timer清理得到0/1原紅，原log不改、不相加。候選只在`useContainerWidth.ts`的Web onLayout讀當前mounted同ref rect.width，native保留event.nativeEvent.layout.width；保留prepaint／viewport fallback／正值guard／callback，無ref時不回退異單位、不添focus timer或改720／zoom／owner／導航。22個tsx／23個hook實例同node ref＋onLayout已源碼核對；Profile的rect一致才onLayoutReady契約亦支持保留原視覺量度，不能當全22頁browser通過。
- **定向原紅、綠及獨立邊界：**新`settings-container-width-focus-dom.test.cjs`對官方exact baseline同focus斷言0/1，候選3/3：固定vertical控制、高度回報後精確connected selected family焦點及same-node trace、真rect650→0→818.4時合法horizontal→保留horizontal→vertical。geometry／observer為明示環境ports，jsdom以直接focus建立browser已見switch→panel→tab路徑，沒有native Tab／Space預設；結構呈現替身、非完整Settings owner／route，network0只限離線harness。獨立review不重跑這3項，另native584／zero不讀DOM及卸載ref後late onLayout不讀／不dispatch各通過，原hook1/2（late dispatch2→3紅）、候選2/2（2→2），是真ReactDOM＋隔離Platform／dimensions及合成event，不當真native或加總全域5項。產品／測試已獨立Allow，hash分別`4ebaf3b5222d5907f40083347a9079208daccc0321cfa24afd1726e107d28c42`／`b39af32749e6ffe53f579aedeb0b0e9d72ef1cf8fa36b8f32f2e1778d45436c6`。單產品memory-overlay noEmit沿原tsconfig、TypeScript6.0.3、374roots／0diagnostics／exit0，與組合tsc分開。診斷materialization只多一個末尾newline，原bytes／hash留存；正式baseline採官方exact blob，provenance明示差別。
- **唯一組合build及保留：**479來源、17產品／測試freeze及原18最終3docs為固定build inputs，組合正式tsc一次exit0。本輪唯一官方clear／單workerbuild於03:16:18–03:18:24 UTC成功exit0，預先准許per-command `NODE_OPTIONS=--max-old-space-size=1536 CI=1 EXPO_DEBUG=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npm run build:web --workspace frontend -- --clear --max-workers 1 --output-dir ../../dist-settings-width-combined`。沒有重跑suite或第二build，cap成功不證明歷史137的根因；原18首失敗及有界恢復phase原樣保留。source前後及17檔freeze不變；build-time三docs是原18精確bytes，本輪後寫docs不倒填。35路由／61裸產物共10083846 bytes，bundle `index-7785c04bda18f8cc51d54bc0dc527ea6.js` 5157783 bytes，SHA256 `29d563fbb7100fb7e0af716a40a70f5c3292d14ff21abb28a40f9692c20f269e`；35HTML只換bundle引用，另25裸產物不變。原18組合664及delivery79項全自有regular／symlink identity共743記錄保留，symlink target不遍歷；原完整61build／68preview manifest亦核，不把重疊數加成另一總量。
- **完整圖／hook AST與本地preview已獨立Allow：**reviewer自行解析實際兩bundle，以3個有序runtime roots及有序edge雙射覆蓋全部1981模組／7183edges／原1個null slot，1980 body逐byte相同，唯一hook1678→1681；原六修補七個runtime module bodies全部保留。prelude／7個非root statements不變，root次序只沿mapping，沒有任意數字替換。Web callback精確匹配同ref prepaint量度並核constant-Web return-void lowering；只撤回該callback、按必要wrapper IDs／dependencies映射後，整module在21bindings／7個一致scope-bound rename下相等，未泛正規化numeric／string／property。首shape matcher及第二position matcher失敗的script／log／exit均保留；主對話只准一次精確undo後generate→reparse重建cloned AST位置，strict比較成功，屬核對器修正而非產品改動／build重試。68檔本地preview（67static＋原hosting）保留v69七份fixture／viewport／hosting bytes、原CSP含`connect-src 'none'`及bootstrap順序，36HTML／353本地引用有效，preview bundle同官方bare bytes；相對v69只換35HTML bundle引用及一bundle。獨立source／artifact／preview review Allow，核479source／17freeze及原18＋新2精確來源、61產物／25保留，另自採原包786記錄不變並核完整743 regular／symlink identity記錄；兩集合重疊不相加。沒有重跑build／tsc／產品suite或新browser。
- **門檻及下一步：**組合source／artifact／preview及完整圖／AST已Allow；接續完成本3文件／英文PR及20檔patch的獨立末核，由主對話按精確hash裁決。本文件不自批交付。七修補的候選真browser、live量度因果、剩餘Settings鍵盤及query／Back／Forward、完整讀屏／四尺寸／手勢／Android、Profile恢復及其他responsive代表頁、真API／自然race與前六修補原未驗全部保留；FE／P2未完成。證據在[既有checks的本輪兩項增量](verification/loading-switch-readiness-2026-10-10/checks.json)。

以下原18檔及更早PLAN正文逐字保留為歷史階段；其「當前／待末核／下一步」只適用當時，不將舊組合成功或原v69觀察改成這20檔的build、發布或修後browser通過。

## QA：封存文件 retry 純讀提示併入既有五修補（18檔本地候選，恢復產物已核、交付末核待定）

2026-10-11 UTC，沿固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`，在已獨立Allow、仍未發布的16檔候選加入文件owner及新測試，形成9產品＋6測試＋原3份前端文件共18檔。主對話於01:59:40 UTC官方核 master、open PR 0及既有公開合成預覽v69／Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`；只代表該時觀察。本輪另建組合及交付目錄，原16／11檔與更早source、產物、原紅及51個checks keys整值保留，不新增權威文件或GitHub待辦。未PR／merge／簽憑證／發布，原v69仍有下述原紅。

- **GA69-F01原v69有界觀察：**02:00–02:03 UTC，dot雲端Chrome/CDP、1180×757 CSS px、原HTML zoom 1.4／visualViewport scale 1。GA69-01在文件刷新失敗時保留兩份報告及原目前第5版，一次Enter重讀仍失敗，其後原Normal控制觸發自動refresh恢復；06 AX是處理中、07 AX／06 JPEG才是settled，不當cold error或獨立人工成功retry。GA69-02以可見一次文件讀取失敗後Enter「翻閱其他期間／版本」，首次archived GET失敗，局部error／retry及頁底純讀錯誤同現。Enter「重試載入歸檔報告」後局部error／retry消失、原十張版本卡及目前內容保留，頁底polite region仍顯「未能載入更多文件，已取得的內容保留。」。10 DOM、11 full AX及12原JPEG保留原紅，首次失敗即停批；12只把原紅捲入畫面，不另計測試。fixture成功封存回應為空終頁，不能當非空封存／所有分頁已驗。
- **最小owner修補：**只改`useFamilyDocuments.ts`（SHA256 `deb80ea83b7aa752be7aaa8319ba0620405fe3cd659d9ba93c9ac7a1adf99779`），將原catch字串命名，`loadMoreDocuments`在真API／strict parser返回、current及authority守衛通過、原page／listPages更新後，functional `setNotice`只清當下仍完全相等的純讀失敗提示。不在pending／HTTP尚未parse時清錯，不泛清較新／其他notice，不改operation、pending、原opId、dirty／epoch、草稿、資料合併、撤權或原finally。403／404 access-loss、authority mismatch、original／pending阻擋與unknown／conflict原收據回復保留；沒有更動API、parser、PDF、fixture、共用元件或新增產品依賴。
- **同斷言原紅與作者定向綠：**新`document-archive-read-notice.test.cjs`（SHA256 `c5d87b0ff5cd0bf92789f37983c7f797c7f61b192bf1e97de98b6626113f21ea`）使用真React owner、原task-knowledge runtime、QueryClient、FamilyDocumentsApi及strict parser，替身限environment／navigation write-guard ports及HTTP transport，Host不渲染GrowthArchive／FamilyReportControls。原碼於archiveReady=true、pageError=false、readState=ready後，相同空notice斷言0/1，失敗值就是殘留提示，不是harness起動失敗；原script不改後候選完整6/6、exit0。具名六test涵蓋成功空終頁retry只在settle後清錯且dirty／epoch／snapshot／operation不變、重複503、403與404各自撤權／拒後續、authority mismatch保留recheck提示，以及unknown／conflict原收據／門檻保留不自動重寫。最後一test含兩fixture，故6tests／7fixtures，原紅及首綠重疊不加為7tests；20合成GET、2合成失敗原POST只屬unknown／conflict設定、native fetch0，不宣稱全部POST0或真服務驗收。
- **獨立局部review與noEmit：**固定owner／測試已Allow；reviewer不重跑作者六test，另2/2真owner邊界分列：retry pending時真createDocument既有重複報告分支產生較新notice，成功retry保留它及原dirty／epoch／snapshot／operation；retry HTTP200卻帶active item於archived page時真parser拒絕，仍pageError、archiveReady=false並保留純讀提示。每項active GET1／archived GET2、POST0、native fetch0，不能把兩組相加當全race矩陣。單owner memory-overlay noEmit沿原frontend tsconfig及source paths，TypeScript6.0.3、374 roots、0 diagnostics、exit0；reviewer只核原腳本／log，未重跑，也不是新18檔組合build。
- **本輪首build失敗與有界恢復：**478來源／15產品與測試freeze的新組合正式`npm run typecheck`一次exit0。首個官方`--clear --max-workers 1` export於02:13:39–02:15:34 UTC執行，exit137且log末尾`Killed`，首次失敗即停；該phase有output目錄但0個檔案，不能交付bundle或借原16檔產物。原log SHA256 `3ef59a64271f98f0f8ed0bf943c983dea47c138c5bf3ba35a44bfd59b877a37a`及首失敗三docs／English PR快照凍結。之後主對話只准一次有界恢復：同官方clear／單worker命令僅加per-command `NODE_OPTIONS=--max-old-space-size=1536`，使用獨立attempt2 log／output，02:19:14–02:21:11 UTC exit0；共2次build啟動／1成功、tsc共1次，沒有第三次、重跑suite、改產品／config／依賴或終止其他工作。唯讀heap probe及cap恢復成功都不證明原137是OOM，原因仍未核實；原16成功与原11的137／唯一恢復仍是各自歷史phase。
- **組合來源、產物及完整圖：**478份來源前後records及15產品／測試freeze均符；build-time三docs是原16 delivery精確bytes，本輪後寫docs不倒填為build inputs。35路由／61裸產物共10085313 bytes，bundle `index-fa6f449b2d7f4fcee5c0d07e0453d92e.js`為5159250 bytes，SHA256 `6922407903058e7dc3484ff99567f320e5b3aeb33062807315b7e663aabc3aa1`。Metro再重排module次序／ID，以3個有序runtime roots覆蓋全部1981模組、7183有序edges及原同位置1個null slot，無未達／未驗模組；1980 module bodies逐byte相同，只有documents owner不同。原5修補的6個body不變，prelude／7個非entry statements相同，postlude只改3個映射entry IDs，不做任意數字替換。精確撤銷原字串constant／catch引用及success末尾functional清錯後，全owner AST在284個scope-bound bindings／82組一致rename下相同，不正規化其他literal或guard；35HTML只換bundle引用、另25裸產物相同。
- **本地preview、保留與獨立核對：**68檔本地preview（67靜態＋原hosting）沿v69七份fixture／viewport／hosting及原CSP／fixture prefix順序，`connect-src 'none'`不變，36HTML含viewport的353本地引用有效，preview bundle與attempt2 bare bytes相同；只改35HTML的bundle引用及替換一bundle。原9樹path-filtered snapshot的2134記錄不變，但排除.git／.expo／node_modules路徑包括bundled assets；另按原16／11既有完整61build＋68preview manifests核258記錄含dependency assets全同，兩數重疊不相加、不冒稱整樹完整。首輪保留核對器因既有preview manifest排序不同而拒，原script／log留存，只按path排序完整byte/hash記錄後通過，沒有改舊包。獨立review另從實際478來源、61產物、68preview核353引用、原七helper／CSP及其719份原freeze記錄，並自行AST解析實際bundle、ordered roots/edges遍歷及精確owner undo，核同1981／7183／1980及284bindings／82rename，已Allow精確source／artifact／preview／owner AST，未重跑build／tsc／suite。原3docs／English PR與整18檔patch末核及主對話裁決仍須按最終hash另存，本文件不預批該gate或發布／修後browser。
- **證據、未驗與下一步：**原browser有15 AX＋7原JPEG＋5 DOM／inventory JSON，共27份artifacts而非27tests；僅核script filename、未核live bytes及無browser network trace。可見fixture audit為original=null、mutationPostCount0、allPostCount4、blocked0／held0、faultOutcomes[503]，mutation屬限定document/photo類別，不把它說成全POST0。cleanup沿原完整重新讀取報告清掉提示，恢復目前第5版、normal／輸入空／controls收起、自建tab36關閉、18／19未動；這不代表原retry缺口已修。首次fail停止使較早修訂／chunk正文、不同版本／回目前、資料／來源展收及導出取消第三路徑未跑；沒有有效保存／刪除／導出POST、真PDF／模型／照片／訊息／家庭資料或權限變動。精確來源與分段結果在[既有checks本輪兩項增量](verification/loading-switch-readiness-2026-10-10/checks.json)；新組合／preview已獨立核；精確18檔文件／English PR末核後由主對話裁決。六修補修後真browser、實際polite提示／讀屏、完整鍵盤／四尺寸／手勢／Android、非空封存與所有版本／chunk、自然race／正式API／PDF bytes仍未驗；前五修補原未驗及FE／P2未完成狀態保留。

以下原16檔及更早PLAN正文逐字保留為歷史階段；其「當前／待末核／下一步」只適用當時，不將舊組合成功或原v69觀察改成這18檔的build、發布或修後browser通過。

## QA：Family 邀請取消回焦併入既有四修補（16檔本地候選，組合產物已核、交付末核待定）

2026-10-11 UTC，沿固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`，在原11檔候選加入Family的4產品及1測試，形成8產品＋5測試＋原3份前端文件共16檔。主對話於01:00:09 UTC官方核 master、open PR 0及既有公開合成預覽v69／Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`未變；只代表該時觀察。新組合及文件均在獨立目錄準備；原11／9檔候選、freeze、browser原紅及所有原checks值保留。未PR／merge／簽憑證／發布，不新增權威文件、純狀態PR或GitHub待辦。

- **Family原v69有界觀察：**01:01–01:03 UTC，dot雲端Chrome/CDP、直接`/family` 1180×757 CSS px、產品原HTML zoom 1.4／visualViewport scale 1。FR69-01中刷新失敗保留舊成員／孩子並明示非最新，停用管理／邀請、隱去成功空邀請提示；一次Enter人工重讀仍安全失敗，原「正常更新」觸發自動refresh後恢復。FR69-02中空邀請required／格式錯誤、更正清錯、具名input焦點與invalid／helper idref及摘要Enter均符合有界期望。FR69-03純本地邀請review未勾共享確認、最終操作仍disabled，Enter取消清review及電郵後activeElement=BODY、`:focus-visible`空，首次產品失敗即停批。只是焦點持續性可用性缺口；沒有測取消後Tab／Shift+Tab，不推論Tab重置、keyboard trap或WCAG違規，也不把normal自動refresh說成人工獨立恢復。
- **最小Family修補與契約界線：**只改FamilyView、FamilyActions型別及production／preview owner。`cancel(onCancelled?)`僅在原guard接納本地清理、呼叫原state更新後同步通知；不是Server／wire成功或非同步取消收據。production原pending／busy及clearDraft／formKey，preview原locked／reset／草稿清理及不改formKey／原composer文字的語義均保留。caller只為本人invite取消記當時scope／model，等首個不同projection立即consume；同scope、draft空、unlocked、ready、operation none且仍owner才preventScroll回既有邀請展收trigger，scope變更清意圖。非invite仍沿原cancel路徑；無timer、microtask、第二owner、DOM查找、共用Button或額外form reset。只看draft／formKey不能證明被guard接納，且preview原本不增formKey；該方案只作讀碼取捨，沒有虛構失敗候選或額外run。
- **Family定向原碼與獨立review：**真FamilyView／InviteComposer／DraftReview、production owner／SettingsDomainSupport、Paper／RNWeb／RHF，合成API／environment及有界外殼替身，memo owner以useLayoutEffect發布。原connected、非BODY、屬目前UI的同一assert修前0/1、修後1/1；另真production busy拒cancel且callback=0／draft及formKey保留、恢復不搶焦，真preview callback=1／原formKey0與文字保留兩case通過。定稿`family-cancel-focus-dom.test.cjs`完整3/3、exit0，hash `5b2a0c0a7c2f9a802696c3dcd519491af61b1eacc6dad03cdf8cdcead9702280`；分段1及2不加總為6。獨立review另以真FamilyView及受控model/actions核拒絕無callback／無render後稍後清理不搶焦、成功callback後A→B loading→A不復活，兩項2/2且trigger focus events=0；首輪同2case的sentinel act警告保留，僅harness包act後再2/2。作者／reviewer fetch/write均0，只限合成DOM；兩組不合成完整race矩陣。精確4產品＋1測試已Allow，無新增產品依賴，外置既有JSDOM_MODULE仍需明確提供，不聲稱clean-CI自足。
- **Typecheck與新組合：**Family四產品memory-overlay noEmit使用原frontend tsconfig、TypeScript 6.0.3，374 root files、0 diagnostics、exit0；與本次正式組合tsc分列。新組合一次正式`npm run typecheck`及唯一獲准官方`--clear --max-workers 1` export均exit0，build於01:15:50–01:17:53 UTC執行，沒有重試或重跑source suite。477份source前後及13產品／測試freeze吻合，原14樹path-filtered snapshot所列4281檔不變（排除.git／.expo／node_modules路徑，包括bundled assets）；35路由／61裸產物共10083780 bytes，新bundle `index-c113265fface6732219c5197804db9b4.js`為5157717 bytes，SHA256 `8fa17ca326a83a45f67f655526c9fdf39b6816d91a7f489aa94bb8e3a17b24eb`。本次新3文件另行更新，build source保留原11檔階段3文件，不冒稱新文件已在建置來源內。原11檔phase的首build137／Killed（0產物、原因未定）及唯一獲准恢復exit0、共2次啟動／1成功，仍按原476-source階段保存，不將舊bundle或counts當新16檔結果。
- **新bundle／本地preview與核對器界線：**本輪Metro全bundle module次序／ID重排，不能沿舊逐line相等說法。從3個有序runtime entry建立1981模組一對一完整graph映射，7183條ordered edges及原同位置1個null slot吻合，無未達／未驗module；1979個module body逐byte相同，只有Family production owner及FamilyView兩body不同。精確撤回callback／ref／scope-reset／一次新projection guards／cancel接線後，各121個scope-bound bindings全文AST相同，owner無rename、view10組一致rename；原Sources／Contact／Care／ARIA四body仍逐byte相同。35HTML只換bundle引用、另25裸產物相同。初scanner錯排bundled node_modules assets算42檔、固定line假設失敗、首次graph拒原null，以及其後一次缺抽取輸入的ENOENT均留原script／log；只修核對器，沒有改source／config／dependency、重build或重跑suite。68檔本地preview沿原v69七份fixture／viewport／hosting及CSP prefix，`connect-src 'none'`不變，67靜態檔＋hosting、36HTML含viewport的353本地引用有效，preview bundle等於成功bare bytes。獨立review另讀實際source／bundle／preview，以自己的AST graph遍歷核同1981／7183／1979及兩Family exact undo，477來源／13freeze、61裸產物、68preview、353引用均通過，沒有重跑build／tsc／suite。該4281檔snapshot不能稱完整整樹；已另按原11／9／7各61build＋68preview既有fullmanifest核387記錄含dependency assets全同。文件／英文PR末核及整16檔裁決另存，沒有把本地包當成已發布或修後browser。
- **原證據、保留與下一步：**Family browser保留15 AX＋6原JPEG＋6 DOM／inventory JSON共27份artifacts，不是27項tests；只核script filename，無live-byte hash／network instrumentation，不聲稱browser POST=0。取消後清空本地表單、normal、QA／邀請展收收起，自建tab35關閉，原18／19未動；原報告clearDraft／cancel定位行號已於修補報告補正，原紅本身不改。本次16檔獨立artifact及文件／英文PR末核由reviewer另存固定報告，主對話據精確交付hash裁決；本文件不預填整16檔Allow；[既有checks新增Family及16檔階段](verification/loading-switch-readiness-2026-10-10/checks.json)保存精確hash與分段結果。五修補均未做修後真browser，Family可見focus框／原生Tab、其他尺寸／200%／讀屏／Android／跨瀏覽器、cold error／manual-only成功恢復、真空／唯讀／失效邀請、incoming／dirty導航及完整pending／unknown／scope races、正式API仍未驗；其餘四修補門檻及FE／P2未完成狀態不變。

以下原11檔及更早PLAN正文逐字保留為歷史階段；其「當前／下一步／待末核」只適用當時，原137與唯一恢復成功亦只屬11檔phase，不代表本次16檔已建置／發布或修後browser通過。


## QA：Care 返回焦點併入來源、文件錯誤關聯及聯絡唯讀修補（11檔本地候選，組合產物已核、修後瀏覽器待驗）

2026-10-11 UTC，沿固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6` 及原九檔候選加入 Care workspace／定向測試兩檔，合共8檔程式／測試與原3份前端文件。主對話於00:30:29 UTC再次官方重核 master、open PR 0、既有公開合成預覽v69及 Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c` 未變；這是該時觀察，不是持續即時狀態。全新候選與文件在獨立目錄準備，未PR／merge／簽憑證／發布，不另開純狀態PR或GitHub待辦。原九檔delivery／combined及更早freeze保持不變。

- **CF69-01／02原v69觀察：**約00:01–00:07 UTC，dot雲端Chrome/CDP在直接1180×757及既有390×900產品iframe，Enter內層「返回記錄」或取消空草稿後，原控制項卸載而沒有接手的active UI target；相應唯讀DOM為BODY，390乾淨空草稿取消更直接見`:focus-visible`空及原JPEG沒有活躍控制項焦點框。外層關閉control明確回`care-review-list`。不經任何locator移焦的原生Tab仍到本區「手動新增共享記錄」，Shift+Tab到「待確認0」tabpanel，桌面外層control接續亦相同。因此裁定有限焦點持續性可用性缺口，沒有宣稱Tab從頁首重來、keyboard trap或WCAG違規。invalid空草稿只實測下一Tab；乾淨空草稿另測Shift+Tab，390外層沒有另驗Shift+Tab，不能互相代填。
- **最小修補與隔離：**只改`CareReviewHistoryView.tsx`，SHA256 `3af9c39be2d86509dcec5f93ac27b3a7b424d588639a5fec926dad2fccc3dd03`。本人內層返回／取消仍走原`!locked`、owner closePanel及recordOpen關閉，另記一次當時model引用與scopeKey。仍是舊projection時不消耗；首個不同owner projection立即consume，只在同scope、detail／draft／deletion全空且operation=none時沿既有list／仍開selected panel的ref及preventScroll回焦，否則drop；scope／入口reset清意圖。保留selected capture、owner API／attempt拒絕／generation／權限守衛，不新增owner、timer、microtask、stale element、Modal或共用Button改動。model identity是既有同步owner／layout-publish契約的局部銜接，不宣稱泛用非同步關閉收據。
- **原DOM紅與版本保留：**真CarePage路由composition、CareReviewWorkspace／Detail／Form及Paper／RNWeb DOM，合成owner／route ports與有界外殼替身。detail及空draft的原connected、非BODY且屬目前UI斷言各0/1，沒有硬指定exact inner target或模擬Tab；原外層control已綠。首次viewport未設的harness錯誤保留，其後只補1180×757取得產品紅。較早兩行候選只在同步owner happy path通過；epoch候選被獨立memo＋useLayoutEffect publish反例證實detail仍BODY、0/1，原碼`f2fe49c3603cb6e035201c90df3821d946f479f591167b5a2a43d9309e4f4a77`及各phase完整保留，不改成通過。
- **identity階段已驗與局部review：**作者原detail／draft同斷言各1/1，另4個case為首個occupied／saving投影後不晚搶焦、全空saved不冒充close及其後none不搶焦、原地scope更換丟棄、capture草稿取消回同selected panel一次。前三安全反例新增programmatic focus=0，capture=1且preventScroll=true；fetch／submission計數0。初guard pending run01的act警告與原script／log保留，僅測試移焦包回act後run02通過，產品未變。獨立review另以layout-publish staging核detail／draft各1/1、synthetic fetch/write=0，只是owner發布時序類比，沒有跑真production owner／API或native Tab。作者6case與reviewer2case分列，不加總為8種獨立涵蓋。獨立局部程式Allow及原九檔兩處18路徑／原紅5份hash保留已核。另單檔memory-overlay noEmit有374 root files、0 diagnostics、exit0；這不是正式組合tsc或build。
- **canonical單檔測試：**新`frontend/scripts/care-return-focus-dom.test.cjs`採memoized owner＋layout-publish staging，唯一完整run六case全通過、exit0、fetch/write=0，精確hash `47a2c7549d9f33ebcb2698c4a22d7afec614b035c70d37fc040393f500619323`。六case為detail／draft各含原外層control及上述四guards，與較早作者6及reviewer2功能重疊，不能相加；reviewer讀碼及log覆核Allow，沒有重跑。source root改為repository-relative預設／可選`CARE_FOCUS_SOURCE`，既有外部DOM runtime由`JSDOM_MODULE`明確提供，沒有新產品依賴，也不宣稱clean-CI自足。原九檔ARIA／Contact／Sources測試、build／preview依舊按下節保存，沒有重跑或新增計數。
- **組合首輪build失敗：**正式組合frontend `tsc --noEmit` exit0；00:24:52 UTC開始的首個官方`--clear` export以137退出、log末尾`Killed`，首次失敗即停。該次獨立覆核dist有0個檔案，沒有可交付bundle／AST比較或新preview，沒有借原九檔bundle當新產物。476份source與8檔freeze前後相符，原10樹3815檔hash／大小保留。exit137只證明被終止，沒有確證kernel原因前不標OOM。原log SHA256 `99d5fa2fe2c4e40b332e4adbc59e003e614b757db9a5c1624136a7a497288ad0`完整保存；失敗phase文件及log保持原樣，不以後述恢復結果改寫。
- **獲准的一次恢復build：**核實現行Expo官方CLI支持`--max-workers 1`後，主對話於00:28:02 UTC准一次相同`--clear`、單worker及獨立log／output的attempt2，實際exit0。共2次build啟動、1次成功；正式tsc共1次，沒有重跑任何source suite、改source／config／dependency／minify或kill其他程序。476來源／8檔freeze及原10樹3815檔仍符；35路由／61裸產物，新bundle `index-2f35bfade15f2f72c995e1dcc7616398.js`（5158776 bytes、SHA256 `7b20e4e9a9df922edfb90e7a451af9e11f5a33c048186c7c85917c90c0f4ebfd`）。相對原九檔2603行bundle只改Care第2145行，其餘2602行含Sources2105／Contact2135／ARIA2193逐byte相同；35HTML只換bundle引用、其他25產物相同。Care module精確撤銷新增ref、scope reset、首次新projection／同scope／面板全空／operation-none守衛、model依賴與close request後，115個scope-bound bindings正規化全文相同，27組一致minifier更名，無其他syntax／literal變動。build時source內仍是原九檔的3份文件；本次新3文件另行更新，不冒稱它們在build前已存在。
- **新本地preview與產物界線：**68檔（67靜態＋原hosting）沿官方v69原CSP／fixture prefix及7份fixture／viewport／hosting bytes，`connect-src 'none'`不變；35份產品HTML、連原viewport共36HTML、353本地引用（352靜態檔引用＋1 iframe根導航）有效，preview bundle與成功bare bytes相同。相較v69只換35HTML bundle引用及單一bundle，沒有新fixture行為／權限／正式資料。原九檔／更早來源、freeze、失敗及本輪首build失敗仍保留；preservation報告曾復用路徑，首失敗bytes核SHA後精確復原，成功紀錄另名保存，沒有改凍結phase或多跑build。獨立覆核另算476source／61bare／68preview、115bindings／27rename及353引用均符，Allow精確產品與本地產物；沒有重build／tsc／suite，不把本地preview當成已發布或修後browser。
- **證據與下一步：**本輪原v69保存39份AX、4張原JPEG、8份DOM JSON及2份inventory，共53份browser artifacts，不是53項tests；同一自建tab34已關，原18／19未動，空草稿／詳情／錯誤已清，fixture一直normal／控制收起。只觀察原script filename，沒有live byte hash或browser network instrumentation，不宣稱POST／mutation為0。精確版本／失敗／分段結果見[既有checks的新Care及11檔記錄](verification/loading-switch-readiness-2026-10-10/checks.json)。恢復build及本地AST／preview已核，待文件／英文PR末核後由主對話裁決，不將build當作修後browser通過；修後四修補browser、可見focus框、讀屏、完整四尺寸／Tab次序、Android、其他瀏覽器、完整scope／pending／unknown race、Contact grant／ack、account／denied恢復及正式API均未解除待驗，FE／P2仍未全數完成。

以下原九檔及更早正文逐字保留為歷史階段；其「當前／下一步／待末核」僅指當時，不代表本次11檔已驗／交付。既有失敗、未發布版本、讀屏及完整FE／P2門檻不由新記錄覆蓋。

## QA：來源讀取恢復、文件錯誤關聯與聯絡唯讀鎖（9檔候選已核，修後瀏覽器待驗）

2026-10-10 UTC，固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`，前批R01／名稱7檔已隨 [#188](https://github.com/2NTTY/child-ai-caregiver/pull/188) 合併。既有公開合成預覽仍v69，Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`。本次在已核、未發布的Contact＋ARIA七檔候選上，加來源owner／test兩檔，共6檔程式／測試及原3份前端文件；另目錄準備單一英文PR，不另開純狀態PR或GitHub待辦文件。原七檔整樹、原ARIA五檔及全部原紅／freeze封存不動。

- **SD69-F01原紅：**21:31–21:34 UTC，dot雲端Chrome/CDP、1180×757的/sources，未選既有來源，只填合成原文與用途本地草稿。可見「刷新失敗」後，欄位鎖住、草稿保留；持續失敗下原「重新讀取來源」仍報錯。按既有「正常更新」觸發自動refresh成功後，清單2項及編輯能力已恢復，卻仍顯示「這次來源操作／讀取未能確認…請手動重新讀取」，原retry消失。首次新產品失敗即停，未有效保存、intake、模型、取得URL正文、分享或刪除。
- **根因與最小修補：**`usePhotoInputSources`的phase=null讀取catch寫入notice，成功refresh只更新load=ready，View遂把舊read-error當操作banner重顯。只把該既有字串抽為常數，並於當前scope整次refresh完成、包含所選item及pending處理之後，嚴格匹配這一notice才清空。不在讀取開始或list先成功時清除，也不重置operation、pending/direct、receipt/opId、conflict、confirmed_unavailable、404／撤權或其他notice、草稿／formKey與權限。
- **定向原碼證據：**真React source owner、QueryClient、SharedInputApi／online transport／parser的同一原斷言修前0/1、候選8/8及frontend typecheck exit0；環境／導航／native Platform為替身，未渲染SourcesView。其餘必要邊界包含持續失敗、人工／管理草稿及formKey、完整item才清、404保留與當前403清理、unknown收據不重送、direct未知／conflict及舊身份晚200/403。全套49 GET及2個明確合成POST（context＋原submit），native fetch=0。獨立review無阻塞，只重跑原紅同assert1/1，3 inputs GET／native0；未重跑其他7項、不合計為9項。
- **原v69其他有界觀察：**空白來源原文驗證、error-summary焦點及真DOM invalid／描述關聯通過；兩份草稿下，今日導航guard的Escape／繼續編輯均留原頁、保留草稿並回原link焦點。沒有確認捨棄／Back/Forward／reload／孩子切換驗收。18 AX、9次截圖及17 DOM／inventory JSON是44份證據，不是44項測試。可見fixture的mutationPostCount=0限其列明類別，allPostCount=5，不聲稱全部POST=0或network trace；normal控制本身發refresh，不能算隔離的手動成功恢復。清理沿原「清除草稿並新增來源」，兩欄空、normal、控制收起、tab29關閉，原18/19保留；清理不是修後通過。
- **6檔組合產物：**在新隔離source組合，frontend typecheck及唯一一次官方clear export均exit0，475份source前後hash及6freeze吻合，35靜態路由／61產物。新bundle `index-0782dbe3bc0a89c89528d3360daf409d.js`，SHA256 `3c5c9e8ecf0519f65616bc90761c9645af87e7827854fc05f45df8fb5552c4b0`。相較前Contact組合2603行bundle，只有source owner第2105行不同，其餘2602行含原Contact2135／ARIA2193逐byte保留。精確撤回常數、catch替換及refresh末尾notice清理後，194個scope-bound bindings正規化相同，53組一致minifier更名；沒有其他語法／literal變動。
- **本地預覽與獨立核對：**35 HTML只更新bundle引用、另25bare產物相同；68檔本地preview沿原v69 CSP／fixture／hosting，353本地引用（352檔案＋1 iframe根導航）皆有效。獨立覆核重算475來源、61產物、68preview及舊七檔整樹hash，Allow；未重建、typecheck或重跑source套。初shell的cwd重定向錯誤在npm前；作者首次literal matcher誤以為bundle不是unicode escapes、reviewer首次iframe路徑／353計數分類錯誤均保留，只修核對器，未改產品或重建。
- **保留與下一步：**Contact只讀鎖及文件title ARIA兩props的原碼／DOM、原paired-focus紅與後續RHF timer診斷、原v69兩kind六次Return回焦、前七檔及前五檔產物均保留於下節，未重跑或重標。原3文件同批更新，正在文件／英文PR末核與主對話裁決，未PR／發布，三修補的修後browser仍待驗。v69 script filename只作DOM觀察，不是live byte hash或獨立commit mapping；四尺寸／讀屏／Android／FPS、unknown自然競態及正式服務未因此通過，FE／P2仍未全數完成。

精確分段證據及hash見[原驗證文件的新增來源恢復／九檔組合記錄](verification/loading-switch-readiness-2026-10-10/checks.json)。以下七檔階段完整保留為歷史快照；其中「當前／待末核／下一步」只適用當時，最新批次以上節為準。


## QA：文件錯誤關聯與聯絡唯讀鎖（7檔組合已核，修後瀏覽器待驗）

2026-10-10 UTC，固定 master `d96e34bef19d34911ce3bcc285e0b1c3d21935d6`，前一批7檔已隨 [#188](https://github.com/2NTTY/child-ai-caregiver/pull/188) 合併。既有公開合成預覽仍為v69、Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`；本次新候選尚未發布或建立PR。本包將原文件caller／test與本次聯絡owner／test合成4檔程式／測試，加原3份文件共7檔；不另開小PR、純狀態PR或新增GitHub待辦文件。原5檔f855交付候選及更早freeze仍保留。

- **原紅與根因：**19:08 UTC兩kind真元件DOM均確認title沒有持續錯誤idref／invalid狀態。19:08–19:09原v69、dot雲端Chrome/CDP、1180×757的準備單手動建立表單亦重現：只勾合成確認、保持title與日期空白並按一次原建立控制，title可見required helper但input未關聯。原 `role=alert`／`aria-live=assertive` 摘要已有完整錯誤，不說成錯誤完全未暴露；browser未測growth-report或真讀屏播報。
- **最小修正：**只在 `DocumentCreateForm` title AppTextField傳 `aria-invalid={!!errors.title}` 與conditional `aria-describedby`，引用原 `${id}-title-error`。保留既有名稱、ref、Paper error、RHF規則、原字串、確認、owner及提交；不改共用ui、fixture、後端、依賴或權限。
- **定向原碼證據：**同一新增test修前0/2、候選2/2，frontend typecheck exit0。兩kind涵蓋initial、required、length、更正清錯、owner epoch reset，以及同時掛載instance ID隔離／peer不污染；真live summary語義仍在，network／create calls皆0。真React／RHF／Paper／RNWeb與bounded非title controls／owner替身，jsdom沿外置既有依賴，並非clean CI自足或完整表單提交。獨立review Allow；另只將原paired錯誤關聯紅例改source／證據IO後得exit0，未重跑作者2項，不合計為新增測試。
- **原focus紅例與後續診斷：**原extended paired-focus expectation在baseline與candidate均0/2，當時在摘要click後立即觀察，activeElement仍留另一form；原runner／logs、identity斷言及五行scope split全部保留，不改判原結果。19:34獨立有界診斷核實實際RHF 7.88 `setFocus` 另外用 `setTimeout` 執行，原runner只在submit後排timer，沒有等摘要新排的timer。真ref事件鏈為本form setFocus→RHF代理→Paper root→正確RNWeb host input；基線paired兩方向、候選paired兩方向及候選兩kind單表單先移焦後再按摘要，均在實際timer完成後符合原精確identity期望，network／create皆0。六次DOM觀察的after-act有兩次已轉焦、四次尚未轉，after-timer皆正確，證明原檢查時序不穩定；不需要改產品。舊單表單suite沒有先移焦，故其原通過不擴為真正轉移證明；原suite／測試及freeze一字不改、不重跑，不把新增診斷與舊case數量加總。
- **原v69摘要鍵盤回焦：**19:32:18–19:33:51 UTC、dot雲端Chrome在既有v69，先後開Summary準備單及Growth成長報告的手動備援；各自空值驗證後先移焦到可選使用日期，再以Return啟動3個錯誤摘要按鈕，title／from／to共6次均回正確具名input。這是兩種單表單先後驗證，不是同時掛載兩form，也不是未發布ARIA候選的修後驗收；initial first-error focus只算前置。AX／唯讀DOM實際輸出節錄於清理後保存，無PNG，不作視覺／真讀屏證據；只核載入script名稱，未讀live bytes／獨立對應commit。兩份草稿沿原控制明確放棄，errors清除、確認0及submit disabled；自建tab25於19:34:12關閉。沒有有效提交、模型、生成文件或真家庭資料；沒有network instrumentation，不宣稱transport請求數為0。
- **ARIA階段建置與預覽包（保留）：**作者唯一一次官方 `--clear` export exit0，35路由／61產物；新bundle `index-5cb2bd29be31a080c47061fa94fd7dcb.js`、SHA256 `9428907d068f2c32dee062e2e1cb7f06ae6af91d21011f4afecd888cecb1bcae`。473份source前後及兩檔freeze不變；相對v69的2603行bundle只改DocumentCreateForm一個module，其餘2602行含換行bytes相同。scope-bound AST正規化後只有兩props語意增量，保留minifier local rename的界線；35HTML只換bundle引用，另25產物相同。沿原v69 CSP／fixture／hosting前綴組合本地68檔包（67靜態＋1hosting），353本地資源引用及新bundle原bytes已核。作者未重跑suite／typecheck或新增fixture；獨立source／build／preview審查Allow，另核473source、61裸產物、68本地包及353引用，原label／ref／live alert／R01保留；沒有重跑原碼suite或build。修後browser未驗、未發布／PR，不以產物相符代替驗收；原紅及詳細hash見[固定證據增量](verification/loading-switch-readiness-2026-10-10/checks.json)。
- **Contact原v69唯讀反例：**約20:00 UTC在dot雲端Chrome、1180×757只核`/contact`讀取及本人同意收合。既有fixture固定`canManage:false`、無渠道／tasks／grants／requests、worker未啟用；空態明示只限已載資料。頁面雖提示唯讀，展開後「允許透過以下本人渠道接收一般任務提示」及「我確認保存以上本人接收及後備同意」兩checkbox仍可聚焦，AX未標disabled，唯讀DOM為aria-disabled缺省／tabindex=0；後備checkbox及未勾確認的Save停用。首次具體呈現反例後停批，沒有切checkbox、產生草稿或保存。Enter收起原disclosure後關閉自建tab26，模式未改；只核script名稱，無live byte／network計數／讀屏聲稱。
- **Contact最小修正與權限界線：**`useProductionContact`原本按`page.canManage`／viewer投影read_only，save三分支仍拒不可管理者；Server的本人同意、task grant及ack也共用owner／caregiver寫入角色，個人同意沒有viewer例外。問題僅returned `locked`漏了`state.access !== "editable" || !state.page?.canManage`，令consent、task及ack的既有caller以為可編輯。本次只補這兩條件，保留busy／offline／pending／load及全部save／scope／原收據守衛；不改後端權限或逐caller行為。這是只讀呈現修補，不是已證未授權寫入；view／refresh／disclosure仍可使用。
- **Contact定向證據：**同一185行DOM test原碼2/5通過、3/5失敗，候選5/5及frontend typecheck exit0。兩read_only原紅直接save的合成API寫入均0；其餘覆蓋manager鍵盤編輯／保存中鎖、busy／503／offline與依權限恢復、unknown原決定重讀仍鎖及明確原body retry。真owner／SettingsDomainSupport／QueryClient／RHF／Zod／AppCheckbox／RNWeb，API port為合成記憶體、motion／部分外觀／navigation為有界替身，global networkCalls=0；不是HTTP／opId／Server保存證據。獨立review Allow，僅重跑同一定稿的ready nonmanager原斷言0/1→1/1，未重跑作者其餘4項或typecheck，不加總為6項新驗收。owner全文按byte只有一次locked substitution，原EOF、其他產品及兩批freeze保持。
- **本批4檔組合建置與獨立覆核：**新目錄整合上述Contact2檔與凍結ARIA2檔，組合frontend typecheck及唯一一次官方`--clear` export exit0，35路由／61產物；新bundle `index-10723d08bc05177d65a0daa1f0787250.js`、SHA256 `eb330fee4ba685703b01528bffca4ee31154d8eef8ac25ba983bd4e2c65d0ff3`。474份source前後及4檔freeze相符；相對ARIA階段的2603行bundle只改Contact owner第2135行，其餘2602行含ARIA第2193行皆byte相同。先前「應為純字串插入」matcher因minifier局部rename失敗，原log／verifier保留；作者及獨立scope-bound AST核70bindings，9個一致rename以外只有2個鎖條件增量。35HTML只換bundle引用，另25裸產物不變。沿v69原CSP／fixture／hosting包成本地68檔、353引用；獨立核474來源、61裸產物、68包裝及原官方v69本地參考bytes，4檔與原候選freeze均符。沒有重跑兩套suite、改fixture、重build、PR或發布；產物相符不是修後browser通過。
- **下一步與界線：**新7檔原碼及組合產物已獲有界獨立覆核；原3文件及英文PR正文末核、必要修後browser後，按主對話裁決同批交付，現仍未PR／發布。原paired-focus紅例及獨立RHF timer診斷、原v69兩kind摘要Return回焦證據保持。Contact目前只有只讀空fixture，task grant／ack／dirty取消未作browser驗證；首次失敗後未再跑手動refresh、error／normal或返回流程。mode控制會自動refresh，不能冒稱隔離手動恢復。兩kind錯誤關聯及Contact修後browser、完整四尺寸／讀屏／Android／真API、account／denied恢復及全FE／P2仍未完成。各原紅、清理、版本與固定hash見同一[證據增量](verification/loading-switch-readiness-2026-10-10/checks.json)。

## QA：恢復流程、檔案歷史重試與文件名稱（#188已合併，保留原交付快照）

下列「待PR／未交付」為前批當時快照；該7檔現已隨#188合併，不代表本次7檔候選已交付。

2026-10-10 UTC，固定 master `fddd32deaa04fea8db39553ea6b3e050769b6a5d`；前批34檔已隨 [#187](https://github.com/2NTTY/child-ai-caregiver/pull/187) 合併。18:02–18:09 UTC在原v68作有界恢復驗收，首次具體產品失敗R01後停批；其後獲准的18:31–18:35 Summary／Tasks有界驗收再確認文件名稱缺accessible name，納入既有未交付R01批。本次把必要修復、測試及原文件更新收束為同一交付，不另開純狀態PR。只改 `frontend/**`，不動後端、fixture、權限或真實資料。

- **R01 實際缺口：**已有未保存的基本資料草稿時，首次「查看較早版本」失敗，唯一歷史入口卻成為停用的「已顯示歷史」，歷史仍空。按「重新讀取檔案」保留草稿，但清掉錯誤提示而未恢復歷史重試。v68真瀏覽器用可見的一次歷史失敗控制及本地合成地區草稿重現；精確503／history GET計數另屬真owner與原fixture合成證據，並非瀏覽器network trace。未保存、分享或刪除，草稿已恢復原值。
- **最小修正：**`CareProfileDomains` 不在開始讀取時標記historyOpen，只在成功結果通過current／generation檢查後標記。首次失敗可沿原入口手動重試；成功空歷史仍是已讀，分頁保留已有列／cursor／hasMore。dirty草稿及formKey、single-flight、身份／孩子與讀取世代、當前scope的403撤權及finally清理保持，不改View、VM或API。
- **程式證據：**同一原斷言及v68 fixture，修前0/1、修後1/1；作者7/7及frontend typecheck exit0。獨立審查另加先3/3、其後只跑新增分頁1/1，包含連續失敗、成功空頁、dirty下分頁失敗後重讀目前檔案再同cursor重試、較新世代與舊身份／孩子晚結果；沒有重跑作者7項，也不把重疊功能加總。真React bridge／keyed owner／QueryClient／API parser／ProfileView條件搭配native、motion及form呈現替身，並非修後真瀏覽器。最初selector誤把刪除按鈕當retry的false green、真正原紅及修後結果均保留，見[固定證據增量](verification/loading-switch-readiness-2026-10-10/checks.json)。
- **其餘恢復觀察：**v68的Care開啟待辦側欄，失敗切孩子後仍遮住舊孩子內容；持續失敗時重試／返回不假成功，transport恢復後按原產品重讀，分別恢復上一位或目標孩子及原側欄。偏好錯誤時表單鎖住，失敗中重讀不假成功；「正常更新」先觸發自動refresh才恢復，不能稱隔離的手動恢復路徑已驗。一次真tab離開／回來未觸發account gate，帳戶錯誤／重試未驗成。合成失權只正向驗到孩子內容隔離，normal加重選未成立原地恢復；整頁reload只作fixture清理，既非恢復通過也未據此判永久鎖死。
- **版本與界線：**上述browser是未修R01的v68，Sites source `c5063f5ef7827d6856646da0888a311328973912`、1180×757；60份AX及26張PNG包含中途、原生瀏覽器框與cleanup，是86份證據，不是86項測試。R01階段只改owner兩行並新增1個定向測試檔；原34 freeze未改，該階段其餘33路徑同#187。既有載入／PDF／照片／家庭證據仍按各版本保存，本輪沒有重跑原31檔suite，也未宣稱帳戶timeout、逐域race、四尺寸／完整a11y、FPS、真PDF或正式服務通過。
- **R01階段建置（保留）：**唯一一次官方 `--clear` export exit0，35靜態路由／61產物；新bundle `index-3211a862defcda912280a4081336b162.js`，SHA256 `f0a71d6591cec7690c737d6b9bd53a306e5dee6646ee8e43b7b2dcb377263e34`。獨立覆核471份完整source manifest及35份既有／增量預期hash、61產物hash／大小均符；此35是原34路徑加新test的來源核對集合，不是本次35檔修改。新舊bundle的2603行只有1個owner module不同，全文只有上述開始／成功兩處預期替換，其餘2602行含換行bytes相同；35HTML只換bundle檔名，其他25產物及先前33份片段保留。最初保存參考的cwd錯誤及其後在build啟動後才採集完整參考的界線保留；產品兩檔另有build前freeze，舊61產物也符原manifest。沒有重跑測試／typecheck，沒有注入fixture或發布；產物相符不等於browser通過。
- **文件名稱無障礙缺口：**原v68的Summary「手動備援：直接整理準備單」是新文件草稿，不是修改既有準備單。可見「文件名稱」輸入欄沒有程式名稱；真browser AX及唯讀DOM確認缺aria-label／aria-labelledby／placeholder及label關聯，真DocumentCreateForm／AppTextField／Paper／RNWeb DOM亦重現原紅。修補限該caller傳入既有 `labels.title` 作accessibilityLabel，不全域改TextField，不改保存、確認、草稿或焦點契約；作者caller一行修正及1個測試檔已freeze；同一原DOM斷言1紅→1綠，兩種文件kind的2/2定向通過，涵蓋可見名稱、既有required／長度HelperText、原error-summary ref聚焦、原樣草稿及readOnly；合成network／create皆0。獨立code/test review Allow，reviewer只另重跑原斷言修後1項通過，作者兩kind的2項依原碼及log核對未重跑，不相加為新3項。名稱來源檢查不是完整AccName engine或讀屏驗收。原aria-invalid缺失的新增斷言失敗已單列未收束；沒有把移除該超出名稱範圍的期望算作錯誤語意通過，error關聯亦未驗。另保留dependency、input selector及Paper disabled映射RNWeb readOnly的harness修正證據，無全局元件改動。
- **Summary／Tasks有界樣本：**1180×757原v68共4流程：Summary準備單行→inline詳情→返回原行；Tasks空原因回饋／原因焦點、只在本地預覽及明確丟棄草稿；日期modal首尾Tab／Escape／Cancel與返回trigger；Summary dirty tab guard的Escape／繼續編輯保留草稿及返回trigger，明確丟棄後可乾淨換tab。準備單詳情是inline，Escape不關閉符合已讀契約；沒有既有文件編輯入口，不把手動建立備援當已驗編輯。Tasks繼續修改及Summary丟棄按鈕卸載後焦點到WebArea僅記觀察，未找到明確契約，既不升格已確認缺陷也不算焦點通過。39AX／11PNG／1DOM JSON是51份證據，不是51項測試；沒有保存、建立文件、改期、套用日期、模型或真資料操作。
- **7檔組合建置：**4檔程式／測試精確合成後，frontend typecheck及唯一一次官方 `--clear` build exit0，35靜態路由／61產物；新bundle `index-15ea99b9d58dbaff55bb7273d070946a.js`，SHA256 `737cdd1a8ebb01b73ecc45ba4663cd59367f997ef44e4d5c1211376264fafb8d`。獨立核472份source前後hash及4檔freeze、61產物hash／大小；相對R01的2603行bundle只有DocumentCreateForm一行module改動，其餘2602行含換行bytes相同，R01 owner全文保留。新增label之外，minifier交換兩個local的宣告及各自唯一bound use；以scope-bound AST正規化核對僅label有語意差異，沒有把首次「應純插入、無rename」matcher失敗抹去或放寬產品行為。35HTML只換bundle引用，另25產物不變。沒有重跑R01／前34／title兩項suite，也未注入fixture或發布；先前R01 build及所有原紅封存。
- **發布前本地預覽包（保留）：**另以既有v68的CSP／fixture原前綴包裝，新bundle bytes不變；獨立核68檔（67靜態＋1hosting）、35HTML精確前綴、原QA／hosting bytes及353個本地靜態引用。這是發布前的本地包覆核，該階段沒有發布、修後browser、模型或fixture suite重跑；既有recovery合成寫入與5條GET相容分支仍分開，未增加寫入權限。
- **v69發布與兩項原紅重驗：**既有公開 [Sites預覽](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site) 於2026-10-10 18:50:59 UTC正常發布成功，Sites source `b47344b0a4b3f94a2322c1218f41c90255b3216c`，沿用上述737cdd組合bundle；這不是GitHub合併或正式後端部署。18:52–18:54 UTC在dot雲端Chrome/CDP、1180×757，只重驗兩項原紅：R01首次history失敗仍可重試，重讀目前檔案後dirty地區及入口保留，一次手動重試只見一份版本1，成功後才成為停用的「已顯示歷史」；準備單手動建立的空「文件名稱」在AX有名稱，DOM的aria-label亦為「文件名稱」。沒有填title或建立／保存文件。HTTP503及精確history GET次數仍只屬owner／fixture測試；一份可見版本不是分頁／並發證明，DOM只核載入script名，不當live bytes hash。25AX／4PNG／3JSON是32份證據，不是32項測試。地區還原後form dirty文字雖消失，原owner仍要求明確捨棄才離頁，已沿原控制清理；這只保留為cleanup觀察，不另判新缺陷。normal模式恢復、未輸入的title表單收起、所建tab23關閉。
- **下一步：**同一完整7檔（R01 owner／test、文件名稱caller／test及原3文件）的程式、組合產物及兩項定向真browser結果已齊，正準備單一英文PR，待文件／內文末核及主對話交付裁決。4檔程式／測試不再改動，原7檔發布前freeze、R01階段及v68反例保留；不另拆狀態PR，不預填PR號。v69只驗準備單空title，growth-report browser、aria-invalid／error關聯、完整讀屏／四尺寸／a11y、R01分頁與race、account／denied恢復、待定inline焦點、PDF／照片等先前未驗仍保留；後端由Codex承接，未將全FE／P2標完。

## QA：載入、切換、路由、PDF 與家庭選項（#187 已合併，保留交付快照）

以下是前34檔在PR前的原驗收快照；其中「待交付／未PR」只適用當時。該批已於2026-10-10 17:58:28 UTC隨#187合併，當前R01修復以上述入口為準。

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

