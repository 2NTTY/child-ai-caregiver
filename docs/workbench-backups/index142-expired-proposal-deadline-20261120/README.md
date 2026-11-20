# 選配工作台第 124 頁：星期五才要帶圖畫簿，為甚麼星期三已不能按「建立待辦」？

- **A｜在活動清單分開標示。** [Oracle 官方請求清單原圖](https://docs.oracle.com/cd/E41197_01/books/PTA%201.0/pta_UG_6.2.2_1ed.pdf#page=50)把 Cleared 和 Expired requests 放在同一表格。若網址沒跳頁，找印刷頁 36 圖 27。育伴港方案分開寫「確認期限已過」和「建議星期五完成」。
- **B｜在原提案詳情分兩行。** [OPSEU 官方活動詳情原圖，第 2 頁](https://opseu.org/wp-content/uploads/2020/11/Event-Registration-Tutorial.pdf#page=2)分開報名截止日和活動日；不是逾期畫面。育伴港方案用同樣的方法分開星期二的確認期限和星期五的建議完成日。

[確認期限](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/server/firestore-agent-proposals.ts#L202-L211)是原提案的 24 小時期限，不是待辦的期限。這個例子從未接受；過期沒有建立或取消待辦。[略過](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/server/firestore-agent-proposals.ts#L138-L168)是在有權讀回原提案後另行結束它，不更改任何待辦。兩案只比較，不執行操作；原圖只外連。

## 重建與檢查

- 前 123 頁不變。共 124 題、251 款，其中 155 款只外連；保留 165 張既有離線圖。
- 用已驗證 #123 HTML（SHA-256 `1506afb489f5b1bdab3e6400c7b219ce167631439fd7936ede071299fd7a26d7`），執行 `python append124.py baseline123.html spec124.json output124.html`。
- HTML 34,385,849 bytes，SHA-256 `023c1341e045e1ee01f931312f2eee02c9bf15f2d618f168e87712d7a79baea2`；單檔 ZIP 22,773,912 bytes，SHA-256 `5a1f2809f896bf20c8f86e13cf622fef3ec0d191328080e541a0cf7c2b39b059`。
- 離線測試不是現網驗收。沒有更新網站、主分支或四方案。
