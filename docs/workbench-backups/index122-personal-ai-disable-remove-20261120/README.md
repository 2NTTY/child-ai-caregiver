# 選配工作台第 104 頁：本人 AI 的停用與移除

本頁比較兩種完整設定流程。它不執行停用、刪除或金鑰操作，也不修改或部署育伴港。前 103 頁及既有選項原樣保留；本版 104 個主題、211 款、164 張離線圖、116 款只外連。

- **個人 AI-01：同頁區分兩個操作。** [LibreOffice Calc 7.0 官方原圖](https://wiki.documentfoundation.org/images/5/50/CG7014-SettingUpCustomizing.pdf#page=34)，第 14 章第 34 頁圖 31。擷取完整管理視窗原始像素；兩個按鈕在原案例均呈灰色，只證明版面。© 2020 LibreOffice Documentation Team。章節作者 Steve Fanning、Kees Kriek、Felipe Viggiano。[原版權及署名](https://wiki.documentfoundation.org/images/5/50/CG7014-SettingUpCustomizing.pdf#page=2)，本次選用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，圖像像素未修改。
- **個人 AI-02：另頁核對移除，再顯示結果。** [KSeFGPT 官方示範 4–8.5 秒](https://ksefgpt.pl/wiedza/videos/howto/integrations/09-jak-usunac-integracje-w-ksefgpt-en.mp4#t=4,8.5) 顯示設定卡、指名確認、刪後空狀態；外連原片，不轉載圖片、影片或合成畫面。官方英文教學標註 2026-08-28，未核實拍攝組建。

[育伴港既有原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/components/model-settings/ModelSettingsView.tsx#L294-L347)：保存停用保留密鑰，另行核對移除才清除目前已保存的聊天與獨立知識搜尋密鑰；兩種操作均不會自動改用平台 AI。移除也不是向供應商撤銷密鑰或撤回已接受的請求。兩款都不是育伴港現有畫面。

## 重建及驗證

只備份可重建文本；不含私人預覽、原始素材或資料。須另有獨立保留的第 103 頁 HTML（SHA-256 `f3e05ebce3db09bc796d0388d2f4bb435bc779d335945a740ca57319c6247850`）。從上述官方 PDF 取得 `lo-calc70-ch14.pdf`，再用 `pdfimages -f 34 -l 34 -png lo-calc70-ch14.pdf lo-calc70-fig31` 擷取唯一圖 31；來源及輸出雜湊均由腳本核對。之後用 `python append104.py baseline103.html spec104.json output104.html` 重建。新版實測：

- HTML：33,924,741 bytes，SHA-256 `4ffb3e4b01330afb264749f7aabdd9c4d3437512037e3885296077b27fbecce0`。
- 單檔 ZIP：22,519,191 bytes，SHA-256 `079f878d1eb5761bc32c96251831e9ed61cd0999f694d40db0cca69ac16dc004`。
- 專項檢查通過：舊頁完整、已選項保留、搜尋及編號跳轉、雙欄對照、複製確切來源／版本。沒有上線或變更四方案。
