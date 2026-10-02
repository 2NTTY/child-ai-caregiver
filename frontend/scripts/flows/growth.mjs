import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview,assertFits,selectOption } from "../preview-browser.mjs";
import { setDateTime } from "./tasks-memory.mjs";

const button=(page,name)=>page.getByRole("button",{name,exact:true});
const field=(page,name)=>page.getByRole("textbox",{name,exact:true});
const checkbox=(page,name)=>page.getByRole("checkbox",{name,exact:true});
const current=page=>page.getByTestId("growth-item-preview-growth-current");
const topic=page=>page.getByTestId("growth-topic-preschool_development");
const contextLabel="學前發展：相關日常情況（合成選項）";
const raw="  自行核對的觀察原文；時間仍須確認。  ";
async function tools(page){if(await button(page,"顯示關注情境").count())await button(page,"顯示關注情境").click();}
async function process(page){await button(current(page),"處理這項關注").click();}
async function openTopic(page){await button(topic(page),"查看學前發展設定").click();}
async function ready(page){await page.getByRole("button",{name:/^重讀(成長關注並保留草稿|並核對原操作)$/}).waitFor();}
async function saved(page){await page.getByText(/^已模擬/).first().waitFor();}
async function fresh(browser,failures,width=320){return openPreview(browser,"/growth",width,width>=1024?992:width===390?844:720,failures);}
export async function verifyGrowth(browser,failures,directory){
  for(const width of [1440,1024,390,320]){
    const page=await fresh(browser,failures,width);
    if(await button(page,"更多頁面").count()){
      await button(page,"更多頁面").click();await button(page,"成長關注").click();
    }else{
      const link=page.getByRole("link",{name:"成長關注",exact:true});assert.equal(await link.getAttribute("href"),"/growth");await link.focus();await page.keyboard.press("Enter");
    }
    await current(page).waitFor();await assertFits(page,`growth ${width}`);
    assert.equal(await page.getByText("先與家人核對自己的觀察，再決定是否需要安排下一步（合成示例）。",{exact:true}).count(),1,"Old unavailable advice must not be presented as current");
    await page.screenshot({path:resolve(directory,`growth-${width}.png`)});await page.close();
  }
  const acknowledge=await fresh(browser,failures);await process(acknowledge);
  await button(current(acknowledge),"明確接受並記錄知悉").click();await saved(acknowledge);
  await current(acknowledge).getByText("已記錄知悉，沒有連結任務；不代表已預約或完成。",{exact:true}).waitFor();assert.equal(await button(current(acknowledge),"查看連結任務").count(),0);await acknowledge.close();

  const task=await fresh(browser,failures,390);await process(task);await selectOption(task,"接受後的安排","建立共享待處理任務");
  assert.equal(await button(current(task),"明確接受並建立共享任務").isDisabled(),true);
  await field(task,"關注任務標題").fill("  整理家庭觀察  ");await field(task,"關注任務內容").fill(raw);await selectOption(task,"關注任務負責人","媽媽");await setDateTime(task,"關注任務時間","2030-10-02","09:00");
  assert.ok((await task.getByTestId("growth-task-review").textContent()).includes(raw),"The review must retain raw task text");
  const share=checkbox(task,"我已核對時間及負責人，同意建立家庭共享任務");await share.focus();await task.keyboard.press("Space");
  await button(current(task),"明確接受並建立共享任務").click();await saved(task);await current(task).getByText("讀取當時：待處理",{exact:true}).waitFor();
  await button(current(task),"查看連結任務").click();await task.waitForURL("**/tasks");await task.close();

  const snooze=await fresh(browser,failures);await process(snooze);await selectOption(snooze,"關注處理方式","稍後處理");await button(current(snooze),"明確延後這項關注").click();
  await snooze.getByText("請選擇將來的明確日期與時間。",{exact:true}).waitFor();await setDateTime(snooze,"關注延後時間","2030-10-08","09:00");await button(current(snooze),"明確延後這項關注").click();await saved(snooze);
  await current(snooze).getByText("觀察 · 已延後",{exact:true}).waitFor();await snooze.close();

  const context=await fresh(browser,failures);await openTopic(context);
  assert.equal(await button(context,"明確保存學前發展所選近況").isDisabled(),true);await topic(context).getByText("目前已確認：尚未確認",{exact:true}).waitFor();
  await selectOption(context,contextLabel,"已與家人核對觀察");assert.equal(await button(context,"明確保存學前發展所選近況").isDisabled(),true);
  await tools(context);await selectOption(context,"關注提交結果","結果未知");await checkbox(context,"我同意保存學前發展所選近況為家庭共享已確認資料").click();await button(context,"明確保存學前發展所選近況").click();
  await context.getByTestId("growth-pending").waitFor();await ready(context);const original=await context.getByTestId("growth-original-request").textContent();
  assert.equal(await button(context,"明確查回原操作").isDisabled(),true);await selectOption(context,"關注重讀結果","基準或授權版本已變");await button(context,"重讀並核對原操作").click();await ready(context);
  assert.equal(await context.getByTestId("growth-original-request").textContent(),original,"GET must not replace the frozen version/authority/body");assert.equal(await button(context,"明確查回原操作").isDisabled(),true);
  await selectOption(context,"關注提交結果","成功");await checkbox(context,"我已核對並同意查回同一份原內容及版本").click();await button(context,"明確查回原操作").click();await saved(context);
  assert.equal(await context.getByTestId("growth-pending").count(),0);await openTopic(context);await topic(context).getByText("目前已確認：已與家人核對觀察",{exact:true}).waitFor();
  await checkbox(context,"我同意永久停用學前發展").click();await button(context,"明確永久停用學前發展").click();await saved(context);await openTopic(context);
  await topic(context).getByText("已永久停用",{exact:true}).waitFor();await checkbox(context,"我同意重新啟用學前發展").click();await button(context,"明確重新啟用學前發展").click();await saved(context);
  await context.getByTestId("growth-item-preview-growth-previous").getByText("觀察 · 已關閉",{exact:true}).waitFor();await context.close();

  const missing=await fresh(browser,failures);await process(missing);await tools(missing);await selectOption(missing,"關注提交結果","結果未知");await button(current(missing),"明確接受並記錄知悉").click();await missing.getByTestId("growth-pending").waitFor();await ready(missing);
  await selectOption(missing,"關注重讀結果","最新頁面沒有原對象");await button(missing,"重讀並核對原操作").click();await ready(missing);
  assert.equal(await checkbox(missing,"我已核對並同意查回同一份原內容及版本").isDisabled(),true);await button(missing,"放棄草稿並重新核對").click();await button(missing,"確認放棄未提交草稿").click();await ready(missing);assert.equal(await missing.getByTestId("growth-pending").count(),1,"Discarding form fields cannot drop an unknown request");await missing.close();

  const conflict=await fresh(browser,failures);await process(conflict);await selectOption(conflict,"關注處理方式","關閉這項關注");await field(conflict,"關注關閉備註").fill(raw);await tools(conflict);await selectOption(conflict,"關注提交結果","版本衝突");await button(current(conflict),"明確關閉這項關注").click();await conflict.getByTestId("growth-pending").waitFor();await ready(conflict);
  await selectOption(conflict,"關注重讀結果","基準或授權版本已變");await button(conflict,"重讀並核對原操作").click();await ready(conflict);
  assert.equal(await field(conflict,"關注關閉備註").inputValue(),raw);assert.equal(await button(current(conflict),"明確關閉這項關注").isDisabled(),true);
  await button(conflict,"放棄草稿並重新核對").click();await button(conflict,"確認放棄未提交草稿").click();await ready(conflict);await process(conflict);await selectOption(conflict,"關注處理方式","關閉這項關注");assert.equal(await field(conflict,"關注關閉備註").inputValue(),"");await conflict.close();

  const source=await fresh(browser,failures);await tools(source);await selectOption(source,"關注資料情境","來源或依據不可用");assert.equal(await button(current(source),"處理這項關注").count(),0);
  assert.equal(await source.getByText("先與家人核對自己的觀察，再決定是否需要安排下一步（合成示例）。",{exact:true}).count(),0);await button(current(source),"查看來源及依據").click();await current(source).getByTestId("growth-source").waitFor();await source.close();

  const controls=await fresh(browser,failures);await tools(controls);await selectOption(controls,"關注資料情境","近況衝突");await openTopic(controls);assert.equal(await button(controls,"明確保存學前發展所選近況").isDisabled(),true);await button(controls,"到記憶區核對").click();await controls.waitForURL("**/memory");await controls.close();
  const linked=await fresh(browser,failures);await tools(linked);await selectOption(linked,"關注資料情境","已有待覆核任務");await process(linked);await current(linked).getByText("已有待處理／待覆核的連結任務，請先到任務區核對，不能在這裏另建一份。",{exact:true}).waitFor();assert.equal(await button(linked,"明確接受並建立共享任務").count(),0);await linked.close();

  const scope=await fresh(browser,failures);await process(scope);await selectOption(scope,"關注處理方式","關閉這項關注");await field(scope,"關注關閉備註").fill(raw);
  await button(scope,"切換合成預覽情境").click();await button(scope,"離線").click();assert.equal(await field(scope,"關注關閉備註").inputValue(),raw);assert.equal(await button(current(scope),"明確關閉這項關注").isDisabled(),true);
  await button(scope,"一般").click();assert.equal(await button(current(scope),"明確關閉這項關注").isDisabled(),true);await button(scope,"重讀成長關注並保留草稿").click();await ready(scope);assert.equal(await field(scope,"關注關閉備註").inputValue(),raw);
  await tools(scope);await button(current(scope),"明確關閉這項關注").click();await scope.getByText("正在模擬提交；尚未確認保存。",{exact:true}).waitFor();await button(scope,"切換關注預覽帳戶").click();await current(scope).waitFor();await scope.waitForTimeout(450);assert.equal(await scope.getByTestId("growth-pending").count(),0);await current(scope).getByText("觀察 · 待確認",{exact:true}).waitFor();
  await process(scope);await selectOption(scope,"關注處理方式","關閉這項關注");await field(scope,"關注關閉備註").fill(raw);await tools(scope);await button(scope,"切換關注預覽 Server").click();await process(scope);await selectOption(scope,"關注處理方式","關閉這項關注");assert.equal(await field(scope,"關注關閉備註").inputValue(),"");
  await field(scope,"關注關閉備註").fill(raw);await scope.getByRole("button",{name:/^選擇孩子，目前/}).click();await scope.getByRole("radio",{name:"阿樂 · 約 8 歲 · 截至 2026 年 9 月",exact:true}).click();await current(scope).waitFor();await process(scope);await selectOption(scope,"關注處理方式","關閉這項關注");assert.equal(await field(scope,"關注關閉備註").inputValue(),"");
  await tools(scope);await selectOption(scope,"關注資料情境","失去存取");assert.equal(await current(scope).count(),0);assert.equal(await scope.getByTestId("growth-pending").count(),0);await scope.close();
  const readOnly=await fresh(browser,failures);await tools(readOnly);await selectOption(readOnly,"關注資料情境","唯讀");assert.equal(await button(current(readOnly),"處理這項關注").count(),0);await openTopic(readOnly);assert.equal(await checkbox(readOnly,"我同意永久停用學前發展").count(),0);await readOnly.close();
  return "growth: four sizes and navigation, acknowledgement/task consent, explicit snooze, finite context/private draft, topic terminal preservation, frozen unknown/version/missing target, unavailable source/linked task/fact conflict, offline and identity/Server/child/access cleanup; no API calls";
}
export async function verifyGrowthText(browser,failures,directory){
  for(const width of [390,320]){
    const page=await fresh(browser,failures,width);await process(page);await selectOption(page,"關注處理方式","關閉這項關注");await field(page,"關注關閉備註").fill(raw);await openTopic(page);await selectOption(page,contextLabel,"已與家人核對觀察");await page.waitForTimeout(220);
    await page.evaluate(()=>{for(const element of document.querySelectorAll("div,span,p,input,textarea")){
      if(!element.matches("input,textarea")&&![...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()))continue;
      const style=getComputedStyle(element);element.style.fontSize=`${parseFloat(style.fontSize)*1.5}px`;if(style.lineHeight!=="normal")element.style.lineHeight=`${parseFloat(style.lineHeight)*1.5}px`;
    }});
    await page.waitForFunction(input=>{const labels=[...input.parentElement.parentElement.querySelectorAll("div")].filter(item=>[...item.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent==="關注關閉備註"));return labels.length&&labels.every(item=>item.getBoundingClientRect().bottom+3<=input.getBoundingClientRect().top);},await field(page,"關注關閉備註").elementHandle());
    await assertFits(page,`growth 150% Web text ${width}`);await current(page).getByTestId("growth-decision-form").scrollIntoViewIfNeeded();await page.screenshot({path:resolve(directory,`growth-large-text-${width}.png`)});await page.close();
  }
  return "growth text: 390/320 synthetic 150% Web text, floating label and shared controls reflow; not Android system font acceptance";
}
