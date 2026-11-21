# 選配工作台：同題讀取 AI 觀點與小結

71 題／145 款的獨立候選。第 71 題新增兩張非官方自製示意：A 依 [Open WebUI v0.6.5 的並排回覆](https://github.com/open-webui/open-webui/blob/07d8460126a686de9a99e2662d06106e22c3f6b6/src/lib/components/chat/Messages/MultiResponseMessages.svelte#L210-L231)及[另列合併回覆](https://github.com/open-webui/open-webui/blob/07d8460126a686de9a99e2662d06106e22c3f6b6/src/lib/components/chat/Messages/MultiResponseMessages.svelte#L283-L315)，保留原回覆，不表示會自動合併；B 依 [Synode v0.4.4 的發言順序和綜合結果](https://github.com/mahatab/synode-council-of-ai-agents/blob/c72070d0e1ef2c412e8795c0a4a03bb94465e769/src/components/chat/ChatView.tsx#L364-L386)，呈現依序排列的模型發言及另列的綜合答覆。兩圖是互不相連的虛構成人展覽情境，不代表原產品的唯讀模式或育伴港的功能。合併與綜合都不是人工評判、核證或已保存原答的連結。本次沒有送出、呼叫模型或更改資料。BSD-3-Clause（限所列 Open WebUI 版本）與 MIT 是上游程式授權，不是圖像授權。

## 核對與定位

候選 HTML 為 535,784 位元組，SHA-256 為 `8a94bea6a0a95606a90241f8f539649307db2afbc1618ac3998b2995b1ba736f`；基準 HTML SHA-256 為 `5776f44da68aedce6c87e28966ea44c01095ff4deb0c26b5d9f3e04b82ef546e`；候選清單 SHA-256 為 `a9070e1498feccd3a546e7e2c547bd26cdfa0eab7dd7b540f2257a8d458276a4`。本機還原包已比對封存 HTML、全部 145 張圖及候選清單的原始位元組。

在 `docs/workbench-backups/inline145-reference-20261121/` 找到以下四個文字檔：
- `README.md`：本說明
- `candidate-145/build.py`：精確組裝及檢查
- `candidate-145/manifest.json`：候選來源、版本、署名與圖像雜湊
- `check-candidate145.cjs`：本機差異及互動檢查

## 私人復原

此文字備份不含圖片、私人原件、憑證或私人取件資料。完整復原須另用已核對的私人副本；先驗 ZIP 雜湊及全部 CRC，並只在新的私人資料夾解壓。核對 147 筆 SHA-256 清單與允許的 148 個條目；若出現額外檔案、絕對路徑、上層路徑或符號連結，停止。把 `out/index.html` 與完整 `out/visuals/` 保持原相對結構，兩者合共 146 個工作台檔案；來源清單及雜湊帳本留在備份，不放進服務路徑。此備份不是部署，不改動產品網站。
