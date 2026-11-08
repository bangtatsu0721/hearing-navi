const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
let passed=0;
const test=(name,fn)=>{fn();console.log('PASS',name);passed++};
function app(seed={}){
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://qa.invalid/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.URL.createObjectURL=()=> 'blob:qa';w.URL.revokeObjectURL=()=>{};
  for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,JSON.stringify(v));
 }});
 return {dom,w:dom.window,$:id=>dom.window.document.getElementById(id),errors};
}
const A=app(),{w,$}=A;
const set=(id,v)=>$(id).value=String(v);
const answer=(text,choice)=>{set('answer',text);if(choice){[...w.document.querySelectorAll('[name=choice]')].find(x=>x.value===choice).checked=true}$('next').click()};
const state=()=>w.eval('s');
const KEY='hearing_navi_inventory_v1';
const records='housing_interview_public_anonymous_v1_records';
test('all inline scripts parse',()=>{for(const script of [...w.document.scripts])new vm.Script(script.textContent)});
test('initialization has no runtime errors',()=>assert.deepEqual(A.errors,[]));
test('Enter submits exactly once, IME/Shift+Enter do not submit',()=>{
 set('answer','家賃がもったいないので購入検討。家賃8万円、家賃補助はありません。');
 for(const opts of [{shiftKey:true},{isComposing:true},{repeat:true}])$('answer').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,...opts}));
 assert.equal(state().entries.length,0);
 $('answer').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(state().entries.length,1);
});
test('contextual depth followed by no-subsidy branch never repeats trigger',()=>{
 assert.equal(state().current,'depth:asset_reason');answer('老後も住める家がほしい');assert.equal(state().current,'now');
 answer('','特に不満はない');assert.equal(state().current,'probe:currentok');answer('老後の安心');
 assert.notEqual(state().current,'trigger');assert.ok(!state().entries.some(e=>e.id===state().current));
});
test('full route terminates without duplicate IDs or subsidy continuation',()=>{
 let n=0;while(state().current&&n++<100){assert.ok(!state().entries.some(e=>e.id===state().current),state().current);assert.notEqual(state().current,'probe:subsidy');answer('確認しました')}
 assert.ok(n<100);assert.equal(state().current,null);
});
test('report opens and includes interview responses',()=>{$('reportBtn').click();assert.ok(!$('report').classList.contains('hidden'));assert.match($('reportBody').textContent,/家賃/)});
test('no-subsidy analysis and displayed record number agree with answers',()=>{
 set('recordNumber','QA-REPORT');set('memo','internal note');$('reportBtn').click();
 assert.match($('reportBody').textContent,/アンケート番号：QA-REPORT/);
 assert.ok(!$('reportBody').textContent.includes('家賃補助による実質負担との差が判断の障壁'));
 assert.ok(!w.eval('detectDecisions().some(r=>r.id==="subsidy")'));
});
test('reload preserves unnamed draft without changing customer records',()=>{
 const draft=JSON.parse(w.localStorage.getItem('housing_interview_public_anonymous_v1_state'));
 const B=app({'housing_interview_public_anonymous_v1_state':draft});assert.equal(B.w.eval('s.entries.length'),draft.entries.length);assert.equal(B.w.localStorage.getItem(records),null);B.dom.window.close();
});
test('record save/reopen and old-format compatibility',()=>{
 set('recordNumber','QA-A');$('recordSave').click();const saved=JSON.parse(w.localStorage.getItem(records));assert.ok(saved['QA-A'].state.entries.length>10);
 $('recordNew').click();assert.equal(state().entries.length,0);set('recordList','QA-A');$('recordOpen').click();assert.equal(state().entries.length,saved['QA-A'].state.entries.length);
 const B=app({[records]:saved});B.$('recordList').value='QA-A';B.$('recordOpen').click();assert.equal(B.w.eval('s.entries.length'),saved['QA-A'].state.entries.length);B.dom.window.close();
});
function unit(id,price=4200){for(const [k,v] of Object.entries({Project:'QA架空物件',Unit:id,Layout:'2LDK',Area:60,Price:price,Maint:10000,Repair:10000,Other:0,Status:'販売中'}))set('inv'+k,v);$('invSave').click()}
test('inventory create / edit / delete while editing another row',()=>{
 unit('A');unit('B');$('invRows').querySelector('[data-edit="1"]').click();$('invRows').querySelector('[data-remove="0"]').click();
 assert.equal($('invSave').dataset.edit,undefined);$('invRows').querySelector('[data-edit="0"]').click();set('invPrice',4300);$('invSave').click();
 const data=JSON.parse(w.localStorage.getItem(KEY));assert.equal(data.length,1);assert.equal(data[0].unit,'B');assert.equal(data[0].price,'4300');
});
test('zero interest payment: 42m / 420 months + 20k = 120k',()=>{
 $('invRows').querySelector('[data-edit="0"]').click();set('invPrice',4200);$('invSave').click();set('invBudget',120000);set('invRate',0);set('invYears',35);$('invCheck').click();assert.match($('invResults').textContent,/120,000円/);assert.match($('invResults').textContent,/1戸が月額予算内/);
});
test('positive interest agrees with independent amortization schedule',()=>{
 set('invRate',1);$('invCheck').click();
 let lo=0,hi=42000000;for(let k=0;k<100;k++){const payment=(lo+hi)/2;let balance=42000000;for(let i=0;i<420;i++)balance=balance*(1+0.01/12)-payment;if(balance>0)lo=payment;else hi=payment}
 const expected=Math.round((lo+hi)/2+20000).toLocaleString('ja-JP');assert.ok($('invResults').textContent.includes(expected+'円'));
});
test('cash purchase still pays fixed costs, sold units excluded, invalid inputs rejected',()=>{
 set('invDown',5000);set('invBudget',19000);$('invCheck').click();assert.match($('invResults').textContent,/20,000円/);assert.match($('invResults').textContent,/月額予算超過/);
 set('invYears',35.5);$('invCheck').click();assert.match($('invResults').textContent,/確認してください/);
 set('invYears',35);set('invRate','');$('invCheck').click();assert.match($('invResults').textContent,/確認してください/);
 $('invRows').querySelector('[data-edit="0"]').click();set('invStatus','販売終了');$('invSave').click();set('invRate',1);$('invCheck').click();assert.match($('invResults').textContent,/販売中の登録住戸がありません/);
});
test('failed inventory write is atomic and clears no original data',()=>{
 const original=w.localStorage.getItem(KEY);const native=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(k,v){if(k===KEY)throw Error('quota');return native.call(this,k,v)};
 unit('C');assert.equal(w.localStorage.getItem(KEY),original);assert.match($('invMessage').textContent,/変更は確定していません/);w.Storage.prototype.setItem=native;
 unit('D');assert.deepEqual(JSON.parse(w.localStorage.getItem(KEY)).map(u=>u.unit),['B','D']);
});
test('malformed stored inventory is preserved and blocks overwrite',()=>{
 const B=app({[KEY]:[{project:'legacy',unit:'1',price:3000,area:50}]});B.$('invSave').click();assert.equal(JSON.parse(B.w.localStorage.getItem(KEY)).length,1);assert.match(B.$('invMessage').textContent,/必須/);B.dom.window.close();
});
test('no application runtime errors after operations',()=>assert.deepEqual(A.errors,[]));
console.log(`${passed} checks passed`);w.close();
