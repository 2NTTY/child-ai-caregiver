import { test as base,expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID,randomBytes } from "node:crypto";
const api="http://localhost:3101",web="http://localhost:8181";
const check=(condition,code)=>{if(!condition)throw new Error(code);};

// Runtime-only fixture: --list does not create accounts, connect, or start services.
export const test=base.extend({
  family:async({browser},use,testInfo)=>{
    check(process.env.P2_BROWSER_APPROVED==="true","Consolidated acceptance approval required");
    // Preserve the real three-signups-per-ten-seconds limit between browser projects.
    if(testInfo.project.name==="firefox")await delay(10100);
    let requests=0,confirmedNewAccounts=0,childDeleted=false,unexpectedNetwork=false,child,failureStep=null;
    const contexts=[];
    const count=()=>check(++requests<=180,"Browser acceptance HTTP cap reached");
    const request=async(person,path,body,status=200)=>{
      count();
      const response=await person.context.request.fetch(api+"/api"+path,{method:body===undefined?"GET":"POST",timeout:10000,maxRetries:0,maxRedirects:0,
        headers:{origin:api,...(person.id?{"x-expected-user-id":person.id}:{})},...(body===undefined?{}:{data:body})});
      const actualStatus=response.status();
      if(actualStatus!==status){
        failureStep??={code:"api_status_mismatch",requestAttempt:requests,method:body===undefined?"GET":"POST",actualStatus,expectedStatus:status};
        throw new Error("Synthetic API response status mismatch: actual "+actualStatus+", expected "+status);
      }
      return response.json();
    };
    const write=async(person,path,payload)=>{
      const command={path:"/api"+path,payload};
      const context=await request(person,"/online/context",command);
      const receipt=await request(person,"/online/submit",{...command,operation:{...context,deviceId:randomUUID(),opId:randomUUID()}});
      check(receipt.state==="confirmed"&&receipt.result!==null,"Synthetic mutation unconfirmed");
      return receipt.result;
    };
    let owner,caregiver,viewer;
    try{
      const people=[];
      for(let i=0;i<3;i++){
        const context=await browser.newContext({serviceWorkers:"block"});contexts.push(context);
        await context.route("**/*",async route=>{
          const url=new URL(route.request().url());
          if(url.origin!==api&&url.origin!==web){unexpectedNetwork=true;await route.abort();return;}
          if(url.origin===api){try{count();}catch{await route.abort();return;}}
          await route.continue();
        });
        const person={context,email:"p2-browser-"+randomUUID()+"@example.test",id:"",name:"合成瀏覽器成員 "+i};
        const signed=await request(person,"/auth/sign-up/email",{email:person.email,password:randomBytes(24).toString("hex"),name:person.name});
        person.id=signed.user.id;confirmedNewAccounts++;person.page=await context.newPage();people.push(person);
      }
      [owner,caregiver,viewer]=people;
      child=(await write(owner,"/children",{displayName:"S16 合成孩子 "+randomUUID().slice(0,8)})).child;
      const version=async()=>(await request(owner,"/families")).families.find(f=>f.id===child.workspaceId).version;
      const invite=async(person,role)=>{
        const invitation=await write(owner,"/families/"+child.workspaceId+"/invitations",{email:person.email,role,expectedVersion:await version()});
        await write(person,"/families/invitations/accept",{token:invitation.token,confirmWorkspaceId:child.workspaceId});
      };
      const revoke=async person=>write(owner,"/families/"+child.workspaceId+"/members/"+person.id,{role:"revoked",expectedVersion:await version()});
      await use({owner,caregiver,viewer,child,request,write,invite,revoke,
        open:async person=>{await person.page.goto(web);await expect(person.page.getByRole("button",{name:"重新讀取孩子列表",exact:true})).toBeVisible();}});
      check(!unexpectedNetwork&&requests<=180,"Unexpected network or request cap");
    }finally{
      try{if(child&&owner){await write(owner,"/children/"+child.id+"/delete",{confirmChildId:child.id});childDeleted=true;}}
      finally{
        try{await testInfo.attach("synthetic-boundary-metadata",{contentType:"application/json",body:Buffer.from(JSON.stringify({requestAttempts:requests,httpCap:180,confirmedNewAccounts,childId:child?.id??null,childDeleted,unexpectedNetwork,failureStep}))});}
        finally{await Promise.all(contexts.map(context=>context.close()));}
      }
    }
  },
});
export { expect };
