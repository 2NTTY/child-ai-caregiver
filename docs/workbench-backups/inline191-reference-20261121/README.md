# 選配工作台：助手對話：切模式，只影響之後的訊息

第 94 題新增兩張獨立重繪的完整頁示意，累計 94 題／191 款。
- A 依 [Cline v3.74.0](https://github.com/cline/cline/blob/bde7049c016352047f033cdfe513743ad0bf6ea9/webview-ui/src/components/chat/ChatView.tsx#L327-L395)（相關程式 Apache-2.0），在對話底部用簡短的 Plan／Act 切換，保留上方工作紀錄。
- B 依 [Goose CLI v1.59.0（歷史版本）](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/Cargo.toml#L7-L13)（相關程式 Apache-2.0），在同一個終端對話內顯示模式變更確認，不開另一段對話。現行育伴港並不使用斜線指令切換。

兩張都是非官方靜態示意。[育伴港](https://github.com/2NTTY/child-ai-caregiver/blob/1077b9901389b341ad9105a358480f8a12a7fd24/src/client/chat-controller.ts#L348-L368) 只把新模式用於之後送出的訊息。已開始的回覆不會被切換或停止；既有對話亦保留。「只是聊天」仍可搜尋及問答，但不建立正式記錄、待辦、檔案或核對卡。上游參考不代表相同的權限或切換規則。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `a175abb83f9cb8178dda5a11bd88b6a7dea458fa23d31bdb8aef3db3b770050b`。
候選 HTML 669784 位元組，SHA-256 `a0acc7ed5196b1ffc0827dd2eccd852d81fb43b12be792e78e3078670e69e81f`。
原有 93 題、189 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 94 題可直達、核對兩個固定來源，兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未在產品切換模式、傳送訊息或執行指令。

四個純文字檔：本說明、`candidate-191/build.py`、`candidate-191/manifest.json`、`check-candidate191.cjs`。
完整還原包另行私人保存：194 個 ZIP 條目、193 筆 SHA-256 清單、192 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
