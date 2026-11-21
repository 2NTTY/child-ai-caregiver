# 選配工作台：刪除前記錄已更新：核對新版本後重新確認

第 79 題新增兩張獨立重繪的完整頁示意，累計 79 題／161 款。
- A 依 [MediaWiki 1.44.1](https://github.com/wikimedia/mediawiki/blob/02f60e14ba59bfe6d4533054d7951887bc5f3702/includes/actions/DeleteAction.php#L184-L211)（相關程式 GPL-2.0-or-later），頁首顯示記錄已變的警告和可查頁面歷史，另呈現新的確認表。
- B 依 [Gitea v1.26.0](https://github.com/go-gitea/gitea/blob/9b9d1e31aa0bd2e2bb87d2ba329521ed3c5084bd/templates/repo/editor/delete.tmpl#L1-L29)（相關程式 MIT），留在檔案樹和提交表，頂部提示原版本不符，沒有成功提交。

兩張都是非官方靜態示意，使用虛構資料。[育伴港現有畫面](https://github.com/2NTTY/child-ai-caregiver/blob/ace22957540071cc0050786c5ef84e298c3eafd9/frontend/src/components/care/CareRecordDelete.tsx#L9-L22) 版本不符時停用舊確認；採用最新版本後要重新勾選，並不是立即刪除。只有該筆記錄和更正歷史在範圍內。上游網站的刪除方式、歷史保留及重新提交規則並不等同育伴港。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `fa555fa9dcfa73d9dc6ea187def68beceb1b4ccd8bb2b2ccbb7913aa15c9bf66`。
候選 HTML 583795 位元組，SHA-256 `9b74cfca8aaf5df1b5d1f4461fe295c34c19d472bf8d68ba9810f3826aa825c1`。
原有 78 題、159 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 79 題並排顯示兩個來源，B 確認未建立提交、未刪除檔案；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。

四個純文字檔：本說明、`candidate-161/build.py`、`candidate-161/manifest.json`、`check-candidate161.cjs`。
完整還原包另行私人保存：164 個 ZIP 條目、163 筆 SHA-256 清單、162 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
