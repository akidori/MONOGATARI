// Synthetic isolated layout/interaction regression; no real App boot or customer storage.
// PLAYWRIGHT_MODULE points to an external Playwright install; Chromium is preinstalled.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../monogataritch.src.jsx', import.meta.url), 'utf8');
const extract = (start, end) => { const a=source.indexOf(start), b=source.indexOf(end,a); assert.ok(a>=0 && b>a); return source.slice(a,b); };
const header=extract('                        <div id={"row-" + r.id} data-toc=', '                        );');
const inputs=extract('function AutoTextarea(', 'function BufferedTextarea(');
const day=extract('  const dayPickerEl =', '\n  /* 日の区切り');
const insert=extract('                const isInsert = r.type', '                const actionsEl =');
const addStart=source.indexOf('<button key={k} onClick={() => setRows((rows) => [...rows, newScene(k)])}');
assert.ok(addStart>0); const add=source.slice(addStart,source.indexOf('</button>',addStart)+9);
const newScene=source.split('\n').find(l=>l.startsWith('const newScene ='));
const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx',contents:`
import React,{useState,useRef,useEffect,startTransition} from 'react';
import {createRoot} from 'react-dom/client';
const Icon=({className})=><svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/></svg>;
const hexA=(c,a)=>'rgba(255,255,255,'+a+')',fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'),timeInputValue=s=>s;
let counter=0;const uid=()=> 'added-'+(++counter);${newScene}
${inputs}
function Insert({r,updateRow}){
const [insertEdit,setInsertEdit]=useState(null),[insertCollapsed,setCollapsed]=useState(new Set());
const toggleInsertCollapsed=id=>setCollapsed(old=>{const n=new Set(old);if(n.has(id))n.delete(id);else n.add(id);return n;});
const scriptDensity='normal',t={dot:'#334155'};
// The rich editor is outside this layout test. Only its value/onChange boundary is simulated.
const scriptEl=<textarea aria-label="合成原稿" value={r.script} onChange={e=>updateRow(r.id,{script:e.target.value})}/>;
${insert}
return <article data-scene={r.id} className="group" style={{padding:12,border:'1px solid #ddd',marginBottom:8}}>5秒 インサート{contentEl}</article>;
}
function Fixture(){
const initial=[{id:'fixture-location',kind:'location',label:'合成ロケーションのタイトルを確認する',time:'13:00',day:1,done:false,unknown:'keep'}, {id:'fixture-scene',kind:'scene',type:'インサート',sec:5,script:'（合成の外観）\\n（合成の作業風景）\\n（合成の道具）',insertChecks:{}}];
const [rows,setRows]=useState(()=>JSON.parse(localStorage.getItem('fixture-rows')||'null')||initial);
window.fixtureRows=()=>rows;
const updateRow=(id,patch)=>setRows(rs=>rs.map(v=>v.id===id?{...v,...patch}:v));
const r=rows[0],scenes=rows.slice(1),theme={main:'#171719',accent:'#e9b956'},mainText='#fff',mono='monospace';
const g={idx:0},sp={num:'01',title:r.label,prefix:'',suffix:''},lc={secSum:275,scenes},sub='合成インサート',secIcon='pin',isNarrow=innerWidth<=640,maxDay=1,isDragOver=false,flashId=null;
const dayOf=r=>r.day,dropZoneProps=()=>({}),rowDragProps=()=>({}),setRowMenu=()=>{},SECTION_TYPES={'インサート':{dot:'#334155'}},k='インサート';
${day}
return <main style={{padding:16,maxWidth:1200,margin:'auto'}}>${header}
{!r.done&&scenes.map(s=><Insert key={s.id} r={s} updateRow={updateRow}/>)}
${add}
<button onClick={()=>localStorage.setItem('fixture-rows',JSON.stringify(rows))}>合成JSONを保存</button></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false});
const css=await readFile(new URL('../tailwind.css',import.meta.url),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
for(const width of [375,390,430,1440]){
const page=await browser.newPage({viewport:{width,height:900},locale:'ja-JP'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
await page.goto(origin);await page.waitForTimeout(300);
const metrics=()=>page.evaluate(()=>{const h=document.querySelector('[data-toc]'),t=h.querySelector('textarea');return {height:h.getBoundingClientRect().height,titleWidth:t.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,clipped:t.scrollHeight>t.clientHeight+1}});
const m=await metrics();assert.ok(m.height<160 && m.titleWidth>=180,JSON.stringify({width,...m}));assert.equal(m.overflow,false);assert.equal(m.clipped,false);
const initial=await page.evaluate(()=>window.fixtureRows());
for(const w of [430,375,width]){await page.setViewportSize({width:w,height:900});await page.waitForTimeout(60);assert.ok((await metrics()).height<160);}
assert.deepEqual(await page.evaluate(()=>window.fixtureRows()),initial); // resize never changes saved fields
await page.screenshot({path:'/tmp/mobile-location-fixed-'+width+'.png',fullPage:true});
const card=page.locator('[data-scene="fixture-scene"]');
await card.getByRole('checkbox').first().check();
await card.getByRole('button',{name:'インサート（3）'}).click();assert.equal(await card.getByRole('checkbox').count(),0);
await card.getByRole('button',{name:'インサート（3）'}).click();assert.equal(await card.getByRole('checkbox').first().isChecked(),true);
await card.getByTitle('カットの一覧を編集（1行＝1カット）').click();
await page.getByLabel('合成原稿').fill(initial[1].script+'\n（合成の追加カット）');
await page.getByRole('button',{name:'チェックリストに戻る'}).click();assert.equal(await card.getByRole('checkbox').count(),4);
assert.equal(await card.getByRole('checkbox').first().isChecked(),true);
await page.getByTitle('このロケを撮影完了にする').click();assert.equal(await page.locator('[data-scene]').count(),0);
await page.getByTitle('撮影完了を取り消す').click();assert.equal(await card.getByRole('checkbox').first().isChecked(),true);
const title=page.locator('[data-toc] textarea');await title.fill('長い合成タイトルを編集しても文字が途切れず表示されることを確認する');await title.blur();await page.waitForTimeout(300);
assert.equal((await metrics()).clipped,false);assert.ok((await metrics()).height<200);
await page.getByRole('button',{name:'インサート',exact:true}).click();assert.equal(await page.locator('[data-scene]').count(),2);
const state=await page.evaluate(()=>window.fixtureRows());assert.equal(state[0].time,'13:00');assert.equal(state[0].day,1);assert.equal(state[0].unknown,'keep');assert.equal(state[1].sec,5);
await page.getByRole('button',{name:'合成JSONを保存'}).click();await page.reload();await page.locator('[data-toc]').waitFor();assert.deepEqual(await page.evaluate(()=>window.fixtureRows()),state);
await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.getByRole('button',{name:'合成JSONを保存'}).click();assert.deepEqual(errors,[]);
console.log(JSON.stringify({width,...m,interactions:'passed'}));await page.close();
}
}finally{await browser.close();await new Promise(r=>server.close(r));}
