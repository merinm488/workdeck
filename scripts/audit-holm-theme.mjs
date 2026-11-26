// Local, deterministic visual audit of the actual Holm build. No production
// credentials, data or writes. Requires Chrome and Node 22+; no npm dependencies.
// node scripts/build-holm-landing.mjs /tmp/workdeck-theme-audit
// node scripts/audit-holm-theme.mjs /tmp/workdeck-theme-audit/web /tmp/workdeck-theme-report
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const root = resolve(process.argv[2] || '/tmp/workdeck-theme-audit/web');
const output = resolve(process.argv[3] || '/tmp/workdeck-theme-report');
mkdirSync(output, { recursive: true });
const stamp = new Date(Date.now() - 3600_000).toISOString();
const record = { id:'audit', name:'Design review', title:'Design review', version:1, createdAt:stamp, updatedAt:stamp, tagId:'tag-audit' };
const tag = { id:'tag-audit', name:'Project', color:'#3b82f6' };
// Independent expectations from the pre-unification app stylesheets. Never
// assert every app equals Home: app identities must survive shared UI design.
const accentColors = {
  home:['#eab308','#facc15'], docs:['#4285f4','#4285f4'],
  todo:['#188038','#4ade80'], kanban:['#a21caf','#e879f9'],
  minutes:['#5451a6','#5451a6'], calendar:['#0284c7','#38bdf8'],
  sheets:['#22c55e','#22c55e'], forms:['#7248b9','#a78bfa'],
  slides:['#ea580c','#fb923c'], draw:['#e11d48','#fb7185'],
  files:['#0d9488','#0d9488'], blog:['#0d9488','#2dd4bf'],
};
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(part=>parseInt(part,16)).join(', ')})`;
const onAccent = (app, mode) => app==='minutes' || (mode==='light' && ['draw','forms','todo','kanban'].includes(app)) ? 'rgb(255, 255, 255)' : 'rgb(10, 10, 10)';
const data = {
  tags:[tag], docs:[{...record, content:'A document for checking the interface.', contentType:'plain-text'}],
  sheets:[record], forms:[{...record, display:'form', components:[{id:'field',key:'name',type:'textfield',label:'Name'},{id:'submit',type:'button',action:'submit',label:'Submit'}]}],
  slides:[{...record,width:960,height:540,slides:[{id:'s1',name:'Slide 1',background:'#ffffff',objects:[]}]}],
  draws:[{...record,background:'#ffffff',objects:[],viewport:{zoom:1,panX:0,panY:0}}],
  todo:[{...record,items:[]}], kanban:[{...record,columns:[{id:'col',label:'To do',cards:[]}]}],
  minutes:[{...record,date:'2026-11-25',state:'draft',agenda:[]}],
  posts:[{...record,content:'<p>A draft article.</p>',status:'draft'}],
  files:[{...record, mime:'text/plain',size:128,tags:['tag-audit']}], folders:[],
  calendars:[{...record,color:'#0284c7',visible:true}], events:[],
};
let theme = 'dark';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let name = decodeURIComponent(url.pathname);
  if (name.startsWith('/api/')) {
    const settings = {theme, viewMode:'grid'};
    let payload = {success:true,data:{...data,settings,boards:data.kanban,meetings:data.minutes,lists:data.todo}};
    if (name === '/api/me') payload = {member:{id:'audit-member',theme},loginURL:'/auth/login',accountURL:'/auth/account',logoutURL:'/auth/logout'};
    if (name.startsWith('/api/todo/lists')) payload = {lists:data.todo,items:[],settings};
    if (name === '/api/users' && url.searchParams.has('sheet')) payload = {success:true,data:{id:'wb_audit',name:record.name,styles:{},sheetOrder:['s1'],sheets:{s1:{id:'s1',name:'Sheet 1',rowCount:30,columnCount:12,cellData:{}}}}};
    if (name === '/api/posts') payload = {success:true,data:{...data.posts[0],posts:data.posts,settings}};
    if (url.searchParams.has('shared')) {
      payload = {success:true,sharedAt:stamp,doc:data.docs[0],form:data.forms[0],deck:data.slides[0],drawing:data.draws[0],
        sheet:{...record,data:{id:'shared_audit',name:record.name,styles:{},sheetOrder:['s1'],sheets:{s1:{id:'s1',name:'Sheet 1',rowCount:30,columnCount:12,cellData:{}}}}}};
    }
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(payload)); return;
  }
  if (name.endsWith('/')) name += 'index.html';
  if (['/home','/apps','/account'].includes(name)) name += '.html';
  const path = join(root,name);
  if (!path.startsWith(root + '/') || !existsSync(path)) { res.writeHead(404).end('missing'); return; }
  const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
  res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'}).end(readFileSync(path));
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(),'wd-theme-chrome-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-extensions','--disable-sync','--disable-features=Translate',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
], {stdio:'ignore'});
const wait = ms => new Promise(r=>setTimeout(r,ms));
const reports = [];
let ws;
try {
  let port;
  for (let i=0;i<100;i++) {
    if (existsSync(join(profile,'DevToolsActivePort'))) { port = readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]; break; }
    await wait(100);
  }
  if (!port) throw new Error('Chrome debugging port unavailable; set CHROME to your Chrome executable');
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let next=0, errors=[]; const requests=new Map();
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id && requests.has(m.id)) {
      const done=requests.get(m.id); requests.delete(m.id);
      m.error ? done.reject(Error(m.error.message)) : done.resolve(m.result);
    }
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;requests.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker',{bypass:true});
  const homes = ['/home','/todo/','/kanban/','/minutes/','/calendar/','/docs/','/sheets/','/forms/','/slides/','/draw/','/files/','/blog/'];
  const editors = ['/todo/?list=audit','/kanban/?board=audit','/minutes/?meeting=audit','/docs/?doc=audit','/sheets/editor.html?id=audit','/forms/editor.html?id=audit','/slides/editor.html?id=audit','/draw/editor.html?id=audit','/blog/?post=audit'];
  const shared = ['/docs/?shared=audit',...['sheets','forms','slides','draw'].map(app=>`/${app}/shared.html?shared=audit`)];
  const pages = process.env.PAGES?.split(',') || [...homes,...editors,...shared];
  for (theme of (process.env.THEMES?.split(',') || ['dark','light'])) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    await send('Page.navigate',{url:origin+'/home'}); await wait(300);
    await evaluate(`localStorage.setItem('workdeck_theme',${JSON.stringify(theme)})`);
    for (const width of (process.env.WIDTHS?.split(',').map(Number) || [1280,390,320])) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      for (const page of pages) {
        errors=[];
        await send('Page.navigate',{url:origin+page});
        await wait(page.includes('editor') || page.startsWith('/docs') || page.startsWith('/files') ? 1800 : 900);
        for (let retry=0;retry<240;retry++) {
          if (await evaluate('!!document.body')) break;
          await wait(250);
        }
        if (!await evaluate('!!document.body')) throw new Error(`Timed out loading ${page}: ${await evaluate('location.href')}`);
        await wait(350);
        const needsSheetEngine=page.startsWith('/sheets/editor') || page.startsWith('/sheets/shared');
        if(needsSheetEngine) for(let attempt=0;attempt<80;attempt++) {
          if(await evaluate(`!!document.querySelector('[data-u-comp="workbench-layout"]')`)) break;
          await wait(250);
        }
        if(process.env.VIEW==='list') {
          await evaluate(`document.querySelector('#viewToggle,#fbViewToggle,.wd-app-view-toggle,[title="Switch to list view"]')?.click()`);
          await wait(200);
        }
        if(process.env.EDIT_DOCS==='1' && page.startsWith('/docs/?doc=')) {
          await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit')?.click()`);
          await wait(500);
        }
        const report = await evaluate(`(() => {
          const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
          const style=el=>{if(!el)return null;const s=getComputedStyle(el);return {tag:el.tagName,id:el.id,classes:el.className,bg:s.backgroundColor,image:s.backgroundImage,color:s.color,border:s.borderTopColor,radius:s.borderRadius,visible:visible(el)};};
          const primary=[...document.querySelectorAll('.wd-new-btn,.btn-primary,.home-create-btn,.primary,.blog-btn-primary,.fb-primary-btn,.present-btn,button.bg-blue-600')].filter(visible);
          const sidebar=document.querySelector('.wd-sidebar,.wd-app-sidebar,.wd-docs-sidebar,.fb-sidebar,.cal-sidebar');
          const card=[...document.querySelectorAll('.wd-file-card,.home-card,.td-list-card,.spreadsheet-card,.meeting-card,.blog-post-row,.fb-file-card,.card')].find(visible);
          const engine=document.querySelector('[data-u-comp="workbench-layout"]')?{dark:!!document.querySelector('.univer-dark'),bg:getComputedStyle(document.querySelector('[data-u-comp="workbench-layout"]')).backgroundColor}:null;
          const buttons=[...document.querySelectorAll('button')].map(style).filter(s=>s.bg!=='rgba(0, 0, 0, 0)');
          const surfaces=[...document.querySelectorAll('body *')].filter(el=>{if(!visible(el))return false;const r=el.getBoundingClientRect();return r.width*r.height>15000&&getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)';}).map(style);
          const overflows=[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return visible(el)&&r.right>innerWidth+2&&r.left<innerWidth;}).slice(0,12).map(style);
          return {url:location.href,theme:document.documentElement.dataset.theme,app:document.documentElement.dataset.wdApp,body:style(document.body),sidebar:style(sidebar),card:style(card),primary:primary.map(style),engine,buttons,surfaces,overflows,scrollWidth:document.documentElement.scrollWidth,innerWidth,visibleText:document.body.innerText.slice(0,160)};
        })()`);
        const expectedBg = theme==='dark'?'rgb(10, 10, 10)':'rgb(255, 255, 255)';
        const expectedAccent = rgb(accentColors[report.app][theme==='dark'?1:0]);
        const expectedLabel = onAccent(report.app,theme);
        const failures=[];
        if (report.theme !== theme) failures.push('effective theme mismatch');
        if (report.body.bg !== expectedBg) failures.push('body palette mismatch');
        if (report.sidebar && report.sidebar.bg !== expectedBg) failures.push('sidebar palette mismatch');
        for (const button of report.primary) {
          if (button.bg !== expectedAccent || button.color !== expectedLabel || button.image !== 'none') failures.push(`primary palette mismatch: ${button.id || button.classes}`);
        }
        if (needsSheetEngine && !report.engine) failures.push('spreadsheet engine did not load (check CDN errors)');
        if (report.engine && report.engine.dark !== (theme==='dark')) failures.push('spreadsheet engine theme mismatch');
        if (report.scrollWidth > width+2) failures.push(`horizontal overflow: ${report.scrollWidth}`);
        const states={};
        if(process.env.CHECK_STATES==='1') {
          // Actual pointer hover, keyboard focus and disabled styling—not just
          // token declarations. Never click/save/create a workspace record.
          for(const [kind,selector] of [
            ['primary','.wd-new-btn,.btn-primary,.home-create-btn,.primary,.blog-btn-primary,.fb-primary-btn,.present-btn,button.bg-blue-600'],
            ['highlight','.top-nav-btn:not(.present-btn),.td-icon-btn,.wd-icon-btn'],
          ]) {
            const point=await evaluate(`(() => {
              const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>{
                const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
                return r.width&&r.height&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));
              });
              window.__themeAuditTarget=el;
              if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
            })()`);
            if(!point)continue;
            await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(200);
            states[kind]=await evaluate(`(() => {
              const el=window.__themeAuditTarget;
              const snapshot=()=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,color:s.color,filter:s.filter,radius:s.borderRadius,outline:s.outlineColor,opacity:s.opacity};};
              const hover=snapshot();el.focus();const focus=snapshot();
              const canDisable='disabled' in el;
              const wasDisabled=el.disabled;if(canDisable)el.disabled=true;const disabled=canDisable?snapshot():null;if(canDisable)el.disabled=wasDisabled;el.blur();
              return {hover,focus,disabled};
            })()`);
            await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
            if(kind==='primary') {
              if(states.primary.hover.bg!==expectedAccent || states.primary.hover.color!==expectedLabel || states.primary.hover.filter!=='brightness(1.08)') failures.push('primary hover changed app identity or effect');
              if(states.primary.hover.radius!=='8px') failures.push('inconsistent primary corner radius');
              if(states.primary.disabled && states.primary.disabled.opacity!=='0.55') failures.push('inconsistent disabled state');
            }
          }
        }
        // Settings, sidebar form and keyboard focus are audited without saving.
        const interactions=await evaluate(`(async () => {
          const result={};const snapshot=el=>{if(!el)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return {bg:s.backgroundColor,color:s.color,outline:s.outlineColor,display:s.display,left:r.left,right:r.right};};
          const trigger=document.querySelector('#settingsBtn,#fbSettingsBtn,.wd-account-trigger');trigger?.click();await new Promise(r=>setTimeout(r,50));
          result.settings=snapshot(document.querySelector('.wd-account-panel'));
          if(trigger)trigger.click();
          const add=document.querySelector('.wd-app-side-add');add?.click();
          result.tagSubmit=snapshot(document.querySelector('.wd-app-side-submit'));
          const input=document.querySelector('.wd-app-side-form input');input?.focus();result.tagInput=snapshot(input);
          document.querySelector('.wd-app-side-cancel')?.click();
          return result;
        })()`);
        const filename = `${theme}-${width}-${page.replace(/[^a-z\d]+/gi,'-')}`;
        if (process.env.SCREENSHOTS !== '0') {
          const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(output,filename+'.png'),Buffer.from(shot.data,'base64'));
        }
        const expectedSurface=theme==='dark'?'rgb(20, 20, 20)':'rgb(247, 247, 245)';
        if(interactions.settings && interactions.settings.bg!==expectedSurface) failures.push('settings palette mismatch');
        if(interactions.settings?.display!=='none' && (interactions.settings?.left < 0 || interactions.settings?.right > width+2)) failures.push('settings outside viewport');
        if(interactions.tagSubmit && (interactions.tagSubmit.bg!==expectedAccent || interactions.tagSubmit.color!==expectedLabel)) failures.push('tag submit palette mismatch');
        if(errors.length) failures.push('browser runtime exception(s)');
        const row={theme,width,page,...report,states,interactions,errors,failures};
        reports.push(row);console.log(JSON.stringify(row));
      }
    }
  }
  if (process.env.CHECK_SWITCHING === '1') {
    const switches=[];
    theme='dark';
    for (const page of [...homes,'/sheets/editor.html?id=audit','/sheets/shared.html?shared=audit']) {
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
      await send('Page.navigate',{url:origin+page});
      await wait(1800);
      // Exercise the same event received from another Workdeck tab.
      await evaluate(`localStorage.setItem('workdeck_theme','system');window.dispatchEvent(new StorageEvent('storage',{key:'workdeck_theme',newValue:'system'}));`);
      for (const system of ['light','dark']) {
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:system}]});
        await wait(250);
        const state=await evaluate(`({effective:document.documentElement.dataset.theme,preference:localStorage.getItem('workdeck_theme'),bodyDark:document.body.classList.contains('dark'),htmlDark:document.documentElement.classList.contains('dark'),engine:document.querySelector('[data-u-comp="workbench-layout"]')?!!document.querySelector('.univer-dark'):null})`);
        const ok=state.effective===system && state.preference==='system' && (state.engine===null || state.engine===(system==='dark'));
        switches.push({page,system,...state,ok});
        if(!ok)process.exitCode=1;
      }
    }
    writeFileSync(join(output,'theme-switching.json'),JSON.stringify(switches,null,2));
  }
  writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
  if(reports.some(r=>r.failures.length)) process.exitCode=1;
} finally {
  ws?.close();chrome.kill('SIGTERM');server.close();await wait(300);
  rmSync(profile,{recursive:true,force:true});
}
