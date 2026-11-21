# 選配工作台：已登入，這一頁未共享

69 題／141 款的獨立候選。第 69 題新增兩張非官方自製示意：A 依 [Mattermost v10.8.0 的頻道錯誤頁](https://github.com/mattermost/mattermost/blob/bb105f3a2785636ad53b2d0bf4027900d41f6a67/webapp/channels/src/components/error_page/error_page.tsx#L137-L156) 呈現不透露頻道名稱、成員或訊息的整頁提示；B 依 [Moodle v5.0.0 的課程報讀入口](https://github.com/moodle/moodle/blob/78e860178314c45441a21e0b99455400b8283d48/enrol/index.php#L97-L107) 只顯示原已公開的成人工作坊簡介，不提供自行報讀，也不表示可顯示原本受限的任何資料。兩幅是不同工具的獨立示例，不代表育伴港的存取行為，也沒有實際登入、讀取受限資料或更改權限。Apache-2.0 與 GPL-3.0-or-later 分別是上游程式授權，不是圖像授權。

## 核對與定位

候選 HTML 為 525,033 位元組，SHA-256 為 `8f7c6829275cafd4e2fb68983038b5daaa8ef14908114d33248bf5700aae0e61`；基準 HTML SHA-256 為 `a92b02b76302b5c5924f92f29b861488317150a5f164bf1cbcf5ef7e720c8bdc`；候選清單 SHA-256 為 `1b8ecba0fe8e81112ce4b1b452e0d3dc65a09804e9d835b6b06d7276aa7ac9c3`。獨立差異核對確認舊 68 題、139 張圖片、原來源與互動未改。Chrome 確認第 69 題兩幅圖均可在頁內顯示並以 1280 × 880 放大，可點暗處或按 Esc 關閉。

在 `docs/workbench-backups/inline141-reference-20261121/` 找到以下四個文字檔：
- `README.md`：本說明
- `candidate-141/build.py`：精確組裝及檢查
- `candidate-141/manifest.json`：候選來源、版本、署名與圖像雜湊
- `check-candidate141.cjs`：本機差異及互動檢查

## 私人復原

此文字備份不含圖片、私人原件、憑證或私人取件資料。完整復原須另用已核對的私人副本；先驗 ZIP 雜湊及全部 CRC，並只在新的私人資料夾解壓。核對 143 筆 SHA-256 清單與允許的 144 個條目；若出現額外檔案、絕對路徑、上層路徑或符號連結，停止。把 `out/index.html` 與完整 `out/visuals/` 保持原相對結構，兩者合共 142 個工作台檔案；來源清單及雜湊帳本留在備份，不放進服務路徑。此備份不是部署，不改動產品網站。
