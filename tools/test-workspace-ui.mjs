// Real app with isolated synthetic data. All API calls and remote writes are blocked.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const names = ['index.html','settings.html','app.js','app.css','tailwind.css','logo-header.png'];
const files = new Map(await Promise.all(names.map(async n => ['/'+n, await readFile(path.join(root,'dist',n))])));
const server = createServer((req,res) => {
  let p = new URL(req.url,'http://localhost').pathname;
  if (p==='/') p='/index.html';
  if (p==='/settings') p='/settings.html';
  const data=files.get(p); if (!data) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html');res.end(data);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = process.env.WORKSPACE_QA_ORIGIN || 'http://127.0.0.1:'+server.address().port;
const output = process.env.WORKSPACE_QA_OUTPUT || '/private/tmp/monogatari-workspace-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const project={id:'ui-synthetic',name:'合成案件・制作チームの一日',channel:'合成チャンネル',format:'talk',createdAt:1,updatedAt:1,rate:5,meta:{client:'合成クライアント',shootDate:'2026-10-18',note:'保持するメモ'},theme:{main:'#1F2430',accent:'#E63946'},rows:[],plans:[{id:'p1',title:'働く人の挑戦',refs:[],unknown:'keep-plan'}],assets:[],files:[],review:{versions:[],comments:[]},unknown:'keep-project'};
try {
 for (const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ja-JP',hasTouch:width<640,isMobile:width<640,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
    const u=new URL(r.request().url());
    if(u.href==='https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs@gh-pages/qrcode.min.js' && r.request().method()==='GET') return r.continue();
    if(u.origin===origin && r.request().method()==='GET' && (['/','/settings','/settings.html'].includes(u.pathname)||names.some(n=>u.pathname==='/'+n))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(({project})=>{
    if(localStorage.getItem('ui-seeded')) return;
    const doc={...project,id:'ui-doc',format:'documentary',assets:[{id:'a1',name:'撮影素材サンプル.mp4',category:'撮影素材',key:'fixture-only',size:1024,type:'video/mp4'}],review:{versions:[{id:'v1',label:'v1',name:'確認動画サンプル',url:'https://fixture.invalid/video.mp4',type:'video/mp4'}],comments:[]},rows:[{id:'loc1',kind:'location',name:'オフィス',address:'合成住所'}, {id:'s1',kind:'scene',type:'VLOG',sec:30,script:'合成テスト用の場面',title:'仕事を始める'}]};
    [project,doc].forEach(p=>localStorage.setItem('mg:monogataritch-proj-'+p.id,JSON.stringify(p)));
    localStorage.setItem('mg:monogataritch-index-v1',JSON.stringify([project,doc].map(({id,name,channel,createdAt})=>({id,name,channel,createdAt}))));localStorage.setItem('ui-seeded','1');
  },{project});
  for(const tab of ['overview','script','hearing','kouban','assets','review','deliver']) {
    const id=['hearing','kouban'].includes(tab)?'ui-doc':'ui-synthetic';
    await page.goto(origin+'/?case='+id+'&tab='+tab);
    const main=page.locator('main[data-workspace-tab="'+tab+'"]');await main.waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(width<640) assert.equal(await page.locator('.mg-work-mobile-nav [aria-current=page]').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;}),true,`${tab}: selected navigation visible`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${tab} ${width}: page overflow`);
    if(tab==='script') {
      await main.getByPlaceholder('動画のタイトル',{exact:true}).fill('編集保存の確認');
      await main.getByPlaceholder('動画のタイトル',{exact:true}).blur();
      // Blur and leave the editor, then verify the app's persisted edit after reload.
      await page.getByRole('button',{name:'概要',exact:true}).last().click();
      await page.waitForTimeout(1200);
      await page.reload();await page.locator('main[data-workspace-tab]').waitFor();
      const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('mg:monogataritch-proj-ui-synthetic')));
      assert.equal(data.plans[0].title,'編集保存の確認');assert.equal(data.meta.note,'保持するメモ');assert.equal(data.plans[0].unknown,'keep-plan');
      await page.goto(origin+'/?case=ui-synthetic&tab=script');await main.waitFor();
    }
    await page.screenshot({path:path.join(output,`${tab}-${width}.png`),fullPage:true});
    console.log(`${tab}: ${width}px passed`);
  }
  await page.goto(origin+'/?case=ui-doc&tab=script');await page.locator('main[data-workspace-tab="script"]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`documentary ${width}: overflow`);
  await page.screenshot({path:path.join(output,`documentary-${width}.png`),fullPage:true});
  for(const populated of ['assets','review']) {
    await page.goto(origin+'/?case=ui-doc&tab='+populated);await page.locator('main[data-workspace-tab="'+populated+'"]').waitFor();
    if(populated==='review') await page.locator('main video').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${populated} populated ${width}: overflow`);
    await page.screenshot({path:path.join(output,`${populated}-populated-${width}.png`),fullPage:true});
  }
  await page.goto(origin+'/settings.html');await page.locator('#geminiKey').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`settings ${width}: overflow`);
  await page.locator('#geminiKey').focus();
  assert.equal(await page.locator('#geminiKey').evaluate(el=>getComputedStyle(el).outlineWidth),'3px');
  await page.screenshot({path:path.join(output,`settings-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[],`${width}: browser errors`);
  console.log(`documentary/settings: ${width}px passed`);await context.close();
 }
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
