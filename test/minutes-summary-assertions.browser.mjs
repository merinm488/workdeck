import assert from 'node:assert/strict';

export async function assertMinutesSummaryLayout(page, label) {
  assert.equal(await page.locator('.document-footer,#bottomReview').count(), 0, 'duplicate footer is removed');
  assert.equal(await page.getByText('Good meetings lead to clear next steps.', {exact:true}).count(), 0);
  assert.equal(await page.locator('.topbar #reviewBtn').isVisible(), true, `${label}: review stays accessible in the header`);
  assert.equal(await page.locator('.summary-number,.summary-item-top,.summary-meta,.summary-status,.summary-card-footer,.summary-progress').count(),0,'summaries contain no numbering, status badges, owners, dates or footers');
  const geometry = await page.locator('.summary-section,.summary-card').evaluateAll(elements => elements.map(el => {
    const s=getComputedStyle(el),r=el.getBoundingClientRect(),topic=el.querySelector(':scope > .summary-topic'),text=el.querySelector(':scope > .summary-text');
    return {className:el.className,border:s.borderTopWidth,style:s.borderTopStyle,radius:parseFloat(s.borderRadius),padding:parseFloat(s.paddingLeft),left:r.left,right:r.right,overflow:el.scrollWidth>el.clientWidth+1,
      topicRight:topic?.getBoundingClientRect().right,topicLeft:topic?.getBoundingClientRect().left,textRight:text?.getBoundingClientRect().right};
  }));
  for(const box of geometry){
    assert.equal(box.border,'1px',`${label}: ${box.className} is enclosed`);
    assert.equal(box.style,'solid');
    assert.ok(box.radius>=8 && box.padding>=12,`${label}: consistent card spacing`);
    assert.ok(box.left>=0 && box.right<=page.viewportSize().width,`${label}: card stays inside viewport`);
    assert.equal(box.overflow,false,`${label}: card contents do not overflow`);
    if(box.topicRight){
      assert.ok(Math.abs(box.topicRight-(box.right-box.padding-1))<1,`${label}: topic is at the right edge`);
      assert.ok(box.topicLeft>=box.textRight,`${label}: topic sits beside, not above, the description`);
    }
  }
  const controls=await page.locator('.topbar #reviewBtn,.topbar #settingsBtn').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right};}));
  assert.ok(controls[0].right<=controls[1].left,`${label}: review and account controls never overlap`);
}

export async function assertMinutesSummaryContent(page, ds, taskLink, controls) {
  const decisions=page.locator('#decisionsList'),actions=page.locator('#actionsList');
  const checkbox=actions.locator('[data-complete]');
  const settled=()=>page.waitForFunction(()=>document.querySelector('#actionsList .action-item')?.getAttribute('aria-busy')==='false');
  const currentTask=()=>ds.findOne('todo_lists',taskLink.todoListId).items.find(task=>task.id===taskLink.todoTaskId);
  const readTodo=()=>page.evaluate(async()=> (await (await fetch('/api/todo/lists')).json()).lists);
  assert.equal(await page.locator('#decisionSummaryCount').textContent(),'1');
  assert.equal(await page.locator('#actionSummaryCount').textContent(),'1');
  assert.equal(await decisions.locator('.summary-card').count(),1);
  assert.equal(await actions.locator('.summary-card').count(),1);
  assert.match(await decisions.locator('.summary-text').textContent(),/Invite five customers/);
  assert.match(await actions.locator('.summary-text').textContent(),/Prepare the pilot/);
  assert.equal(await checkbox.isChecked(),false);
  const topicId=await page.locator('.topic-group').first().getAttribute('id');
  assert.equal(await decisions.locator('.summary-topic').getAttribute('href'),'#'+topicId);
  assert.equal(await actions.locator('.summary-topic').getAttribute('href'),'#'+topicId);
  await decisions.locator('.summary-topic').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(id=>document.activeElement.id===id,topicId);

  // The collection spans topics, not just the topic containing the first decision.
  const other=page.locator('.topic-group').nth(1).locator('.note-type');
  await other.selectOption('decision');
  assert.equal(await page.locator('#decisionSummaryCount').textContent(),'2');
  assert.equal(await decisions.locator('.summary-card').count(),2);
  await other.selectOption('discussion');
  await page.locator('#saveState[data-state="saved"]').waitFor();

  await checkbox.check();await settled();
  assert.equal(currentTask().completed,true,'Minutes completion reaches the actual linked Todo task');
  assert.equal((await readTodo()).find(list=>list.id===taskLink.todoListId).items.find(task=>task.id===taskLink.todoTaskId).completed,true,'Todo API reads the same completion');
  await page.reload();await page.locator('#editor').waitFor();
  assert.equal(await checkbox.isChecked(),true,'completion survives reload');
  await checkbox.focus();await page.keyboard.press('Space');await settled();
  assert.equal(currentTask().completed,false,'completion can be undone from Minutes');
  assert.equal(await checkbox.evaluate(el=>el===document.activeElement),true,'keyboard focus returns to the completion checkbox');

  controls.failNext();await checkbox.focus();await page.keyboard.press('Space');await page.locator('#actionError').waitFor();await settled();
  assert.equal(await checkbox.isChecked(),false,'failed writes restore the previous checkbox state');
  assert.equal(currentTask().completed,false,'failed completion never claims the task is done');
  await checkbox.check();await settled();
  assert.equal(await page.locator('#actionError').isVisible(),false,'retry clears the error');
  assert.equal(currentTask().completed,true);
  await checkbox.uncheck();await settled();

  // A completion response overtakes a previously captured autosave response.
  controls.delay(1400);controls.saveResponseDelay(1200);
  await checkbox.check();assert.equal(await checkbox.isDisabled(),true,'duplicate clicks are blocked while saving');
  const owner=page.locator('.type-action [data-field="owner"]');
  await owner.fill('Alex updated while saving');
  await settled();await page.locator('#saveState[data-state="saved"]').waitFor();
  assert.equal(await checkbox.isChecked(),true,'an older autosave response cannot undo completion');
  assert.equal(currentTask().completed,true);
  assert.match(currentTask().description,/Alex updated while saving/,'completion preserves concurrent task detail changes');
  controls.delay(0);controls.saveResponseDelay(0);
  await owner.fill('Alex');await page.locator('#saveState[data-state="saved"]').waitFor();
  await checkbox.uncheck();await settled();

  // Refresh reads external Todo changes; deleted tasks cannot be toggled or recreated.
  let list=ds.findOne('todo_lists',taskLink.todoListId);
  const originalItems=structuredClone(list.items),completed=structuredClone(list.items);
  completed.find(item=>item.id===taskLink.todoTaskId).completed=true;
  ds.update('todo_lists',{id:list.id},{$set:{items:completed,version:list.version+1}});
  await page.locator('#refreshTasks').click();await page.waitForFunction(()=>document.querySelector('#actionsList input').checked);
  assert.equal(await checkbox.isChecked(),true);
  list=ds.findOne('todo_lists',list.id);
  ds.update('todo_lists',{id:list.id},{$set:{items:[],version:list.version+1}});
  await page.locator('#refreshTasks').click();await page.waitForFunction(()=>document.querySelector('#actionsList input').disabled);
  assert.match(await actions.locator('.summary-completion').getAttribute('title'),/removed/);
  list=ds.findOne('todo_lists',list.id);
  ds.update('todo_lists',{id:list.id},{$set:{items:originalItems,version:list.version+1}});
  await page.locator('#refreshTasks').click();await page.waitForFunction(()=>!document.querySelector('#actionsList input').disabled);
  assert.equal(await checkbox.isChecked(),false);
}
