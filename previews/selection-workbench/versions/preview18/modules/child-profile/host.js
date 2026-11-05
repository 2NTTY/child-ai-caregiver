(function(root,factory){const api=factory(typeof module==='object'?require('./model.js'):root.CPModel);if(typeof module==='object')module.exports=api;else root.CPHost=api;})(globalThis,function(M){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v));
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  function createHost(){
    let alive=true,life=0,sequence=0,pending=null;
    const listeners=new Set();
    let state=freeze({revision:0,lifetime:0,binding:null,access:'read_only',online:true,unavailable:null,readState:'neverRead',stale:false,error:null,current:null,selectedField:null,expandedFields:[],layout:'passport',pending:false,disposed:false});
    // Notifications are latest-state projection. Nested newer commits retire outer delivery.
    function commit(patch){
      state=freeze({...state,...patch,revision:state.revision+1});const captured=state;
      for(const registration of [...listeners]){if(state!==captured)break;if(registration.active&&listeners.has(registration))registration.fn(captured);}
    }
    const allowed=()=>alive&&state.binding&&state.access!=='lost'&&!state.unavailable;
    const fieldAllowed=(id,lifetime)=>allowed()&&lifetime===state.lifetime&&M.fields(state.current).some(f=>f.id===id);
    function setContext(binding,options={}){
      if(!alive)return false;
      if(binding!==null&&(!binding||!['identityEpoch','scopeKey','childId','childName','authorityFingerprint'].every(k=>typeof binding[k]==='string'&&binding[k].length)))throw new TypeError('Explicit synthetic binding required');
      const access=options.access??'read_only';if(!['editable','read_only','lost'].includes(access))throw new TypeError('Invalid access');
      pending=null;life+=1;
      commit({lifetime:life,binding:binding?freeze(clone(binding)):null,access,online:options.online??true,unavailable:options.unavailable??null,readState:'neverRead',stale:false,error:null,current:null,selectedField:null,expandedFields:[],pending:false});return true;
    }
    function beginRead(){
      if(!allowed()||!state.online||pending)return null;
      const ticket=freeze({id:++sequence,lifetime:state.lifetime});pending=ticket;
      commit({pending:true,readState:'loading',stale:!!state.current,error:null});
      return pending===ticket&&allowed()&&state.lifetime===ticket.lifetime?ticket:null;
    }
    function settle(ticket,result){
      if(!ticket||ticket!==pending||ticket.lifetime!==state.lifetime||!allowed()||!state.online)return false;
      pending=null;
      if(!result||!M.validRevision(result.current)){
        const error=typeof result?.error==='string'?result.error:'合成回應格式不完整；未把它當成空檔案。';
        commit({pending:false,error,readState:state.current?'ready':'neverRead',stale:!!state.current});return !!result&&typeof result.error==='string';
      }
      const current=freeze(clone(result.current));const ids=M.fields(current).map(f=>f.id);
      commit({pending:false,current,readState:'ready',stale:false,error:null,selectedField:ids.includes(state.selectedField)?state.selectedField:ids[0]??null,expandedFields:state.expandedFields.filter(id=>ids.includes(id))});return true;
    }
    function subscribe(fn){
      if(typeof fn!=='function')throw new TypeError('Subscriber must be a function');
      if(!alive){fn(state);return ()=>{};}
      const registration={fn,active:true};listeners.add(registration);fn(state);
      return ()=>{registration.active=false;listeners.delete(registration);};
    }
    return Object.freeze({getSnapshot:()=>state,subscribe,setContext,beginRead,settle,
      setOnline(online){if(!alive)return false;const value=!!online;if(value===state.online)return true;if(!value)pending=null;commit({online:value,pending:!!pending,readState:pending?'loading':state.current?'ready':'neverRead',stale:state.stale||!!state.current&&!value});return true;},
      selectField(id,lifetime){if(!fieldAllowed(id,lifetime))return false;if(id!==state.selectedField)commit({selectedField:id});return true;},
      toggleField(id,lifetime){if(!fieldAllowed(id,lifetime))return false;commit({selectedField:id,expandedFields:state.expandedFields.includes(id)?state.expandedFields.filter(x=>x!==id):[...state.expandedFields,id]});return true;},
      setLayout(layout){if(!alive||!['passport','index'].includes(layout))return false;if(state.layout!==layout)commit({layout});return true;},
      dispose(){if(!alive)return;alive=false;pending=null;life+=1;commit({disposed:true,lifetime:life,binding:null,current:null,pending:false,readState:'neverRead',stale:false,error:null,selectedField:null,expandedFields:[]});listeners.clear();}
    });
  }
  return Object.freeze({createHost});
});
