/**
 * tests/diag-live.mjs —— 只读诊断：连上正在运行的浏览器，把每个 frame 的真实状态打出来
 * 不会点击、不会播放，纯读取。
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);

const PROBE = `(() => {
  const out = {};
  try { out.isTop = window === window.top; } catch (e) { out.isTop = false; }
  out.href = location.href.slice(0, 110);
  out.hidden = document.hidden;
  out.visibility = document.visibilityState;
  try { out.hasFocus = document.hasFocus(); } catch (e) { out.hasFocus = null; }
  out.videos = document.querySelectorAll('video').length;

  const v = document.querySelector('video');
  if (v) {
    const r = v.getBoundingClientRect();
    out.video = {
      id: v.id || '(no id)',
      cls: String(v.className || '').slice(0, 40),
      paused: v.paused,
      ended: v.ended,
      muted: v.muted,
      currentTime: Number(v.currentTime.toFixed(2)),
      duration: Number((v.duration || 0).toFixed(1)),
      readyState: v.readyState,
      networkState: v.networkState,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      src: String(v.currentSrc || v.src || '').slice(0, 90),
    };
    let p = v.parentElement, chain = [];
    for (let i = 0; i < 4 && p; i++) { chain.push((p.tagName + '.' + String(p.className || '')).slice(0, 50)); p = p.parentElement; }
    out.videoParents = chain;
  }

  const big = document.querySelector('.vjs-big-play-button, .prism-big-play-btn, .xgplayer-start, [class*="big-play"]');
  out.bigPlay = big ? (big.tagName + '.' + String(big.className || '')).slice(0, 60) : null;

  const pops = [];
  for (const el of document.querySelectorAll('button, a, div, span')) {
    const t = (el.innerText || '').replace(/\\s+/g, '');
    if (!t || t.length > 12) continue;
    if (!/继续学习|继续观看|我知道了|点击继续|继续播放/.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    pops.push({ text: t, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    if (pops.length >= 3) break;
  }
  out.popups = pops;
  out.tip = (document.body && document.body.innerText || '').indexOf('长时间') >= 0;
  return out;
})()`;

function print(label, v) {
  if (!v) return;
  console.log('  ' + label + ' | ' + (v.href || '').slice(0, 80));
  console.log('      isTop=' + v.isTop + ' hidden=' + v.hidden + ' visibility=' + v.visibility + ' hasFocus=' + v.hasFocus + ' videos=' + v.videos);
  if (v.video) {
    const d = v.video;
    console.log(`      video#${d.id} .${d.cls} paused=${d.paused} ended=${d.ended} muted=${d.muted} t=${d.currentTime}/${d.duration} readyState=${d.readyState} netState=${d.networkState}`);
    console.log(`      rect=${JSON.stringify(d.rect)} src=${d.src}`);
    console.log(`      父链=${JSON.stringify(v.videoParents)}`);
  }
  if (v.bigPlay) console.log('      大播放按钮: ' + v.bigPlay);
  if (v.popups && v.popups.length) console.log('      弹窗按钮: ' + JSON.stringify(v.popups));
  if (v.tip) console.log('      页面出现"长时间"类提示文案');
}

const pages = await listPages(PORT).catch((e) => null);
if (!Array.isArray(pages)) {
  console.log('连不上 CDP（9222），当前没有驱动在跑。');
  process.exit(0);
}
const hits = pages.filter((p) => p.type === 'page' && /chaoxing/.test(p.url || ''));
console.log(`标签页 ${pages.length} 个，chaoxing 相关 ${hits.length} 个`);
hits.forEach((h) => console.log('  - ' + h.title.slice(0, 30) + '  ' + h.url.slice(0, 90)));

const page = await attach('', PORT);
await page.watchContexts(800);
await new Promise((r) => setTimeout(r, 800));

console.log(`\n执行上下文 ${page.contexts.size} 个，跨域会话 ${page.sessions.size} 个\n`);
for (const [id, c] of page.contexts) {
  let v = null;
  try { v = await page.evalIn(id, PROBE); } catch (e) { v = null; }
  console.log(`[ctx ${id}] origin=${c.origin || '?'} name=${(c.name || '').slice(0, 20)}`);
  print('state', v);
}
for (const [sid, info] of page.sessions) {
  let v = null;
  try { v = await page.evalInSession(sid, PROBE); } catch (e) { console.log(`[oopif ${sid.slice(0, 8)}] 执行失败: ${e.message}`); continue; }
  console.log(`[oopif ${sid.slice(0, 8)}] ${String(info.url || '').slice(0, 80)}`);
  print('state', v);
}
page.close();
setTimeout(() => process.exit(0), 200);
