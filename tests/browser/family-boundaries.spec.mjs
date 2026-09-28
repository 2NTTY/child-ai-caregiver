import { test,expect } from "./family-fixture.mjs";
const details={kind:"note",quantity:null,eventTime:{rawText:"",at:null,timeZone:"Asia/Hong_Kong",precision:"unknown"}};

// One connected scenario covers the three planned boundaries, without a scenario matrix.
test("family isolation, original-operation recovery and revoked UI",async({family})=>{
  const {owner,caregiver,viewer,child,request,write,invite,revoke,open}=family;
  const seed="合成共享原文 "+child.id;
  await write(owner,"/children/"+child.id+"/care",{text:seed,source:"S16 合成觀察",details,confirmShared:true});
  await open(caregiver);
  await expect(caregiver.page.getByRole("button",{name:new RegExp(child.displayName)})).toHaveCount(0);
  await request(caregiver,"/children/"+child.id+"/care",undefined,404);
  await invite(caregiver,"caregiver");await invite(viewer,"viewer");
  await caregiver.page.getByRole("button",{name:"重新讀取孩子列表",exact:true}).click();
  await open(viewer);
  for(const person of [caregiver,viewer])await expect(person.page.getByText(seed,{exact:true}).first()).toBeVisible();
  await expect(viewer.page.getByLabel("記錄原文",{exact:true})).toHaveCount(0);
  await request(viewer,"/children/"+child.id+"/care",{text:"不可保存",source:"S16",details,confirmShared:true},404);

  const text="  合成原操作回應中斷\n"+child.id+"  ";
  let opId=null,submissions=0,lost=false;
  const lookups=new Set();
  caregiver.page.on("request",req=>{
    const match=/\/api\/online\/operations\/([a-f0-9-]+)$/u.exec(new URL(req.url()).pathname);
    if(match)lookups.add(match[1]);
  });
  await caregiver.page.route("**/api/online/submit",async route=>{
    const body=route.request().postDataJSON();
    if(body.path!=="/api/children/"+child.id+"/care"){await route.fallback();return;}
    submissions++;
    if(lost){await route.fallback();return;}
    opId=body.operation.opId;
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:10000});
    expect(response.status()).toBe(200);
    lost=true;await route.abort("failed");
  });
  await caregiver.page.getByLabel("記錄原文",{exact:true}).fill(text);
  await caregiver.page.getByLabel("資料來源（由你描述）",{exact:true}).fill("S16 原操作合成觀察");
  await caregiver.page.getByRole("button",{name:"預覽共享記錄",exact:true}).click();
  await caregiver.page.getByRole("button",{name:"我已核對，確認共享保存",exact:true}).click();
  await expect(caregiver.page.getByText(/結果未知的操作：新增照顧記錄/u)).toBeVisible();
  await caregiver.page.getByRole("button",{name:"重新讀取並核對",exact:true}).click();
  await expect(caregiver.page.getByText("Server 已確認原操作。已重新讀取目前資料，毋須再次提交。",{exact:true})).toBeVisible();
  const saved=(await request(owner,"/children/"+child.id+"/care")).records.filter(record=>record.text===text);
  expect(saved.length).toBe(1);expect(submissions).toBe(1);expect(opId!==null&&lookups.has(opId)).toBe(true);

  await caregiver.page.getByLabel("記錄原文",{exact:true}).fill("撤權後必須清除的合成草稿");
  await revoke(caregiver);
  await caregiver.page.getByRole("button",{name:"重新讀取孩子列表",exact:true}).click();
  await expect(caregiver.page.getByLabel("記錄原文",{exact:true})).toHaveCount(0);
  await expect(caregiver.page.getByText(seed,{exact:true})).toHaveCount(0);
  await expect(caregiver.page.getByRole("button",{name:new RegExp(child.displayName)})).toHaveCount(0);
  await request(caregiver,"/children/"+child.id+"/care",undefined,404);
});
