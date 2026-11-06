import { createEditorOwner } from './owner.mjs';
import { mountEditor } from './editor.mjs';
const params=new URLSearchParams(location.search);
const layout=params.get('layout')==='handbook'?'handbook':'care';
const requested=params.get('scenario');
const scenario=['normal','review','terminal','worker-unknown'].includes(requested)?requested:'normal';
mountEditor(document.getElementById('app'),{owner:createEditorOwner({scenario}),layout});
