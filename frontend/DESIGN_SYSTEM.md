# 育伴港 Web 設計規則

本版由首頁參考圖提取可重用的視覺語言，再以育伴港原有 Logo、海旁插畫及香港繁體中文落地。圖片只決定視覺方向，不改寫 [SPEC](../SPEC.md) 的功能或狀態語義；後續圖片可在工作包內局部修訂這份規則。

## 共通語言

- 暖白與淡綠作背景，深綠作正文，青綠只突出主要操作；琥珀代表待核對／結果未知，珊瑚代表明確失敗。
- 內容由「目前孩子、現在需要留意、已確認資料」向下展開；標題、摘要、次要資料各有固定字級，不能用顏色代替文字說明。
- 卡片用柔和邊框、圓角和足夠留白；狀態標籤與操作按鈕分開，避免把狀態看成可點擊的結果。
- 寬桌面用側欄、主內容和摘要欄；中等寬度保留側欄但收起摘要欄；窄 Web 單欄及底部導覽。版面根據視窗寬度重排，320 CSS px 不應橫向捲動。
- 1586×992 參考圖的桌面結構落成為：左側導覽；頁首孩子／地區／資料摘要；中央基本聊天入口、資料概況、待確認狀態及記錄；右側子女資料、近期已確認記錄和連線。圖中的「處理進度」位置改以真實資料狀態表示，沒有臆造百分比。

## 現行 tokens 與元件

實值以 [theme.ts](src/theme.ts) 為準：文字 `#203E3A`、主青綠 `#287568`、暖紙 `#FAF7EF`、淡綠 `#DDE8DB`、琥珀 `#D99A3D`、珊瑚 `#C86D52`。間距採 4／8／12／16／24／32／40 px；圓角採 10／16／22 px 及膠囊形。字級採 12／14／16／20／28／34 px；Web 優先 `Noto Sans TC`、`Microsoft JhengHei`、`PingFang TC` 系統字體，沒有從外站載入字體。

| 共用部分 | 首包做法 | 後續頁面用法 |
|---|---|---|
| 主要／次要按鈕 | [AppButton](src/components/ui.tsx) 包裝 React Native Paper `Button` | 共用高度、字重、顏色與 disabled 狀態 |
| 表單輸入 | Paper `TextInput`，首頁僅作已載入記錄的本地篩選 | 複雜表單需按實際契約再核對 Paper、RHF／Zod；不預建空表單框架 |
| 卡片與區段 | `SectionCard`、`SectionHeader`、`TextLink` | 同一留白、標題層次和鍵盤可操作入口 |
| 狀態標籤 | `OperationPill`、`ConnectionPill` | 明示「待確認／處理中／已保存／失敗／結果未知」，網絡可用不等於保存 |
| 孩子選擇 | Paper `Dialog`＋`RadioButton.Item` | 保留唯一孩子身份及明確選擇；避免選錯孩子的資料混入 |
| 空、載入、離線 | [HomeDashboard](src/components/HomeDashboard.tsx) 依 view model 切換 | 共用文案規則；不把空資料、讀取失敗或離線混成同一狀態 |

成熟組件以 [React Native Paper 5.x](https://oss.callstack.com/react-native-paper/docs/guides/getting-started) 為基礎；Expo Router、React Native Web 的使用方式參考 [Expo Router](https://docs.expo.dev/router/advanced/tabs/)、[Expo design-system skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md) 與 [RNW styling](https://necolas.github.io/react-native-web/docs/styling/)。首包實測 Paper 定位式 `Menu` 在本版 Expo Web 預覽無法可靠顯示選項，孩子選擇改用 Paper `Dialog`；不為這一個問題自造選單。

## 參考圖不能直接照搬之處

參考圖的嫩芽標誌與本項目現有 Logo／海旁美術不符；本版沿用倉庫素材。圖中的 Agent 百分比、背景任務、通知、附件、疫苗安排與若干健康數據，不能因為圖片存在就視為已接通。首頁只顯示目前能準確表達的合成孩子、已確認記錄與操作狀態；入口在預覽中會解釋待正式接線，不製造假結果或假路由。年齡保留「約數」與日期基準，不從圖片推斷精確出生日期。
