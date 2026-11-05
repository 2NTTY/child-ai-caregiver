# 育伴港選配工作台 · preview25

本版為本地 source／DOM 整合與來源區窄版 CSS 修補，preview25 gallery native NOT_RUN；沒有發布或正式驗收。

## 新候選與保留界線

29個候選／28個有候選模組，88邊界／16組／285去重角色來源路徑原樣。A/B各只算一個候選。263個基底公開路徑全留，257檔byte不變，只變更五個metadata檔及必要lab.css；新增5個原樣runtime共32,129B，合計268檔。lab.js、原五版、舊候選及選擇／undo bytes不變。

CS01 孩子與共享範圍切換 → child-picker；完整候選ID child-scope-cp01，入口 child-scope/index.html。歷史來源簡碼為CP01，候選內文字保持精確原樣；它不是原 child-profile CP01/P01，後者完整保留。A 同行名冊、B 身份指令台共用同一合成owner；staged卡不是已選，void／關閉不是成功收據，明確捨棄才可能清除草稿，觀察到的已選快照才可確認。unknown不當known-empty；共享只讀目前verified context，沒有共享名冊、grant或個人fallback。

B只用頁內按鈕，沒有query/hash B直入；候選沒有品牌返回連結，請用瀏覽器返回。真Back／Forward和跨頁記憶保留沒有新增承諾。runtime仍有歷史CP01與待覆核提示，不修改sealed候選來更新狀態，請以本段的當期驗收層為準。

## 原生觀察與未驗範圍

CS01 fix02獨立三審為scoped synthetic source/DOM PASS，F04 source/DOM閉合。原生只在代表性桌面及320／390 CSS iframe觀察：B初始、搜尋、無結果及反覆更新的Tab循環／內部Tab／Escape重開，A/B stage/dirty cancel/deferred/unknown/shared邊界。CSS iframe不是真手機或native viewport；不把AX／截圖張數當PASS案例數。本次只讀既有報告，沒有重新執行這段原生驗收。

OS IME NOT_RUN；modal內same-context publication、identity-null／retained roster／owner ABA／queued focus reentry、AT／screenreader／forced-colors／reduced-motion／zoom／手勢及完整矩陣 NOT_RUN。busy、deferred rejection、pointer Close及Space未完成。正式React／RN／ProductionOwner adapter NOT_IMPLEMENTED，正式整合NOT_RUN。新組裝的gallery仍須獨立source review與最小原生delta。

## 來源區窄版修補

preview24代表性320及390 CSS iframe發現來源區橫向溢出：client305／375但scroll388；source grid track約370.484、source row約370.484375，320右緣388.484。既有1fr track採自動min-content最小值，source item沒有min-width或長內容換行保護。本版僅把三處source-grid欄寬設為minmax(0,1fr)，並設定.source min-width:0／overflow-wrap:anywhere。沒有body overflow:hidden、裁切、隱藏研究文字、改來源內容或selection程式。

本輪CSSOM只能驗作者規則及回歸負控，沒有layout engine。修後同路徑320／390真瀏覽器幾何、焦點環與來源連結可達仍NOT_RUN，不稱已修好，也不猜是哪一個token唯一致因或舊版繼承。preview24其他小頁的有限原生觀察不當全站PASS。

## 研究與來源身分

117原exact URL + 4新exact URL = 121。7個child-scope引用用法，3次復用既有frontend-design／NN/g progressive-disclosure／recognition-and-recall。cmdk repository及README是兩個exact URL，同一次文件閱讀，不是兩個家族；原研究分四類（論壇、元件／產品模式、公開design Skill、UX研究），不是七個獨立方向。只有A/B兩種呈現。

原行readDepth及既有candidateUsages不覆寫。每次CS01原研究深度、採用／不採用理由另列；例如原TC01完整Skill閱讀與CS01只讀175–195行分別保留，不回填成同一深度。redirect及license只作context，不湊來源分母。原未看的圖片、未跑的demo／library及license描述限制照留。這輪沒有新外部抓取、套件或第三方程式／圖片／字型／Skill文字複製。

全域清冊仍e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92；候選checkpoint沿2abe7aed60b192b253414f6464e3fd070cc377e7，均不稱最新master。這輪讀contract、claims／manifest／研究與已封review，機械核對9來源／15切片與原包一致；不聲稱重讀全部原始碼或完成新正式語義審核。

## 其他既有狀態

正式63 NOT_RUN、正式65 NOT_RUN、正式72 NOT_RUN、正式48 NOT_RUN；semantic88 PENDING；CM-F01 UNFIXED。same-document hash Back焦點、CD窄B方位NIT、SL初始未選詳讀空白等限制照留；BFCache命中未證實。原preview21／23與PC的code9原因仍UNKNOWN；這輪無code9不能作修復證據。PC/AP/TC的來源准入與各自原生層不混合，沒有重跑歷史大套。

CW01固定preview23 routes，不納入、不當自動兼容本版；未審PH01／NP01不納入。僅dist可公開供應，source／tests／evidence／私人筆記／raw screenshots不在其中。根HTTP或同前綴nested部署必須使用完整dist；本輪未啟HTTP、browser或daemon，未做GitHub／PR／Site。GitHub顯示HTML不等於部署。
