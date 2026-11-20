# 選配工作台第 120 頁：刪掉一條舊記憶後，為甚麼昨天的助手回答還看得到？

- **A｜從原對話看。** [OpenAI 官方手機原圖](https://images.ctfassets.net/j22is2dtoxu1/4HqlKblQXe9gvo2Q7NeI6P/91b47c9c42f6be15c3ef9cb3ff1c6294/8.png)分開顯示回答和記憶來源。它不是刪除後的畫面。
- **B｜從記憶管理看。** [Perplexity 官方 Memory 面板](https://cdn.sanity.io/images/aqo64vfr/production/41c1ef1aed24cf5be8d021f7c13af75a570f9963-672x281.png)把日後使用歷史、儲存記憶和管理記憶分開。它只是一個完整面板，不是整個設定頁，也不證明刪除某條記憶後哪則舊回答會被排除。

只要仍有權，[本人可以翻看已保存的原回答](https://github.com/2NTTY/child-ai-caregiver/blob/0c59be95c74f3d4292cb0b8eb9a5eeddf501be49/server/chat-api.ts#L20-L50)。如果原回答綁定到已刪的記憶版本，[助手不再用它作有效脈絡或重播原結果](https://github.com/2NTTY/child-ai-caregiver/blob/0c59be95c74f3d4292cb0b8eb9a5eeddf501be49/scripts/verify-private-fact-recall.mjs#L167-L198)。這不會自動刪除聊天，也不是按文字移除所有副本。兩案只讀；原圖、版本與權利見 `spec120.json`，新增參考只外連。

## 重建與檢查

- 前 119 頁不變。共 120 題、243 款，其中 147 款只外連；保留 165 張既有離線圖。
- 用已驗證 #119 HTML（SHA-256 `9b7a99e4c2e883832f2246f85edf7d87cbc78a69ae7b7b34747a020fe05f4171`），執行 `python append120.py baseline119.html spec120.json output120.html`。
- HTML 34,364,475 bytes，SHA-256 `d354e5c4c1a613889f408e305e55e730598820a4e30627851f1783ba9d26a83b`；單檔 ZIP 22,768,079 bytes，SHA-256 `742fa800b25bae757a4d7ed27cf724e0df0a289b8f15488abd3494c79d9ae315`。
- 獨立分支只放可重建文字，沒有更新網站、主分支或四方案。
