import {createFixture} from './fixture.mjs';
import {mountComposer} from './view.mjs';
const fixture=createFixture();
const view=mountComposer(document,fixture);
const choice=new URL(location.href).searchParams.get('direction');
if(choice==='B')view.setDirection('B');
function onPageHide(event){
  view.retireFocus();
  if(event.persisted)return;
  window.removeEventListener('pagehide',onPageHide);
  view.destroy();
}
window.addEventListener('pagehide',onPageHide);
