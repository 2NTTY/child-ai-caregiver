# 育伴港選配工作台 · preview27

本版是本地來源/DOM整合候選，未發布，整合獨立review與native仍待驗。35個唯一候選／34個有候選模組；88邊界、16組、285角色路徑保持。A/B只算同一候選，ready/available不是原生通過。

## 任務詳情與編輯 · TE01
入口 task-editor/index.html；ID task-editor-te01。
來源/DOM已審，原生待驗的實驗候選。Care 分段核對與 Handbook 同頁核對共用合成 owner。fix04 rebase reveal 與 heading margin 已做來源/DOM審查；TE-NATIVE-03仍待此版原生確認，舊fix03原生不能代替。
create 的 title/details/kind/assignee/dueAt/timeZone 與既有任務 reschedule/complete/cancel/resolve 草稿分開；explicit-offset instant 和 IANA 時區各自保留，無重複規則或提醒渠道編輯。
同一原 task owner 才可保存；本頁只用合成 owner。review＋明確確認、dirty guard、conflict→reload→明確rebase及same-reference unknown查核/重試不可拆；無任意title/details patch、刪除或reopen。
五個已封donor/source研究；本候選沒有新增外部設計研究，不把同bytes的Original/Fourth當另一IA。

## 任務完成與歷史 · TH01
入口 task-history/index.html；ID task-history-th01。
來源/DOM已審，原生待驗的實驗候選。Care 整頁reader與Handbook保留索引彈窗，共享Harbour-inspired讀取/重試語義。fix01完整revision投影及收起history的局部焦點退役已審；native NOT_RUN。
同一孩子 completed/cancelled 詳情及逐版task snapshot、actorUserId、basisVersion（含0）、note與at；終態時間不可由dueAt猜測，已載窗口不代表完整audit。
唯讀select/close、showHistory/loadOlder/retry/current read，共用原task owner；沒有撤銷、重開或writer。不是跨域history-frame，也不重做TC清單篩選；歷史指派不等於目前資格。
Care頁面、Handbook彈窗與Harbour讀取狀態的合成重新呈現，非exact RN/master adapter。

## 孩子概況閱讀 · CO01
入口 child-overview/index.html；ID child-overview-co01。
來源/DOM已審，原生待驗的實驗候選。兩種閱讀IA共用唯讀合成owner，保留childChoice、來源/量度分離授權與expiry。正式量度unavailable；有值只屬明標optional合成投影。fix01 lifetime/focus已審，native NOT_RUN。
同scope/child的profile source及獨立授權量度投影；來源失效不冒充有效資料，expiry與invalidated不同。正式接點量度unavailable，有值只作optional合成示例；version0/unknown不當空白成功。
只讀概況及本地原檔案/history/量度導航回執；原owner的讀寫/recovery不搬入。childChoice與authority退役清舊資料；不是CP編輯、GR成長寫入或摘要文件生成。
原source helpers的compiler-only投影，加原創A/B HTML閱讀器；不是原React renderer或production owner。

## 日期時間輸入 · DT01
入口 date-time/index.html；ID date-time-dt01。
來源/DOM已審，原生待驗的實驗候選。同屏欄位或分步核對，共用本頁草稿。只onChange不save；時區即時獨立套用，取消不回復時區。fix01 focus後cleanup guard已審；native/RN/AT及40正式格未驗。
calendar Date只是顯示日期carrier；既有instant要明確offset，當地日期時間以獨立IANA解讀。保留空值/未提供/未知差異，DST缺口/重複拒絕，選用明確UTC。
本頁choose/clear只回onChange，不是保存、任務或提醒。zone獨立即時onZoneChange，cancel只丟date/time草稿；A/B不重設開啟草稿。原RN/Paper popup及正式owner另驗。
原date-time helper type stripping及本地Luxon 3.7.2（MIT license保留）；其餘HTML呈現原創，非RN原生picker。

## 保留與入口
preview26的281條公開路徑全部保留，276檔byte-exact。只有README.md、index.html、modules.json、catalog-data.js、sources-data.js五項metadata更動。lab.js/CSS、五版、舊runtime、selection/undo及31個原卡片fragment原樣。新增23 runtime共432,801B逐byte等於已審四模組來源；Luxon3.7.2 MIT license保留。

TE預設Care，可用layout=handbook直入Handbook；另三候選預設A，B只用真頁內控制。不加假query或返回連結，返回工作台用瀏覽器返回；不是新Back/Forward/BFCache驗收。候選內原歷史status原字節保留，以這裡的分層說明理解。原31候選各自的舊native狀態不成為本版通過。

## 來源與研究
全域catalog仍e8918dd，snapshot和五個donor身份不變。四模組沿已封2abe7aed候選來源，沒有新查latest master。13個署名外部用途（TH3、CO6、DT4）新增6exact URL、復用7次，總138exact URLs。它們不是13個新家族或全文研究；TE沒有新增外部設計研究。每個usage保留自己的readDepth/adopt/reject/license，不以舊候選全文替換本次部分讀取。CO的search-only Skills網址不加入已讀清單；原NP兩項不可用嘗試不升格。沒有外部demo操作或新第三方程式/美術/字型；DT只帶既有Luxon及MIT。

## 驗收狀態
四模組各自source/DOM reviewed，但本版integration review PENDING；gallery native NOT_RUN。TE fix04 rebase/heading仍須新native，舊fix03 01/02有限閉合不移植為fix04 PASS。TH/CO/DT native未驗。formal63/65/72/48及DT40仍NOT_RUN，semantic88 PENDING，production adapter NOT_IMPLEMENTED。OS IME、AT、真手機/觸控/手勢、完整WCAG、BFCache、RN/Paper原生picker、API/Firestore/model都未驗。

既有CM-F01、hash focus、CD窄B、SL初始空白、code9 UNKNOWN、NP DP-F01/lookup404與reconnect差異、PH舊adapted17PASS/1FAIL照留。CW仍屬preview23，不移植。原preview26 verifier有legacy candidateId KeyError，須連其已審外部修正使用；本版不宣稱原verifier通過。

只此公開runtime清單屬可服務內容，無真家庭資料。沒有browser、HTTP、daemon、install、正式repo、PR、Sites或憑證操作。後續須另做獨立review與native，不由這份README批准發布。
