# 受控文件批次：離線 consumer 候選

## 狀態及交付邊界

2026-10-10，本候選以 master `04fb3f3ef7aa70cb63451b1229d8936241e389f1`（#185）核對產品接口，加入可執行的離線 consumer。唯一產品改動是 `server/agent-model-gateway.ts` 抽取共用原生 payload builder／SDK options；正式 provider 的模型、thinking、candidate、output、abort 及重試行為保留。沒有修改 production 預設、workflow、request、批准 manifest、WIF／IAM 或資源。

歷史 helper 來自 controlled harness `f93dfb8f200c427867c4a02b803f4453681b0c75`，Git blob `3349ce6b6ece6b3564a48326a5466c3a661562e7`，原文不改。master 沒有該 helper；若交付到 master，必須把它作為明列的新增依賴，不能假稱 master 原有。歷史 runner 不覆蓋到 master。

原四檔離線庫候選及原紅綠證據另外保持 freeze；它的獨立 Allow 不延伸到本 consumer／wire 修改。此版本仍只有離線用途。`createControlledDocumentBatchConsumer`／`requireControlledLiveReadiness` 無條件拒絕；任何 caller 的 `approved`、成本值或 token proof 都不能開啟 live。

## 唯一傳送邊界

- production provider 與離線 adapter 復用同一 builder，避免複製生成配置。adapter 固定 project `ai-caregivers-for-children`、location `global`、model `gemini-3.1-flash-lite`、candidate 1、maxOutputTokens 1024、SDK／應用 attempts 1。實際安裝的 SDK 必須是 GenAI 2.24.0。
- ADK 的全部 contents、歷史工具回覆、system instruction、tools／toolConfig、thought signatures、摘要及 labels 先作純 JSON／text-only 檢查。SDK 的 schema normalizer 會修改 private clone，不能把 pre-SDK frozen object 直接送 SDK；該原紅保留。
- 唯一私有 SDK client 只呼叫非串流 `generateContent`。custom fetch 收到 SDK 最後的實際 URL 及 JSON body 字串後，固定核對 HTTPS／project／global／model／`:generateContent`；query、其他 model／地區／project、stream 路徑、缺少硬生成配置或未知 wire 欄位均拒絕。原生 JSON bytes 連同 model／SDK scope 凍結及雜湊，opaque handle 由模組私有 WeakMap 綁定。
- 合成 counter 與合成 transport 收到同一 frozen `{url, body}` 物件。SDK normalization 已經完成，計數後不重建 body、不增加摘要或 schemas。這只證明離線同 bytes 准入；counter 固定合成數字，不是官方 token 上界。
- SDK constructor 仍會讀 API-key 環境值；consumer 因此先以 `Object.hasOwn` 只檢查 `GOOGLE_API_KEY`／`GEMINI_API_KEY` 是否存在，任一存在即拒絕，不讀值、不刪改環境。通過後 client 使用固定空 Headers 的假 auth，沒有 ADC、實際認證或 secret 檔；不保存 headers。custom fetch 從不呼叫原生 fetch，僅轉交固定的合成回覆，因此沒有重導向可跟隨。SDK 的 429 一次 attempt 行為另以假 fetch 驗過；沒有向外暴露 client、stream API 或第二 transport。這不等於真 HTTP redirect／認證已驗。

## 跨 root 狀態及終局裁決

只接受明列 `offlineSimulationOnly: true` 的合成舊台帳，保留 baseline／events／原 validator 的 20 cap，同一檔加 `offlineBatchJournal`。先鎖定、原子替換及 fsync 整批 US$0.25 合成預留，再在每次假 counter／transport 前持久化 call reservation。固定三 root 4／5／3、總 12 次、每 root 8 工具、32,768 合成 input 上限／1,024 output、root 90 秒、全批 270 秒。未知 usage 不退款；沒有初始化真帳、rollover、重置或 resume。

缺檔、外部替換、破損、鎖衝突、persist 失敗、重開／新 ID、重複 payload、並發、counter 失敗／越界、usage 缺失／不符、逾時及非 STOP 回覆均 fail closed。原有失敗狀態測試及獨立 review 證據保留。

consumer 自己持有 provider／batch，只向受信 harness 的當前 `runRoot` 傳 provider，不暴露 `passRoot`。三 root 的文字及 fresh-conversation 設定固定；受信 execution／inspect 是合成測試依賴，不是 live 授權或可插入 token authority 的 plugin。固定內部 asserter 檢查真 `ProductAgentResult` 的 completed、全部工具 succeeded、已知 counts、零 embedding，以及來源文件／work／原收據／寫入數：

1. 兩份準備單先補問，同一 waiting work 恰有兩個不同原 ID／version 的 family_document 引用，不改文件。
2. 單字選擇第二份，只修改該原 ID 一次、version 3→4；另一份逐值不變。依同一原 op receipt 保存 completed work，再獨立呈現。
3. 新 conversation／root 重新 read_work 及原 source，確認同 ID 第 4 版，不新增寫入或 save_work；consumer 的受信 inspect 另核原 receipt 保持不變。這不是第三 root 經工具重新讀取原收據正文的證據。

工具 failed／unknown 即使沒有下一次模型 request，也會在終局裁決持久停批。caller 自填 passed／approved 不會令斷言通過。模型回傳 `search_knowledge` 或其他情境外工具時，整份回覆在交 ADK 前拒絕；保留其 core schema、production embedding profile 最低值 1，本批仍為 0 embedding。不能吞掉錯誤再加 call 補跑。

本切片沒有新增「同一模型回覆中，多工具執行途中首次失敗便即時中止其他工具」的 hook；產品 ADK／runtime 的該段機制未改。已接的批次停止邊界是下一 request 准入前及 root 終局結果，不能將其稱為工具級即時中止已完成。

## 實際驗證與保留紅

環境為 Node 24.19.0、ADK 2.1.0、GenAI 2.24.0。新窄驗：代表性 SDK request 的真 serializer＋429 假 fetch 一次 attempt；wire 固定 target／body／硬配置／巢狀 media／偽造 handle 拒絕；consumer preparation、最後工具失敗、語義假 pass、search 回 ADK 前停批。真 ProductAgent／ADK 搭合成 stores/provider 經內部真 SDK serializer 的完整三 root 通過，12 次 wire call 為 4／5／3、0 embedding、原 20 歷史數不變、只寫原文件一次。125 檔 import 閉包對 #185 核對，除明列候選五檔外無非預期 mismatch。

唯一產品 diff 的定向回歸先發現 output cap 被過早 capture，破壞原本可由 1024 下調 512 的語義；保留紅後恢復原讀取時點，原斷言轉綠。其他三個當輪定向案例已過；沒有稱四項全部在修後重跑。gateway scoped TypeScript 通過。原 state 庫只重驗受新增 private contents 影響的 full-frozen／prior-failed 兩項，沒有重跑完整舊套件。

原九項初始守門、review 的巢狀 SDK 媒體及 prior failed／unknown 返修、原 state fault／並發檢查、原產品合成證據各自保留，不改原紅或把早期結果當成新版本全回歸。詳見 `artifacts/verification/CONTROLLED_DOCUMENT_BATCH_20261010.json`。沒有 HTTP、真 Firestore、真模型、CountTokens、workflow、部署或全量回歸。

新 consumer 的獨立 review 發現兩項：GenAI constructor 會先讀環境 API key，已加上述 presence-only 拒絕；root 1 的引用斷言原本容許重複同一文件，已改為兩個不同原 kind／ID／version 各恰一次。reviewer 的重複引用實證紅保留；作者新增合法 kind 但重複 ID 的反例確認不會通過第一 root。兩項修正後同一真 SDK／ProductAgent 三 root 情境再通過；並未重跑全部早期案例。

最終五份程式／測試 freeze `5be20d5841abcfd13124db31dfcdbf5e0cc8f44e4f8c5a02df636a9318f2ba21` 已獲獨立 Allow。reviewer 逐項重驗 serializer／429、terminal failure、wire admission、credential presence，另驗合法 kind 的重複引用反例及最終真 SDK／Product 三 root，均通過；含原紅的七份網絡 audit 全為 0。可獨立閱讀的結果、原缺口及斷言已嵌入 artifact，不依賴本機日誌路徑。Allow 只覆該五份碼；dot 已親審最後九檔及根文案，核准精確12檔正常PR交付。記錄時尚未PR／合併，不解鎖 live。

## live 尚未具備

1. 可信、適用該 Vertex 模型及完整 payload 的 token 上界；CountTokens 是否及如何授權／計費仍須核。不能用字元／UTF-8、fake counter 或 caller proof 替代。
2. Vertex 上該模型 maxOutputTokens 是否涵蓋 reasoning、精確定價與其他費用仍待核。US$0.116736 是條件估算；US$0.25 只是預留，不能當 US$30 累計成本 gate 通過。
3. 承接原 20／20 的明確新批次授權 manifest、可信 successor ledger、跨 workflow checkpoint authority／累計成本核對仍缺。原已過期 C manifest 不可沿用，不能以新 request 或 batch ID 繞過。
4. 真 live consumer、受權 counter／network／credential 邊界、持久 checkpoint 搬運及正式 synthetic fixture 資料寫入環境仍未接線或驗收。現在的 runRoot／inspect／counter／sender 均是離線合成測試依賴。
5. 若驗收要求「新 root 透過產品工具重新讀取原 op 收據正文」，本三 root fixture 尚未包含該步。現有結果只證明新 root 讀 work／同文件來源，並由受信 inspect 驗原 receipt 未變；不能替代收據讀取流程驗收。

普通離線程式／測試可在既有授權內續作；實際模型／CountTokens／workflow、真資源或權限變更需先有涵蓋具體操作及目標的當次有效授權和全部技術 gate。本候選沒有建立或代填這些授權。

## 測試入口

按首次失敗停批逐項選擇必要案例，不自動重跑全量：

- `node --test tests/chat-document-batch-guards.test.mjs`
- `node --test tests/chat-document-batch-consumer.test.mjs`
- `node --experimental-test-module-mocks --test tests/chat-document-batch-product.test.ts`

上述需完整同版產品原碼及已鎖定依賴。consumer 單元在隔離 overlay 可用 `CONTROLLED_OFFLINE_PRODUCT_ROOT` 指向已核產品複本；測試不需要帳戶、認證或外網。
