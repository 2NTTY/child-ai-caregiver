# 選配工作台第 123 頁：教材卡有新片段，為甚麼另一段仍是先前的？

- **A｜在原卡逐段看。** [Airbyte 官方狀態整頁](https://docs.airbyte.com/assets/images/cloud-status-page-88407100afc2debe348e30ef21f75959.png)把各資料流的狀態和時間並列。原圖三列都成功，並非舊片段保留的實拍。
- **B｜先開片段核對區。** [Google Search Console 官方檢查整頁](https://lh3.googleusercontent.com/sGYb7oLLpLEr2AjLHNxJ8nTbfOksVb68no8qlucDb34_niSRyZx7q3alQm6rtR80Nw5B=s0)把上次擷取和即時檢查分開。育伴港方案把先前摘錄、當時起訖和本次未能核實並排；同一網址不保證原片沒變。

育伴港[按來源及媒體流分開整理](https://github.com/2NTTY/child-ai-caregiver/blob/01a53716c18d57ad6ccead7bc63960854c3d41ad/server/platform-media-processing.ts#L16-L89)，一段有新結果不代表另一段也已核實。工作台只比較，不加入草稿、不重做擷取、不發布。新增原圖只外連，版本和權利見 `spec123.json`。

## 重建與檢查

- 前 122 頁不變。共 123 題、249 款，其中 153 款只外連；保留 165 張既有離線圖。
- 用已驗證 #122 HTML（SHA-256 `4939fb4a4761bdff2abcde0b78de2eb8ceca1d66d3d2085e2e3907ee0b73f837`），執行 `python append123.py baseline122.html spec123.json output123.html`。
- HTML 34,380,513 bytes，SHA-256 `1506afb489f5b1bdab3e6400c7b219ce167631439fd7936ede071299fd7a26d7`；單檔 ZIP 22,772,585 bytes，SHA-256 `f80c1fdee320b887b66e67f05d42f83c9b09c33362c9908c5313bce556419e2d`。
- 已做離線比對和選配檢查，沒有更新網站、主分支或四方案，不是現網驗收。
