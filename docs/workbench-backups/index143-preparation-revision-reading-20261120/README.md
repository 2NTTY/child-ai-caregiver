# 選配工作台第 125 頁：準備單舊版正文未讀完，怎樣接着看同一版？

- **A｜在原頁續讀。** [Sourcegraph 官方完整工作區影片](https://sourcegraph.com/_docssvc-assets/changelog/20261105_diff-context-expansion_demo.mp4)在同一提交和檔案中展開更多行；不是斷線或重試。育伴港方案保留所選版本，只在仍有後段時續讀。
- **B｜在獨立唯讀窗看同一版。** [MediaWiki 指定舊版原頁](https://www.mediawiki.org/w/index.php?oldid=8094969&title=Help%3AHistory)把舊版日期和正文放在同頁，沒有分批或重試。獨立閱讀窗是設計方案，不是現行功能。

育伴港[續讀綁定同一份文件及快照](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/useFamilyDocuments.ts#L330-L372)，只有核實完整才顯示正文，不拿現版替代。若仍有權且範圍未變，暫時失敗可重試；權限或來源變了就不能續讀。傳輸長度不是正文閱讀百分比，也不承諾關頁後記住位置。兩案只比較，原始來源只外連。

## 重建與檢查

- 前 124 頁不變。共 125 題、253 款，其中 157 款只外連；保留 165 張既有離線圖。
- 用已驗證 #124 HTML（SHA-256 `023c1341e045e1ee01f931312f2eee02c9bf15f2d618f168e87712d7a79baea2`），執行 `python append125.py baseline124.html spec125.json output125.html`。
- HTML 34,391,553 bytes，SHA-256 `7455df867bfeb35cb79a11a9f3210c91f9d1f6f755890037a437d719d1909a67`；單檔 ZIP 22,775,555 bytes，SHA-256 `12be0d6476342ffe9245722ef9a64198914567593a8a54948452a1b50de4ffc9`。
- 離線測試不是現網驗收。沒有更新網站、主分支或四方案。
