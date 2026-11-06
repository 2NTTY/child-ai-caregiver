import { createOwner } from './owner.mjs';
import { mount } from './renderer.mjs';
const root=document.getElementById('app');let owner,view;
function enter(){if(view)return;owner=createOwner();view=mount(root,owner);}
function leave(){view?.dispose();owner?.dispose();view=null;owner=null;}
window.addEventListener('pagehide',leave);window.addEventListener('pageshow',enter);enter();
