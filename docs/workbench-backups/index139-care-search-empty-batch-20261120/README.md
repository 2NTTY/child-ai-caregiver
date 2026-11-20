# 選配工作台第 121 頁：照顧記錄搜尋這頁沒有結果，還能往下找嗎？

- **A｜在原列表繼續找。** [AWS DynamoDB 官方結果頁](https://d2908q01vomqb2.cloudfront.net/887309d048beef83ad3eabf2a79a64a389ab1c9f/2023/01/17/dbblog-1981-image007.png)示範本批已完成與仍可取下一批。原圖有命中，不是空頁；[官方 Scan 文件](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html)才另行說明零命中仍可有下一批。
- **B｜分開顯示已查範圍。** [Elastic Discover 官方原圖](https://www.elastic.co/docs/explore-analyze/images/kibana-discover-try-esql-from.png)分開放查詢、結果和分頁。它沒有失效提示；「用相同條件重新搜尋」是育伴港的設計構想。

育伴港的[單批掃描](https://github.com/2NTTY/child-ai-caregiver/blob/0ac10560e61a9f7d251175686cfd9c1f5db08782/server/firestore-care.ts#L251-L273)可在零命中時仍傳回續頁位置，不代表整次已查完或沒有保存。如果[原分頁位置失效](https://github.com/2NTTY/child-ai-caregiver/blob/0ac10560e61a9f7d251175686cfd9c1f5db08782/frontend/src/production/CareReadCoordinator.ts#L107-L149)，以已套用條件從第一頁重搜，不合計前後結果。兩案只讀，不更改記錄，不是現網修改；新增原圖只外連，版本及權利見 `spec121.json`。

## 重建與檢查

- 前 120 頁不變。共 121 題、245 款，其中 149 款只外連；保留 165 張既有離線圖。
- 用已驗證 #120 HTML（SHA-256 `d354e5c4c1a613889f408e305e55e730598820a4e30627851f1783ba9d26a83b`），執行 `python append121.py baseline120.html spec121.json output121.html`。
- HTML 34,369,151 bytes，SHA-256 `7eb1b0a36ba11c474b821bfcbcc201b4b55bb72f127db54c9d661dcaa63e87c1`；單檔 ZIP 22,769,555 bytes，SHA-256 `f5ec0dce68d8cb3a394cc7790fa9714010f06043692168a4ef03b70aae8e2e5a`。
- 獨立分支只放可重建文字，沒有更新網站、主分支或四方案。
