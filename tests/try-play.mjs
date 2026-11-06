/**
 * tests/try-play.mjs —— 对照实验：找出能让视频真正播起来的手段
 * 依次尝试：play() → 可信鼠标点击播放器 → 鼠标移动抖动 → 组合
 */
import { attach } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FIND = `(() => {
  const v = document.querySelector('video#video_html5_api, video');
  const out = { isTop: (() => { try { return window === window.top; } catch (e) { return false; } })(), hasVideo: !!v };
  if (v) {
    const r = v.getBoundingClientRect();
    out.cur = Number(v.currentTime.toFixed(2));
    out.paused = v.paused;
    out.rect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  }
  return out;
})()`;

const page = await attach('', PORT);
await page.watchContexts(600);
await wait(600);

let videoCtx = null;
let info = null;
for (const id of page.contexts.keys()) {
  try {
    const v = await page.evalIn(id, FIND);
    if (v && v.hasVideo) { videoCtx = id; info = v; break; }
  } catch (e) {}
}
if (!videoCtx) { console.log('没找到 video'); process.exit(0); }
console.log(`video 在 ctx ${videoCtx}: paused=${info.paused} cur=${info.cur} rect=${JSON.stringify(info.rect)}`);

// 找到 video 所在 iframe 在顶层页面里的绝对偏移
const OFFSET = `(() => {
  const f = Array.from(document.querySelectorAll('iframe')).find((x) => /video/i.test(x.src || ''));
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
})()`;
let topCtx = null;
for (const id of page.contexts.keys()) {
  try {
    const v = await page.evalIn(id, FIND);
    if (v && v.isTop) { topCtx = id; break; }
  } catch (e) {}
}
let offset = null;
if (topCtx) { try { offset = await page.evalIn(topCtx, OFFSET); } catch (e) {} }
console.log('iframe 偏移:', JSON.stringify(offset));

async function state(tag) {
  const v = await page.evalIn(videoCtx, FIND);
  console.log(`  ${tag}: paused=${v.paused} cur=${v.cur}`);
  return v;
}

// ---- 手段 1：直接 play() ----
console.log('\n[1] 直接 play()');
await page.evalIn(videoCtx, `(() => { const v = document.querySelector('video'); v.muted = true; v.playbackRate = 1.5; const p = v.play(); if (p && p.catch) p.catch(() => {}); return true; })()`);
await wait(2500);
await state('2.5s 后');

// ---- 手段 2：可信鼠标点击播放器中心 ----
console.log('\n[2] 可信鼠标点击播放器中心');
const cx = offset ? offset.x + Math.round(offset.w / 2) : 500;
const cy = offset ? offset.y + Math.round(offset.h / 2) : 300;
console.log(`  点击坐标 (${cx}, ${cy})`);
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', clickCount: 0 });
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
await wait(2500);
await state('2.5s 后');

// ---- 手段 3：点击播放器左下角播放按钮所在区域 + 抖动 ----
console.log('\n[3] 鼠标抖动 + 再来一次点击');
for (let i = 0; i < 6; i++) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 12, y: cy - i * 6, button: 'none', clickCount: 0 });
  await wait(180);
}
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
await wait(3000);
await state('3s 后');

// ---- 手段 4：直接改 currentTime 触发 seek + play ----
console.log('\n[4] seek 到当前时间+1 再 play');
await page.evalIn(videoCtx, `(() => {
  const v = document.querySelector('video');
  try { v.currentTime = v.currentTime + 0.5; } catch (e) {}
  v.muted = true;
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
  return true;
})()`);
await wait(3000);
await state('3s 后');

page.close();
setTimeout(() => process.exit(0), 200);
