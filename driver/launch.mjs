#!/usr/bin/env node
/**
 * launch.mjs —— 单独启动带调试端口的浏览器（不需要扩展）
 *
 * 首次运行是一个全新配置目录，里面没有你的登录态：在这个窗口里登录一次学习通，
 * 之后该目录会一直保留登录，下次直接后台跑。
 *
 * 用法：
 *   node driver/launch.mjs                  # 有窗口
 *   node driver/launch.mjs --headless       # 无窗口（真后台）
 *   node driver/launch.mjs --url "<课程页URL>"
 */
import { launchBrowser, DEFAULT_PORT, DEFAULT_PROFILE, findBrowser } from './browser.mjs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
const headless = process.argv.includes('--headless');
const url = arg('url', 'https://mooc1.chaoxing.com/');
const port = Number(arg('port', DEFAULT_PORT));

const exe = findBrowser();
if (!exe) {
  console.error('找不到 Edge/Chrome，可设环境变量 XXT_BROWSER=<路径>');
  process.exit(1);
}

console.log(`[launch] ${path.basename(exe)} ${headless ? '(headless)' : '(有窗口)'}`);
console.log(`[launch] profile = ${DEFAULT_PROFILE}`);
console.log(`[launch] cdp     = http://127.0.0.1:${port}`);

try {
  await launchBrowser({ port, url, headless, keepAlive: false });
} catch (e) {
  console.error('[launch] 失败：' + e.message);
  process.exit(2);
}

console.log('[launch] 就绪。下一步：node driver/drive.mjs' + (headless ? '' : '（首次请先在这个窗口里登录学习通）'));
