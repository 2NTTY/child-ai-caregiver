// Finite test-only DOM; no HTML parser, CSS layout or native keyboard simulation.
class Element {
  constructor(tagName,document) {
    this.tagName=tagName.toUpperCase();this.ownerDocument=document;this.parentNode=null;
    this.children=[];this.attributes=new Map();this.listeners=new Map();this.ownText='';this.disabled=false;
  }
  get isConnected(){let n=this;while(n){if(n===this.ownerDocument.body)return true;n=n.parentNode;}return false;}
  get textContent(){return this.ownText+this.children.map(n=>n.textContent).join('');}
  set textContent(value){this.replaceChildren();this.ownText=String(value);}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  removeAttribute(name){this.attributes.delete(name);}
  append(...nodes){for(const node of nodes){
    if(typeof node==='string')throw new Error('String append is outside this finite harness');
    if(node.parentNode){const siblings=node.parentNode.children;siblings.splice(siblings.indexOf(node),1);}
    node.parentNode=this;this.children.push(node);
  }}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.ownText='';this.append(...nodes);}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  click(){if(!this.disabled)for(const handler of [...(this.listeners.get('click')??[])])handler({type:'click',target:this,currentTarget:this});}
  focus(){if(this.isConnected&&!this.disabled)this.ownerDocument.activeElement=this;}
}
export function createDocument(){
 const document={activeElement:null,createElement(tag){return new Element(tag,this);},getElementById(id){return all(this.body,n=>n.getAttribute('id')===id)[0]??null;}};
 document.body=document.createElement('body');document.activeElement=document.body;return document;
}
export function all(node,predicate){return [...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];}
export function byId(node,id){return all(node,n=>n.getAttribute('id')===id)[0]??null;}
export function byClass(node,name){return all(node,n=>(n.getAttribute('class')??'').split(/\s+/).includes(name));}
export function rootFor(document){const root=document.createElement('div');document.body.append(root);return root;}
