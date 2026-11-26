import assert from 'node:assert/strict';

// Runs against the real built editor (also used in the live-asset smoke test).
export async function checkSheetsEditorHeader(page, getRecord) {
  assert.equal(await page.locator('#saveState').count(), 1);
  assert.equal(await page.locator('.top-nav-left #spreadsheetTitle + #saveState').count(), 1);
  assert.equal(await page.locator('.top-nav-right #saveState, .top-nav-actions #mentionBtn').count(), 0);
  assert.equal(await page.locator('#settingsDropdown #mentionBtn').count(), 1);
  assert.equal(await page.locator('#mentionBtn').isVisible(), false);
  const originalTitle = await page.locator('#spreadsheetTitle').textContent();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => sheetsApp.setTheme(theme), theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 980 });
      for (const title of [originalTitle, 'A very long spreadsheet name that should truncate without moving the checkpoint beside the avatar']) {
        await page.locator('#spreadsheetTitle').evaluate((el, text) => { el.textContent = text; }, title);
        for (const state of ['saved', 'saving', 'error']) {
          await page.evaluate(state => WDAutosave.status(state), state);
          const layout = await page.evaluate(() => {
            const title = document.querySelector('#spreadsheetTitle').getBoundingClientRect();
            const status = document.querySelector('#saveState').getBoundingClientRect();
            const avatar = document.querySelector('#settingsBtn').getBoundingClientRect();
            return { title: title.toJSON(), status: status.toJSON(), avatar: avatar.toJSON(),
              font: getComputedStyle(document.querySelector('#saveState')).fontSize };
          });
          assert.ok(layout.title.width > 0, `${theme} ${width}px: title remains visible`);
          assert.ok(layout.status.x - layout.title.right >= 5 && layout.status.x - layout.title.right <= 11, 'status directly beside file name');
          assert.ok(layout.status.right <= layout.avatar.x && layout.avatar.right <= width, `${theme} ${width}px: header does not overlap`);
          assert.equal(layout.font, '12px', 'same passive label size as Draw');
          assert.ok(Math.abs(layout.status.y + layout.status.height / 2 - (layout.title.y + layout.title.height / 2)) < 1, 'vertically aligned');
        }
      }
      await page.evaluate(() => WDAutosave.status('saved'));
      await page.locator('#settingsBtn').click();
      assert.equal(await page.locator('#settingsBtn').getAttribute('aria-expanded'), 'true');
      await page.locator('#mentionBtn').waitFor();
      await page.locator('#mentionBtn').focus();
      await page.keyboard.press('Enter');
      try { await page.locator('.wdm-pop.active .wdm-search-input').waitFor({ timeout: 5000 }); }
      catch (error) {
        console.error('Link action state', { theme, width, details: await page.evaluate(() => ({
          focused: document.activeElement?.outerHTML, menu: document.querySelector('#settingsDropdown')?.className,
          picker: document.querySelector('.wdm-pop')?.outerHTML, mentions: typeof WDMentions
        })) });
        throw error;
      }
      await page.locator('#settingsDropdown').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#settingsBtn').getAttribute('aria-expanded'), 'false');
      const picker = await page.locator('.wdm-pop').boundingBox();
      assert.ok(picker.x >= 0 && picker.x + picker.width <= width, `${width}px: file picker stays onscreen`);
      await page.locator('.wdm-search-input').press('Escape');
    }
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.locator('#spreadsheetTitle').evaluate((el, text) => { el.textContent = text; }, originalTitle);
  // Rename still works with the new adjacent status and input sizing.
  await page.locator('#spreadsheetTitle').click();
  assert.equal(await page.locator('.spreadsheet-title-input + #saveState').count(), 1);
  await page.locator('.spreadsheet-title-input').fill('Sheets header test');
  await page.locator('.spreadsheet-title-input').press('Enter');
  await page.locator('#spreadsheetTitle').filter({ hasText: 'Sheets header test' }).waitFor();
  await page.locator('#saveState[data-save-status=saved]').waitFor();
  assert.equal(getRecord().name, 'Sheets header test');
  // Moving the action must not lose the selected cell or its real hyperlink.
  await page.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('D9').activate());
  await page.locator('#settingsBtn').click();
  await page.getByRole('button', { name: 'Link a file', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'Linked reference' }).click();
  await page.locator('#saveState[data-save-status=saved]').waitFor();
  assert.match(JSON.stringify(getRecord().data.sheets.sheet1.cellData[8][3]), /Linked reference/);
  assert.match(JSON.stringify(getRecord().data), /record00000000002/);
  assert.equal(await page.locator('.wdm-pop.active').count(), 0);
  console.log('PASS Sheets header: title-adjacent status, dropdown file linking, rename, light/dark, desktop/mobile');
}
