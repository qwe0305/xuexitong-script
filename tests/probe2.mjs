import { attach } from '../driver/cdp.mjs';
const PORT = 9222;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await attach('', PORT);
await page.watchContexts(600);
await wait(500);
let ctxId = null;
for (const id of page.contexts.keys()) {
  try { const v = await page.evalIn(id, `!!document.querySelector('video')`); if (v) { ctxId = id; break; } } catch (e) {}
}
if (!ctxId) { console.log('no video'); process.exit(0); }
console.log('ctx', ctxId);

// 1) play() 的真实结果
const r1 = await page.evalIn(ctxId, `(async () => {
  const v = document.querySelector('video');
  try { await v.play(); return 'resolved paused=' + v.paused; }
  catch (e) { return 'rejected ' + e.name + ': ' + (e.message||'').slice(0,120); }
})()`);
console.log('[play 结果]', r1);

// 2) 谁在 pause：装监听器记录 stack
await page.evalIn(ctxId, `(() => {
  const v = document.querySelector('video');
  window.__pauses = [];
  v.addEventListener('pause', () => {
    window.__pauses.push({ t: Date.now(), stack: (new Error()).stack.split('\\n').slice(1,6).join(' | ') });
  });
  window.__playCalls = 0;
  const orig = v.play.bind(v);
  v.play = function(){ window.__playCalls++; return orig(); };
  return true;
})()`);
await page.evalIn(ctxId, `document.querySelector('video').play().catch(()=>{})`);
await wait(4000);
const info = await page.evalIn(ctxId, `({
  pauses: (window.__pauses||[]).length,
  stacks: (window.__pauses||[]).slice(0,3).map(p=>p.stack),
  playCalls: window.__playCalls,
  paused: document.querySelector('video').paused,
  cur: document.querySelector('video').currentTime,
  muted: document.querySelector('video').muted,
  rate: document.querySelector('video').playbackRate,
  autoplay: document.querySelector('video').autoplay
})`);
console.log(JSON.stringify(info, null, 2).slice(0, 1800));
page.close();
setTimeout(()=>process.exit(0),200);
