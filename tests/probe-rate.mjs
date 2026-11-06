import { attach } from '../driver/cdp.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await attach('', 9222);
await page.watchContexts(600);
await wait(400);
let ctx = null;
for (const id of page.contexts.keys()) {
  try { if (await page.evalIn(id, `!!document.querySelector('video')`)) { ctx = id; break; } } catch (e) {}
}
if (!ctx) { console.log('no video'); process.exit(0); }
const info = await page.evalIn(ctx, `(() => {
  const out = {};
  out.btns = Array.from(document.querySelectorAll('button, .vjs-control, [class*="rate"], [class*="speed"], [title*="倍速"], [class*="倍速"]'))
    .map(b => (b.tagName + '|' + String(b.className||'').slice(0,50) + '|' + (b.getAttribute('title')||'') + '|' + (b.innerText||'').replace(/\\s+/g,'').slice(0,10)))
    .filter(s => /rate|speed|倍速|Playback/i.test(s)).slice(0, 20);
  out.menuItems = Array.from(document.querySelectorAll('.vjs-menu-item, .vjs-menu-content li, [class*="speed"] li'))
    .map(x => (x.innerText||'').replace(/\\s+/g,'')).filter(Boolean).slice(0, 20);
  out.rateNow = (document.querySelector('video')||{}).playbackRate;
  return out;
})()`);
console.log(JSON.stringify(info, null, 2));
page.close();
setTimeout(() => process.exit(0), 200);
