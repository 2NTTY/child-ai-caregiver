# 育伴港選配工作台 · 86 主題搜尋版

原有 86 題、175 款方案、146 張原圖、所有來源和比較捷徑保留。新增一個離線搜尋欄：輸入主題、參考名稱，或數字頁碼（例如 `Hero`、`切到妹妹`、`86`）。輸入時只顯示結果，點選才跳頁；有多款時直接並看。既有選擇不受影響。沒有新增連網、儲存、傳送或自動套用。

## 驗證及備份

- [第 86 題基線的備份記錄](https://github.com/2NTTY/child-ai-caregiver/blob/20a2891a4966ea7c0f79c38b521e59c1e9cafe01/docs/workbench-backups/index100-current-child-switch-20261119/README.md)。基線 SHA-256 `55fee94b52d1927d1e56433df0d9f1d281d14d94a938cca49b36130f31c08ae4`。
- 搜尋版 31012215 bytes，SHA-256 `fa59f1a4114bcb2f91ebc0ab45a02bd19a620af75729127734abd275d4e9426d`。完整資料逐位元組相同；逐張核對 146 圖及 CSP，保留 50 個原有快捷項目。模擬 DOM 驗證全形頁碼、參考名、清空與無結果、選擇維持及導覽；原基線比較測試仍通過。實際 Chromium 因環境不允許 socket 而無法啟動，未做實際瀏覽器驗收。
- 完整 HTML 私人保存；GitHub 保留不含圖片、草稿或私有資料的可重現修改。未發布、未開 PR，未變更項目產品。

## 可重現修改

將以下存作 `apply_finder.py`，以 Python 3 執行 `python3 apply_finder.py baseline.html workbench-search.html`，輸出另一份 HTML，不覆蓋原件。使用基線檔復作後已逐位元組比較相同。

```python
import base64,hashlib,re,sys
from pathlib import Path
BASE=Path(sys.argv[1])
data=BASE.read_bytes()
assert hashlib.sha256(data).hexdigest()=='55fee94b52d1927d1e56433df0d9f1d281d14d94a938cca49b36130f31c08ae4'
head,tail=data.decode().split('<script type="application/json" id="records">',1)
records,javascript=tail.split('</script><script>',1)
js,end=javascript.split('</script>',1)
css=re.search(r'<style>(.*?)</style>',head,re.S)[1]
finder='<div class="topic-finder"><label for="topic-search">搜尋主題、參考名稱或頁碼</label><input type="search" id="topic-search" autocomplete="off" maxlength="100" aria-controls="topic-results"><p id="topic-search-status" class="status" role="status" aria-live="polite" aria-atomic="true"></p><div id="topic-results" class="actions" role="group" aria-label="主題搜尋結果" hidden></div></div>'
anchor='我的選擇（0）</button></section>'
assert head.count(anchor)==1
head=head.replace(anchor,'我的選擇（0）</button>'+finder+'</section>')
new_css=css+"""
.topic-finder{flex:0 0 100%;min-width:0;display:grid;gap:5px;margin-top:6px}.nav .topic-finder label{min-width:0;max-width:none;width:auto}.topic-finder input{width:min(100%,420px);min-height:44px;padding:9px 13px;border:1px solid #a6bbb0;border-radius:9px;font:inherit;color:var(--ink);background:#fff}.topic-finder input:focus-visible{outline:3px solid #154b8a;outline-offset:3px}.topic-finder .status:empty{margin:0}.topic-finder button{text-align:start;overflow-wrap:anywhere}
"""
hook="document.querySelectorAll('[data-latest]')"
assert js.count(hook)==1
new_js=js.replace(hook,"""const topicSearch=by('topic-search'),topicResults=by('topic-results'),topicStatus=by('topic-search-status');
const normalizeTopic=s=>s.normalize('NFKC').toLowerCase().trim();
const searchableTopics=groups.map(g=>[g.title,...g.choices.map(c=>c.name)].map(normalizeTopic));
function drawTopicResults(){
 const q=normalizeTopic(topicSearch.value??'');
 topicResults.replaceChildren();
 topicResults.hidden=!q;
 topicStatus.textContent='';
 if(!q)return;
 const numeric=/^[0-9]+$/.test(q);
 let count=0;
 groups.forEach((g,i)=>{
  if(numeric ? Number(q)!==i+1 : !searchableTopics[i].some(label=>label.includes(q)))return;
  const b=clickBtn('第 '+(i+1)+' 頁：'+g.title,()=>{groupIndex=i;viewMode=g.choices.length>1?-1:0;showList=false;draw();by('viewtitle').focus()});
  b.dataset.topic=String(i);
  topicResults.append(b);
  count++;
 });
 topicStatus.textContent=count?'找到 '+count+' 個主題':'沒有符合的主題';
}
topicSearch.addEventListener('input',drawTopicResults);
drawTopicResults();
"""+hook)
hashvalue=lambda s:base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()
for old,new in [(css,new_css),(js,new_js)]:
 h="sha256-"+hashvalue(old)
 assert head.count(h)==1
 head=head.replace(h,"sha256-"+hashvalue(new))
head=head.replace('<style>'+css+'</style>','<style>'+new_css+'</style>')
result=(head+'<script type="application/json" id="records">'+records+'</script><script>'+new_js+'</script>'+end).encode()
out=Path(sys.argv[2])
out.write_bytes(result)
print(str(out),len(result),hashlib.sha256(result).hexdigest())
```
