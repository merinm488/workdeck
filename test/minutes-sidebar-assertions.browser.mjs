// Compare actual built editors, not a second set of assumed Kanban dimensions.
import assert from 'node:assert/strict';

export async function assertMinutesSidebarLikeKanban(context, page, origin, theme) {
  const reference = await context.newPage();
  await reference.goto(origin + '/kanban/?board=sidebar_reference_001');
  await reference.locator('#boardView').waitFor();
  const minutes = { page, toggle: '#overviewToggle', sidebar: '#meetingOverview', toolbar: '#editorToolbar', header: '.topbar' };
  const kanban = { page: reference, toggle: '#kbSidebarToggle', sidebar: '#kbSidebar', toolbar: '#boardToolbar', header: '.top-nav' };
  async function state(editor, open, mobile) {
    await editor.page.waitForFunction(({toggle, sidebar, toolbar, open, mobile}) => {
      const button = document.querySelector(toggle), rail = document.querySelector(sidebar);
      return button?.getAttribute('aria-expanded') === String(open) && rail.inert === !open &&
        (mobile && open ? rail.contains(button) : document.querySelector(toolbar).contains(button));
    }, {...editor, page: undefined, open, mobile});
  }
  async function geometry(editor) {
    return editor.page.evaluate(({toggle, sidebar, toolbar, header}) => {
      const button = document.querySelector(toggle), rail = document.querySelector(sidebar);
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
      const style = getComputedStyle(rail), b = rect(button), h = rect(document.querySelector(header)), r = rect(rail);
      return { button:b, rail:r, header:h, toolbar:rect(document.querySelector(toolbar)),
        padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],
        background:style.backgroundColor, border:style.borderRight, position:style.position,
        path:button.querySelector('path').getAttribute('d'), stroke:getComputedStyle(button.querySelector('svg')).strokeWidth,
        viewportHeight:innerHeight };
    }, {...editor, page: undefined});
  }
  const equal = (a,b,label) => assert.ok(Math.abs(a-b)<1,`${theme}: ${label}: ${a} vs ${b}`);
  try {
    for (const width of [1440,1024,768,701,700,390,320]) {
      const mobile = width<=700;
      await page.setViewportSize({width,height:900});await reference.setViewportSize({width,height:900});
      for (const editor of [minutes,kanban]) {
        await state(editor,!mobile,mobile);
        if (mobile) { await editor.page.locator(editor.toggle).click(); await state(editor,true,true); }
      }
      // Wait for the drawer's final geometry rather than hover animations, which can cancel.
      await reference.waitForFunction(()=>Math.abs(document.querySelector('#kbSidebar').getBoundingClientRect().x)<1);
      const a=await geometry(minutes),b=await geometry(kanban);
      assert.deepEqual(a.padding,b.padding,`${theme}: sidebar padding ${width}`);
      assert.equal(a.background,b.background,`${theme}: sidebar surface ${width}`);
      assert.equal(a.border,b.border,`${theme}: sidebar divider ${width}`);
      assert.equal(a.position,b.position,`${theme}: sidebar layout ${width}`);
      equal(a.rail.width,b.rail.width,`sidebar width ${width}`);
      equal(a.rail.x,b.rail.x,`sidebar left edge ${width}`);
      equal(a.button.width,b.button.width,`toggle width ${width}`);
      equal(a.button.height,b.button.height,`toggle height ${width}`);
      assert.equal(a.path,b.path);assert.equal(a.stroke,b.stroke);
      if (mobile) {
        equal(a.rail.y,b.rail.y,`drawer top ${width}`);
        equal(a.rail.height,b.rail.height,`drawer height ${width}`);
        equal(a.button.x,b.button.x,`drawer toggle x ${width}`);
        equal(a.button.y,b.button.y,`drawer toggle y ${width}`);
      } else {
        equal(a.rail.y-a.header.bottom,b.rail.y-b.header.bottom,`sidebar below header ${width}`);
        equal(a.rail.bottom,a.viewportHeight,`sidebar fills editor height ${width}`);
        equal(a.button.x-a.rail.right,b.button.x-b.rail.right,`toggle beside sidebar ${width}`);
        equal(a.button.y-a.header.bottom,b.button.y-b.header.bottom,`toggle below header ${width}`);
        assert.ok(a.button.y>=a.header.bottom,'toggle must not be in the filename bar');
      }
      for(const editor of [minutes,kanban]) {await editor.page.locator(editor.toggle).click();await state(editor,false,mobile);}
      const closedA=await geometry(minutes),closedB=await geometry(kanban);
      equal(closedA.button.x,closedB.button.x,`collapsed toggle x ${width}`);
      equal(closedA.button.y-closedA.header.bottom,closedB.button.y-closedB.header.bottom,`collapsed toggle below header ${width}`);
      assert.equal(closedA.path,closedB.path);
      assert.equal(await page.locator('.editor-heading img,.editor-heading #overviewToggle').count(),0,'no filename image or sidebar control in top bar');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no overflow ${width}`);
      assert.equal(await page.locator('#documentScroll').evaluate(el=>el.scrollWidth>el.clientWidth),false,`document has no horizontal overflow ${width}`);
      if (!mobile) for(const editor of [minutes,kanban]) {await editor.page.locator(editor.toggle).click();await state(editor,true,false);}
    }
    await page.setViewportSize({width:1440,height:1000});await state(minutes,true,false);
    const before=await page.locator('#editorToolbar').boundingBox();
    await page.locator('#documentScroll').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await page.locator('#documentScroll').evaluate(el=>el.scrollTop>0),'document is independently scrollable');
    assert.deepEqual(await page.locator('#editorToolbar').boundingBox(),before,'toggle stays put when notes scroll');
    assert.equal(await page.evaluate(()=>scrollY),0,'editor does not scroll the entire page');
    await page.locator('.rail-heading').click();
    await page.waitForFunction(()=>document.getElementById('documentScroll').scrollTop<50);
    console.log(`PASS ${theme}: Minutes/Kanban sidebar and toggle geometry at 7 widths, independent document scrolling, no filename image`);
  } finally {await reference.close();}
}
