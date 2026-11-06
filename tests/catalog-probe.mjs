/**
 * tests/catalog-probe.mjs —— 只读：把目录树 41 个节点的 class / 父级 class / 文本全打出来，
 * 找出「当前小节」到底靠什么标记。
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(800);

const P = `(() => {
  const nodes = Array.from(document.querySelectorAll('.posCatalog_select'));
  return nodes.map(function (n, i) {
    const t = (n.title || n.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 34);
    const pc = n.parentElement ? String(n.parentElement.className || '') : '';
    return i + ' | ' + String(n.className || '') + ' | parent=' + pc + ' | ' + t;
  });
})()`;

for (const id of page.contexts.keys()) {
  let v = null;
  try { v = await page.evalIn(id, P); } catch (e) {}
  if (Array.isArray(v) && v.length) {
    console.log(`[ctx ${id}] 共 ${v.length} 个 .posCatalog_select 节点\n`);
    v.forEach((line) => console.log('  ' + line));
    break;
  }
}
page.close();
setTimeout(() => process.exit(0), 200);
