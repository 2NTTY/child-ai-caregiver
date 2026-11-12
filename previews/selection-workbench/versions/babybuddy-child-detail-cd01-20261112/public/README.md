# 孩子基本資料：Baby Buddy Child Detail 完整頁展示草稿

入口：`child-detail.html`（`index.html` 為相同頁面的位元相同副本）。這是尚未接受、未發布的獨立 UX/UI 候選，不是已接入育伴港的前端功能。

## 精確來源與授權

- Repository: https://github.com/babybuddy/babybuddy
- Commit: https://github.com/babybuddy/babybuddy/commit/f02f28b7f96f8bb1b9a0212a377c327ce33e7699
- Source page: https://github.com/babybuddy/babybuddy/blob/f02f28b7f96f8bb1b9a0212a377c327ce33e7699/core/templates/core/child_detail.html
- Page blob: `58e31585e1627a0cb83c7dc5a2b8828605328eb4`
- Synthetic test: https://github.com/babybuddy/babybuddy/blob/f02f28b7f96f8bb1b9a0212a377c327ce33e7699/core/tests/tests_models.py
- Fixture blob: `489578405b9180b9404c01ee9cd46bc618cbf31a`
- Package version: `0.1.0`; commit date `2017-10-28T03:20:52Z`.
- BSD-2-Clause, Copyright (c) 2017, Baby Buddy's Contributors. Full required notice and disclaimer: `licenses/BabyBuddy-BSD-2-Clause.txt`.
- Bootstrap 4.0.0-beta.2, jQuery 3.2.1, Popper 1.12.5: MIT. Font Awesome 4.7.0: code MIT, font OFL-1.1. Corresponding notices are retained under `licenses/`.

## 保留的頁面與資料邊界

直接渲染原版 base → nav-dropdown → page → child_detail 模板；保留導覽、麵包屑、jumbotron、原 icon-only Dashboard／Reports／Edit／Delete 入口，以及 Reports 原五項清單。沒有加健康檔案、卡片、表單、圖片或自行設計的目標頁。

姓名 `First Last`、slug `first-last`、出生日期規則 `timezone.localdate()` 來自上述 ChildTestCase.test_child_create。固定時間為 `2017-10-28T00:00:00+00:00`、UTC、英文，因此原 timesince 顯示 `0 minutes`，不改成自行設計的年齡格式。導覽的 `caregiver` 是合成非 staff 使用者，timer 清單為空；權限呈現選擇全部列在 `fixture.json`，不是實際帳戶權限。

所有跨頁入口保留原外觀及識別但移除 href，並加入停用標記。即使 JavaScript 未載入，也不會導向頁面、API、編輯或刪除。保留原 Bootstrap 本機 dropdown/collapse 程式與最小鍵盤啟動適配；不加入替代彈窗或假後端。CSP 禁止連線、表單與 frame，沒有真家庭資料、外部服務、模型、資料庫或瀏覽器儲存。

## 必要差異與未驗證項目

- 使用 Django 5.2.8/Python 3.12.14 做模板渲染，不執行原 Django 1.11.6 應用。固定 UTC DateField 年齡計算採同時區、相同 naive local-midnight 語意。
- 重用同 commit、原 theme/Bootstrap/Font Awesome 的既有 CSS；以 libsass 0.23.0 重新在記憶體編譯比對相同。不是原 gulp/node-sass 執行環境；未載入不相關 report timeline/date-picker CSS、favicon/PWA 或原資料刷新 JS。
- 原頁將動作群誤標為 `Timer actions`，且圖示按鈕缺少描述性 accessible name；此忠實展示保留並揭露問題，沒有宣稱無障礙通過。
- 尚未使用 browser 檢查桌機／手機像素、字型載入、斷點、Reports／nav dropdown、collapse、鍵盤焦點或讀屏。靜態檢查不是完整 UX／視覺驗收。
- 沒有宣稱與原截圖像素一致；既有 C-03 對照的 screenshot 是另一個 Dashboard 頁，不是本 Child Detail。
- 歷史 vendor 只供隔離參考展示，不建議作正式環境依賴。

完整機讀來源與限制見 `manifest.json`。
