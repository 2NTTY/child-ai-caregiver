# 育伴港選配工作台 · preview26

本版是私有來源／DOM整合，尚待獨立review和新的工作台原生短窗，沒有發布或正式產品驗收。31個候選／30個有候選模組；88邊界、16組、285角色來源路徑保留。A/B不是兩個候選，也不是全站版本。

## PH01 孩子檔案歷史
入口 profile-history/index.html；完整ID profile-history-ph01，屬profile-history。A 版本書庫／B 欄位航線，共用 child-scoped 合成只讀 owner；分頁閱讀完整十欄歷史版本。fix02 獨立來源／DOM及有限原生觀察已完成，本版整合原生尚未驗；沒有 structured diff、restore writer 或 raw sortable timestamp。原 adapted source 17/18（舊UI lookup RED）保留，本輪 NOT_RERUN。

版本metadata與完整十欄（age、dueDate、gestationalWeeksRaw、region、language、allergies、specialNeeds、preferences、source、validUntil）由原owner投影。null、version0、data=null、partial-empty分開；顯示確認時間不可還原timestamp或排序。B是同欄原文閱讀，不計算diff／醫療趨勢；無snapshotId／global total／restore writer。正式接線仍須保留renderer及owner兩層gate。

獨立修後來源／DOM F01–F04有界閉合；既有root/nested、A/B、全文、320/390 CSS iframe、真Tab/Escape／返回opener有有限原生觀察。私有延時owner診斷與public entry證據分列，不是正式owner或OS IME。原adapted source 17 PASS／1 FAIL舊「重新讀取檔案」UI lookup照留，本輪NOT_RERUN，不推成正式新bug或全通過。

## NP01 本人通知偏好
入口 notification-preferences/index.html；完整ID notification-preferences-np01，屬catalog preferences。A 夜間航圖／B 偏好校對台（saved／draft），共用 account/server/session 合成 owner；四欄與 version，未知原操作只在讀收據後 fresh consent 明確 same-ID/input/version 重試，confirmed 只讀。fix01 獨立來源／DOM及有限原生觀察已完成，本版整合原生尚未驗。320原生select尾字截短，完整值在核對可讀；DP-F01、lookup404及正式reconnect差異未修。

正式Settings notifications tab呈現本模組；Settings preferences tab是appearance，不可錯配。本人account/server/session是owner，child切換不清本人偏好。預設四值只是草稿，saved projection與version另列。quietStart/end為不同HH:mm；IANA不猜offset/DST；鐘面區間不是經過時數或實際通知承諾。unknown不自動重送；讀收據及目前值後仍須fresh consent，保留same-ID/input/version；confirmed只讀。

NP-R01有自然native保存／basis retirement觀察；confirmed recovery中disabled read按鈕已原生blur到BODY，未重現JSDOM hidden descendant前提。NP-R02 retained／queued disposed callbacks僅source/DOM，不升格native。320原生select尾字截短是已知限制，核對／recovery有完整IANA可讀。DP-F01有效confirmed＋畸形domain結果、lookup404以及production安全自動reconnect read和本候選explicit read差異均未修。

## 入口與舊檔保留
13個新增runtime逐byte等於已覆核PH01 fix02七檔、NP01 fix01六檔。268個舊公開路徑全部保留，僅README.md、index.html、modules.json、catalog-data.js、sources-data.js五項metadata變更；lab.js、lab.css、五版、所有舊runtime與選擇／undo原樣。新候選均從A開始；B只用頁內控制，無query/hash直入B，無工作台返回連結，請用瀏覽器返回。這不是新的Back／Forward/BFCache驗收。舊候選內歷史待驗文字不改寫，以本版當期分層說明為準。

## 來源、研究與快照
全域catalog仍e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92。候選checkpoint沿2abe7aed60b192b253414f6464e3fd070cc377e7。PH選取本地f453來源＋remote2abe歷史compare；NP是封存2abe選取來源。五個原始設計快照仍分別保留，不以候選checkpoint宣稱全站latest master。本輪沒有外部master／網頁重抓。

14個署名研究用途新增11個exact URL、復用3次；總132個去重exact URL。PH五用途、NP九項（七有內容、兩不可用嘗試）不當十四個家族。Primer source/docs同家族；Obsidian forum/help同生態；不同frontend-design網址的部分行段和全文讀取逐用途保留，不由既有TC01／別候選讀深度互相升級。NP Material JS-only及Spectrum inaccessible沒有可用指引。redirect/license只作context，外部demo未實跑，未安裝Skill或複製第三方code/assets/fonts。

## 驗收層與限制
preview25的G24-N01在其來源grid320/390有界native回歸已閉合；原CSS不變，但本版新增研究長文仍須新native驗證。preview26 gallery native NOT_RUN；PH／NP原生是各自finite scope，非281檔全站或正式owner接線。來源／DOM不等於native布局或原生預設鍵盤。

正式63／65／72／48 NOT_RUN；semantic88 PENDING；production adapter NOT_IMPLEMENTED。OS IME、AT／screenreader、實體手機／touch／gesture、完整WCAG、BFCache、OS forced-colors/reduced-motion及正式API／Firestore／model未驗。CM-F01未修；same-document hash焦點、CD窄B文案、SL初始空白等舊限制保留；code9原因UNKNOWN。CW01仍固定preview23，不自動移植；TE/TH待驗，不在本版。

只dist屬公開allowlist；source、tests、evidence、raw screenshots及私人資料不得加入。這輪未啟HTTP、browser、daemon或重型build，無GitHub／PR／Site／credential／真資料操作。原native HTTP曾有managed live-server HTML注入，不能把來源byte等同HTTP response；本版只核檔案，不稱已驗HTTP。發布前須新的獨立review和native短窗。
