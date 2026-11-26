import assert from 'node:assert/strict';

export const removedMinutesCopy = [
  'Capture the discussion. Make the next steps clear.',
  'A clear record. A clear next step.',
  'Review the follow-ups before finishing your minutes.',
  '✓ All action items have an owner and due date.',
  'Approval names are recorded, not independently verified. Final minutes can be reopened.',
  'These minutes are final and read-only. Reopen to make changes.',
];

export async function assertReviewCopy(page) {
  await page.getByRole('dialog', {name:'Review', exact:true}).waitFor();
  for (const text of removedMinutesCopy) assert.equal(await page.getByText(text,{exact:true}).count(),0,`removed: ${text}`);
  assert.equal(await page.locator('#finalNotice,.notes-heading p,#reviewDialog .caveat,#reviewDialog .dialog-description').count(),0);
}

export async function assertApprovalVariants(page, theme) {
  const approval = page.locator('#approvalName');
  const apply = async () => { await page.locator('#confirmReview').click(); await page.locator('#reviewDialog').waitFor({state:'hidden'}); };
  const reopen = async () => {
    await page.locator('#reviewBtn').click();
    const dialog=page.getByRole('dialog',{name:'Reopen meeting',exact:true});
    await dialog.getByRole('button',{name:'Reopen',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal(await approval.isVisible(),false,'reopening removes the approval name');
    assert.equal(await approval.textContent(),'');
  };
  assert.equal(await approval.isVisible(),false,'drafts have no approval label');
  assert.equal(await page.locator('#reviewBtn').textContent(),'Update Status');
  await page.locator('#reviewBtn').click();await assertReviewCopy(page);
  assert.equal(await page.locator('#reviewIssues').isVisible(),false,'no success message or empty placeholder');
  await page.locator('#recordState').selectOption('review');await apply();
  assert.equal(await page.locator('#stateChip').textContent(),'In review');
  assert.equal(await page.locator('#reviewBtn').textContent(),'Update Status');
  assert.equal(await approval.isVisible(),false);
  await page.locator('#reviewBtn').click();await page.locator('#recordState').selectOption('final');
  await page.locator('#approvedBy').fill('   ');await apply();
  assert.equal(await page.locator('#stateChip').textContent(),'Final');
  assert.equal(await approval.isVisible(),false,'final with no name shows only Final');
  assert.equal(await page.locator('#reviewBtn').textContent(),'Reopen to edit','final records retain their reopening action');
  await page.reload();await page.locator('#editor').waitFor();
  assert.equal(await approval.isVisible(),false,'blank approver remains absent after reload');
  assert.equal(await page.locator('#title').isDisabled(),true,'removing the notice does not unlock final minutes');
  await reopen();

  const longName='<b>Approver</b> '+ 'A'.repeat(90);
  await page.locator('#reviewBtn').click();await page.locator('#recordState').selectOption('final');
  await page.locator('#approvedBy').fill(longName);await apply();
  assert.equal(await approval.textContent(),'Approved by '+longName);
  assert.equal(await approval.locator('*').count(),0,'approver names are rendered as text, never HTML');
  await page.reload();await page.locator('#editor').waitFor();
  assert.equal(await approval.textContent(),'Approved by '+longName,'approver survives refresh');
  assert.equal(await page.locator('.meeting-status #stateChip + #approvalName').count(),1,'approver sits alongside the status');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await approval.isVisible(),true,`${theme}: approver is visible at ${width}px`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('#documentScroll').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    assert.equal(await approval.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'long names wrap without clipping');
  }
  await page.setViewportSize({width:1440,height:1000});await reopen();

  // Only the success filler is removed; actionable review warnings remain.
  const owner=page.locator('.type-action [data-field="owner"]');
  const previous=await owner.inputValue();await owner.fill('');
  await page.locator('#reviewBtn').click();await assertReviewCopy(page);
  assert.equal(await page.locator('#reviewIssues').isVisible(),true);
  assert.match(await page.locator('#reviewIssues').textContent(),/Assign an owner:/);
  await page.keyboard.press('Escape');await owner.fill(previous);
  await page.locator('#saveState[data-state="saved"]').waitFor();
}
