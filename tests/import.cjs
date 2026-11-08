const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
(async()=>{
 const key='hearing_navi_inventory_v1',base={project:'QA',unit:'1',layout:'1LDK',area:40,price:3000,maint:10000,repair:5000,other:0,status:'販売中'};
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://qa.invalid',runScripts:'dangerously',virtualConsole:new VirtualConsole(),beforeParse(w){w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.localStorage.setItem(key,JSON.stringify([base]))}}),w=dom.window,$=id=>w.document.getElementById(id);
 const load=async data=>await $('invImport').onchange({target:{files:[{text:async()=>JSON.stringify(data)}],value:'test'}});
 for(const invalid of [[{...base,maint:-1}],[{...base,repair:''}],[{...base,other:'abc'}],[{...base,status:'不明'}],[base,base],[null]]){await load(invalid);assert.equal(w.localStorage.getItem(key),JSON.stringify([base]));assert.match($('invMessage').textContent,/読み込みに失敗/)}
 console.log('PASS six invalid imports preserve existing inventory');
 $('invRows').querySelector('[data-edit]').click();await load([{...base,unit:'2',extra:'preserve'}]);assert.equal($('invSave').dataset.edit,undefined);assert.equal(JSON.parse(w.localStorage.getItem(key))[0].unit,'2');assert.ok(Object.keys(w.localStorage).some(k=>k.startsWith(key+'_backup_')));
 console.log('PASS valid import backs up previous data and cancels stale editing');
 w.close();
})();
