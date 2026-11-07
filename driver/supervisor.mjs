#!/usr/bin/env node
/**
 * driver/supervisor.mjs —— 进程级守护
 *
 * 背景：2026-11-06 21:15，驱动进程因 Node 堆损坏（退出码 0xC0000374）直接消失，
 * 之后没有任何东西把它拉起来，白白空转到第二天。
 * 开机的 .vbs 只在登录时跑一次，覆盖不到"运行中崩溃"这种情况，
 * 所以再加一层进程守护：驱动退出就重启。
 *
 * 用法：node driver/supervisor.mjs [透传给 drive.mjs 的参数...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = process.env.XXT_DATA || path.join(ROOT, 'data');
const OUT_LOG = path.join(DATA, 'drive.out.log');
const SUP_LOG = path.join(DATA, 'supervisor.log');
const RESTART_DELAY = Number(process.env.XXT_RESTART_DELAY || 60000);

fs.mkdirSync(DATA, { recursive: true });

const passArgs = process.argv.slice(2);
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

function say(msg) {
  const line = `[${stamp()}] [守护] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(SUP_LOG, new Date().toISOString() + '  ' + msg + '\n'); } catch (e) {}
}

say('守护启动，驱动退出后 ' + Math.round(RESTART_DELAY / 1000) + ' 秒自动重启');

let round = 0;
for (;;) {
  round++;
  say(`第 ${round} 次拉起驱动 ${passArgs.join(' ')}`.trim());
  const out = fs.openSync(OUT_LOG, 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(ROOT, 'driver', 'drive.mjs'), ...passArgs], {
      cwd: ROOT,
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
  } catch (e) {
    say('拉起失败：' + e.message);
    await new Promise((r) => setTimeout(r, RESTART_DELAY));
    continue;
  }

  const code = await new Promise((resolve) => {
    child.on('exit', (c, sig) => resolve({ c, sig }));
    child.on('error', (e) => resolve({ c: -1, sig: String(e.message) }));
  });

  // 0xC0000374 是堆损坏，Node 里常见于长时间运行后原生层出问题
  const hex = typeof code.c === 'number' && code.c < 0 ? (code.c >>> 0).toString(16).toUpperCase() : '';
  say(`驱动退出（code=${code.c}${hex ? ' / 0x' + hex : ''}${code.sig ? ', signal=' + code.sig : ''}），${Math.round(RESTART_DELAY / 1000)} 秒后重启`);

  await new Promise((r) => setTimeout(r, RESTART_DELAY));
}
