// Hold data and deferred UI scripts independently to catch every unfinished frame.
import assert from 'node:assert/strict';
const gate = () => { let release; const promise = new Promise(resolve => { release=resolve; }); return {promise,release}; };

export async function assertMinutesLoading(contextFor, origin, id) {
  for (const theme of ['light','dark']) for (const width of [1440,390]) for (const editor of [false,true]) {
    const data=gate(),scripts=gate(),options={loadGate:data.promise};
    const {context,page}=await contextFor(theme,options);
    let reloadData;
    try {
      await page.setViewportSize({width,height:900});
      await context.addInitScript(() => {
        window.unfinishedFrames=[];window.loadingFrames=0;
        const visible = el => el && el.getBoundingClientRect().height>0 && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden';
        function sample() {
          const root=document.documentElement,bar=document.querySelector('.topbar');
          if(visible(document.getElementById('minutesLoading')))window.loadingFrames++;
          if(visible(bar)) {
            const failure=visible(document.getElementById('loadError'));
            const editing=new URLSearchParams(location.search).has('meeting')&&!failure;
            const ready=editing ? document.body.classList.contains('minutes-editing')&&visible(document.getElementById('editor'))
              : bar.classList.contains('wd-home-header')&&document.body.classList.contains('wd-app-side-available')&&(!root.hasAttribute('data-wd-home-pending')||failure);
            if(root.hasAttribute('data-minutes-loading')||!ready)window.unfinishedFrames.push({editing,classes:bar.className,body:document.body.className});
          }
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await context.route('**/js/home-ui.js',async route=>{await scripts.promise;await route.continue();});
      const url=origin+'/minutes/'+(editor?'?meeting='+id:'');
      await page.goto(url,{waitUntil:'commit'});
      await page.locator('#minutesLoading').waitFor();
      assert.equal(await page.locator('.topbar').isVisible(),false,'unfinished controls hidden before UI scripts');
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme,'stored theme applies before loading screen');
      const background=await page.locator('#minutesLoading').evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.notEqual(background,'rgba(0, 0, 0, 0)','loading screen is opaque, not a transparent black flash');
      scripts.release();await page.waitForFunction(()=>!!window.WDHomeUI);
      assert.equal(await page.locator('#minutesLoading').isVisible(),true,'loading continues while API is held');
      assert.equal(await page.locator('#newBtn').isVisible(),false,'no misplaced New button while waiting');
      data.release();await page.locator('#minutesLoading').waitFor({state:'hidden'});
      await page.locator(editor?'#editor':'.wd-home-card-face').first().waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.deepEqual(await page.evaluate(()=>unfinishedFrames),[],`${theme} ${width} ${editor?'editor':'home'}: no unfinished cold-load frames`);
      // Refresh repeats the same stable first-paint path, including cached assets.
      reloadData=gate();options.loadGate=reloadData.promise;
      await page.reload({waitUntil:'commit'});await page.locator('#minutesLoading').waitFor();
      assert.equal(await page.locator('.topbar').isVisible(),false);
      reloadData.release();await page.locator('#minutesLoading').waitFor({state:'hidden'});
      await page.locator(editor?'#editor':'.wd-home-card-face').first().waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(()=>loadingFrames>0),'loading feedback rendered during refresh');
      assert.deepEqual(await page.evaluate(()=>unfinishedFrames),[],`${theme} ${width} ${editor?'editor':'home'}: no unfinished header frames`);
      if(!editor){
        // Network failures must reveal an actionable error instead of trapping the loader.
        options.failLoad=true;await page.reload();await page.locator('#loadError').waitFor();
        assert.equal(await page.locator('#minutesLoading').isVisible(),false);
        options.failLoad=false;await page.locator('#loadRetry').click();
        await page.locator('.wd-home-card-face').first().waitFor();await page.locator('#minutesLoading').waitFor({state:'hidden'});
        assert.equal(await page.locator('#loadError').isVisible(),false);
      }
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('.minutes-loading-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');
      console.log(`PASS Minutes loading ${theme} ${width} ${editor?'editor':'home'}: delayed scripts/data, refresh, theme, no unfinished frames${editor?'':', retry'}`);
    } finally {data.release();scripts.release();reloadData?.release();await context.close();}
  }
}
