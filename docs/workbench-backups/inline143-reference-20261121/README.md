# 選配工作台：留在工作頁，問這一項

70 題／143 款的獨立候選。第 70 題新增兩張非官方自製示意：A 依 [Code – OSS 1.107.1 的行內對話](https://github.com/microsoft/vscode/blob/994fd12f8d3a5aa16f17d42c041e5809167e845a/src/vs/workbench/contrib/inlineChat/browser/inlineChatSessionServiceImpl.ts#L399-L409)，把未送出的問題放在選取段落上方；不表示送出時只使用該段。B 依 [Jupyter AI v3.1.0 文件](https://github.com/jupyterlab/jupyter-ai/blob/00c1fa5809f08c9c0a6d41553119a8aaae6bc528/docs/source/users/index.md#L133-L144)及 [Jupyter Chat v0.23.0 的附件實作](https://github.com/jupyterlab/jupyter-chat/blob/5d74c49baf56c1e1ee59a0912dd4a6a096f84a9b/ui-tests/tests/attachments.spec.ts#L150-L198)，在旁邊的提問草稿手動附上單元格；附件只標示筆記本檔名，沒有單元格編號。兩圖互不相連、全用虛構資料，不代表育伴港的實際行為，沒有送出問題、執行程式、呼叫模型、產生答案或改動文件。MIT 與 BSD-3-Clause 為上游授權，不是圖像授權。

## 核對與定位

候選 HTML 為 530,330 位元組，SHA-256 為 `5776f44da68aedce6c87e28966ea44c01095ff4deb0c26b5d9f3e04b82ef546e`；基準 HTML SHA-256 為 `8f7c6829275cafd4e2fb68983038b5daaa8ef14908114d33248bf5700aae0e61`；候選清單 SHA-256 為 `6c505192d4442976bb34e813a4ccf9c90abf751f2058cf4f2df6e7c30fcead07`。本機還原包已比對封存 HTML、全部 143 張圖及候選清單的原始位元組。

在 `docs/workbench-backups/inline143-reference-20261121/` 找到以下四個文字檔：
- `README.md`：本說明
- `candidate-143/build.py`：精確組裝及檢查
- `candidate-143/manifest.json`：候選來源、版本、署名與圖像雜湊
- `check-candidate143.cjs`：本機差異及互動檢查

## 私人復原

此文字備份不含圖片、私人原件、憑證或私人取件資料。完整復原須另用已核對的私人副本；先驗 ZIP 雜湊及全部 CRC，並只在新的私人資料夾解壓。核對 145 筆 SHA-256 清單與允許的 146 個條目；若出現額外檔案、絕對路徑、上層路徑或符號連結，停止。把 `out/index.html` 與完整 `out/visuals/` 保持原相對結構，兩者合共 144 個工作台檔案；來源清單及雜湊帳本留在備份，不放進服務路徑。此備份不是部署，不改動產品網站。
