# 第 58 題｜語音回看：這一句，原錄音怎樣說？

轉錄寫了「八點半」，家長記得自己說的是「八點」。設計要解決的不是猜哪個時間對，而是讓家長自己找到那一句，回去聽同一段原聲。此處的照顧情境、句子和「0:12」均為虛構的合成示例；沒有使用或播放私人錄音。工作台只記錄設計選擇。

## 育伴港已有甚麼

前置讀碼基準為 [master 的 3c02633](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)。[附件回看分頁](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/photos/PhotosView.tsx#L92-L117) 將語音和相片、影片、文件分開。[正式清單](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/useAttachmentReview.tsx#L83-L95) 為每則語音接上列內播放器，不用重錄或重送助手。[轉錄及跳播邏輯](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/VoiceMessage.tsx#L68-L83) 將原聲和文字分開處理：[原音讀取](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/VoiceMessage.tsx#L48-L62) 會再核對範圍與版本；[播放器](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/LocalAudioPreview.tsx#L21-L35) 支援從指定秒數播放。

- 有段落和開始時間：以該段為入口，回到原錄音聽；點中且變色本身，不代表音訊真的跳播。
- 段落沒有開始時間：可以讀文字，不編造時間碼。轉錄還未完成或只有部分時，不要因此藏起可讀的原錄音，家長仍能自行重聽。
- 原錄音不可讀：說清楚無法播放，不顯示成可以核對的證據。轉錄是辨音線索，不等於已確認的照顧記錄，也不是在此修改逐字稿。

## 兩張作者原圖可以怎樣看

1. **語音-01｜Typist：先找一句，再回到原聲。** [作者原圖](https://img.iamtypist.dev/blog/how-to-add-timestamps-to-a-transcript/2026-11-07-timestamps.webp) 是一段 20 秒的短錄音；結果頁上方有數個藍色時間標記，下方只有一個播放器。[教程](https://iamtypist.dev/blog/how-to-add-timestamps-to-a-transcript) 說明樣本用自寫文字與合成語音製作；[產品說明](https://iamtypist.dev/) 解釋點文字如何定位音訊。借鑑的是「看到一句，聽回原聲」的閱讀次序，不是直接搬波形、品牌或範文。原圖是靜態的，不能證明育伴港跳播成功。
2. **語音-02｜Transcription App：留著播放器，逐段對照。** [作者原圖](https://transcription-app.com/wp-content/uploads/2026/11/transcription-app-transcript-editor.webp) 中央列出段落起迄時間，右側是同一則錄音的播放器。[官方教程](https://transcription-app.com/tutorials/6-working-with-transcripts/) 說明開啟 Play on click 後，可從段首重聽。這是桌面教學檔；作者未說音源是否由 TTS 合成，我們沒有使用或複製錄音、姓名、頭像或逐字內容。手機設計只借用「保留同一個播放器」與段落入口，不表示育伴港支援三欄編輯或隨播逐字著色。

[Apple Podcasts 官方說明](https://support.apple.com/en-us/127831) 區分播放和逐字稿：不能查看逐字稿，不等於不能播放。這是無轉錄情況的文字佐證，不是第三款設計；兩張原圖都沒有演示此狀態。只有點連結才開啟作者原圖或官方說明。沒有熱連圖、鏡像原圖、取用音訊或發行素材副本。

## 這個檔案核對過甚麼

- 私用單檔：`育伴港選配工作台-58主題-語音回看外鏈版-20261119.html`；30,909,156 bytes，SHA-256 `78e22c2d32af22dd3dd9c0046ad30e16b722e7aa6b93afbfc9d2729816a21535`。基準為已交付第 57 題版，SHA-256 `eeb83f014f29584731ef643fedf1f7c221162fe5e40c90ac0f4cf2e79493fc0b`。
- 共 58 題、119 款：77 款離線、42 款外鏈。去除新增一題後，既有完整資料區逐位元組一致；146 張原有離線圖片全部解碼後逐張比對摘要。第 58 題只新增兩條作者原圖連結和四條有標籤的來源或補充連結，不含媒體。
- 靜態、內容安全政策摘要和 JavaScript 語法檢查通過。離線 JavaScript VM 通過 42 組閱讀器檢查，含所有頁面的單看／並看、第 57 與 58 頁往返、最後一頁邊界、選擇／改選／撤回、摘要返回、其他選擇保留、焦點與連結。沒有以瀏覽器、手機或育伴港實際畫面驗收，沒有執行轉錄、操作第三方 App 或發布預覽。要驗收實際播放，仍需獨立合成錄音測試非零秒數跳播，以及缺少轉錄時原聲仍可播。
