import assert from 'node:assert/strict';

export async function assertMinutesCardStyles(page, label) {
  await page.mouse.move(0, 0);
  await page.locator('#documentName').focus();
  assert.equal(await page.locator('#attendees').getAttribute('placeholder'), 'Names');
  const fields = await page.locator('.meeting-meta input').evaluateAll(inputs => inputs.map(input => {
    const css = getComputedStyle(input);
    return { id: input.id, border: css.borderTopWidth, color: css.borderTopColor, style: css.borderTopStyle, background: css.backgroundColor };
  }));
  for (const field of fields) {
    assert.equal(field.border, '1px', `${label}: ${field.id} has an always-visible border`);
    assert.equal(field.style, 'solid');
    assert.notEqual(field.color, 'rgba(0, 0, 0, 0)');
    assert.notEqual(field.color, field.background);
  }
  const cards = await page.locator('.note-row').evaluateAll(rows => rows.map(row => {
    const css = getComputedStyle(row), type = getComputedStyle(row.querySelector('.note-type'));
    return { background: css.backgroundColor, border: css.borderColor, width: css.borderWidth, radius: css.borderRadius, shadow: css.boxShadow, typeColor: type.color };
  }));
  assert.ok(cards.length > 2);
  assert.equal(cards[0].width, '1px');
  assert.notEqual(cards[0].border, cards[0].background);
  assert.equal(cards[0].shadow, 'none');
  for (const card of cards) assert.deepEqual(card, cards[0], `${label}: all note types use the same neutral card`);
}

export async function assertCollapsedPoint(row) {
  assert.equal(await row.locator('.point-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await row.locator('textarea').isVisible(), true, 'short description stays visible');
  assert.equal(await row.locator('.point-toolbar').isVisible(), false, 'type and menu hide with details');
  assert.equal(await row.locator('.point-details').isVisible(), false);
  assert.equal(await row.locator('.point-context').isVisible(), false, 'context closes with its card');
  assert.equal(await row.locator('input:visible,select:visible,[data-context]:visible,.point-menu:visible,.ql-editor:visible').count(), 0);
  const controlled = (await row.locator('.point-toggle').getAttribute('aria-controls')).split(' ');
  for (const id of controlled) assert.equal(await row.locator(`[id="${id}"]`).getAttribute('hidden'), '');
}

// Exercises an already-open rich editor, independent cards, and a full rows rerender.
export async function assertMinutesCardCollapse(page) {
  const topic = page.locator('.topic-group').first();
  const note = topic.locator('.type-discussion').first(), action = topic.locator('.type-action');
  const noteId = await note.getAttribute('data-point');
  const noteRow = page.locator(`[data-point="${noteId}"]`);
  const text = await note.locator('textarea').inputValue();
  const context = await note.locator('.ql-editor').innerHTML();
  await note.locator('.point-toggle').focus();
  await page.keyboard.press('Space');
  await assertCollapsedPoint(noteRow);
  assert.equal(await action.locator('.point-details').isVisible(), true, 'collapsing one card leaves its sibling alone');
  await page.keyboard.press('Enter');
  assert.equal(await noteRow.locator('.point-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await noteRow.locator('.point-context').isVisible(), false, 'reopening a card does not reopen the context editor');
  await noteRow.locator('[data-context]').click();
  assert.equal(await noteRow.locator('.ql-editor').innerHTML(), context, 'rich text survives collapse without reconstruction');
  assert.equal(await noteRow.locator('.ql-editor').count(), 1, 'no duplicate rich editor');
  await noteRow.locator('[data-context]').click();
  assert.equal(await noteRow.locator('.point-context').isVisible(), false, 'context can also be closed independently');
  await noteRow.locator('[data-context]').click();
  await noteRow.locator('.point-toggle').click();
  await action.locator('.point-toggle').click();
  await assertCollapsedPoint(action);
  assert.equal(await action.locator('[data-field="owner"]').isVisible(), false);
  const decisionId = await topic.locator('.type-decision').getAttribute('data-point');
  const decision = page.locator(`[data-point="${decisionId}"]`);
  for (const type of ['question', 'information', 'decision']) {
    await decision.locator('.note-type').selectOption(type);
    await assertMinutesCardStyles(page, type);
    await assertCollapsedPoint(noteRow);
    await assertCollapsedPoint(action);
    await decision.locator('.point-toggle').click();
    await assertCollapsedPoint(decision);
    await decision.locator('.point-toggle').click();
  }
  await decision.locator('.point-menu').click();
  await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
  await assertCollapsedPoint(noteRow);
  await decision.locator('.point-menu').click();
  await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
  await assertCollapsedPoint(noteRow);
  await assertCollapsedPoint(action);
  assert.equal(await noteRow.locator('textarea').inputValue(), text);
  await noteRow.locator('.point-toggle').click();
  await noteRow.locator('[data-context]').click();
  assert.equal(await noteRow.locator('.ql-editor').innerHTML(), context, 'saved context survives full rerenders too');
  await noteRow.locator('[data-context]').click();
  await action.locator('.point-toggle').click();
  assert.equal(await action.locator('[data-field="owner"]').inputValue(), 'Alex');
  assert.equal(await action.locator('[data-field="dueDate"]').inputValue(), '2027-01-15');
}
