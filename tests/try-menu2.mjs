import { attach } from '../driver/cdp.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await attach('', 9222);
await page.watchContexts(600);
await wait(300);
let ctx = null;
for (const id of page.contexts.keys()) {
  try { if (await page.evalIn(id, `!!document.querySelector('video')`)) { ctx = id; break; } } catch (e) {}
}
if (!ctx) { console.log('no video'); process.exit(0); }

const before = await page.evalIn(ctx, `(() => {
  const b = document.querySelector('.vjs-playback-rate');
  const menu = b && b.querySelector('.vjs-menu-content');
  return { hasBtn: !!b, ariaExpanded: b && b.getAttribute('aria-expanded'), menuHtmlLen: menu ? menu.innerHTML.length : -1, menuText: menu ? (menu.innerText||'').replace(/\\s+/g,'|') : '' };
})()`);
console.log('打开前:', JSON.stringify(before));

// 用 mousedown 打开（video.js 菜单常用 pointerdown/mousedown）
const r = await page.evalIn(ctx, `(() => {
  const b = document.querySelector('.vjs-playback-rate');
  if (!b) return 'no-btn';
  for (const t of ['pointerdown','mousedown','mouseup','click']) {
    b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }
  return 'dispatched';
})()`);
console.log('派发事件:', r);
await wait(800);

const after = await page.evalIn(ctx, `(() => {
  const b = document.querySelector('.vjs-playback-rate');
  const menu = b && b.querySelector('.vjs-menu-content');
  const items = menu ? Array.from(menu.querySelectorAll('.vjs-menu-item')).map(x => (x.innerText||'').replace(/\\s+/g,'')) : [];
  return { ariaExpanded: b && b.getAttribute('aria-expanded'), menuText: menu ? (menu.innerText||'').replace(/\\s+/g,'|') : '', items, classes: b ? b.className : '' };
})()`);
console.log('打开后:', JSON.stringify(after));
page.close();
setTimeout(() => process.exit(0), 200);
