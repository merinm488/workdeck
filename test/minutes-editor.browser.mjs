// Real Minutes API + synthetic member storage. Never uses production accounts.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROME=/path/to/chrome node test/minutes-editor.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { handleMinutes } from '../holm/minutes/api.js';
import { handleTodo } from '../holm/todo/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { assertMinutesNewMeetingLauncher } from './minutes-new-meeting-assertions.browser.mjs';
import { pageFixture } from './holm-page-fixtures.mjs';
import { assertMinutesSidebarLikeKanban } from './minutes-sidebar-assertions.browser.mjs';
import { assertMinutesLoading } from './minutes-loading-assertions.browser.mjs';
import { assertMinutesTheme } from './minutes-theme-assertions.browser.mjs';
import { assertMinutesCardStyles, assertMinutesCardCollapse, assertCollapsedPoint } from './minutes-section-assertions.browser.mjs';
import { assertMinutesSummaryContent, assertMinutesSummaryLayout } from './minutes-summary-assertions.browser.mjs';
import { assertReviewCopy, assertApprovalVariants } from './minutes-review-assertions.browser.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const screenshots = '/tmp/workdeck-minutes-design';
await mkdir(screenshots, { recursive: true });
const rows = new Map(), prefs = new Map(); let sequence = 0;
const clone = value => structuredClone(value);
const collection = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
const ds = {
  find: name => [...collection(name).values()].map(clone), count: name => collection(name).size,
  findOne: (name, where) => clone(collection(name).get(typeof where === 'string' ? where : where.id) || null),
  insert: (name, record) => { const id = `record_${++sequence}_abcdefgh`; collection(name).set(id, clone({ ...record, id })); return id; },
  update: (name, where, patch) => collection(name).set(where.id, clone({ ...collection(name).get(where.id), ...patch.$set })),
  delete: (name, where) => collection(name).delete(where.id), transaction: fn => fn(ds),
};
const env = { holm: { auth: { getMember: () => ({ id: 'synthetic_member' }) }, app: { member: { ds, kv: { get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)) } } } } };
const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const server = createServer(async (req,res) => {
  try {
    let file = path.join(root, new URL(req.url,'http://local').pathname);
    if (!file.startsWith(root+'/')) throw new Error();
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file=path.join(file,'index.html');
    res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.statusCode=404; res.end('Missing'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME?{executablePath:process.env.CHROME}:{})});
let failNextSave=false, failNextRename=false, failNextCompletion=false, completionDelay=0, saveResponseDelay=0, saveDelay=0, saveCalls=0;
const errors=[];
async function contextFor(theme='light', options={}) {
  prefs.set('workdeck_settings',{theme});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.addInitScript(theme=>localStorage.setItem('workdeck_theme',theme),theme);
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/me')return route.fulfill({json:{authenticated:true,member:{id:'synthetic_member',name:'Design Test'},profile:{displayName:'Design Test'},settings:{theme}}});
    if(url.pathname==='/api/kanban')return route.fulfill({json:{success:true,data:{kanban:[{id:'sidebar_reference_001',name:'Reference board',columns:[{id:'column001',label:'To do'}],rows:[],cards:[],links:[],version:1}],todo:[],tags:[],settings:{theme}}}});
    const body=req.postDataJSON();
    if(url.pathname==='/api/minutes'&&req.method()==='GET'){
      if(options.loadGate)await options.loadGate;
      if(options.failLoad)return route.fulfill({status:503,json:{success:false,error:'Connection interrupted.'}});
    }
    if(url.pathname==='/api/workdeck'&&body?.action==='renameFile'&&failNextRename){failNextRename=false;return route.fulfill({status:503,json:{success:false,error:'Rename interrupted.'}});}
    if(url.pathname==='/api/minutes'&&body?.action==='create'&&options.failCreateOnce){options.failCreateOnce=false;return route.fulfill({status:503,json:{success:false,error:'Creation interrupted.'}});}
    if(url.pathname==='/api/minutes'&&body?.action==='save'){
      saveCalls++;
      if(failNextSave){failNextSave=false;return route.fulfill({status:503,json:{success:false,error:'Connection interrupted.'}});}
      if(saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));
    }
    if(url.pathname==='/api/minutes'&&body?.action==='setActionCompleted'){
      if(failNextCompletion){failNextCompletion=false;return route.fulfill({status:503,json:{success:false,error:'Completion interrupted.'}});}
      if(completionDelay)await new Promise(resolve=>setTimeout(resolve,completionDelay));
    }
    const handler=url.pathname==='/api/minutes'?handleMinutes:url.pathname==='/api/workdeck'?handleWorkspace:url.pathname.startsWith('/api/todo/')?handleTodo:null;
    if(!handler)return route.fulfill({json:{success:true,data:{},settings:{theme}}});
    const response=await handler(new Request(req.url(),{method:req.method(),headers:{...req.headers(),origin},...(body?{body:JSON.stringify(body)}:{})}),env);
    if(body?.action==='save'&&saveResponseDelay)await new Promise(resolve=>setTimeout(resolve,saveResponseDelay));
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  return {context,page};
}
async function saved(page){await page.locator('#saveState[data-state="saved"]').waitFor();}
async function noOverflow(page,label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label);}
try {
  await assertMinutesNewMeetingLauncher(contextFor,origin,ds);
  const {context,page}=await contextFor();
  await page.goto(origin+'/minutes/');await page.locator('#empty').waitFor();
  await assertMinutesTheme(page,'light');
  await page.locator('#newBtn').click();
  await page.getByRole('dialog',{name:'New meeting',exact:true}).waitFor();
  assert.equal(await page.locator('#createDialog .dialog-description').count(),0,'New meeting has no introductory tagline');
  assert.equal(await page.locator('#createName').isVisible(),true);
  await page.getByLabel('Team sync', {exact:false}).check();
  await page.locator('#confirmCreate').click();await page.locator('#editor').waitFor();await saved(page);
  assert.equal(await page.locator('[data-topic]').count(),3,'template seeds three topics');
  await assertMinutesTheme(page,'light');
  assert.equal(await page.locator('#decisionsList .summary-empty strong').textContent(),'No decisions yet');
  assert.equal(await page.locator('#actionsList .summary-empty strong').textContent(),'No action items yet');
  assert.equal(await page.locator('#actionProgress').count(),0,'summaries have no extra progress ribbon');
  await assertMinutesSummaryLayout(page,'empty desktop');
  const id=new URL(page.url()).searchParams.get('meeting');
  // Header matches the other editors: filename (not a breadcrumb), then status.
  assert.equal(await page.locator('#documentName').textContent(),'Untitled meeting');
  assert.equal(await page.locator('#returnBtn,.breadcrumb-divider,.editor-heading img,.editor-heading #overviewToggle').count(),0);
  assert.equal(await page.locator('#documentName + #saveState').count(),1);
  const nameBox=await page.locator('#documentName').boundingBox(),statusBox=await page.locator('#saveState').boundingBox();
  assert.ok(statusBox.x>=nameBox.x+nameBox.width && statusBox.x-nameBox.x-nameBox.width<20,'status sits directly beside filename');
  await page.locator('#documentName').focus();await page.keyboard.press('Enter');
  let rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  assert.equal(await rename.getByLabel('Meeting name').inputValue(),'Untitled meeting');
  await rename.getByLabel('Meeting name').fill('Discard this name');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#documentName').textContent(),'Untitled meeting');
  await page.locator('#documentName').click();rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  await rename.getByLabel('Meeting name').fill('   ');await rename.getByRole('button',{name:'Rename',exact:true}).click();
  assert.equal(await rename.isVisible(),true,'empty rename is rejected');
  await rename.getByLabel('Meeting name').fill('  Product & design weekly  ');await rename.getByRole('button',{name:'Rename',exact:true}).click();
  await rename.waitFor({state:'detached'});await saved(page);
  assert.equal(ds.findOne('meeting_minutes',id).title,'Product & design weekly');
  assert.equal(await page.locator('#title').inputValue(),'Product & design weekly');
  assert.equal(await page.title(),'Product & design weekly · Minutes');
  // Compare sidebar position, toolbar offset, surfaces and mobile breakpoint to Kanban.
  await assertMinutesSidebarLikeKanban(context,page,origin,'light');
  // Overview is a full-height sidebar below the file header, with the shared icons.
  const overview=page.locator('#meetingOverview'),toggle=page.locator('#overviewToggle');
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  const railBox=await overview.boundingBox(),barBox=await page.locator('.topbar').boundingBox();
  assert.equal(railBox.x,0);assert.equal(railBox.y,barBox.height);assert.equal(railBox.height,1000-barBox.height);
  assert.equal(await toggle.locator('path').getAttribute('d'),'m11 6-6 6 6 6m8-12-6 6 6 6');
  const expandedLeft=(await page.locator('.document-column').boundingBox()).x;
  await toggle.click();await overview.waitFor({state:'hidden'});
  assert.equal(await overview.evaluate(el=>el.inert),true);
  assert.equal(await toggle.locator('path').getAttribute('d'),'m5 6 6 6-6 6m8-12 6 6-6 6');
  assert.ok((await page.locator('.document-column').boundingBox()).x<expandedLeft,'document reclaims sidebar space');
  await page.reload();await page.locator('#editor').waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'),'false','desktop preference survives reload');
  await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#printBtn,#printView').count(),0,'Minutes has no print/PDF control or print-only view');
  await page.locator('#location').fill('Studio / Meet');await page.locator('#attendees').fill('Alex, Priya, Jordan');await page.locator('#noteTaker').fill('Priya');
  const first=page.locator('.topic-group').first();
  await first.locator('textarea').fill('The new onboarding flow is ready for a small pilot. Feedback from the team has been positive.');
  await first.locator('textarea').press('Enter');
  assert.equal(await first.locator('[data-point]').count(),2,'Enter adds a note');
  await first.locator('textarea').nth(1).fill('Invite five customers to try the new flow before the wider release.');
  await first.locator('[data-field="type"]').nth(1).selectOption('decision');
  await first.locator('[data-context]').first().click();
  await first.locator('.ql-editor').fill('Pilot feedback will inform the release checklist.');
  await first.locator('.ql-editor').press('Meta+a');await first.locator('.ql-bold').click();
  await first.locator('[data-add="action"]').click();
  const action=first.locator('.type-action');
  await action.locator('textarea').fill('Prepare the pilot invitation and feedback form');
  assert.equal(await page.locator('#actionsList [data-complete]').isDisabled(),true,'unsaved actions cannot yet update Todo');
  assert.equal(await page.locator('#actionsList .summary-meta').count(),0,'owner and date remain only in the topic editor');
  await action.locator('[data-field="owner"]').fill('Alex');await action.locator('[data-field="dueDate"]').fill('2027-01-15');
  const second=page.locator('.topic-group').nth(1);
  await second.locator('textarea').fill('We need a final accessibility pass before sharing the prototype.');
  await page.locator('.topic-group').nth(2).locator('textarea').fill('Review pilot feedback at the next team sync.');
  await saved(page);
  assert.equal(ds.findOne('meeting_minutes',id).agenda[0].points.length,3);
  assert.match(ds.findOne('meeting_minutes',id).agenda[0].points[0].notes,/<strong>/,'inline rich text persists');
  const taskLink=ds.findOne('meeting_minutes',id).agenda[0].points[2];
  assert.ok(taskLink.todoTaskId,'action creates a Todo task');
  assert.equal(await page.locator('#decisionCount').textContent(),'1');assert.equal(await page.locator('#actionCount').textContent(),'1');
  await assertMinutesCardStyles(page,'light desktop');
  await assertMinutesCardCollapse(page);await saved(page);
  assert.deepEqual(ds.findOne('meeting_minutes',id).agenda[0].points[2],taskLink,'collapsing cards preserves task links, owners and due dates');
  assert.match(ds.findOne('meeting_minutes',id).agenda[0].points[0].notes,/<strong>/);
  const callsBeforeCollapse=saveCalls;
  await first.locator('.point-toggle').first().click();await first.locator('.point-toggle').first().click();
  await page.waitForTimeout(800);assert.equal(saveCalls,callsBeforeCollapse,'collapse/expand never saves meeting data');
  await assertMinutesSummaryContent(page,ds,taskLink,{
    failNext:()=>{failNextCompletion=true;},delay:ms=>{completionDelay=ms;},saveResponseDelay:ms=>{saveResponseDelay=ms;},
  });
  await assertMinutesSummaryLayout(page,'populated desktop');
  await page.locator('#decisionsSection').scrollIntoViewIfNeeded();await page.screenshot({path:screenshots+'/summaries-light.png'});
  await page.locator('#documentScroll').evaluate(el=>el.scrollTo(0,0));await page.screenshot({path:screenshots+'/editor-light.png',fullPage:true});
  // Round trip: existing data, rich context, links, and final view remain readable.
  await page.reload();await page.locator('#editor').waitFor();assert.equal(await page.locator('#title').inputValue(),'Product & design weekly');
  assert.match(await page.locator('.point-context').first().textContent(),/Pilot feedback/);
  assert.equal(await page.locator('.point-context').first().isVisible(),false,'saved context starts closed on reload');
  await page.locator('#reviewBtn').click();await assertReviewCopy(page);
  assert.equal(await page.locator('#reviewIssues').isVisible(),false,'valid follow-ups need no success notice');
  await page.locator('#recordState').selectOption('final');await page.locator('#approvedBy').fill('Unconfirmed approver');
  failNextSave=true;await page.locator('#confirmReview').click();await page.locator('#reviewError').waitFor();
  assert.equal(await page.locator('#approvalName').isVisible(),false,'failed finalization never displays an unconfirmed approval');
  assert.equal(ds.findOne('meeting_minutes',id).state,'draft','failed finalization keeps the saved status');
  await page.keyboard.press('Escape');await page.locator('#reviewBtn').click();
  await page.locator('#recordState').selectOption('final');await page.locator('#approvedBy').fill('Priya');await page.locator('#confirmReview').click();
  await page.locator('#reviewDialog').waitFor({state:'hidden'});assert.equal(await page.locator('#title').isDisabled(),true);assert.equal(await page.locator('.point-menu').count(),0);
  assert.equal(await page.locator('#stateChip').textContent(),'Final');
  assert.equal(await page.locator('#approvalName').textContent(),'Approved by Priya');
  assert.equal(await page.locator('#approvalName').isVisible(),true);
  await page.reload();await page.locator('#editor').waitFor();
  assert.equal(await page.locator('#approvalName').textContent(),'Approved by Priya','final approval is preserved across reload');
  const finalNote=page.locator('.note-row').first();
  assert.equal(await finalNote.locator('.point-context').isVisible(),false);
  await finalNote.getByRole('button',{name:'Show context',exact:true}).click();
  assert.match(await finalNote.locator('.point-context').textContent(),/Pilot feedback/,'final context remains accessible');
  assert.equal(await finalNote.locator('.point-context').isVisible(),true);
  assert.equal(await finalNote.locator('.ql-editor').count(),0,'final context never creates an editable rich editor');
  await finalNote.locator('.point-toggle').click();await assertCollapsedPoint(finalNote);
  assert.equal(await finalNote.locator('textarea').isDisabled(),true);
  await finalNote.locator('.point-toggle').click();
  assert.equal(await finalNote.locator('.point-context').isVisible(),false);
  assert.equal(ds.findOne('meeting_minutes',id).state,'final');
  const finalRecord=ds.findOne('meeting_minutes',id);
  await page.locator('#actionsList [data-complete]').check();
  await page.waitForFunction(()=>document.querySelector('#actionsList .action-item').getAttribute('aria-busy')==='false');
  assert.equal(ds.findOne('todo_lists',taskLink.todoListId).items.find(item=>item.id===taskLink.todoTaskId).completed,true);
  assert.deepEqual(ds.findOne('meeting_minutes',id),finalRecord,'finishing a follow-up does not edit finalized minutes');
  await page.locator('#actionsList [data-complete]').uncheck();
  await page.waitForFunction(()=>document.querySelector('#actionsList .action-item').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#documentName').isDisabled(),true,'final minutes cannot be renamed until reopened');
  await page.locator('#backBtn').click();await page.locator('.wd-card-more').click();
  assert.equal(await page.getByRole('menuitem',{name:'Rename',exact:true}).isDisabled(),true,'home rename respects final records');
  await page.keyboard.press('Escape');await page.locator('.meeting-card').click();await page.locator('#editor').waitFor();
  await page.locator('#reviewBtn').click();failNextSave=true;await page.getByRole('dialog',{name:'Reopen meeting'}).getByRole('button',{name:'Reopen',exact:true}).click();
  await page.getByRole('dialog',{name:'Reopen meeting'}).getByRole('alert').waitFor();await page.keyboard.press('Escape');
  assert.equal(ds.findOne('meeting_minutes',id).state,'final','failed reopening does not leave an invalid retry queued');
  assert.equal(await page.locator('#approvalName').textContent(),'Approved by Priya','failed reopening keeps the recorded approval visible');
  await page.locator('#reviewBtn').click();await page.getByRole('dialog',{name:'Reopen meeting'}).getByRole('button',{name:'Reopen',exact:true}).click();
  await page.getByRole('dialog',{name:'Reopen meeting'}).waitFor({state:'detached'});assert.equal(await page.locator('#title').isEnabled(),true);
  assert.equal(ds.findOne('meeting_minutes',id).approvedBy,'');
  assert.equal(await page.locator('#approvalName').isVisible(),false);
  await assertApprovalVariants(page,'light');
  assert.equal(await page.locator('#documentName').isEnabled(),true);
  // Rename failures retain the new name locally and can be retried in the dialog.
  await page.locator('#documentName').click();rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  failNextSave=true;await rename.getByLabel('Meeting name').fill('Renamed meeting');await rename.getByRole('button',{name:'Rename',exact:true}).click();
  await rename.getByRole('alert').waitFor();assert.equal(ds.findOne('meeting_minutes',id).title,'Product & design weekly');
  assert.equal(await page.locator('#documentName').textContent(),'Renamed meeting');
  await rename.getByRole('button',{name:'Rename',exact:true}).click();await rename.waitFor({state:'detached'});await saved(page);
  assert.equal(ds.findOne('meeting_minutes',id).title,'Renamed meeting');
  await page.locator('#title').fill('Product & design weekly');await saved(page);
  assert.equal(await page.locator('#documentName').textContent(),'Product & design weekly','document title and filename stay synchronized');
  // Save failures are inline, non-destructive, and do not trigger retry storms.
  failNextSave=true;await page.locator('#location').fill('Updated studio');await page.locator('#saveError').waitFor();
  const calls=saveCalls;await page.waitForTimeout(1600);assert.equal(saveCalls,calls,'failed save waits for an explicit retry');
  assert.equal(await page.locator('#location').inputValue(),'Updated studio');
  await page.locator('#retryBtn').click();await saved(page);assert.equal(ds.findOne('meeting_minutes',id).location,'Updated studio');
  // A second edit during a slow request is saved as a later revision, not lost.
  saveDelay=1000;await page.locator('#location').fill('First edit');await page.locator('#saveState[data-state="saving"]').waitFor();await page.locator('#location').fill('Latest edit');await saved(page);saveDelay=0;
  assert.equal(ds.findOne('meeting_minutes',id).location,'Latest edit');
  await page.locator('#backBtn').click();await page.locator('#home').waitFor();await page.locator('.wd-home-card-face').waitFor();
  // Card and list More menus share the native rename action without opening the editor.
  const beforeRename=ds.findOne('meeting_minutes',id);
  await page.locator('.wd-card-more').click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  assert.equal(await page.locator('#editor').isVisible(),false);
  await rename.getByLabel('Meeting name').fill('Discard home rename');await page.keyboard.press('Escape');
  assert.equal(ds.findOne('meeting_minutes',id).title,beforeRename.title);
  await page.locator('.wd-card-more').focus();await page.keyboard.press('ArrowDown');await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  await rename.getByLabel('Meeting name').fill('  ');await rename.getByRole('button',{name:'Rename',exact:true}).click();assert.equal(await rename.isVisible(),true);
  failNextRename=true;await rename.getByLabel('Meeting name').fill('  Renamed from home  ');await rename.getByRole('button',{name:'Rename',exact:true}).click();
  await rename.getByRole('alert').waitFor();assert.equal(ds.findOne('meeting_minutes',id).title,beforeRename.title);
  await rename.getByRole('button',{name:'Rename',exact:true}).click();await rename.waitFor({state:'detached'});
  const afterRename=ds.findOne('meeting_minutes',id);
  assert.equal(afterRename.title,'Renamed from home');assert.equal(afterRename.revision,beforeRename.revision+1);
  assert.deepEqual(afterRename.agenda,beforeRename.agenda,'home rename preserves notes and Todo links');
  assert.equal(await page.locator('.wd-file-title').textContent(),'Renamed from home');
  await page.reload();await page.locator('.wd-home-card-face').waitFor();
  assert.equal(await page.locator('.wd-file-title').textContent(),'Renamed from home','home rename survives reload');
  await page.locator('.meeting-card').click();await page.locator('#editor').waitFor();
  assert.equal(await page.locator('#documentName').textContent(),'Renamed from home');
  await page.locator('#location').fill('Edit after home rename');await saved(page);
  assert.equal(ds.findOne('meeting_minutes',id).location,'Edit after home rename','editor uses the fresh revision');
  await page.locator('#backBtn').click();await page.getByRole('button',{name:'Switch to list view',exact:true}).click();
  await page.locator('.wd-app-list-more').click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});await rename.getByLabel('Meeting name').fill('Product & design weekly');
  await rename.getByRole('button',{name:'Rename',exact:true}).click();await rename.waitFor({state:'detached'});
  assert.equal(ds.findOne('meeting_minutes',id).title,'Product & design weekly');
  await page.getByRole('button',{name:'Switch to card view',exact:true}).click();
  await page.locator('#settingsBtn').click();assert.equal(await page.getByText('Print or save as PDF',{exact:true}).count(),0,'home account menu has no print/PDF option');await page.keyboard.press('Escape');
  await page.screenshot({path:screenshots+'/home-light.png',fullPage:true});
  assert.equal(await page.locator('.home-hero').count(),0);
  // Compare actual app-home control geometry, not just similar CSS values.
  const reference=await context.newPage();await reference.goto(origin+'/todo/');await reference.locator('.wd-home-header').waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await reference.setViewportSize({width,height:1000});
    await Promise.all([page.evaluate(()=>document.fonts.ready),reference.evaluate(()=>document.fonts.ready)]);
    const metrics=async(p,selector)=>p.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:r.height,right:r.right,radius:s.borderRadius,font:s.fontSize,weight:s.fontWeight};});
    const a=await metrics(page,'#newBtn'),b=await metrics(reference,'#newListBtn');
    assert.equal(a.height,b.height,`New button height at ${width}px`);assert.equal(a.radius,b.radius);assert.equal(a.font,b.font);assert.equal(a.weight,b.weight);
    assert.equal((await metrics(page,'#settingsBtn')).right,(await metrics(reference,'#settingsBtn')).right,`account positioning at ${width}px`);
  }
  await reference.close();await page.setViewportSize({width:1440,height:1000});
  await page.locator('#search').fill('nobody-here');await page.locator('#noResults').waitFor();await page.locator('#clearSearch').click();
  await page.getByRole('button',{name:'Switch to list view',exact:true}).click();await page.locator('.as-list .meeting-card').waitFor();
  await page.getByRole('button',{name:'Switch to card view',exact:true}).click();
  await page.locator('.meeting-card').click();await page.locator('#editor').waitFor();await page.goBack();await page.locator('#home').waitFor();await page.goForward();await page.locator('#editor').waitFor();
  // Removing print/PDF does not disturb account controls or normal saves.
  await page.locator('#location').fill('Updated studio');
  await page.locator('#settingsBtn').click();
  assert.equal(await page.getByText('Print or save as PDF',{exact:true}).count(),0);
  assert.equal(await page.locator('#settingsDropdown #logoutBtn').isVisible(),true);
  await page.keyboard.press('Escape');await saved(page);
  assert.equal(ds.findOne('meeting_minutes',id).location,'Updated studio');
  await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('#printBtn,#printView').count(),0,'native browser events do not create a custom print view');
  for(const width of [1024,768,701,700,390,320]){
    await page.setViewportSize({width,height:850});await noOverflow(page,`editor ${width}px`);
    await assertMinutesCardStyles(page,`light ${width}px`);
    await assertMinutesSummaryLayout(page,`light ${width}px`);
    await page.locator('#reviewBtn').click();await page.locator('#reviewDialog').waitFor();await page.keyboard.press('Escape');
    if(width===390){await page.locator('#actionsSection').scrollIntoViewIfNeeded();await page.screenshot({path:screenshots+'/summaries-mobile.png'});}
    const mobileNote=page.locator('.note-row').first();
    await mobileNote.locator('.point-toggle').click();await assertCollapsedPoint(mobileNote);
    await noOverflow(page,`collapsed card ${width}px`);
    await mobileNote.locator('.point-toggle').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#notesList textarea')].every(el=>el.scrollHeight<=el.clientHeight+1));
    assert.equal(await page.locator('#documentName').isVisible(),true,'filename remains visible on narrow screens');
    assert.equal(await page.locator('#saveState').isVisible(),true);
    if(width<=700){
      await page.waitForFunction(()=>document.getElementById('overviewToggle').getAttribute('aria-expanded')==='false');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false','mobile drawer starts closed');
      await toggle.click();assert.equal(await page.locator('#meetingOverview #overviewToggle').count(),1);
      assert.equal(await overview.evaluate(el=>el.inert),false);await noOverflow(page,`open overview ${width}px`);
      if(width===390){await page.waitForTimeout(250);await page.screenshot({path:screenshots+'/overview-mobile.png'});}
      await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      assert.equal(await toggle.evaluate(el=>el===document.activeElement),true,'drawer restores toggle focus');
      await toggle.click();await page.locator('#overviewScrim').click({position:{x:width-5,y:400}});
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await toggle.click();await page.locator('#outline a').first().click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await page.locator('#documentName').click();await page.getByRole('dialog',{name:'Rename meeting',exact:true}).waitFor();await page.keyboard.press('Escape');
    }
    if(width===390){await page.locator('#documentScroll').evaluate(el=>el.scrollTo(0,0));await page.screenshot({path:screenshots+'/editor-mobile.png',fullPage:true});}
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>document.getElementById('overviewToggle').getAttribute('aria-expanded')==='true');
  assert.equal(await toggle.getAttribute('aria-expanded'),'true','desktop preference survives mobile resizing');
  await page.locator('#documentName').click();rename=page.getByRole('dialog',{name:'Rename meeting',exact:true});
  await rename.getByLabel('Meeting name').fill('A very long meeting name '.repeat(8));await rename.getByRole('button',{name:'Rename',exact:true}).click();await rename.waitFor({state:'detached'});await saved(page);
  for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:850});await noOverflow(page,`long filename ${width}px`);}
  await page.locator('#title').fill('Product & design weekly');await saved(page);await page.setViewportSize({width:1440,height:1000});
  // Conflict: no overwrite, preserve all local content, offer downloadable recovery.
  const external=ds.findOne('meeting_minutes',id);ds.update('meeting_minutes',{id},{$set:{revision:external.revision+1,title:'Changed in another tab'}});
  await page.locator('#title').fill('My unsaved local title');await page.locator('#saveError').waitFor();
  assert.equal(await page.locator('#title').inputValue(),'My unsaved local title');assert.equal(await page.locator('#title').isDisabled(),true);
  assert.equal(await page.locator('#documentName').isDisabled(),true,'conflicted minutes cannot be renamed');
  const download=page.waitForEvent('download');await page.locator('#downloadRecovery').click();
  const recovery=await download;assert.match(recovery.suggestedFilename(),/recovery.html$/);
  const recoveredHTML=await readFile(await recovery.path(),'utf8');
  assert.match(recoveredHTML,/My unsaved local title/,'recovery preserves the unsaved local version');
  assert.match(recoveredHTML,/<strong>.*Pilot feedback/,'recovery preserves formatted context');
  assert.match(recoveredHTML,/Owner: Alex/);assert.match(recoveredHTML,/Invite five customers/);
  assert.equal(await page.locator('#printView').count(),0,'recovery needs no hidden print view');
  assert.equal(ds.findOne('meeting_minutes',id).title,'Changed in another tab');
  await context.close();
  const dark=await contextFor('dark');await dark.page.goto(origin+'/minutes/?meeting='+id);await dark.page.locator('#editor').waitFor();
  await assertMinutesSidebarLikeKanban(dark.context,dark.page,origin,'dark');
  await assertMinutesCardStyles(dark.page,'dark desktop');
  await assertMinutesTheme(dark.page,'dark');
  for(const width of [1440,390]){
    await dark.page.setViewportSize({width,height:1000});
    await assertMinutesCardStyles(dark.page,`dark ${width}px`);
    await assertMinutesSummaryLayout(dark.page,`dark ${width}px`);
    await dark.page.locator('#decisionsSection').scrollIntoViewIfNeeded();await dark.page.screenshot({path:screenshots+`/summaries-dark-${width}.png`});
    const darkNote=dark.page.locator('.note-row').first();
    await darkNote.locator('[data-context]').click();
    await darkNote.locator('.point-toggle').click();await assertCollapsedPoint(darkNote);
    await darkNote.locator('.point-toggle').click();
    assert.equal(await darkNote.locator('.point-context').isVisible(),false);
    await noOverflow(dark.page,`dark cards ${width}px`);
  }
  await dark.page.setViewportSize({width:1440,height:1000});
  await dark.page.locator('#documentScroll').evaluate(el=>el.scrollTo(0,0));
  await dark.page.screenshot({path:screenshots+'/editor-dark.png',fullPage:true});
  await assertApprovalVariants(dark.page,'dark');
  await dark.page.locator('#backBtn').click();await dark.page.locator('.wd-home-card-face').waitFor();await dark.page.screenshot({path:screenshots+'/home-dark.png',fullPage:true});
  await assertMinutesTheme(dark.page,'dark');
  await dark.context.close();
  await assertMinutesLoading(contextFor,origin,id);
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log('PASS Minutes: concise Review modal/final approval labels, description-only summaries/right-aligned topics, linked Todo completion/undo/retry/refresh/races/finalized meetings, footer removed/mobile header review, always-visible fields, neutral cards for all five types, independent keyboard/card/context collapse, read-only context, collapsible overview/persistence/mobile drawer, header rename/retry/read-only, adjacent save status, print/PDF removed with HTML recovery intact, templates, inline rich text, Todo sync, autosave/races/retry/conflicts, final/reopen, search/list/history, responsive layouts, light/dark.');
  console.log('Screenshots: '+screenshots);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
