/**
 * tests/frame-probe.mjs —— 验证「跨域 iframe 里的 video 能否被找到」
 *
 * 造一个父页面（127.0.0.1）套一个跨域 iframe（localhost），iframe 里有 <video>，
 * 然后用真实浏览器 + CDP 多上下文执行，确认能取到 hasVideo=true。
 *
 * 运行：node tests/frame-probe.mjs
 */
import http from 'node:http';
import { launchBrowser } from '../driver/browser.mjs';
import { attach } from '../driver/cdp.mjs';

const PORT_A = 8801;   // 父页面：127.0.0.1
const PORT_B = 8802;   // 子页面：localhost（与父页面不同 origin）
const CDP_PORT = 9333;

const parentHtml = `<!doctype html><meta charset="utf-8"><title>parent</title>
<h1>父页面（127.0.0.1）</h1>
<iframe src="http://localhost:${PORT_B}/frame.html" width="640" height="360"></iframe>`;

const frameHtml = `<!doctype html><meta charset="utf-8"><title>frame</title>
<h2>子页面（localhost）</h2>
<video id="video_html5_api" width="600" height="300" muted></video>
<button id="cont">继续学习</button>`;

const srvA = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(parentHtml);
});
const srvB = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(frameHtml);
});

const PROBE = `(() => {
  const out = { acted: [], hasVideo: false };
  try { out.isTop = window === window.top; } catch (e) { out.isTop = false; }
  const v = document.querySelector('video#video_html5_api, video[id*="video_html5"], .vjs-tech, video');
  if (v) { out.hasVideo = true; out.cur = v.currentTime; out.dur = v.duration; out.paused = v.paused; }
  out.origin = location.origin;
  return out;
})()`;

await new Promise((r) => srvA.listen(PORT_A, '127.0.0.1', r));
await new Promise((r) => srvB.listen(PORT_B, '127.0.0.1', r));
console.log(`[test] 父页面 http://127.0.0.1:${PORT_A}/  子页面 http://localhost:${PORT_B}/frame.html`);

const started = Date.now();
try {
  await launchBrowser({
    port: CDP_PORT,
    profile: 'C:\\Users\\' + (process.env.USERNAME || 'JD') + '\\WorkBuddy\\chaoxing-profile-test',
    url: `http://127.0.0.1:${PORT_A}/`,
    headless: true,
    keepAlive: true,
  });
  console.log('[test] 浏览器就绪');

  const page = await attach(`http://127.0.0.1:${PORT_A}/`, CDP_PORT);
  await page.watchContexts(800);
  await new Promise((r) => setTimeout(r, 1200));

  const ids = Array.from(page.contexts.keys());
  console.log(`[test] 执行上下文数量：${ids.length}`);

  const results = [];
  for (const id of ids) {
    try {
      const v = await page.evalIn(id, PROBE);
      if (v) results.push(v);
    } catch (e) { /* 跳过不可用上下文 */ }
  }
  console.log(`[test] 跨域 iframe 会话数量：${page.sessions.size}`);
  for (const sid of page.sessions.keys()) {
    try {
      const v = await page.evalInSession(sid, PROBE);
      if (v) results.push(v);
    } catch (e) { /* 跳过 */ }
  }

  console.log('[test] 各上下文探测结果：');
  for (const r of results) {
    console.log(`   origin=${r.origin} isTop=${r.isTop} hasVideo=${r.hasVideo}${r.hasVideo ? ` dur=${r.dur}` : ''}`);
  }

  const top = results.find((r) => r.isTop);
  const vid = results.find((r) => r.hasVideo);
  console.log('');
  console.log(`[结果] 顶层上下文：${top ? top.origin : '未找到'}`);
  console.log(`[结果] 视频所在上下文：${vid ? vid.origin : '未找到'}`);
  console.log(`[结果] 跨域穿透：${vid && !vid.isTop ? '成功 ✅' : '失败 ❌'}`);

  page.close();
} catch (e) {
  console.error('[test] 失败：' + (e.message || e));
} finally {
  srvA.close();
  srvB.close();
  console.log(`[test] 用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  // 让浏览器自己退出，避免测试挂住
  setTimeout(() => process.exit(0), 300);
}
