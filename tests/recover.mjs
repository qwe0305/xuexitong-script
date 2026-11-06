/**
 * tests/recover.mjs —— 把跑到错误页/空白页的标签页导航回指定 URL
 * 用法：node tests/recover.mjs "<URL>"
 */
import { attach, listPages, Page } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const URL = process.argv[2];
if (!URL) { console.log('用法: node tests/recover.mjs "<URL>"'); process.exit(1); }

const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }

let target = pages.find((p) => p.type === 'page') || null;
if (!target) { console.log('没有可用标签页'); process.exit(0); }
console.log('目标标签页: ' + String(target.url || '').slice(0, 80));

const page = await Page.connect(target.webSocketDebuggerUrl);
await page.send('Page.enable').catch(() => {});
await page.send('Page.navigate', { url: URL }).catch((e) => console.log('navigate 失败: ' + e.message));
console.log('已发起导航，等待 20 秒让播放器加载…');
await new Promise((r) => setTimeout(r, 20000));
await page.watchContexts(800);

const P = `(() => {
  const v = document.querySelector('video');
  return { href: location.href.slice(0, 80), videos: document.querySelectorAll('video').length,
           cur: v ? +v.currentTime.toFixed(1) : null, dur: v ? +(v.duration||0).toFixed(1) : null,
           paused: v ? v.paused : null, rate: v ? v.playbackRate : null };
})()`;
for (const id of page.contexts.keys()) {
  try {
    const s = await page.evalIn(id, P);
    if (s && s.videos) { console.log('恢复结果: ' + JSON.stringify(s)); break; }
  } catch (e) {}
}
for (const sid of page.sessions.keys()) {
  try {
    const s = await page.evalInSession(sid, P);
    if (s && s.videos) { console.log('恢复结果(oopif): ' + JSON.stringify(s)); break; }
  } catch (e) {}
}
page.close();
setTimeout(() => process.exit(0), 300);
