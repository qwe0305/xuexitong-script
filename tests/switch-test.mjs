/**
 * tests/switch-test.mjs —— 验证目录树点击切节是否真的生效（来回各一次，不丢当前进度）
 *
 * 步骤：记住当前小节 → 点下一节 → 确认章节真的变了 → 点回原小节 → 确认回到原位
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toTimeString().slice(0, 8);

const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(800);

const S = `(() => {
  const nodes = Array.from(document.querySelectorAll('.posCatalog_select:not(.firstLayer)'));
  const isActive = (n) => {
    const c = String(n.className || '');
    return /posCatalog_active|posCatalog_current/.test(c) || /(^|\\s)active(\\s|$)/.test(c);
  };
  const idx = nodes.findIndex(isActive);
  const t = (n) => (n.title || n.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const v = document.querySelector('video');
  const lo = Math.max(0, idx - 1);
  const list = [];
  for (let i = lo; i < Math.min(nodes.length, lo + 5); i++) list.push('[' + i + '] ' + t(nodes[i]) + (i === idx ? '   <== 当前' : ''));
  return {
    count: nodes.length,
    idx,
    active: idx >= 0 ? t(nodes[idx]) : '',
    cur: v ? +v.currentTime.toFixed(1) : null,
    url: location.href.slice(0, 90),
    list: list,
  };
})()`;

async function topCtx() {
  for (const id of page.contexts.keys()) {
    try { const v = await page.evalIn(id, 'window===window.top'); if (v) return id; } catch (e) {}
  }
  return null;
}
const ctxId = await topCtx();
if (ctxId == null) { console.log('拿不到主框架上下文'); process.exit(0); }
const run = (e) => page.evalIn(ctxId, e);

const before = await run(S);
console.log(`目录共 ${before.count} 节，当前索引 ${before.idx}`);
console.log(`当前：${before.active}  cur=${before.cur}`);
console.log('邻近节点：\n  ' + before.list.join('\n  '));

if (before.idx < 0) { console.log('\n没找到 active 标记，无法定位当前小节，跳过测试'); process.exit(0); }
if (before.idx + 1 >= before.count) { console.log('\n已是最后一节，无法测下一节'); process.exit(0); }

console.log(`\n>>> 点击下一节 [${before.idx + 1}]`);
const clickIdx = (i) => run(`(() => {
  const nodes = Array.from(document.querySelectorAll('.posCatalog_select:not(.firstLayer)'));
  const n = nodes[${i}];
  if (!n) return 'no-node';
  const name = n.querySelector('.posCatalog_name') || n;
  const oc = String(name.getAttribute('onclick') || '');
  name.click();
  return (name.title || name.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 40) + '  [onclick=' + oc.slice(0, 50) + ']';
})()`);

console.log('  目标：' + (await clickIdx(before.idx + 1)));
await wait(9000);

const after = await run(S);
console.log(`${now()} 切后：${after.active}  cur=${after.cur}  idx=${after.idx}`);
console.log(`  url=${after.url}`);
const moved = after.active !== before.active || after.idx !== before.idx;
console.log(moved ? '  ✅ 章节确实切换了（点击生效）' : '  ❌ 章节没变（点击无效）');

console.log(`\n>>> 点回原小节 [${before.idx}] 恢复进度`);
await clickIdx(before.idx);
await wait(9000);
const back = await run(S);
console.log(`${now()} 回来：${back.active}  cur=${back.cur}  idx=${back.idx}`);
const restored = back.active === before.active;
console.log(restored ? `  ✅ 已回到原小节，进度 ${back.cur}（离开前 ${before.cur}）` : '  ⚠ 没回到原小节，请手动确认');

page.close();
setTimeout(() => process.exit(0), 200);
