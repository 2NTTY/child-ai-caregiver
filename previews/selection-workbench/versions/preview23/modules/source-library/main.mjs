import{createHost}from'./host.mjs';import{mount}from'./app.mjs';
const root=document.querySelector('#app');let host,view;
function start(){host=createHost();view=mount(root,host)}
start();window.addEventListener('pagehide',()=>{view.dispose();host.dispose()});window.addEventListener('pageshow',e=>{if(e.persisted)start()});
