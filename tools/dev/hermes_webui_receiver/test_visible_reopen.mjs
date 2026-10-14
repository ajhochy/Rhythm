// Real existing renderer, closed/foreign/reopen and overlay qualification.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const [base,dependency,executablePath]=process.argv.slice(2);
assert.match(base,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const {chromium}=createRequire(import.meta.url)(dependency);
const browser=await chromium.launch({executablePath,headless:true,args:[
  '--disable-background-networking','--disable-component-update','--disable-sync',
  '--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();
  const receipts=[];
  page.on('request',r=>{if(r.url().endsWith('/api/rhythm-notify/render-receipt')){
    assert.ok(!r.headers().authorization,'No Rhythm bearer in browser');
    receipts.push(r.postDataJSON());
  }});
  await page.goto(base+'/?session=foreign-chat',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>S._bootReady&&!_loadingSessionId);
  await page.evaluate(()=>loadSession('foreign-chat'));
  await page.waitForTimeout(1800);
  assert.equal(receipts.length,0,'Foreign selected chat must not relay receipt');
  // Actual application's modal, not a seeded reply DOM or injected CSS.
  await page.evaluate(()=>{void showConfirmDialog({title:'Fixture obscuration',message:'Visibility must await dismissal.'});});
  await page.evaluate(()=>loadSession('fixture-chat'));
  await page.waitForFunction(()=>document.querySelector('#messages')?.innerText.includes('Fixture native reply.'));
  await page.waitForTimeout(1800);
  assert.equal(receipts.length,0,'Obscured saved reply must not relay receipt');
  await page.locator('#appDialogCancel').click();
  await page.locator('#messages').getByText('Fixture native reply.',{exact:true}).first().scrollIntoViewIfNeeded();
  const qualified=page.waitForResponse(r=>r.url().endsWith('/api/rhythm-notify/render-receipt')&&r.status()===200);
  await page.evaluate(()=>renderMessages({preserveScroll:true}));
  await qualified;
  assert.equal(receipts.length,1);
  await page.close();
  const reopened=await context.newPage();
  await reopened.goto(base+'/?session=fixture-chat',{waitUntil:'domcontentloaded'});
  await reopened.waitForFunction(()=>document.querySelector('#messages')?.innerText.includes('Fixture native reply.'));
  await reopened.waitForTimeout(600);
  console.log(JSON.stringify({closedAwaitingRender:'PASS',foreign:'PASS',obscured:'PASS',reopen:'PASS',qualifiedReceipts:receipts.length}));
  await context.close();
}finally{await browser.close();}
