/**
 * tests/catalog-dom.mjs —— 只读：打印某个目录节点的完整 outerHTML 与父级结构，
 * 找出真正可点击的元素（a[href] / li / onclick）。
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(800);

const P = `(() => {
  const nodes = Array.from(document.querySelectorAll('.posCatalog_select'));
  const idx = nodes.findIndex((n) => /posCatalog_active/.test(String(n.className||'')));
  const n = nodes[idx];
  if (!n) return null;
  const out = { idx: idx, tag: n.tagName, cls: String(n.className) };
  out.attrs = Array.from(n.attributes).map(function (a) { return a.name + '=' + String(a.value).slice(0, 60); });
  out.outer = String(n.outerHTML).replace(/\\s+/g, ' ').slice(0, 700);
  out.parentTag = n.parentElement ? n.parentElement.tagName + '.' + String(n.parentElement.className||'') : '';
  out.parentOuter = n.parentElement ? String(n.parentElement.outerHTML).replace(/\\s+/g, ' ').slice(0, 400) : '';
  const a = n.querySelector('a');
  out.innerA = a ? { href: String(a.getAttribute('href') || '').slice(0, 120), onclick: String(a.getAttribute('onclick') || '').slice(0, 160), cls: String(a.className||'') } : null;
  out.onclick = String(n.getAttribute('onclick') || '');
  // 全局是否暴露了跳转函数
  out.hasOpenChapter = typeof window.openChapter !== 'undefined';
  out.topFns = Object.keys(window).filter(function (k) { return /chapter|catalog|toChapter|openCh/i.test(k); }).slice(0, 20);
  return out;
})()`;

for (const id of page.contexts.keys()) {
  let v = null;
  try { v = await page.evalIn(id, P); } catch (e) {}
  if (v && v.idx >= 0) { console.log(JSON.stringify(v, null, 2)); break; }
}
page.close();
setTimeout(() => process.exit(0), 200);
