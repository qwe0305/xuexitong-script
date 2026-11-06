/**
 * tests/quiz-mock.mjs —— AI 答题链路的离线集成测试（不需要真实 key）
 *
 * 做法：
 *   1. 起一个本地 HTTP 服务，同时提供两样东西
 *      - /q.html                     仿超星测验页的 DOM（.questionLi / .num_option / radio / checkbox）
 *      - /v1/chat/completions        假的 OpenAI 兼容接口，按题型返回预设答案
 *   2. 通过 CDP 新开标签页打开 /q.html
 *   3. 复用 driver/quiz.mjs 的 collect / solve，走真实代码路径
 *   4. 断言：第 1 题（单选）勾中 B，第 2 题（多选）勾中 A 和 C
 *
 * 用法：node tests/quiz-mock.mjs
 */
import http from 'node:http';
import { Page, listPages } from '../driver/cdp.mjs';

const CDP_PORT = Number(process.env.XXT_CDP_PORT || 9222);
const PORT = 8799;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 仿超星测验页 ---------------- */
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>测验（合成）</title>
<style>.questionLi{margin:20px;padding:10px;border:1px solid #ccc;width:600px}
li{margin:6px;list-style:none}</style></head>
<body>
<div class="questionLi">
  <div class="mark_name">1.（单选题）中国共产党人的初心和使命是什么？</div>
  <ul class="answerList">
    <li><input type="radio" name="q1"><span class="num_option">A</span> 为中国人民谋幸福</li>
    <li><input type="radio" name="q1"><span class="num_option">B</span> 为中华民族谋复兴</li>
    <li><input type="radio" name="q1"><span class="num_option">C</span> 为世界人民谋和平</li>
    <li><input type="radio" name="q1"><span class="num_option">D</span> 为全人类谋发展</li>
  </ul>
</div>
<div class="questionLi">
  <div class="mark_name">2.（多选题）下列属于红色文化品格的有？</div>
  <ul class="answerList">
    <li><input type="checkbox" name="q2"><span class="num_option">A</span> 坚定信念</li>
    <li><input type="checkbox" name="q2"><span class="num_option">B</span> 贪图享乐</li>
    <li><input type="checkbox" name="q2"><span class="num_option">C</span> 艰苦奋斗</li>
    <li><input type="checkbox" name="q2"><span class="num_option">D</span> 消极懈怠</li>
  </ul>
</div>
</body></html>`;

/* ---------------- 假的大模型 ---------------- */
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/q.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (req.url.includes('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let prompt = '';
      try {
        const msgs = JSON.parse(body).messages || [];
        // 只看最后一条用户消息：system 提示词里也写了"多选题"，不能拿整段判断
        prompt = msgs.length ? String(msgs[msgs.length - 1].content || '') : '';
      } catch (e) {}
      // 按题型给不同答案：多选 → AC，单选 → B
      const answer = /题型：多选题/.test(prompt) ? 'AC' : 'B';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }));
    });
    return;
  }
  res.writeHead(404); res.end('no');
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`本地服务已起：http://127.0.0.1:${PORT}/q.html`);

// 让 ai.mjs 指向这个假服务
process.env.XXT_LLM_BASE = `http://127.0.0.1:${PORT}/v1`;
process.env.XXT_LLM_KEY = 'mock-key';
process.env.XXT_LLM_MODEL = 'mock-model';

const { askLLM } = await import('../agent/ai.mjs');
const quiz = await import('../driver/quiz.mjs');

const pages = await listPages(CDP_PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪（9222），先让浏览器开着'); server.close(); process.exit(0); }

/* ---------------- 开一个新标签跑测试 ---------------- */
// 注意：DevTools 的 /json/new 是 PUT /json/new?<完整URL>，不是 ?url=xxx
const target = `http://127.0.0.1:${PORT}/q.html`;
const created = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(target)}`, { method: 'PUT' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (!created || !created.webSocketDebuggerUrl) { console.log('无法新建标签页'); server.close(); process.exit(0); }
console.log('已打开测试标签页：' + (created.url || '(pending)'));

const page = await Page.connect(created.webSocketDebuggerUrl);
await page.watchContexts(800);

let ctxId = null;
for (let attempt = 1; attempt <= 6 && ctxId == null; attempt++) {
  await wait(1500);
  await page.watchContexts(400).catch(() => {});
  for (const id of page.contexts.keys()) {
    try {
      const t = await page.evalIn(id, 'document.title');
      if (/测验/.test(String(t))) { ctxId = id; break; }
    } catch (e) {}
  }
  if (ctxId == null) console.log(`  第 ${attempt} 次查找未就绪（ctx=${page.contexts.size}）`);
}
if (ctxId == null) {
  console.log('找不到测试页上下文，已发现的上下文：');
  for (const [id, c] of page.contexts) console.log(`  ${id} origin=${c.origin || '?'} name=${c.name || ''}`);
  page.close(); server.close(); process.exit(0);
}
console.log('上下文就绪 ctx=' + ctxId);

/* ---------------- 抓题 ---------------- */
const questions = await quiz.collect(page, ctxId);
console.log('\n抓到题目：' + (questions ? questions.length : 0) + ' 道');
if (questions) questions.forEach((q) => console.log(`  [${q.index}] ${q.type} ${q.question.slice(0, 30)} | 选项 ${q.options.map((o) => o.label).join('')}`));

/* ---------------- 作答 ---------------- */
const logs = [];
const res = await quiz.solvePage(page, ctxId, questions, askLLM, (m) => { logs.push(m); console.log('   ' + m); });

/* ---------------- 断言 ---------------- */
const state = await page.evalIn(ctxId, `(() => {
  const out = [];
  document.querySelectorAll('.questionLi').forEach((n, i) => {
    const picked = [];
    n.querySelectorAll('input').forEach((inp, j) => { if (inp.checked) picked.push(String.fromCharCode(65 + j)); });
    out.push(picked.join('') || '(未选)');
  });
  return out;
})()`);

console.log('\n实际勾选结果：' + JSON.stringify(state));
const pass = state[0] === 'B' && state[1] === 'AC';
console.log(pass ? '✅ 通过：单选勾 B、多选勾 AC，整条链路可用' : '❌ 未通过：期望 ["B","AC"]，实际 ' + JSON.stringify(state));

/* ---------------- 收尾 ---------------- */
try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${created.id}`); } catch (e) {}
page.close();
server.close();
setTimeout(() => process.exit(pass ? 0 : 1), 300);
