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
console.log('ctx', ctx);

// 1) 打开倍速菜单
const opened = await page.evalIn(ctx, `(() => {
  const btn = document.querySelector('.vjs-playback-rate');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);
console.log('打开菜单:', opened);
await wait(600);

// 2) 列出菜单项
const items = await page.evalIn(ctx, `(() => {
  const sel = '.vjs-playback-rate .vjs-menu-item, .vjs-playback-rate .vjs-menu-content li, .vjs-menu-item';
  return Array.from(document.querySelectorAll(sel))
    .map((x, i) => ({ i, text: (x.innerText||'').replace(/\\s+/g,''), cls: String(x.className||'').slice(0,40), visible: x.getBoundingClientRect().width > 2 }))
    .slice(0, 15);
})()`);
console.log('菜单项:', JSON.stringify(items, null, 1));

// 3) 点 1.5x
const clicked = await page.evalIn(ctx, `(() => {
  const sel = '.vjs-playback-rate .vjs-menu-item, .vjs-menu-item';
  const all = Array.from(document.querySelectorAll(sel));
  const target = all.find(x => /1\\.5/.test((x.innerText||'')));
  if (!target) return 'not-found:' + all.map(x=>(x.innerText||'').trim()).join(',');
  target.click();
  return 'clicked:' + (target.innerText||'').trim();
})()`);
console.log('点击 1.5x:', clicked);
await wait(1500);

// 4) 观察 21 秒
for (let i = 1; i <= 7; i++) {
  const v = await page.evalIn(ctx, `(() => { const v = document.querySelector('video'); return v ? { paused: v.paused, cur: Number(v.currentTime.toFixed(1)), rate: v.playbackRate } : null; })()`);
  const t = new Date().toTimeString().slice(0,8);
  console.log(`${t} cur=${v && v.cur} paused=${v && v.paused} rate=${v && v.rate}`);
  if (v && v.paused) {
    await page.evalIn(ctx, `(() => { const v=document.querySelector('video'); v.muted=true; const p=v.play(); if(p&&p.catch)p.catch(()=>{}); return true; })()`);
  }
  await wait(3000);
}
page.close();
setTimeout(() => process.exit(0), 200);
