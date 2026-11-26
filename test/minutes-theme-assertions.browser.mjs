import assert from 'node:assert/strict';

// Exercise the built CSS cascade, including the shared suite overrides.
export async function assertMinutesTheme(page, theme) {
  const primary = 'rgb(84, 81, 166)'; // Workdeck Home's Minutes file identity.
  const accent = theme === 'dark' ? 'rgb(181, 178, 239)' : primary;
  const soft = theme === 'dark' ? 'rgba(181, 178, 239, 0.16)' : 'rgba(84, 81, 166, 0.12)';
  const styles = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return {
      theme: document.documentElement.dataset.theme,
      buttons: [...document.querySelectorAll('.primary')].map(el => {
        const css = getComputedStyle(el);
        return { fill: css.backgroundColor, text: css.color, border: css.borderTopColor };
      }),
      heading: style('.eyebrow').color,
      spinner: style('.minutes-loading-spinner').borderTopColor,
      selectedTemplate: style('.template-option:has(:checked)').backgroundColor,
      selectedTemplateBorder: style('.template-option:has(:checked)').borderTopColor,
      radio: style('.template-option input').accentColor,
      topic: document.querySelector('.topic-number') && {
        color: style('.topic-number').color, fill: style('.topic-number').backgroundColor,
      },
      badges: [...document.querySelectorAll('.wd-home-card-face .wd-file-app-badge')].map(el => getComputedStyle(el).color),
    };
  });
  assert.equal(styles.theme, theme);
  assert.ok(styles.buttons.length > 0);
  for (const button of styles.buttons) {
    assert.deepEqual(button, { fill: primary, text: 'rgb(255, 255, 255)', border: primary }, `${theme}: purple primary controls`);
  }
  assert.equal(styles.heading, accent, `${theme}: editor heading`);
  assert.equal(styles.spinner, accent, `${theme}: loading indicator`);
  assert.equal(styles.selectedTemplate, soft, `${theme}: selected template tint`);
  assert.equal(styles.selectedTemplateBorder, accent, `${theme}: selected template border`);
  assert.equal(styles.radio, primary, `${theme}: form controls`);
  if (styles.topic) assert.deepEqual(styles.topic, { color: accent, fill: soft }, `${theme}: topic numbers`);
  for (const badge of styles.badges) assert.equal(badge, primary, `${theme}: Minutes home file badge`);
  if (await page.locator('#editor').isVisible()) {
    await page.keyboard.press('Tab');
    await page.locator('#overviewToggle').focus();
    assert.equal(await page.locator('#overviewToggle').evaluate(el => el.matches(':focus-visible')), true);
    assert.equal(await page.locator('#overviewToggle').evaluate(el => getComputedStyle(el).outlineColor), accent, `${theme}: keyboard focus ring`);
  }
}
