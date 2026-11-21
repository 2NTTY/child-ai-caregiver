# 選配工作台第 144 頁：看完清單中段的一筆待辦，怎樣接着看下一筆？

- **A｜單頁詳情，關閉回清單。** 用 [Android Sunflower 手機整屏原圖](https://raw.githubusercontent.com/android/sunflower/99eb59417bf8a95999d2334eb5dc320627b9304e/screenshots/phone_plant_detail.png) 參考單頁閱讀。窄版在同一孩子與權限範圍內嘗試還原捲動位置；清單若有變化，不保證原列仍在同一位置。
- **B｜清單與詳情並排，直接選下一列。** 用 [Zeal Windows 完整視窗原圖](https://raw.githubusercontent.com/zealdocs/media/1867a2d01a51ef1eaad05cba4fa377d316ae9633/screenshots/windows/readme-light.png) 參考左選右讀。寬版不用先關閉詳情就可選下一列。

育伴港原碼按容器寬度選版面，不是兩個使用者設定。例子為合成待辦，沒有操作或修改待辦、沒有執行產品瀏覽器驗收。原圖只外連；精確來源版本和程式位置見 `spec144.json`。

## 重建

- 前 143 題及原執行碼不變；144 題、291 款，其中 195 款只外連，165 張既有圖片。
- 以 SHA-256 為 `e6c3b8f75513e71ee7a39bfa7795a7dad413cb09fa5b3f0d39a0338bf48d5850` 的 #143 HTML 執行 `python append144.py baseline143.html spec144.json output144.html`。
- HTML 34,507,462 bytes，SHA-256 `836519f5efb1b08ddd9813e41d84fa2def2f5cddcc69241e5f0d139c2a759d11`。
- ZIP 22,808,755 bytes，SHA-256 `9ebf698ed7b34039f1a3d692962ace9e81d280c92b79d02ff3783ae6efc9dc33`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新產品、主分支或網站。
