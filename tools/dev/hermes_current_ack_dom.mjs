import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const [base,sid,foreign,dependency,executablePath,evidence]=process.argv.slice(2);
assert.match(base,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const {chromium}=createRequire(import.meta.url)(dependency);
const browser=await chromium.launch({executablePath,headless:true,args:[
 '--disable-background-networking','--disable-component-update','--disable-sync',
 '--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage(), receipts=[];
 page.on('request',r=>{if(r.url().endsWith('/api/rhythm-notify/render-receipt')) {
  assert.ok(!r.headers().authorization); receipts.push(r.postDataJSON());
 }});
 await page.goto(base+'/?session='+foreign,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>S._bootReady&&!_loadingSessionId);
 await page.evaluate(id=>loadSession(id),foreign);
 await page.waitForTimeout(1800); assert.equal(receipts.length,0);
 await page.evaluate(()=>{void showConfirmDialog({title:'Fixture obscuration',message:'Await dismissal.'});});
 await page.evaluate(id=>loadSession(id),sid);
 await page.waitForFunction(()=>document.querySelector('#messages')?.innerText.includes('Fixture native reply.'));
 await page.waitForTimeout(1800); assert.equal(receipts.length,0);
 await page.locator('#appDialogCancel').click();
 const reply=page.locator('#messages').getByText('Fixture native reply.',{exact:true}).first();
 await reply.scrollIntoViewIfNeeded();
 const qualified=page.waitForResponse(r=>r.url().endsWith('/api/rhythm-notify/render-receipt')&&r.status()===200);
 await page.evaluate(()=>renderMessages({preserveScroll:true})); await qualified;
 const geometry=await reply.evaluate(el=>{
  const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
  return {width:r.width,height:r.height,unobscured:!!hit&&(el===hit||el.contains(hit))};
 });
 assert.ok(geometry.width>0&&geometry.height>0&&geometry.unobscured);
 assert.equal(receipts.length,1); assert.equal(receipts[0].hermesSessionId,sid);
 assert.equal(receipts[0].proofNonce.length,64);
 await page.screenshot({path:join(evidence,'current-shipping-native-ack.png'),fullPage:true});
 console.log(JSON.stringify({realDOM:geometry,qualifiedReceipts:1,foreign:'PASS',obscured:'PASS'}));
 await context.close();
} finally {await browser.close();}
