/**
 * tests/rate-125.mjs —— 倍速阈值对照实验
 *
 * 目的：确认超星/ananans 播放器是否对「所有非 1.0 倍速」都强制暂停。
 * 流程：1.0x 观察 18s → 1.25x 观察 30s → 回到 1.0x 观察 18s
 * 只做 setRate + play()，不做点击，不派发任何鼠标事件，排除干扰变量。
 */

import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toTimeString().slice(0, 8);

const FIND = `(() => {
  const v = document.querySelector('video');
  if (!v) return { hasVideo: false };
  return {
    hasVideo: true,
    paused: v.paused,
    ended: v.ended,
    cur: Number(v.currentTime.toFixed(1)),
    dur: Number((v.duration || 0).toFixed(0)),
    rate: v.playbackRate,
    rs: v.readyState,
  };
})()`;

const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }

const page = await attach('', PORT);
await page.watchContexts(800);
console.log(`ctx=${page.contexts.size} session=${page.sessions.size}\n`);

/** 在 context + session 里都找一遍视频，返回定位信息 */
async function locate() {
  for (const id of page.contexts.keys()) {
    try {
      const v = await page.evalIn(id, FIND);
      if (v && v.hasVideo) return { kind: 'ctx', id, v };
    } catch (e) {}
  }
  for (const sid of page.sessions.keys()) {
    try {
      const v = await page.evalInSession(sid, FIND);
      if (v && v.hasVideo) return { kind: 'oopif', id: sid, v };
    } catch (e) {}
  }
  return null;
}

async function run(loc, expr) {
  return loc.kind === 'ctx' ? page.evalIn(loc.id, expr) : page.evalInSession(loc.id, expr);
}

const SET_RATE = (r) => `(() => {
  const v = document.querySelector('video');
  if (!v) return 'no-video';
  v.playbackRate = ${r};
  v.muted = true;
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
  return { rate: v.playbackRate, paused: v.paused };
})()`;

async function phase(label, rate, seconds) {
  const t0 = now();
  let loc = await locate();
  if (!loc) { console.log(`${t0} ${label}: 找不到视频`); return null; }
  const setRes = await run(loc, SET_RATE(rate)).catch((e) => 'err:' + e.message);
  console.log(`\n===== ${label}  target=${rate}x  loc=${loc.kind}  起点 cur=${loc.v.cur}  =====`);
  console.log(`  设置结果: ${JSON.stringify(setRes)}`);

  let prev = null;
  let pauseEvents = 0;
  let progress = 0;
  let samples = 0;
  const ticks = Math.floor((seconds * 1000) / 3000);

  for (let i = 1; i <= ticks; i++) {
    await wait(3000);
    // 上下文可能重建，重新定位
    const cur = await locate();
    if (!cur) { console.log(`${now()} [${i}] 无视频（上下文重建中）`); continue; }
    loc = cur;
    const v = cur.v;
    samples++;
    if (prev !== null) {
      const d = +(v.cur - prev).toFixed(1);
      if (d > 0.5) progress += d;
      if (v.paused && !v.ended) pauseEvents++;
    }
    prev = v.cur;
    console.log(`${now()} [${i}] cur=${v.cur}/${v.dur} paused=${v.paused} rate=${v.rate} rs=${v.rs}`);
    if (v.paused && !v.ended) {
      await run(cur, SET_RATE(rate)).catch(() => {});
    }
  }

  const avg = samples > 1 ? (progress / ((samples - 1) * 3)).toFixed(2) : '0';
  console.log(`  >>> ${label} 小结: 累计推进 ${progress.toFixed(1)}s / 真实 ${(samples - 1) * 3}s  →  实测倍率 ${avg}x，暂停次数 ${pauseEvents}`);
  return { progress, pauseEvents, avg: Number(avg) };
}

const A = await phase('A 基线 1.0x', 1.0, 18);
const B = await phase('B 测试 1.25x', 1.25, 30);
const C = await phase('C 回退 1.0x', 1.0, 18);

console.log('\n================ 结论 ================');
console.log(`A(1.0x)  推进 ${A ? A.progress : '-'}s  暂停 ${A ? A.pauseEvents : '-'} 次  实测 ${A ? A.avg : '-'}x`);
console.log(`B(1.25x) 推进 ${B ? B.progress : '-'}s  暂停 ${B ? B.pauseEvents : '-'} 次  实测 ${B ? B.avg : '-'}x`);
console.log(`C(1.0x)  推进 ${C ? C.progress : '-'}s  暂停 ${C ? C.pauseEvents : '-'} 次  实测 ${C ? C.avg : '-'}x`);
if (B && C && A) {
  const ok125 = B.avg > 1.1;
  console.log(ok125
    ? '判定：1.25x 可用（实测倍率 > 1.1），非 1.0 倍速并非一律被暂停'
    : '判定：1.25x 同样被压制（实测倍率 ≈ 1.0 或更低），任何非官方倍速都会被强制暂停');
}

page.close();
setTimeout(() => process.exit(0), 200);
