/**
 * tests/end-test.mjs —— 端到端验证「播完 → 自动切下一节」
 *
 * 做法：把当前视频 seek 到结尾前 N 秒，保持 1.0x 正常播放，
 * 然后观察驱动日志里是否出现「切换下一节」，并对比切节后的章节名/URL。
 *
 * 用法：node tests/end-test.mjs [提前秒数，默认 25]
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const AHEAD = Number(process.argv[2] || 25);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toTimeString().slice(0, 8);

const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(800);

const INFO = `(() => {
  const v = document.querySelector('video');
  const act = document.querySelector('.posCatalog_select.active');
  return {
    hasVideo: !!v,
    cur: v ? Number(v.currentTime.toFixed(1)) : null,
    dur: v ? Number((v.duration||0).toFixed(1)) : null,
    paused: v ? v.paused : null,
    ended: v ? v.ended : null,
    rate: v ? v.playbackRate : null,
    chapter: act ? (act.title || act.innerText || '').replace(/\\s+/g,' ').trim().slice(0,40) : '',
    url: location.href.slice(0, 100),
  };
})()`;

async function locate() {
  for (const id of page.contexts.keys()) {
    try { const v = await page.evalIn(id, INFO); if (v && v.hasVideo) return { kind: 'ctx', id, v }; } catch (e) {}
  }
  for (const sid of page.sessions.keys()) {
    try { const v = await page.evalInSession(sid, INFO); if (v && v.hasVideo) return { kind: 'oopif', id: sid, v }; } catch (e) {}
  }
  return null;
}
async function run(loc, expr) {
  return loc.kind === 'ctx' ? page.evalIn(loc.id, expr) : page.evalInSession(loc.id, expr);
}

let loc = await locate();
if (!loc) { console.log('找不到视频'); process.exit(0); }
const before = loc.v;
console.log(`切节前：${before.chapter}  ${before.cur}/${before.dur}  url=${before.url.slice(0, 70)}`);

const target = Math.max(0, before.dur - AHEAD);
console.log(`\n>>> seek 到 ${target}（结尾前 ${AHEAD}s），倍速保持 1.0\n`);
await run(loc, `(() => {
  const v = document.querySelector('video');
  v.playbackRate = 1;
  v.muted = true;
  v.currentTime = ${target};
  const p = v.play(); if (p && p.catch) p.catch(()=>{});
  return { cur: v.currentTime, rate: v.playbackRate };
})()`).catch((e) => console.log('seek 失败: ' + e.message));

let sawEnd = false;
for (let i = 1; i <= Math.ceil((AHEAD + 40) / 3); i++) {
  await wait(3000);
  const cur = await locate();
  if (!cur) { console.log(`${now()} 视频消失（可能正在切节）`); continue; }
  const v = cur.v;
  if (v.ended) sawEnd = true;
  const changed = v.chapter !== before.chapter || v.url !== before.url;
  console.log(`${now()} ${v.chapter.slice(0, 26)} | ${v.cur}/${v.dur} paused=${v.paused} ended=${v.ended} rate=${v.rate}${changed ? '  <== 章节/地址已变化' : ''}`);
  if (changed) {
    console.log('\n>>> 已切换到下一节 ✅');
    break;
  }
}

const af = await locate();
if (af) console.log(`\n当前：${af.v.chapter}  ${af.v.cur}/${af.v.dur}`);
console.log(sawEnd ? '视频确实走到 ended' : '本次未观察到 ended 标志（可能走了"到达结尾"判定）');
page.close();
setTimeout(() => process.exit(0), 200);
