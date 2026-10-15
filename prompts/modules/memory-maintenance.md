# 長期記憶維護

- ID：`module.memory-maintenance`
- 版本：`0.1.7`
- 使用條件：增量整理聊天摘要、已確認事實、話題狀態及任務記憶，或重建模型上下文時使用。
- 依據：[長期記憶資料規則](../../docs/DATA_MODEL.md#section-5-4)、[長期記憶組合](../../docs/ARCHITECTURE.md#section-5-4)、[記憶與任務驗收](../../SPEC.md#section-10-3)
- 輸入：Server 提供的已授權原始消息、前一摘要與覆蓋游標、已確認事實、話題及任務現況。
- 輸出：按當次工具／outputContract 提供輔助摘要；覆蓋資訊由相應契約處理，不自行增加欄位。

## Agent 指令

<!-- prompt:begin -->
只保存有助之後理解或接續的資訊，分開當前事實、活動工作、輔助摘要及原始歷史，不逐句複製聊天。先查相關原項；重複交代不是新增事實，不同時期事件也不能只因文字相似便合併。依現有工具更新原項或形成更正候選，同義交代由你查回並選擇原 ID／主題鍵，不用文字相似度把不同事情合併。已知事實鍵或話題標題用 read_memory_facts.keys；私人普通交代用 read_private_instructions.memoryKeys 定位。查不到鍵時仍可搜尋舊無鍵資料；有可靠保存時間範圍時用 search_history.createdFrom／createdBefore 縮窄，不把保存時間當事件時間。

新的穩定偏好／事情保存 memoryKey；沿原鍵與原 ID 更新，同鍵但內容不同先讀原版本再 revise_private_instruction。memoryOutcome=duplicate 只表示原內容仍在，不是新寫入或新提醒。日常觀察保存為記錄，不同時期事情不能借同一鍵合併；舊資料無鍵不代表不存在。

stage_private_summary 只傳 text。若 read_context 提供 privateSummaryInput.messageIds，從同次 uncoveredConversation 讀取指定 IDs 的全部原訊息，依 summaryMode 整理：isolated_batch 不帶入舊 summary，舊 cumulative 模式才結合舊摘要；來源與當前終態仍須核對；不要假設 privateSummaryInput 另帶正文。Server 綁定覆蓋清單、游標與版本，不另添參數或把控制資料塞入摘要。其他模式只按當次 outputContract 處理。

核對指定批次完整，不要求一次讀完全部歷史。moreUncovered=true 表示有後續批次；本批原文齊全仍可整理，但不聲稱全史已涵蓋。指定來源缺失、Server 明示不完整或版本衝突時，保留缺口；不按不透明 ID 是否連號猜測缺頁。staged:true／saved:false 只是等待 Server 校驗，不能說記憶已更新。

保留原文依據、適用時間及陳述／推測／確認的區分；摘要可參考上一版本，但不能把反覆濃縮的推測變成事實。按當前台帳記錄已解決／暫緩及再次跟進條件，不讓舊「記得提醒」復活完成、取消或關閉事項。來源更正、刪除、停用或撤權時，不從舊摘要補回已失效正文。

更正或停用已有事實先用 read_memory_facts 讀原項與版本，再以 propose_fact_revision／propose_fact_deactivation 提出所需候選；普通私人交代用既有普通工具，不能用另一筆相似事實代替更正或繞過重要確認。候選是否已準備確認按工具結果及共用規則處理。

工作目標、目前理解及待答問題用 save_work 接回同一工作；只存有用進度，工作完成不等於照護任務完成。私人整理保持私人，混合權限不擴大分享。新會話以 Server 的當前資料、有效摘要及必要原文接續，不因模型快取不存在而重問。
- `summaryMode=isolated_batch` 或配方 `memory-refresh`：只整理 Server 提供的本批原訊息，不複製前一摘要、不帶入其他工具讀到的知識或未列出的私人資料。保留事件時間、原話是陳述還是推測；摘要不能變成已確認事實或新的提醒指令。
- 背景 `memory-refresh` 只有一次生成機會；直接呼叫 `stage_private_summary`，不呼叫不存在的 `present_answer` 或另行聊天。`currentSources` 是本批來源的現行更正，以它修正已過時的描述；保留不受影響的原歷史，不捏造未提供的內容。結果由 Server 再核對來源及批次版本，工具暫存不是已保存。
<!-- prompt:end -->

## 維護與靜態例子

- 正常：上一游標為 105，收到連續消息 106–112 → 按當次契約摘要新增內容並保留任務已完成狀態；stage_private_summary 只交正文，Server 綁定至 112，非工具模式才按 outputContract 回覆覆蓋資訊。
- 缺項／衝突：Server 清單要求 106–108，但標示 107 未取得 → 回報覆蓋缺口，不假裝完整摘要；不透明 ID 不按數字判斷。
- 失敗／權限：新上下文混入另一位成員的私人摘要 → 拒絕合併，要求 Server 按原授權範圍重取內容。
