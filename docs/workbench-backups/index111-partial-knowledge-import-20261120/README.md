# 育伴港選配工作台｜第 95 題：公共知識 ZIP 匯入中斷

同一個 AtoM 2.9 手冊的兩個獨立示例，並不是同一次作業的前後畫面，也不是育伴港實機畫面。

- **95A 先看批次清單**：先辨認哪個作業、甚麼狀態，找到完整報告。 [工作清單原圖](https://github.com/artefactual/atom-docs/blob/204369378c1303196a6d254350c3428e9c3870b6/user-manual/administer/images/manage-jobs.png)（1265 × 863）。
- **95B 先看單批的失敗報告**：已知是哪一批時，直接看最近失敗的原因和日誌。 [報告原圖](https://github.com/artefactual/atom-docs/blob/204369378c1303196a6d254350c3428e9c3870b6/user-manual/import-export/images/csv-import-error.png)（1803 × 976）。

[育伴港固定版本](https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/admin/AdminKnowledgeTransfers.tsx#L21-L85)：完整 SHA-256 先找到原 ZIP。結果未明先查；允許接續不等已重跑。部分入庫不等全包完成，入庫不等審核或發布。工作台不執行匯入、停止、接續或發布。

兩圖均為 AtoM 2.9 文件，© 2025 Artefactual Systems Inc. 及 AtoM 文件貢獻者，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)；[固定授權文件](https://github.com/artefactual/atom-docs/blob/204369378c1303196a6d254350c3428e9c3870b6/LICENCE)。原圖檔未變更；文件版本不等實際擷取的軟件 build。

95 題、193 款（114 款純外連），148 張離線圖。完整預覽 31,321,265 bytes，SHA-256 `288d9fa802f75514a3341e8c312ec928cf341c457d50fa05b501f7a1d843c9de`。靜態及離線 JavaScript 模擬檢查原圖、搜尋、選題、比較和選擇。未做真瀏覽器驗收。只備份文字與版本，不開 PR、不合併、不更新線上預覽。
