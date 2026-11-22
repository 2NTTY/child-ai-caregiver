# 選配工作台：手機提醒：回到指定的班級待辦

第 112 題新增兩張獨立重繪的完整頁示意，累計 112 題／227 款。
- A 依 [Etar Calendar v1.0.57](https://github.com/Etar-Group/Etar-Calendar/blob/dcc308671852a7ac7f0f3bf096ef2dab580e7b43/app/src/main/res/layout/event_info.xml#L16-L82)（相關版面 Apache-2.0，應用整體 GPLv3），由事件提醒到指定的整頁事件詳情。
- B 依 [Nextcloud Deck Android 1.26.3](https://github.com/stefan-niedermann/nextcloud-deck/blob/569df67203a54fc60125495b7570dd217a79d99f/app/src/main/res/layout/activity_edit.xml#L8-L55)（相關程式 GPL-3.0-or-later），開啟所指的整頁卡片。卡片的多分頁不是育伴港功能。

兩張都是非官方靜態示意。[育伴港的 Android 通知入口](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/production/useNativePushNavigation.ts#L12-L25) 在點開時重新核對當下資格，再指向同一班級、孩子和指定待辦，不按名稱猜測。開啟不是完成、已讀回執或更改權限；示意沒有送出提醒或查閱真實資料。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `f31c5eab6c10cae77f225ba0ef7b07f525bbce63366e6252adb8c577dc754d73`。
候選 HTML 765826 位元組，SHA-256 `d78c1507dc07f0107b015117944b7499eb07d3935ba1be955a243bab8f79895a`。
原有 111 題、225 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 112 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未送或點開真實通知、查閱班級資料或更改待辦。

四個純文字檔：本說明、`candidate-227/build.py`、`candidate-227/manifest.json`、`check-candidate227.cjs`。
完整還原包另行私人保存：230 個 ZIP 條目、229 筆 SHA-256 清單、228 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
