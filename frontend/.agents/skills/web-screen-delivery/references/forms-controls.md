# 共用表單、日期時間及可存取控件

適用 frontend/ 的 Paper 5.15.3／RN Web 0.21.2／RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4／Paper Dates 0.24.0／Luxon 3.7.2；最後核對 2026-09-29。改表單／選單／日期／彈窗時才讀，產品及 payload 仍以根契約為準。

- 沿 Controller 接 AppTextField／AppSelect，將 field.ref 傳到實際欄位。ref callback 不回傳 RHF ref 的任意結果，避免 React 19 視為 cleanup。handleSubmit 的原值不為顯示而 trim／parse 後覆寫，schema 只驗證；錯誤靠近欄位。
- 秘密欄沿 AppTextField 的 secureTextEntry，明確停用 autofill／自動修正；送出、失敗、離線、身份／Server 切換及卸載清理。只在當次直接 request 使用，不寫 browser storage、合成 metadata、timeout closure 或重試正文。本人設定按身份／Server 隔離，孩子切換不清本人草稿；沿原契約處理 unknown，不能通用地假定都有 opId。Paper 標籤的實際動畫須穩定才截圖，不因中間幀 fork vendor；本包證據見 [MODEL_SETTINGS_HANDOFF](../../../../MODEL_SETTINGS_HANDOFF.md)。
- 日期是 YYYY-MM-DD，用 local noon carrier 給日曆而非當作 instant；安排時刻是帶 offset 的 ISO 字串加 IANA timeZone。沿 components/date-time.ts 的 Luxon 轉換，拒絕无效日、DST gap／ambiguous 本地時間，沒有自行選第一個 offset。未改時間保留原 ISO。
- Paper Dates 註冊 zh-HK translation（沿 zhTW，局部香港按鈕文案）；使用 DatePickerModal／TimePickerModal 原生及 Web 公開 API。其標準時間 modal 寬度至少 328，小於 360 用公開 TimePicker 的 keyboard inputType 放 AppDialog，不修改 node_modules。保留有 label 的手填日期／HH:mm 欄位。
- Paper 官方 Modal 說明需要 accessible modal 時用 React Native Modal。AppDialog 使用 RN Modal 包 Paper Dialog 視覺，Web 沿內建 focus trap／Escape／焦點還原；不要把所有 Portal 當成有 modal semantics。嵌套日曆／時鐘只關最上層，驗關閉後能回原欄位。
- RN Web 的狀態映射以本版實際 DOM 為準。AppSelectionTrigger、AppCheckbox、Radio.Item／UnderlineTabs 明確補 ARIA，原生仍給 accessibilityState。選單提供選項 labels、expanded、disabled，驗 Tab／Enter／Space／Escape。Paper Button 會替換自身部分狀態，選擇觸發器不用逐頁覆蓋其內部結構。
- 端到端合成檢查採真正點擊、focus、選取和鍵盤。Paper Dates 時間欄 focus 會格式化 leading zero；同一任務 focus＋paste 可能不是使用者鍵盤行為，要先確認實際鍵盤結果再改元件，不為自動化細節 fork vendor。

官方文件已核對：[RHF Controller](https://react-hook-form.com/docs/usecontroller/controller)、[Paper Modal](https://oss.callstack.com/react-native-paper/docs/components/Modal)、[RN Web Modal](https://necolas.github.io/react-native-web/docs/modal/)、[Paper Dates](https://web-ridge.github.io/react-native-paper-dates/)、[Time picker](https://web-ridge.github.io/react-native-paper-dates/guide/time-picker)、[Localization](https://web-ridge.github.io/react-native-paper-dates/guide/localization)、[Luxon API](https://moment.github.io/luxon/api-docs/index.html)。版本／許可已核對與實作已驗證分開；本包實作證據見 [HANDOFF](../../../../HANDOFF.md) 及 verification/fe-w06，未驗真 API／Android 實機。
