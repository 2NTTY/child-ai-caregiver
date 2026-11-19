# 第 60 題｜孩子頭像：小圓框裡還認得出來嗎？

家長想用自己畫的小船代表孩子，不需要孩子的真人照片。原畫是橫幅，中間裁一塊會切走船頭。這次比較兩種設計：一邊調整、一邊看縮小後是否仍然認得；或先取景，之後再確認是否更換。工作台只記下你選哪款設計，不接收圖片，也不更換任何人的頭像。

## 育伴港已實作甚麼？

依據 [master 固定修訂 3c02633](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b) 的前置源碼查核，並非現站或真機測試：

1. 在[子女檔案](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/profileScreen.tsx#L22-L43)核對孩子的稱呼，再開「調整孩子頭像」。[編輯視窗](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/avatar/AvatarEditor.tsx#L23-L50)說明頭像只供有權查看這位孩子的成員使用，不會加入聊天、照片或模型分析；只可查看的成員不能修改。
2. [網頁版](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/avatar/AvatarCropPreview.web.tsx#L33-L54)可拖動或用方向鍵移動，在圓框裡縮放；[原生手機 App](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/avatar/AvatarCropPreview.tsx#L13-L22)顯示系統選圖後的裁切預覽，不是兩端都有同一個滑桿。這是檔案內的對話框，不是修改姓名、建立孩子或管理相簿。
3. 本次選圖可以取消，不會因此移除原有頭像。按「保存頭像」才開始上傳；實作會一起處理選圖位元組與裁切資料，不能說只傳裁下的一小塊。[上傳、採用及重讀完成後才顯示已保存](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/AvatarOwner.ts#L142-L167)。另行移除已存頭像需要確認，之後顯示名字首字。工作台不執行任何一項操作。

## 兩款可以看甚麼？

**頭像-01｜Gravatar：大圖取景，小圓看辨不辨得到。** [官方原圖](https://support.gravatar.com/wp-content/uploads/2025/07/e688aae59c96-2025-07-29-e5878ce699a82.42.13.png?w=1024)可同時看到圓框外變暗的大圖、左下黑貓的小圓、下方 Zoom 和上方 Cancel／Done。[官方說明及原圖出處](https://support.gravatar.com/avatars/#image-editing)。這是 2025-07-29 的支援圖，不等於今日產品組建。**若主要問題是「縮小後還認不認得」，我會選這款**：不用切換畫面便能比較大圖和小圓。育伴港可在實際最小使用尺寸加預覽，先量尺寸，不照搬濾鏡，也不把小圓說成現成功能。支援頁未列出這張截圖和貓照的再發布許可；開發者文件的授權不能直接套用。

**頭像-02｜Akvatar：先裁切，再決定要不要換。** [裁切原圖](https://raw.githubusercontent.com/patschi/akvatar/145327f20f2f2eaf12956745bc52913b451cbbda/docs/images/3-dashboard-image-cropping.png)用方形網格框住鳥照；[確認原圖](https://raw.githubusercontent.com/patschi/akvatar/145327f20f2f2eaf12956745bc52913b451cbbda/docs/images/4-dashboard-image-preview.png)才以圓形展示結果，下方有 Save 和 Cancel，背景頁首仍可見舊頭像。[作者教程（步驟 4、5）](https://github.com/patschi/akvatar/blob/145327f20f2f2eaf12956745bc52913b451cbbda/docs/screenshots.md#4-crop-the-image)固定於修訂 145327f，未標明截圖日期或圓形顯示尺寸。這款較適合強調「選檔不等於更換」。育伴港可在同一層顯示目前／調整後的小圓，不必多開一個彈窗。這是網頁產品的畫面，不是育伴港原生選圖器。[程式碼的 GPL v3](https://github.com/patschi/akvatar/blob/145327f20f2f2eaf12956745bc52913b451cbbda/LICENSE)不能證明第三方鳥照已清權。

兩款都只連作者的原圖和出處，不內嵌、不熱鏈載入、不鏡像動物照片，沒有使用真人或未成年人的照片。截圖證明畫面上有甚麼，不能證明鍵盤操作、取消後的持久化結果，或套用到孩子檔案的權限。兩套均不是已授權重刊的外部素材。

## 檔案和驗證

- 私用 HTML：`育伴港選配工作台-60主題-孩子頭像裁切外鏈版-20261119.html`，30,916,677 bytes，SHA-256 `225ba819befb03e68c26b56f0e90929c7796a8687a2b4490a454604bc7b8135a`。第 59 題交付基準 SHA-256 為 `38710b4493709df863ffffe897e6be943e8657c5f234dccbf4038a235b53ffad`。
- 共 60 題、123 款（77 款離線、46 款外鏈）。從資料區移除本項新增位元組即可還原舊資料區；146 張舊圖逐張解碼核對 SHA-256。新題只有 2 個主要原圖、1 個補充原圖及 2 個作者教程連結；沒有加入可轉載或離線開啟的新圖片。
- 靜態驗證、CSP 雜湊和 JavaScript 語法通過；離線 VM 48 組核對通過，包括全 60 題單看／並看、新題連結、選取／改選／撤回、摘要往返、保留其他選擇、焦點及末頁邊界。VM 不開外鏈；未操作瀏覽器或真機、未上傳選圖、未修改育伴港、未發布預覽。
