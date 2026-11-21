# 選配工作台：助手對話：回看舊訊息，何時回到最新？

第 92 題新增兩張獨立重繪的完整頁示意，累計 92 題／187 款。
- A 依 [LibreChat v0.8.9（預發行）](https://github.com/LibreChat-AI/LibreChat/blob/d4e85d2205c78413ee27d631d7e3b7313556f21d/client/src/routes/Root.tsx#L190-L222)（相關程式 MIT），對話輸入列上方右側用一枚圓形箭嘴，讓回看畫面保持清爽。
- B 依 [Stoat for Web 0.16.0](https://github.com/stoatchat/for-web/blob/6425e83f54d6a87c10d023b696dc8d74a51621dc/packages/client/src/Interface.tsx#L90-L133)（相關程式 AGPLv3），在時間線與輸入列之間用整條文字提示，交代目前正在看舊內容。上游依歷史載入區段顯示，並非往上捲一下就出現。

兩張都是非官方靜態示意。[育伴港的對話時間線](https://github.com/2NTTY/child-ai-caregiver/blob/657d5b19f97f3c28c6fd242968859d4f4c848487/frontend/src/components/chat/ChatTimeline.tsx#L59-L120) 可在往上回看時暫停自動跟隨；按「回到最新」或自己捲回近底部可重新跟上。不涉及發送、已讀狀態或實際模型呼叫。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `1ad7330a31459b95f47f58339349c54f92a85a3f41e87c96715f2663471468d7`。
候選 HTML 660398 位元組，SHA-256 `835cf793ed6025edcbe05771e1936f2a777ccbdf171b6b15ce15997467529c9a`。
原有 91 題、185 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 92 題可直達，並排顯示兩個固定來源。分別放大兩圖，按 Escape／點暗處關閉後回復原圖按鈕焦點。只驗收工作台，沒有發送訊息或呼叫模型。

四個純文字檔：本說明、`candidate-187/build.py`、`candidate-187/manifest.json`、`check-candidate187.cjs`。
完整還原包另行私人保存：190 個 ZIP 條目、189 筆 SHA-256 清單、188 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
