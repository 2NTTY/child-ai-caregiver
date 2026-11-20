# 育伴港選配工作台｜第 102 題：已跟隨的教材擴大收錄範圍，還要重新選嗎？

育伴港保留跟隨設定，但不會自動採用擴大了範圍的版本，也不會自動退回舊版；受影響來源暫不供新問答。可用的新版可經 [設定與匯出 → 固定目前版本](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/components/memory/MemoryReferenceView.tsx#L214-L250) 明確採用，改為固定快照。[跟隨及固定版的測試例子](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/tests/firestore-knowledge.test.ts#L299-L312)。

- **102A 先找到待選項目**：[Open edX 課程資料庫的待更新主區](https://github.com/openedx/docs.openedx.org/blob/a87d6db6f7bd7a352b84eb5a60dfc8fa11e4b797/source/_images/educator_how_tos/library_review_content_updates.png)，2632 × 632，Git blob `6892bce7ff4e52218c0fc8ae487e23cd8ce9a70c`。一般資料庫和待更新分頁，不是同一頁混列。
- **102B 先看修改前後**：[Open edX 完整前後比較對話框](https://github.com/openedx/docs.openedx.org/blob/a87d6db6f7bd7a352b84eb5a60dfc8fa11e4b797/source/_images/educator_how_tos/library_review_content_updates_2.png)，2252 × 1010，Git blob `7af1bc5b47f3926c34348747b14c56ae34aad854`。並排顯示改動、移除、移動；不是擴大育伴港教材的實例。

兩張是 Open edX 同一原流程的不同閱讀重點、不同示例，不含全站導覽。Ulmo 文件快照（2025-12-18），截圖未標產品 build。[官網說明](https://docs.openedx.org/en/latest/educators/how-tos/course_development/sync_a_library_update_to_your_course.html#sync-library-subsections-or-sections) · [固定版手冊與兩張圖位置](https://github.com/openedx/docs.openedx.org/blob/a87d6db6f7bd7a352b84eb5a60dfc8fa11e4b797/source/educators/how-tos/course_development/sync_a_library_update_to_your_course.rst#L52-L78)。Open edX Documentation Working Group／Axim Collaborative，[CC BY-SA 4.0](https://github.com/openedx/docs.openedx.org/blob/a87d6db6f7bd7a352b84eb5a60dfc8fa11e4b797/LICENSE)，原檔未改。

完整 HTML：102 題、207 款（115 款只外連）、161 張離線原圖。33,304,861 bytes，SHA-256 `53cd2601eaccd6ffa3412823f3771d51e83c226c49f6e8a6ae8834fde0750567`。前 101 題、預覽程式及舊搜尋保留；新題跳轉、搜尋、左右比較、主動選擇及複製來源通過離線檢查。未驗實機／網站；未修改育伴港功能，未建立 PR、合併或發布。

完整 HTML 私下保存；分支只備份來源與可重建增量，不附原圖或整份包。將 [第 101 題完整 HTML](https://github.com/2NTTY/child-ai-caregiver/blob/ea33ab15b6a569ebae3d679aebe881d4787e9a16/docs/workbench-backups/index119-handover-period-20261120/README.md) 作為 `baseline101.html`，依序將上述原圖命名為 `b-edx0.png`、`b-edx1.png`，原版條款命名為 `openedx-CC-BY-SA-4.0.txt`，與 `spec102.json` 放一起；用 Python 3 + Pillow 執行：

```sh
python append102.py baseline101.html spec102.json workbench102.html
```

已用獨立還原的 #101 重建，比對每個 byte 一致。程式核對原件及輸出指紋，不覆寫現有檔。
