# 選配工作台第 130 頁：打開「管理家庭」後，怎樣才算進入孩子的共享工作區？

- **A｜先選家庭，再開指定孩子。** [Apple 官方家庭設定整頁原圖](https://help.apple.com/assets/69F8EBBDF3B89A4F6E0C704C/69F8EBC43862495245036393/en_US/86309a67cb23199c539e0ab2b0eaf5c7.png)先列家庭與成員。育伴港的「管理家庭」不切換孩子，須到該家庭的共享孩子列明確開啟。
- **B｜按來源分組，直接選孩子工作區。** [1Password 官方 8.6 Windows 原文](https://1password.com/blog/1password-8-6-windows)顯示按帳戶分組的可選入口；此處借用分組，不借合併清單。整頁選擇器是提案，不是現有跨家庭索引。

用兩位都叫「小禾」的合成例。[共享控制器](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/src/client/shared-child-controller.ts#L35-L56)以家庭和孩子識別核對；失敗不顯示舊空間。[未共享和尚未接通](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/shared-route-access.ts#L5-L26)不能當成空清單。預覽不驅動真實切換，不更改權限、不公開聊天、不移動或合併資料，原圖只外連。

## 重建與檢查

- 前 129 頁不變。130 題、263 款，其中 167 款只外連；保留 165 張既有圖。
- #129 HTML SHA-256 `3a1ac297cecb57c460bef6e55dd035f6870f4bb409d380881a0a792e2108786c`；`python append130.py baseline129.html spec130.json output130.html`。
- HTML 34,422,622 bytes，SHA-256 `2b5348ab13a0bcacf5247f0a83d104f97586201f43912d13eb8534653cbcb81a`；ZIP 22,786,261 bytes，SHA-256 `757408bba4256f4b89ce20b1aad9a087c89a0b65390273c1eae1d39dcffb4f8b`。
- 離線檢查沒有執行現網流程，未更新網站、主分支或四方案。
