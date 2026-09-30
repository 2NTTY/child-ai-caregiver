import assert from "node:assert/strict";
import test from "node:test";
import { createSharedInputApi } from "../src/client/shared-input-api.ts";
import { sharedInputCreateSchema } from "../src/shared/shared-inputs.ts";
import { personalSourceUrl, parsePersonalPage } from "../server/personal-source-fetch.ts";

test("personal sources preserve supplied text and restrict one-off HTML input", async () => {
  const source = {kind:"personal_source",sourceLabel:"My subscription",sourceUrl:"https://source.example/article#chapter",
    sourceDateText:null,sourceNotes:"Private reading",text:""};
  assert.equal(sharedInputCreateSchema.parse(source).kind,"personal_source");
  assert.equal(sharedInputCreateSchema.safeParse({...source,sourceUrl:null}).success,false);
  const supplied = {...source,sourceUrl:null,text:"  Original text\nAbout 120 ml  "};
  assert.equal((sharedInputCreateSchema.parse(supplied) as typeof supplied).text,supplied.text);
  assert.equal(sharedInputCreateSchema.safeParse({...source,sourceUrl:"https://user:password@source.example/"}).success,false);
  assert.equal(personalSourceUrl(source.sourceUrl,source.sourceUrl).hash,"");
  for(const url of ["http://source.example/","https://other.example/","https://source.example:8443/","https://user@source.example/"])
    assert.throws(()=>personalSourceUrl(url,source.sourceUrl));
  const parsed=parsePersonalPage('<title>Article</title><main><h1>Heading</h1><p>About 120 ml<br>Time unknown</p><script>SECRET</script><form>LOGIN</form></main>',source.sourceUrl);
  assert.equal(parsed.url,source.sourceUrl);
  assert.match(parsed.text,/About 120 ml\nTime unknown/);
  assert.doesNotMatch(parsed.text,/SECRET|LOGIN/);
  assert.equal(parsed.sourceDateText,null);
  const response = {...source,id:"00000000-0000-4000-8000-000000000001",childId:"00000000-0000-4000-8000-000000000002",
    ownerUserId:"synthetic-owner",version:1,createdAt:"2026-09-29T00:00:00Z",canManage:true,sourceId:null,sha256:null,retrievedAt:null,
    fetchState:"not_requested",extraction:{state:"not_requested",runId:null,excerpt:null,draft:null,stopReason:null,processedAt:null,model:null},
    recordId:null,confirmationKind:null};
  let requests=0;
  const api=createSharedInputApi("https://app.example",(async()=>{requests++;return Response.json({input:response});}) as typeof fetch);
  const input=await api.input(response.childId,response.id,new AbortController().signal,response.ownerUserId);
  assert.equal(input.sourceNotes,source.sourceNotes);
  assert.equal((await api.fetch(input,new AbortController().signal,response.ownerUserId)).kind,"personal_source");
  assert.equal(requests,2);
  assert.throws(()=>parsePersonalPage('<main>'+"x".repeat(64001)+'</main>',source.sourceUrl));
});
