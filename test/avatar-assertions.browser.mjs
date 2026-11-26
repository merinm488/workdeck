import assert from 'node:assert/strict';

export async function checkBorderlessAvatar(button) {
  const frame = await button.evaluate(el => {
    const css = getComputedStyle(el), box = el.getBoundingClientRect();
    const photo = el.classList.contains('wd-photo-loaded') ? el.querySelector('img') : null;
    const image = photo?.getBoundingClientRect();
    return {
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Width`]),
      background: css.backgroundColor, shadow: css.boxShadow,
      image: image ? { left: image.left - box.left, top: image.top - box.top,
        width: image.width - box.width, height: image.height - box.height,
        radius: getComputedStyle(photo).borderRadius } : null,
    };
  });
  assert.deepEqual(frame.borders, ['0px', '0px', '0px', '0px'], 'no outer avatar border');
  assert.equal(frame.background, 'rgba(0, 0, 0, 0)', 'no circular background around the avatar');
  assert.equal(frame.shadow, 'none', 'no outer avatar shadow');
  if (frame.image) {
    assert.equal(frame.image.radius, '50%', 'photo remains circular');
    for (const edge of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(frame.image[edge]) < .6, 'photo fills avatar without a surrounding gap');
  }
}

// Measure the actual painted SVG and button box, not just source path strings.
export async function checkAccountAvatars(page, { required = true } = {}) {
  const buttons = page.locator('button[aria-label="Account menu"]:visible');
  if (required) assert.ok(await buttons.count(), 'account avatar exists');
  for (const button of await buttons.all()) {
    await checkBorderlessAvatar(button);
    const metrics = await button.evaluate(el => {
      const css = getComputedStyle(el), box = el.getBoundingClientRect();
      const svg = el.querySelector('svg'), image = svg.getBoundingClientRect();
      const head = svg.querySelector('circle'), torso = svg.querySelector('path');
      const h = head.getBBox(), t = torso.getBBox();
      const headStroke = parseFloat(getComputedStyle(head).strokeWidth);
      const torsoStroke = parseFloat(getComputedStyle(torso).strokeWidth);
      return {
        width: box.width, height: box.height, radius: css.borderRadius,
        svgWidth: image.width, svgHeight: image.height,
        centerX: image.left + image.width / 2 - box.left - box.width / 2,
        centerY: image.top + image.height / 2 - box.top - box.height / 2,
        gap: t.y - torsoStroke / 2 - (h.y + h.height + headStroke / 2),
        headCenter: h.x + h.width / 2, torsoCenter: t.x + t.width / 2,
        bottom: t.y + t.height + torsoStroke / 2,
      };
    });
    const size = page.viewportSize().width <= 470 ? 38 : 42;
    assert.equal(metrics.width, size, 'consistent account button width');
    assert.equal(metrics.height, size, 'circular account button, not an ellipse');
    assert.equal(metrics.radius, '50%', 'circular hit area');
    assert.equal(metrics.svgWidth, 22); assert.equal(metrics.svgHeight, 22);
    assert.ok(Math.abs(metrics.centerX) < .6 && Math.abs(metrics.centerY) < .6, 'avatar centered inside button');
    assert.ok(metrics.gap >= 1, `head/body strokes must not cross: gap=${metrics.gap}`);
    assert.equal(metrics.headCenter, metrics.torsoCenter, 'head centered over shoulders');
    assert.ok(metrics.bottom < 24, 'torso fits inside SVG without clipping');
  }
}
