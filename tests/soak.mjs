/**
 * tests/soak.mjs —— 观察 40 秒：不设倍速（保持 1.0），只用 play() + 鼠标抖动，
 * 看进度是否持续推进，并记录每次暂停的状态。
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FIND = `(() => {
  const v = document.querySelector('video#video_html5_api, video');
  if (!v) return { hasVideo: false };
  return {
    hasVideo: true,
    paused: v.paused,
    ended: v.ended,
    cur: Number(v.currentTime.toFixed(1)),
    dur: Number((v.duration || 0).toFixed(0)),
    rate: v.playbackRate,
    muted: v.muted,
    rs: v.readyState,
  };
})()`;

const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
console.log('CDP ok，页面数', pages.length);

const page = await attach('', PORT);
await page.watchContexts(600);

async function scan() {
  let best = null;
  for (const id of page.contexts.keys()) {
    try {
      const v = await page.evalIn(id, FIND);
      if (v && v.hasVideo) { best = { ctxId: id, v }; break; }
    } catch (e) {}
  }
  return best;
}

let lastCur = -1;
let stuck = 0;

for (let i = 1; i <= 13; i++) {
  await page.watchContexts(30).catch(() => {});
  const hit = await scan();
  const t = new Date().toTimeString().slice(0, 8);

  if (!hit) {
    console.log(`${t} [${i}] 无视频`);
  } else {
    const v = hit.v;
    if (v.cur === lastCur) stuck++; else stuck = 0;
    lastCur = v.cur;
    console.log(`${t} [${i}] cur=${v.cur}/${v.dur} paused=${v.paused} rate=${v.rate} muted=${v.muted} rs=${v.rs}${stuck ? ` 停滞×${stuck}` : ''}`);

    if (v.paused && !v.ended) {
      // 不动倍速，只 play()
      await page.evalIn(hit.ctxId, `(() => { const v = document.querySelector('video'); v.muted = true; const p = v.play(); if (p && p.catch) p.catch(()=>{}); return v.playbackRate; })()`).catch(() => {});
    }
    // 鼠标抖动（可信事件）
    try {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600 + (i % 5) * 7, y: 300 + (i % 3) * 5, button: 'none', clickCount: 0 });
    } catch (e) {}
  }
  await wait(3000);
}

page.close();
setTimeout(() => process.exit(0), 200);
