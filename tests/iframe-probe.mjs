/**
 * tests/iframe-probe.mjs —— 只读：当前页面里有哪些 iframe、是否含播放器模块
 * 用来区分「文字章节（真没视频）」和「视频章节但 iframe 还没加载出来」
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(600);

const P = `(() => {
  const act = document.querySelector('.posCatalog_select.posCatalog_active, .posCatalog_active');
  const ifr = Array.from(document.querySelectorAll('iframe')).map(function (f) {
    return String(f.getAttribute('src') || f.src || '(no src)').slice(0, 100);
  });
  const boxes = Array.from(document.querySelectorAll('[class*="ans-attach"], [class*="attach"], .video, [class*="ppt"], [class*="doc"]'))
    .slice(0, 8)
    .map(function (e) { return (e.tagName + '.' + String(e.className || '')).slice(0, 70); });
  return {
    chapter: act ? (act.title || act.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 50) : '',
    iframes: ifr,
    videos: document.querySelectorAll('video').length,
    attachBoxes: boxes,
    bodyLen: (document.body.innerText || '').length,
    bodyHead: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 160),
  };
})()`;

for (const id of page.contexts.keys()) {
  let v = null;
  try { v = await page.evalIn(id, P); } catch (e) { continue; }
  if (!v || (!v.bodyLen && !v.iframes.length)) continue;   // 跳过空上下文
  console.log(`[ctx ${id}]`);
  console.log(JSON.stringify(v, null, 2));
  console.log('');
}
page.close();
setTimeout(() => process.exit(0), 200);
