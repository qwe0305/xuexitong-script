/**
 * browser.mjs —— 拉起带调试端口的浏览器（被 launch.mjs 和 drive.mjs 共用）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_PORT = Number(process.env.XXT_CDP_PORT || 9222);
export const DEFAULT_PROFILE = process.env.XXT_PROFILE || path.join(os.homedir(), 'WorkBuddy', 'chaoxing-profile');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findBrowser() {
  return process.env.XXT_BROWSER || CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

export async function isCdpUp(port = DEFAULT_PORT) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { cache: 'no-store' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/**
 * @returns {Promise<import('node:child_process').ChildProcess|null>} keep=true 时返回子进程句柄（不 unref）
 */
export async function launchBrowser({ port = DEFAULT_PORT, profile = DEFAULT_PROFILE, url = 'https://mooc1.chaoxing.com/', headless = false, keepAlive = false } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('找不到 Edge/Chrome，可设 XXT_BROWSER 指定路径');

  fs.mkdirSync(profile, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    url,
  ];
  if (headless) args.unshift('--headless=new', '--disable-gpu');

  const child = spawn(exe, args, { detached: !keepAlive, stdio: 'ignore' });
  if (!keepAlive) child.unref();

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await isCdpUp(port)) return keepAlive ? child : null;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error('调试端口未就绪（被安全软件拦截，或浏览器版本限制）');
}
