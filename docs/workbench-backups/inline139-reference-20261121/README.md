# 選配工作台：解除封存

68 題／139 款的獨立候選。第 68 題新增兩張非官方自製示意：A 依 [OpenProject v17.0.0 的封存專案清單](https://github.com/opf/openproject/blob/acbb059c8820da8236cee1f43dc0796d83836259/app/views/projects/index.html.erb#L30-L45) 呈現合資格專案的列選單；B 依 [Vikunja v2.1.0 的解除封存確認](https://github.com/go-vikunja/vikunja/blob/ec11643c24b0f00c55ec5a60328b54e2c3a69962/frontend/src/views/project/settings/ProjectSettingsArchive.vue#L1-L13) 呈現在原專案內、執行前的確認。兩圖使用不同的虛構專案，不代表育伴港的權限或行為，也沒有顯示任何操作已執行或成功。GPL-3.0-only 與 AGPL-3.0-or-later 分別是上游程式授權，不是圖像授權。

## 核對與定位

候選 HTML 為 518,856 位元組，SHA-256 為 `a92b02b76302b5c5924f92f29b861488317150a5f164bf1cbcf5ef7e720c8bdc`；基準 HTML SHA-256 為 `7bd7af454a743bdaf1eb1f308f51dff95b8f719824391d1d74933ad9f81cba09`；候選清單 SHA-256 為 `a6872a4618a5f6520d1ccec89dabf89c8bc3b1cf6dfc70ead906cfdcedeb454f`。獨立差異核對確認舊 67 題、137 張圖片、原來源與互動未改。Chrome 確認第 68 題兩圖能在頁內顯示及放大，可點暗處或按 Esc 關閉。

在 `docs/workbench-backups/inline139-reference-20261121/` 找到以下四個文字檔：
- `README.md`：本說明
- `candidate-139/build.py`：精確組裝及檢查
- `candidate-139/manifest.json`：候選來源、版本、署名與圖像雜湊
- `check-candidate139.cjs`：本機差異及互動檢查

## 私人復原

此文字備份不含圖片、私人原件、憑證或私人取件資料。完整復原須另用已核對的私人副本；先驗 ZIP 雜湊及全部 CRC，並只在新的私人資料夾解壓。核對 141 筆 SHA-256 清單與允許的 142 個條目；若出現額外檔案、絕對路徑、上層路徑或符號連結，停止。把 `out/index.html` 與完整 `out/visuals/` 保持原相對結構，兩者合共 140 個工作台檔案；來源清單及雜湊帳本留在備份，不放進服務路徑。此備份不是部署，不改動產品網站。
