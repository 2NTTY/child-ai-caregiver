from pathlib import Path
from hashlib import sha256
import base64, html, io, json, re, sys, struct
from PIL import Image

def digest(s): return base64.b64encode(sha256(s.encode()).digest()).decode()
p=Path(sys.argv[1]); out=Path(sys.argv[2]); manifest=Path(sys.argv[3])
s=p.read_text()
m=re.search(r'(</script>)<script>\(function\(\)\{function c\(\)',s)
if m:s=s[:m.end(1)]+'</body></html>\n'
med={}
licenses=[]
for e in json.loads(manifest.read_text()):
    b=Path(e['file']).read_bytes()
    mime=e.get('mime','image/png')
    assert sha256(b).hexdigest()==e["sha256"] and len(b)<2_000_000
    fmt={'image/png':'PNG','image/webp':'WEBP'}[mime]
    if fmt=='WEBP': assert b[:4]==b'RIFF' and b[8:12]==b'WEBP' and struct.unpack('<I',b[4:8])[0]+8==len(b)
    with Image.open(io.BytesIO(b),formats=[fmt]) as im:
        w,h=im.size
        assert im.format==fmt and 0<w<=4096 and 0<h<=4096 and getattr(im,'n_frames',1)==1
        im.verify()
    assert e['link'] not in med and e['alt'] and e['credit']
    license_text=Path(e['license']).read_text()
    assert license_text.strip() and e['credit']
    licenses.append((e['credit'],license_text))
    for n in e.get('additionalNotices',[]):
        notice=Path(n['file']).read_bytes()
        assert sha256(notice).hexdigest()==n['sha256']
        licenses.append((n['name'],notice.decode()))
    original=e.get('original')
    if original: assert re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/blob/[a-f0-9]{40}/[A-Za-z0-9_./-]+\.png',original)
    med[e['link']]={'src':'data:'+mime+';base64,'+base64.b64encode(b).decode(),'alt':e['alt'],'credit':e['credit'],'original':original}
record=json.loads(re.search(r'<script id="records" type="application/json">(.*?)</script>',s,re.S)[1])
assert set(med)<={c['links'][0]['url'] for g in record for c in g['choices']}
style=re.search(r'<style>(.*?)</style>',s,re.S)[1]
script=re.search(r'<script>(.*?)</script>',s,re.S)[1]
new_style=style+"""
.image-preview{display:block;width:100%;margin:0 0 .55rem;padding:.35rem;min-width:0}
.image-preview img{display:block;width:100%;height:auto;max-height:26rem;object-fit:contain}
footer pre{white-space:pre-wrap;overflow-wrap:anywhere}
.image-caption{font-size:.875rem;margin:.25rem 0 .75rem}
#image-dialog{width:min(76rem,calc(100% - 1rem));max-width:none;max-height:calc(100dvh - 1rem);padding:1rem;border:1px solid #aebdcc;border-radius:1rem}
#image-dialog::backdrop{background:rgba(0,0,0,.7)}
#image-dialog header{display:flex;gap:.75rem;justify-content:space-between;align-items:center;flex-wrap:wrap}
#image-dialog h2{font-size:1.125rem;margin:0}
#image-full{display:block;width:auto;height:auto;max-width:100%;max-height:calc(100dvh - 8rem);object-fit:contain;margin:.75rem auto 0}
"""
code="""
const artwork=ARTWORK;
const imageDialog=by('image-dialog'),fullImage=by('image-full');
let imageTrigger=null;
function removeImage(){
 if(imageDialog.open)imageDialog.close();
}
let backdropStart=false;
function onBackdrop(event){
 if(event.target!==imageDialog)return false;
 const {left,top,right,bottom}=imageDialog.getBoundingClientRect();
 return event.clientX<left||event.clientX>=right||event.clientY<top||event.clientY>=bottom;
}
imageDialog.addEventListener('pointerdown',event=>{backdropStart=event.button===0&&onBackdrop(event)});
imageDialog.addEventListener('pointercancel',()=>{backdropStart=false});
imageDialog.addEventListener('click',event=>{
 const shouldClose=backdropStart&&onBackdrop(event);
 backdropStart=false;
 if(shouldClose)removeImage();
});
fullImage.addEventListener('error',removeImage);
imageDialog.addEventListener('cancel',event=>{event.preventDefault();removeImage()});
imageDialog.addEventListener('close',()=>{
 if(imageDialog.open)return;
 backdropStart=false;
 fullImage.removeAttribute('src');fullImage.alt='';
 if(imageTrigger?.isConnected&&!imageTrigger.closest('[hidden]'))imageTrigger.focus();else by('viewtitle').focus();
 imageTrigger=null;
});
function inlinePreview(c){
 const row=Object.prototype.hasOwnProperty.call(artwork,c.links[0].url)?artwork[c.links[0].url]:null;
 if(!row||typeof row.src!=='string'||row.src.length>2700000)return null;
 const accepted=/^data:image\\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(row.src);
 if(!accepted||accepted[2].length%4!==0)return null;
 const signature=atob(accepted[2].slice(0,16));
 if(accepted[1]==='png'?!accepted[2].startsWith('iVBORw0KGgoAAAANSUhEUg'):!(signature.startsWith('RIFF')&&signature.slice(8,12)==='WEBP'))return null;
 const shell=make('div'),image=make('img');
 const canEnlarge=typeof imageDialog.showModal==='function';
 const open=canEnlarge?btn('',()=>{
  if(imageDialog.open)return;
  imageTrigger=open;by('image-title').textContent=c.name;
  fullImage.alt=row.alt;fullImage.src=row.src;imageDialog.showModal();by('image-title').focus();
 }):make('div');
 open.className='image-preview';if(canEnlarge)open.setAttribute('aria-label','放大 '+c.name+' 參考圖');
 image.alt=row.alt;image.decoding='async';
 image.addEventListener('error',()=>{
  const focused=document.activeElement===open;
  shell.remove();
  if(imageTrigger===open)removeImage();
  else if(focused)by('viewtitle').focus();
 },{once:true});
 open.append(image);const credit=make('p',row.credit,'image-caption');
 shell.append(open,credit);
 image.src=row.src;return shell;
}
""".replace("ARTWORK",json.dumps(med,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c'))
point="function detail(ix,single=-1)"
insertion="  card.append(make('p','方案 '+letter(i)+(chosen?' · 已選擇':''),'letter'),make('h3',c.name),make('p',c.note),anchor(c.links[0]));"
assert script.count(insertion)==script.count(point)==1
new_script=script.replace(point,code+point).replace(insertion,insertion.replace(',anchor(c.links[0])','')+"\n  const figure=inlinePreview(c);if(figure)card.append(figure);const original=artwork[c.links[0].url]?.original;if(original)card.append(anchor({url:original,label:'原始截圖'}));card.append(anchor(c.links[0]));")
s=s.replace('<style>'+style+'</style>','<style>'+new_style+'</style>').replace('<script>'+script+'</script>','<script>'+new_script+'</script>')
s=s.replace(digest(style),digest(new_style)).replace(digest(script),digest(new_script)).replace('img-src &#x27;none&#x27;;','img-src data:;')
assert "img-src data:;" in s
s=s.replace('<section id="list"','<dialog id="image-dialog" aria-labelledby="image-title" aria-describedby="image-help"><header><h2 id="image-title" tabindex="-1" autofocus></h2></header><p id="image-help" class="sr">點圖外的暗色區，或按 Escape 關閉。</p><img id="image-full" alt=""></dialog><section id="list"',1)
s=s.replace('這裡只展示文字，比較的是設計做法，不是產品功能驗收。想看原圖、文件或原始碼，請自行開啟各方案的原方連結；原始碼連結不一定有可預覽的介面。本站沒有收錄離線參考圖或下載包。','有參考圖的方案可以直接比較，按圖在同頁放大。原方連結保留供查證。畫面僅作設計參考，並非產品功能驗收。')
if licenses:
    credits='<details><summary>參考圖署名及授權</summary>'+''.join('<h3>'+html.escape(name)+'</h3><pre>'+html.escape(notice)+'</pre>' for name,notice in licenses)+'</details>'
    s=s.replace('</footer>',credits+'</footer>',1)
with out.open('x') as fp:fp.write(s)
