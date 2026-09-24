---
name: postgres-vector-knowledge
description: 修改 PostgreSQL 公共知識向量、版本發布／停用、混合檢索或 Vertex text embedding 時使用；不適用私人記憶、產品提示詞或一般 UI。
---

# PostgreSQL 公共知識檢索

適用 PostgreSQL 18.6、pgvector 0.8.6、Node 24、@google/genai 2.24.0。官方文件／固定版本原始碼最後核對 2026-09-24；adapter、排序及有界檢索的單元已驗證，真 embedding、SQL 與擴展還原仍待驗收。產品選型、年齡及費用限制以 [ARCHITECTURE](../../../docs/ARCHITECTURE.md#p2-vector-rag) 為準。

- pgvector 預設為精確搜尋；cosine distance 使用 `<=>`，距離並不是內容適用或支持說法的證據。小型庫先硬性篩選有效版本及適用條件，再排序；不能先取全庫 top-k 才過濾，導致相關片段落空。近似索引須有規模／延遲證據才加入。[查詢與過濾](https://github.com/pgvector/pgvector/tree/v0.8.6#querying)
- extension 的二進位與目標 PostgreSQL major／平台匹配；固定來源 commit、保留許可。官方 Makefile 預設本機 CPU 優化，可分發映像用 `make OPTFLAGS=""`；建置依賴留在 builder。保留原 PGDATA／volume；升級前備份，還原目標須有擴展檔案，`CREATE EXTENSION`／`pg_restore` 成功及實際向量查詢才算恢復。[固定 Dockerfile](https://github.com/pgvector/pgvector/blob/v0.8.6/Dockerfile)、[Makefile](https://github.com/pgvector/pgvector/blob/v0.8.6/Makefile)
- SDK `models.embedContent()` 的 `gemini-embedding-001` 路徑是 Vertex `:predict`。文件與查詢分別用 `RETRIEVAL_DOCUMENT`／`RETRIEVAL_QUERY`；title 只供文件。顯式設定維度及 `autoTruncate:false`，超長重新分段而非裁掉限定條件。官方對批量輸入敘述有衝突，目前按更嚴的 REST 說明每次一段。[輸入／維度](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings)、[task types](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/task-types)
- 沿用 [Vertex Skill](../vertex-gemini-server/SKILL.md) 的 ADC、API v1、一次 SDK attempt、期限及 abort。核對 `embeddings` 數目、維度、有限非零數值及明確未截斷；`statistics.tokenCount`／`metadata.billableCharacterCount` 缺失記未知。取消不保證服務停止或免收費。[固定 SDK 型別](https://github.com/googleapis/js-genai/blob/v2.24.0/src/types.ts)
- 向量重用鍵須包含真正送出的內容／title、模型、維度及處理版本。查詢向量可於同一有界運行重用；每次仍重新校驗來源停用、版本、分類及時效。失敗／額度不足不可標成向量成功；有關鍵詞降級時必須顯示實際模式。
- 發布指向必須原子切換至已核對且向量完整的版本；內容、引用及舊版本保持可追溯。已知失效立即停止檢索，不能因新向量尚未完成而延續錯誤內容。月份精度的來源日期不可杜撰為某日，抓取／核對時間不可冒充出版時間。

以上是技術實作約束；語料適用性、引用是否支持建議與來源重用條款仍需另作內容 review。mock、單元及文件證據均不代替真服務驗收。
