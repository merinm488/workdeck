// Exercise Workdeck's real launcher and Minutes' real modal/API with the suite's
// isolated in-memory member. No live accounts or meetings are used.
import assert from 'node:assert/strict';

export async function assertMinutesNewMeetingLauncher(contextFor, origin, ds) {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const existing = new Set(ds.find('meeting_minutes').map(meeting => meeting.id));
    const tagId = ds.insert('workspace_tags', { name: 'Launcher project', color: '#3B82F6' });
    const options = {};
    const { context, page } = await contextFor(theme, options);
    const count = () => ds.count('meeting_minutes');
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + '/home.html');
      const launch = async (trigger = '#newBtn', menu = '#newDropdown') => {
        await page.locator(trigger).click();
        const opened = page.waitForEvent('popup');
        await page.locator(menu).getByRole('button', { name: 'Minutes', exact: true }).click();
        const popup = await opened;
        await popup.setViewportSize({ width, height: 900 });
        return popup;
      };
      const dialog = popup => popup.getByRole('dialog', { name: 'New meeting', exact: true });
      const cancel = async popup => {
        await dialog(popup).getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog(popup).waitFor({ state: 'hidden' });
      };
      for (const [trigger, menu] of [['#newBtn', '#newDropdown'], ['#emptyNewBtn', '#emptyNewDropdown']]) {
        // Failed initial loads retain the creation intent for Retry.
        options.failLoad = trigger === '#newBtn';
        const popup = await launch(trigger, menu);
        if (options.failLoad) {
          await popup.locator('#loadError').waitFor();
          assert.equal(new URL(popup.url()).searchParams.get('new'), '1');
          assert.equal(await dialog(popup).isVisible(), false);
          assert.equal(count(), existing.size);
          options.failLoad = false;
          await popup.locator('#loadRetry').click();
        }
        await dialog(popup).waitFor();
        assert.equal(count(), existing.size, 'neither launcher creates an empty meeting');
        assert.equal(await popup.locator('#home').isVisible(), true);
        assert.equal(await popup.locator('#editor').isVisible(), false);
        assert.equal(await popup.locator('#createName').evaluate(el => el === document.activeElement), true);
        assert.equal(await dialog(popup).getByRole('radio').count(), 4);
        assert.equal(await popup.locator('input[name="template"]:checked').inputValue(), 'blank');
        assert.equal(new URL(popup.url()).search, '', 'launcher intent is consumed once');
        const markup = await dialog(popup).innerHTML();
        await cancel(popup);
        assert.equal(count(), existing.size, 'Cancel does not create a meeting');
        await popup.reload(); await popup.locator('#home').waitFor();
        assert.equal(await dialog(popup).isVisible(), false, 'refresh does not reopen the consumed intent');
        await popup.locator('#newBtn').click();
        await dialog(popup).waitFor();
        assert.equal(await dialog(popup).innerHTML(), markup, 'both entry points use exactly the same modal');
        await popup.keyboard.press('Escape');
        await dialog(popup).waitFor({ state: 'hidden' });
        assert.equal(count(), existing.size, 'Escape does not create a meeting');
        await popup.close();
      }
      // Tagged Workdeck creation retains its project after the user chooses a template.
      const tag = page.locator(`.wd-project-row[data-tag="${tagId}"]`);
      if (!await tag.isVisible()) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await tag.click();
      const popup = await launch();
      await dialog(popup).waitFor();
      await popup.locator('#createName').fill('Launcher template meeting');
      await popup.getByLabel('Project review', { exact: false }).check();
      options.failCreateOnce = true;
      await popup.locator('#confirmCreate').click();
      await popup.locator('#createError').waitFor();
      assert.equal(count(), existing.size, 'failed confirmation creates no meeting');
      assert.equal(await popup.locator('#createName').inputValue(), 'Launcher template meeting');
      assert.equal(await popup.locator('input[name="template"]:checked').inputValue(), 'project');
      await popup.locator('#confirmCreate').click();
      await popup.locator('#editor').waitFor();
      await popup.locator('#saveState[data-state="saved"]').waitFor();
      const id = new URL(popup.url()).searchParams.get('meeting');
      const meeting = ds.findOne('meeting_minutes', id);
      assert.equal(count(), existing.size + 1, 'confirmation creates exactly one meeting');
      assert.equal(meeting.title, 'Launcher template meeting');
      assert.equal(meeting.tagId, tagId);
      assert.deepEqual(meeting.agenda.map(topic => topic.title), ['Progress & milestones', 'Risks & decisions', 'Next steps']);
      await popup.locator('#backBtn').click(); await popup.locator('#home').waitFor();
      assert.equal(await dialog(popup).isVisible(), false, 'returning home does not replay the launcher');
      await popup.locator('#newBtn').click();
      assert.equal(await popup.locator('input[name="template"]:checked').inputValue(), 'blank');
      await popup.locator('#confirmCreate').click();
      await popup.locator('#editor').waitFor(); await popup.locator('#saveState[data-state="saved"]').waitFor();
      const native = ds.findOne('meeting_minutes', new URL(popup.url()).searchParams.get('meeting'));
      assert.equal(native.tagId, null, 'later native creation does not retain the launcher tag');
      assert.equal(native.agenda.length, 1);
      await popup.goto(origin + '/minutes/?meeting=' + id + '&new=1');
      await popup.locator('#editor').waitFor();
      assert.equal(await dialog(popup).isVisible(), false, 'existing meeting links still open the editor');
      assert.equal(await popup.locator('#title').inputValue(), meeting.title);
      console.log(`PASS ${theme} ${width}px: both Workdeck New menus open the native Minutes modal; cancel, refresh, load/create retry, templates, tags and existing links`);
    } finally {
      await context.close();
      for (const meeting of ds.find('meeting_minutes')) if (!existing.has(meeting.id)) ds.delete('meeting_minutes', { id: meeting.id });
      ds.delete('workspace_tags', { id: tagId });
    }
  }
}
