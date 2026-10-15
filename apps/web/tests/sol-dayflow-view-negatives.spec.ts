import { expect, test } from '@playwright/test';

test('Sol: modal arriving during a pending unblock sends a fresh block before that promise settles', async ({page}) => {
  await page.addInitScript(() => {
    let shell: any;
    Object.defineProperty(window, 'rhythmShell', { configurable: true, get: () => shell, set: (value) => {
      shell = value; const original = value.dayflowView.setBlocked;
      value.dayflowView.setBlocked = (blocked: boolean) => {
        if (blocked) return original(blocked);
        (window as any).__dayflowView.push('blocked:false');
        return new Promise<boolean>((resolve) => { (window as any).__resolveUnblock = resolve; });
      };
    }});
  });
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveUnblock)).toBe('function');
  await page.evaluate(() => (window as any).__setModal(true));
  await expect.poll(() => page.evaluate(() => (window as any).__dayflowView.at(-1)), {timeout:900}).toBe('blocked:true');
  await page.evaluate(() => (window as any).__resolveUnblock(true));
  await expect.poll(() => page.evaluate(() => (window as any).__dayflowView.at(-1))).toBe('blocked:true');
});

test('Sol: document hide during pending unblock sends a block', async ({page}) => {
  await page.addInitScript(() => {
    let shell: any; Object.defineProperty(window, 'rhythmShell', {configurable:true,get:()=>shell,set:(value)=>{
      shell=value; const original=value.dayflowView.setBlocked;
      value.dayflowView.setBlocked=(blocked:boolean)=>blocked?original(blocked):new Promise<boolean>((resolve)=>{(window as any).__dayflowView.push('blocked:false');(window as any).__resolveUnblock=resolve;});
    }});
  });
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveUnblock)).toBe('function');
  await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(() => page.evaluate(() => (window as any).__dayflowView.at(-1)),{timeout:900}).toBe('blocked:true');
  await page.evaluate(() => (window as any).__resolveUnblock(true));
});

test('Sol: gateway validates exact responses, private fields, malformed control and bounds without forwarding', async ({page}) => {
  await page.goto('/tests/dayflow-view-harness.html?mode=none');
  const result = await page.evaluate(async () => {
    // @ts-ignore Vite serves the actual source module to this owned test page.
    const {getDayflowView,validDayflowViewBounds} = await import('/src/gateway/dayflow-desktop.ts');
    const calls: any[]=[]; let status:any={state:'ready'},attach:any={ok:true};
    (window as any).rhythmShell.dayflowView={getStatus:async()=>status,attach:async()=>attach,setBounds:async(x:any)=>{calls.push(['bounds',x]);return true;},setBlocked:async(x:any)=>{calls.push(['blocked',x]);return true;},detach:async()=>true,returnFocus:async()=>true};
    const view=getDayflowView()!; const statuses=[];const attachments=[];
    for(const value of [{state:'ready',lease:'PRIVATE'},{state:'ready',path:'PRIVATE'},{state:'unavailable',code:'other'},true,null]){status=value;statuses.push(await view.getStatus());}
    for(const value of [{ok:true,attachment:'PRIVATE'},{ok:false,reason:'denied',detail:'PRIVATE'},{ok:'true'},{ok:false,reason:'other'},null]){attach=value;attachments.push(await view.attach());}
    const invalid=[{x:0,y:0,width:0,height:10},{x:0,y:0,width:-1,height:10},{x:NaN,y:0,width:10,height:10},{x:Infinity,y:0,width:10,height:10},{x:1000001,y:0,width:10,height:10},{x:0,y:0,width:10,height:10,zoom:1},{x:0,y:0,width:'10',height:10},{x:0,y:0,width:10,height:10,attachment:'PRIVATE'}];
    const rejected=[];for(const x of invalid)rejected.push([validDayflowViewBounds(x),await view.setBounds(x)]);
    const controls=[];for(const x of ['false',0,null,{}])controls.push(await view.setBlocked(x));
    const forwardedBeforePositive=calls.length;const positive=await view.setBounds({x:-1,y:2,width:10,height:10});const blocked=await view.setBlocked(true);
    status={state:'ready'};attach={ok:true};
    return {statuses,attachments,rejected,controls,forwardedBeforePositive,positive,blocked,ready:await view.getStatus(),attached:await view.attach(),calls};
  });
  expect(result.statuses).toEqual(Array(5).fill({state:'unavailable',code:'unavailable'}));
  expect(result.attachments).toEqual(Array(5).fill({ok:false,reason:'unavailable'}));
  expect(result.rejected).toEqual(Array(8).fill([false,false]));expect(result.controls).toEqual([false,false,false,false]);
  expect(result.forwardedBeforePositive).toBe(0);expect(result.positive).toBe(true);expect(result.blocked).toBe(true);
  expect(result.ready).toEqual({state:'ready'});expect(result.attached).toEqual({ok:true});
  expect(result.calls).toEqual([['bounds',{x:-1,y:2,width:10,height:10}],['blocked',true]]);
});

test('Sol: gateway stale attach/bounds and rejected calls preserve sanitized fixed results', async ({page}) => {
  await page.goto('/tests/dayflow-view-harness.html?mode=none');
  const result=await page.evaluate(async()=>{
    // @ts-ignore Vite serves actual gateway.
    const {getDayflowView}=await import('/src/gateway/dayflow-desktop.ts');
    let finishAttach:(value:unknown)=>void=()=>{},finishBounds:(value:unknown)=>void=()=>{};const calls:string[]=[];
    (window as any).rhythmShell.dayflowView={getStatus:async()=>{throw Error('PRIVATE');},attach:()=>new Promise(r=>{finishAttach=r;}),setBounds:()=>new Promise(r=>{finishBounds=r;}),setBlocked:async()=>{throw Error('PRIVATE');},detach:async()=>{calls.push('detach');return true;},returnFocus:async()=>{throw Error('PRIVATE');}};
    const view=getDayflowView()!;const a=view.attach();const b=view.setBounds({x:0,y:0,width:10,height:10});const detached=await view.detach();finishAttach({ok:true});finishBounds(true);
    return {attach:await a,bounds:await b,detached,status:await view.getStatus(),blocked:await view.setBlocked(true),focus:await view.returnFocus(),calls};
  });
  expect(result).toEqual({attach:{ok:false,reason:'detached'},bounds:false,detached:true,status:{state:'unavailable',code:'unavailable'},blocked:false,focus:false,calls:['detach']});
});

test('Sol: stable hidden rectangle blocks and restores only after positive bounds; observers cease after unmount', async ({page}) => {
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(()=>page.evaluate(()=>(window as any).__dayflowView.filter((call: string) => call.startsWith('blocked:')).at(-1))).toBe('blocked:false');
  await page.getByTestId('dayflow-native-host').evaluate((node)=>{(node as HTMLElement).style.display='none';});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await expect.poll(()=>page.evaluate(()=>(window as any).__dayflowView.filter((call: string) => call.startsWith('blocked:')).at(-1))).toBe('blocked:true');
  await page.getByTestId('dayflow-native-host').evaluate((node)=>{(node as HTMLElement).style.display='block';});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await expect.poll(()=>page.evaluate(()=>(window as any).__dayflowView.filter((call: string) => call.startsWith('blocked:')).at(-1))).toBe('blocked:false');
  await page.evaluate(()=>(window as any).__unmount());
  const count=await page.evaluate(()=>(window as any).__dayflowView.length);
  await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('scroll'));document.dispatchEvent(new Event('visibilitychange'));(window as any).__setModal(true);});
  await page.waitForTimeout(60);
  expect(await page.evaluate(()=>(window as any).__dayflowView.length)).toBe(count);
});


test('Sol: late unblock completion reasserts the current modal block without relying on stale-result suppression', async ({page}) => {
  await page.addInitScript(() => {
    let shell:any; (window as any).__nativeBlocked=true;
    Object.defineProperty(window,'rhythmShell',{configurable:true,get:()=>shell,set:(value)=>{
      shell=value;const original=value.dayflowView.setBlocked;
      value.dayflowView.setBlocked=(blocked:boolean)=>{
        if(blocked){(window as any).__nativeBlocked=true;return original(true);}
        (window as any).__dayflowView.push('blocked:false');
        return new Promise<boolean>((resolve)=>{(window as any).__resolveUnblock=()=>{(window as any).__nativeBlocked=false;resolve(true);};});
      };
    }});
  });
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__resolveUnblock)).toBe('function');
  await page.evaluate(()=>(window as any).__setModal(true));
  // Flush the real component's MutationObserver and animation-frame hide report before the late acknowledgement.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.evaluate(()=>(window as any).__resolveUnblock());
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeBlocked),{timeout:900}).toBe(true);
});
