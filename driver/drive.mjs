#!/usr/bin/env node
/**
 * drive.mjs —— 无扩展后台刷课：通过 CDP 直接在页面里执行逻辑
 *
 * 用法：
 *   node driver/drive.mjs --url "<课程播放页URL>" [--rate 1.5] [--interval 3]
 *   node driver/drive.mjs --status-only
 *
 * 依赖：仅 Node 22+（内置 fetch / WebSocket）。需要浏览器以 --remote-debugging-port 启动，
 *       可用 driver/launch.mjs 一键拉起。
 */
import { attach, listPages, Page } from './cdp.mjs';
import { launchBrowser, isCdpUp } from './browser.mjs';
import { askLLM, llmReady } from '../agent/ai.mjs';
import { collect as quizCollect, solvePage as quizSolve, submit as quizSubmit } from './quiz.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.XXT_DATA || path.join(__dirname, '..', 'data');
const HUB = process.env.XXT_HUB || 'http://127.0.0.1:8731';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const START_URL = arg('url', '');
const AUTO = !START_URL;   // 没给 URL = 自动模式：打开门户，等用户点进课程后接管
const PORTAL = 'https://mooc1.chaoxing.com/';
/* 倍速：实测结论（tests/rate-125.mjs）——
 * 1.0x 连续推进 15.1s/15s，0 次暂停；
 * 1.25x 推进 0.0s/27s，被暂停 9 次，且播放器自行把 playbackRate 改回 1 仍不恢复。
 * 结论：任何非 1.0 倍速都会被 ananas 播放器判定异常并锁死播放，因此这里强制 1.0。 */
const RATE = 1.0;
if (arg('rate', '') !== '' && Number(arg('rate')) !== 1) {
  console.warn(`[warn] --rate ${arg('rate')} 已忽略：实测超星对非 1.0 倍速会强制暂停播放，强制使用 1.0x`);
}
const INTERVAL = Number(arg('interval', '3')) * 1000;
const MAX_HOURS = Number(arg('max-hours', '10'));
const NO_VIDEO_SKIP_MS = Number(arg('skip-after', '60')) * 1000;
const PORT = Number(arg('port', process.env.XXT_CDP_PORT || '9222'));
const HEADLESS = !flag('windowed');   // 默认无窗口，加 --windowed 才显示
// AI 答题：默认关闭（先用 --quiz 显式开启）。刷课稳定性优先，答题按需再开。
const NO_QUIZ = !flag('quiz');
const AUTO_SUBMIT = flag('auto-submit'); // 答完自动交卷（默认不交，留给你核对）
// 文字章节停留时长（默认 100 秒）。太短阅读任务点不计，太长纯浪费时间。
const TEXT_DWELL = Number(arg('text-dwell', '100')) * 1000;

const T0 = Date.now();
let page = null;
let lastNextAt = 0;
let noVideoSince = 0;
let lastLog = 0;
let lastHint = '';
let lastCur = -1;          // 上次进度，用于停滞检测
let stallSince = 0;        // 从什么时候开始不动
let lastReloadAt = 0;      // 上次强制刷新时间
let nearEndStreak = 0;     // 连续几轮判定为「临近结尾」
let lastGoodUrl = '';      // 最后一次正常可用的课程页地址（掉线后回跳用）
let lastNavAt = 0;         // 上次自动导航时间
let stallKicked = false;   // 本轮停滞是否已轻推过
let navFails = 0;          // 连续自动导航失败次数
let lastQuizSig = '';      // 上次答过的题目签名，避免同一页反复作答
let lastQuizAt = 0;
let switchAttempts = 0;    // 连续切节失败次数（≥2 改用按钮兜底）
let playerWaitSince = 0;   // 播放器 iframe 已挂载但视频未就绪的起始时间
let textSince = 0;         // 文字章节开始阅读的时间
let lastWaitLog = 0;
let lastNetCheckAt = 0;    // 上次网络探测时间

/* ---------------- 页面内执行的快照+操作脚本 ---------------- */

function snapshotScript(rate) {
  return `(() => {
  const out = { acted: [], hasVideo: false };
  try { out.isTop = window === window.top; } catch (e) { out.isTop = false; }
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  const txt = (el) => (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '');

  // 1) 防挂机弹窗
  const POP = ['继续学习', '继续观看', '继续播放', '我知道了', '知道了', '点击继续', '返回继续学习'];
  const btns = Array.from(document.querySelectorAll('button, a, div, span'));
  for (const el of btns) {
    const t = txt(el);
    if (!t || t.length > 14 || !POP.includes(t) || !visible(el)) continue;
    try { el.click(); out.acted.push('popup:' + t); } catch (e) {}
    break;
  }

  // 2) 小节标题
  const act = document.querySelector('.posCatalog_select.active, .posCatalog_active');
  out.chapter = act ? (act.title || act.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '';

  // 2.1) 区分「视频章节但播放器还没加载」和「文字章节（本来就没视频）」
  out.playerIframe = !!document.querySelector('iframe[src*="ananas"], iframe[src*="modules/video"], iframe[src*="modules/audio"]');
  out.textIframe = !!document.querySelector('iframe[src*="knowledge/cards"], iframe[src*="knowledge"]');

  // 3) 视频
  const pick = (doc) => { try { return doc.querySelector('video#video_html5_api, video[id*="video_html5"], .vjs-tech, video'); } catch (e) { return null; } };
  let v = pick(document);
  if (!v) {
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { d = null; }
      const hit = pick(d);
      if (hit) { v = hit; break; }
    }
  }
  if (v) {
    out.hasVideo = true;
    out.cur = Number((v.currentTime || 0).toFixed(1));
    out.dur = Number((v.duration || 0).toFixed(1));
    out.paused = v.paused;
    out.ended = v.ended;
    out.rate = v.playbackRate;
    // 倍速守卫：任何非 1.0 倍速都会被播放器判为异常并锁死播放，强制拉回 1.0
    if (Math.abs(v.playbackRate - 1) > 0.01) {
      try { v.playbackRate = 1; out.acted.push('rate-guard:' + out.rate); } catch (e) {}
    }
    if (v.paused && !v.ended) {
      try {
        v.muted = true;
        const p = v.play();
        if (p && p.catch) p.catch((err) => { out.playErr = String((err && err.name) || err); });
        out.acted.push('play');
      } catch (e) {
        out.playErr = String((e && e.message) || e);
      }
      // 从未开始播放时，点一次播放器的大播放按钮（不碰播放/暂停切换键，避免反向操作）
      if (v.currentTime < 2) {
        const big = document.querySelector('.vjs-big-play-button, .prism-big-play-btn, .xgplayer-start, [class*="big-play"], [class*="poster-play"]');
        if (big) { try { big.click(); out.acted.push('click-big-play'); } catch (e) {} }
      }
    }
  }
  out.url = location.href;
  out.docTitle = document.title;
  return out;
})()`;
}

function nextScript(preferButton = false) {
  return `(() => {
  // 实测（tests/catalog-probe.mjs）：超星用 class="posCatalog_select posCatalog_active" 标记当前小节，
  // 不是 \`active\`。之前的 findIndex 恒为 -1，导致目录树切节一直没生效。
  const isActive = (n) => {
    const c = String(n.className || '');
    if (/posCatalog_active|posCatalog_current/.test(c)) return true;
    if (/(^|\\s)active(\\s|$)/.test(c)) return true;
    const p = n.parentElement;
    return !!(p && /(^|\\s)active(\\s|$)|posCatalog_active/.test(String(p.className || '')));
  };
  const clickTree = () => {
    const nodes = Array.from(document.querySelectorAll('.posCatalog_select:not(.firstLayer)'));
    if (!nodes.length) return { ok: false, why: '没找到目录树' };
    const idx = nodes.findIndex(isActive);
    if (idx < 0) return { ok: false, why: '目录树里没有 active 标记' };
    if (idx + 1 >= nodes.length) return { ok: false, why: '已是最后一节' };
    const target = nodes[idx + 1];
    // 真正的跳转绑在 span.posCatalog_name 的 onclick="getTeacherAjax(courseId,clazzid,chapterId)"
    const nameEl = target.querySelector('.posCatalog_name') || target;
    const label = (nameEl.title || nameEl.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    try { nameEl.click(); } catch (e) {}
    return { ok: true, how: 'tree', from: idx, to: label };
  };
  const clickButton = () => {
    const next = document.querySelector('#prevNextFocusNext, .prev_next, #right1');
    if (!next) return { ok: false, why: '没找到下一节按钮' };
    try { next.click(); } catch (e) {}
    return { ok: true, how: 'button' };
  };
  if (${preferButton ? 'true' : 'false'}) {
    const b = clickButton();
    if (b.ok) return b;
    return clickTree();
  }
  const t = clickTree();
  if (t.ok) return t;
  const b = clickButton();
  return b.ok ? b : t;
})()`;
}

/* ---------------- 上报 ---------------- */

async function report(payload) {
  try {
    await fetch(HUB + '/hb', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {}
}

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

/* ---------------- 主循环 ---------------- */

let browserProc = null;
let lastScanAt = 0;
let pageTargetId = '';
let lastRefreshAt = 0;
let hubProc = null;

async function ensureHub() {
  try {
    const r = await fetch(HUB + '/health', { cache: 'no-store' });
    if (r.ok) { log('本机中枢已在运行'); return; }
  } catch (e) {}
  log('本机中枢未运行，自动启动 server.mjs');
  hubProc = spawn(process.execPath, [path.join(__dirname, '..', 'agent', 'server.mjs')], { stdio: 'ignore' });
  await sleep(1500);
}

async function ensureBrowser() {
  if (await isCdpUp(PORT)) return;
  log('CDP 未就绪，自动拉起浏览器' + (HEADLESS ? '（无窗口后台）' : '（有窗口）'));
  browserProc = await launchBrowser({ port: PORT, headless: HEADLESS, url: START_URL || PORTAL, keepAlive: true });
  log('浏览器已就绪');
}

/** 新标签页里打开了课程时，把驱动切过去 */
async function switchToCourseTab() {
  if (Date.now() - lastScanAt < 3000) return false;
  lastScanAt = Date.now();
  try {
    const pages = await listPages(PORT);
    if (!Array.isArray(pages)) return false;
    const hit = pages.find((p) => p.type === 'page' && /studentstudy/.test(p.url || ''));
    if (!hit || hit.id === pageTargetId) return false;
    log('发现播放页标签页，切过去：' + String(hit.url || '').slice(0, 80));
    try { page && page.close(); } catch (e) {}
    page = await Page.connect(hit.webSocketDebuggerUrl);
    pageTargetId = hit.id;
    log('已重新连接');
    return true;
  } catch (e) {
    log('切换标签页失败：' + (e.message || e));
    return false;
  }
}

/** 在所有 frame 的执行上下文里跑同一段脚本（跨域 iframe 也能取到） */
async function evalAllFrames(expr) {
  const out = [];

  // a) 同源 frame：按执行上下文执行
  for (const ctxId of Array.from(page.contexts.keys()).slice(0, 12)) {
    try {
      const v = await page.evalIn(ctxId, expr);
      if (v && typeof v === 'object') out.push({ ctxId, v });
    } catch (e) {}
  }

  // b) 跨域 iframe（OOPIF）：按 session 执行
  for (const sessionId of Array.from(page.sessions.keys()).slice(0, 12)) {
    try {
      const v = await page.evalInSession(sessionId, expr);
      if (v && typeof v === 'object') { v.viaOopif = true; out.push({ ctxId: null, sessionId, v }); }
    } catch (e) {}
  }

  return out;
}

async function ensurePage() {
  if (page) return page;
  page = await attach(START_URL || PORTAL, PORT);
  log('已连接页面');
  return page;
}

/**
 * 探测外网是否可达。断网时不要盲目重载页面，否则白丢本地进度。
 */
async function netOk() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('https://mooc1.chaoxing.com/favicon.ico', {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctl.signal,
    });
    clearTimeout(timer);
    return r.status < 500;
  } catch (e) {
    return false;
  }
}

async function tick() {
  await ensurePage();

  // 每 6 秒刷新一次上下文与会话（播放器 iframe 重建后旧句柄会失效）
  if (Date.now() - lastRefreshAt > 6000) {
    lastRefreshAt = Date.now();
    try { await page.watchContexts(60); } catch (e) {}
  }
  const script = snapshotScript(RATE);
  let frames = await evalAllFrames(script);
  if (!frames.length) {
    try { const v = await page.eval(script); if (v) frames = [{ ctxId: null, v }]; } catch (e) {}
  }
  const topEntry = frames.find((f) => f.v.isTop) || frames[0] || { ctxId: null, v: {} };
  const vidEntry = frames.find((f) => f.v.hasVideo) || null;
  const topCtxId = topEntry.ctxId;

  let snap = Object.assign({}, topEntry.v);
  if (vidEntry) {
    Object.assign(snap, {
      hasVideo: true,
      cur: vidEntry.v.cur, dur: vidEntry.v.dur,
      paused: vidEntry.v.paused, ended: vidEntry.v.ended, rate: vidEntry.v.rate,
    });
    snap.acted = [...(topEntry.v.acted || []), ...(vidEntry.v.acted || [])];
    if (vidEntry.v.playErr) snap.playErr = vidEntry.v.playErr;
    if (!snap.chapter) snap.chapter = '';
  } else {
    snap.hasVideo = false;
  }
  const now = Date.now();

  // 可信鼠标抖动：降低超星"长时间无操作"判定
  try {
    const jx = 520 + ((now / 1000) % 40) * 4;
    const jy = 260 + ((now / 3000) % 20) * 3;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(jx), y: Math.round(jy), button: 'none', clickCount: 0 });
  } catch (e) {}

  // 当前标签页不是播放页时，扫一遍所有标签页，可能课程开在新标签
  if (!/studentstudy/.test(String(snap.url || ''))) {
    if (await switchToCourseTab()) {
      // 注意：这里曾经写成 const snap，切换标签页时会抛
      // "Assignment to constant variable."，导致整轮异常、断连、再也恢复不了
      snap = await page.eval(snapshotScript(RATE));
    }
  }

  // 自动模式：还没进播放页就只等待，并给出当前页面该点什么的提示
  const curUrl = String(snap.url || '');
  if (!/studentstudy/.test(curUrl)) {
    /* 页面掉到错误页/空白页时（网络抖动、reload 失败等），之前这里只会无限等待。
       实测 17:33 一次网络抖动后页面变成 chrome-error://chromewebdata/，
       驱动就此卡死 25 分钟。现在改成自动导航回最后一次正常的课程地址。 */
    const broken = !curUrl || curUrl === 'about:blank' || /^chrome-error:/.test(curUrl);
    if (broken && now - lastNavAt > 30000) {
      navFails++;
      // 回跳两三次还进不去（enc 过期等），就退到门户页重新走
      const target = navFails >= 3 ? PORTAL : (lastGoodUrl || PORTAL);
      lastNavAt = now;
      log(`页面异常（${curUrl || '空白'}），自动导航回：${target.slice(0, 80)}${navFails >= 3 ? '（已失败 ' + navFails + ' 次，退回门户）' : ''}`);
      try { await page.send('Page.navigate', { url: target }); } catch (e) {}
      await sleep(8000);
      return;
    }
    const hint = pageHint(curUrl);
    if (hint !== lastHint || now - lastLog > 15000) {
      lastLog = now;
      lastHint = hint;
      log('等待进入播放页 —— ' + hint);
      log('   当前地址：' + curUrl.slice(0, 90));
    }
    return;
  }
  lastGoodUrl = curUrl;   // 记下能正常用的课程地址，供掉线后回跳
  navFails = 0;

  const hb = {
    ts: new Date().toISOString(),
    source: 'cdp',
    top: true,
    url: snap.url,
    docTitle: snap.docTitle,
    chapter: snap.chapter,
    hasVideo: snap.hasVideo,
    cur: snap.cur ?? null,
    dur: snap.dur ?? null,
    paused: snap.paused ?? null,
    ended: snap.ended ?? null,
    rate: snap.rate ?? null,
    popup: (snap.acted || []).filter((a) => a.startsWith('popup:')).join(',') || '',
    frames: [],
    videoCount: snap.hasVideo ? 1 : 0,
  };
  await report(hb);

  if (snap.hasVideo) noVideoSince = 0;
  else if (!noVideoSince) noVideoSince = now;

  /* 停滞检测：进度长时间不前进（播放器假死 / 缓冲卡住）时分两级处理，
     先轻推（原地微调 currentTime 重新触发解码），推不动再整页重载。
     之前一上来就 reload，撞上网络抖动会直接掉进 chrome-error 页。 */
  if (snap.hasVideo && !snap.ended) {
    if (lastCur >= 0 && Math.abs((snap.cur ?? 0) - lastCur) < 0.5) {
      if (!stallSince) stallSince = now;
    } else {
      stallSince = 0;
      stallKicked = false;
    }
    lastCur = snap.cur ?? -1;
    const stuckMs = stallSince ? now - stallSince : 0;

    if (stuckMs > 45000 && !stallKicked) {
      stallKicked = true;
      log('进度停滞 45s，先轻推一次（微调播放位置 + 重新 play）');
      const kick = `(() => {
        const v = document.querySelector('video');
        if (!v) return 'no-video';
        try { v.playbackRate = 1; v.muted = true; v.currentTime = Math.max(0, v.currentTime + 0.3); } catch (e) {}
        const p = v.play(); if (p && p.catch) p.catch(() => {});
        return { cur: +v.currentTime.toFixed(1), paused: v.paused };
      })()`;
      try {
        if (vidEntry && vidEntry.sessionId) await page.evalInSession(vidEntry.sessionId, kick);
        else if (vidEntry && vidEntry.ctxId != null) await page.evalIn(vidEntry.ctxId, kick);
        else await page.eval(kick);
      } catch (e) {}
      return;
    }

    if (stuckMs > 120000 && now - lastReloadAt > 300000) {
      /* 网络断着的时候重载没有任何意义：页面加载不出来，还会把本地进度丢掉、
         只能从服务器最后记录的位置重来（实测一次断网白丢 3.5 分钟）。
         所以重载前先探一下网络，断了就等。 */
      if (now - lastNetCheckAt > 25000) {
        lastNetCheckAt = now;
        const online = await netOk();
        if (!online) {
          log(`网络不通（已停滞 ${Math.round(stuckMs / 1000)}s），暂不重载，等网络恢复`);
          return;
        }
        log('网络已恢复，执行重载');
      } else {
        return;   // 刚探过，等下一轮
      }

      log(`进度停滞 ${Math.round(stuckMs / 1000)}s，轻推无效，整页重载`);
      lastReloadAt = now;
      stallSince = 0;
      stallKicked = false;
      lastCur = -1;
      // 不用 location.reload()（失败会留下错误页），改用 CDP 导航到已知可用地址
      try {
        if (lastGoodUrl) await page.send('Page.navigate', { url: lastGoodUrl });
        else await page.eval('location.reload()');
      } catch (e) {}
      await sleep(8000);
      return;
    }
  } else {
    stallSince = 0;
    stallKicked = false;
    lastCur = -1;
  }

  if (now - lastLog > 8000) {
    lastLog = now;
    const prog = snap.hasVideo
      ? `${fmt(snap.cur)}/${fmt(snap.dur)} ${snap.paused ? '暂停' : '播放中'}${snap.playErr ? ' playErr=' + snap.playErr : ''}`
      : `无视频（上下文 ${page.contexts.size} + 跨域 ${page.sessions.size}，共探测 ${frames.length}）`;
    log(`${(snap.chapter || '?').slice(0, 22)} | ${prog}${snap.acted?.length ? ' | ' + snap.acted.join(',') : ''}`);
  }

  /* ---- 无视频但页面上有题目 → 走 AI 答题 ---- */
  if (!snap.hasVideo && !NO_QUIZ && now - lastQuizAt > 20000) {
    const qs = await quizCollect(page, topCtxId).catch(() => null);
    if (qs && qs.length) {
      const sig = (curUrl + '#' + qs.map((q) => q.question).join('|')).slice(0, 800);
      if (sig !== lastQuizSig) {
        lastQuizSig = sig;
        lastQuizAt = now;
        noVideoSince = 0;   // 答题期间别触发"无视频跳过"
        if (!llmReady()) {
          log(`检测到测验页（${qs.length} 题），但大模型 key 未配置，跳过。配置方法：agent/config.json 填 llm.key`);
        } else {
          log(`检测到测验页，共 ${qs.length} 题，开始 AI 答题`);
          const res = await quizSolve(page, topCtxId, qs, askLLM, log, {});
          const ok = res.filter((r) => r.ok).length;
          const skipped = res.filter((r) => r.skipped).length;
          log(`答题结束：成功 ${ok} 题，跳过 ${skipped} 题，失败 ${res.length - ok - skipped} 题`);
          if (AUTO_SUBMIT) {
            const s = await quizSubmit(page, topCtxId);
            log(s ? `已自动提交（点了「${s}」）` : '没找到提交按钮，未提交');
            await sleep(4000);
          } else {
            log('未自动提交（默认只勾选）。确认无误后自己点提交，或加 --auto-submit 参数');
          }
        }
        await sleep(3000);
        return;
      }
    }
  }

  /* ---- 无视频页的两种情形分开处理 ---- */
  if (!snap.hasVideo && !snap.ended) {
    /* ① 播放器 iframe 已经挂上、只是 video 元素还没出来（切节后常见）
          → 这段时间不能算"无视频"，否则会把刚切过来的视频章节误跳 */
    if (snap.playerIframe) {
      if (!playerWaitSince) playerWaitSince = now;
      if (now - playerWaitSince < 150000) {
        noVideoSince = 0;
        if (now - lastWaitLog > 20000) {
          lastWaitLog = now;
          log(`播放器已挂载但视频元素未就绪，等待中（${Math.round((now - playerWaitSince) / 1000)}s）`);
        }
        return;
      }
      log('播放器 iframe 等了 150s 仍无视频，按无视频处理');
    } else {
      playerWaitSince = 0;
    }

    /* ② 文字章节（知识卡片）：滚动阅读并停留足够时长，避免阅读任务点白读 */
    if (snap.textIframe) {
      if (!textSince) {
        textSince = now;
        log('文字章节，开始滚动阅读（停留 ' + Math.round(TEXT_DWELL / 1000) + 's 后切下一节）');
      }
      await scrollAllFrames();
      // 注意：只有"还没读够"的时候才清零 noVideoSince。
      // 之前这里无条件清零，导致读够之后 noVideoTooLong 永远不成立，卡在文字章节出不来。
      if (now - textSince < TEXT_DWELL) {
        noVideoSince = 0;
        return;
      }
      // 读够了，交给下面的切节判定（textDone 会直接放行）
    }
  } else {
    playerWaitSince = 0;
    textSince = 0;
  }

  // 决策：切下一节
  // 有些播放器停在最后一帧但 ended 始终为 false，因此「离结尾不足 1.5s」也视为播完。
  // 但这必须加两道门槛：① 时长要合理（切节瞬间 dur 会短暂变 0，实测见过 39:40 显示成 00:00）；
  // ② 要连续两轮都成立，避免播放器元数据抖动导致误切。
  const saneDur = snap.hasVideo && (snap.dur ?? 0) > 60;
  const isNearEnd = saneDur && (snap.cur ?? 0) >= (snap.dur ?? 0) - 1.5;
  nearEndStreak = isNearEnd ? nearEndStreak + 1 : 0;
  const nearEnd = isNearEnd && nearEndStreak >= 2;

  const endedLongEnough = snap.ended || nearEnd;
  // 文字章节读完也算"该走了"
  const textDone = !snap.hasVideo && snap.textIframe && textSince && (now - textSince) >= TEXT_DWELL;
  const noVideoTooLong = (!snap.hasVideo && noVideoSince && now - noVideoSince > NO_VIDEO_SKIP_MS) || textDone;

  if (endedLongEnough || noVideoTooLong) {
    if (now - lastNextAt < 12000) return;
    const reason = snap.ended ? '视频播完'
      : nearEnd ? '到达结尾'
      : textDone ? `文字章节已阅读 ${Math.round((now - textSince) / 1000)}s`
      : `无视频 ${Math.round((now - noVideoSince) / 1000)}s`;

    // 目录节点点过一次不一定真跳成功，连续两次没换章节就改走「下一节按钮」
    const preferButton = switchAttempts >= 2;
    let r;
    try {
      const script = nextScript(preferButton);
      r = topCtxId != null ? await page.evalIn(topCtxId, script) : await page.eval(script);
    } catch (e) {
      r = { ok: false, why: e.message };
    }
    lastNextAt = now;
    noVideoSince = 0;
    nearEndStreak = 0;
    lastCur = -1;
    stallSince = 0;
    stallKicked = false;
    textSince = 0;
    playerWaitSince = 0;

    const from = snap.chapter || '';
    log(`切换下一节（${reason}）→ ${r.ok ? (r.to || r.how || 'ok') : '失败：' + r.why}${preferButton ? ' [按钮兜底]' : ''}`);
    if (r.ok) {
      await sleep(3500);   // 等新页面加载
      // 回读章节名，确认是否真的换了
      let ch2 = '';
      try {
        const s2 = topCtxId != null ? await page.evalIn(topCtxId, chapterScript()) : await page.eval(chapterScript());
        ch2 = (s2 && s2.chapter) || '';
      } catch (e) {}
      if (ch2 && from && ch2 === from) {
        switchAttempts++;
        log(`小节没换（仍是「${from.slice(0, 20)}」），下次改用按钮兜底重试（第 ${switchAttempts} 次）`);
      } else {
        switchAttempts = 0;
        log(`已切到「${ch2.slice(0, 24) || '新小节'}」`);
      }
    } else {
      switchAttempts++;
    }
  }
}

/** 只回读当前小节名（切节后校验用） */
function chapterScript() {
  return `(() => {
  const act = document.querySelector('.posCatalog_select.posCatalog_active, .posCatalog_active, .posCatalog_select.active');
  return { chapter: act ? (act.title || act.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '' };
})()`;
}

/**
 * 文字章节「翻页式阅读」：把页面和知识卡片 iframe 都往下滚一点。
 * 超星的阅读任务点通常按停留时长 + 是否有滚动来计，光打开不动容易被判未读。
 */
async function scrollAllFrames() {
  const ROLL = `(() => {
  const out = { y: -1, inner: [] };
  try { window.scrollBy(0, 420); out.y = Math.round(window.scrollY); } catch (e) {}
  // 同源的知识卡片 iframe 一起滚（跨域的情况交给 session 处理）
  try {
    for (const f of document.querySelectorAll('iframe[src*="knowledge"], iframe[src*="cards"]')) {
      const d = f.contentDocument;
      if (!d) continue;
      const el = d.scrollingElement || d.documentElement;
      if (el) { el.scrollTop = el.scrollTop + 420; out.inner.push(Math.round(el.scrollTop)); }
    }
  } catch (e) {}
  return out;
})()`;
  try { await page.eval(ROLL); } catch (e) {}
  for (const sid of Array.from(page.sessions.keys()).slice(0, 6)) {
    try { await page.evalInSession(sid, ROLL); } catch (e) {}
  }
}

function pageHint(url) {
  const u = String(url || '');
  if (!u || u === 'about:blank') return '浏览器刚启动，等一下…';
  if (/passport|\/login/i.test(u)) return '登录页：请先在这个窗口里登录学习通';
  if (/i\.chaoxing\.com\/base|chaoxing\.com\/visit/i.test(u)) {
    return '个人空间首页：点页面里的「课程」→ 选你的课 → 点「进入课程」，再点左侧目录第一节';
  }
  if (/studentstudy/.test(u)) return '已进入播放页';
  if (/chaoxing\.com/.test(u)) return '还没到播放页：继续点「进入课程」→「章节」→ 任意一节';
  return '当前不是学习通页面';
}

function fmt(x) {
  if (x == null) return '--:--';
  const s = Math.max(0, Math.floor(x));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* 单实例锁：防止「开机自启 + 手动双击」同时跑两个驱动互相抢播放器 */
const LOCK = path.join(DATA_DIR, 'drive.pid');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const old = Number(String(fs.readFileSync(LOCK, 'utf8')).trim());
      if (old && old !== process.pid && pidAlive(old)) {
        console.log(`[driver] 已有驱动在运行（PID ${old}），本实例直接退出，避免两个驱动抢播放器`);
        process.exit(0);
      }
    }
    fs.writeFileSync(LOCK, String(process.pid));
    const clean = () => {
      try {
        if (Number(String(fs.readFileSync(LOCK, 'utf8')).trim()) === process.pid) fs.unlinkSync(LOCK);
      } catch (e) {}
    };
    process.on('exit', clean);
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  } catch (e) {}
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  acquireLock();

  if (flag('status-only')) {
    const pages = await listPages(PORT).catch((e) => ({ error: e.message }));
    if (pages.error) { console.log('CDP 不可用：' + pages.error); return; }
    const hit = (pages || []).filter((p) => p.type === 'page' && /chaoxing/.test(p.url || ''));
    console.log(hit.length ? hit.map((p) => `${p.title}  ${p.url}`).join('\n') : '没有打开的学习通页面');
    return;
  }

  log(`后台驱动启动：倍速 ${RATE}x，间隔 ${INTERVAL / 1000}s，CDP ${PORT}，${HEADLESS ? '无窗口' : '有窗口'}`);
  await ensureHub();
  try {
    await ensureBrowser();
  } catch (e) {
    console.error('[driver] 无法启动浏览器：' + e.message);
    process.exit(2);
  }
  if (START_URL) log('起始页面：' + START_URL.slice(0, 120));
  else log('自动模式：会打开学习通门户，请你点进课程一次，之后自动接管');

  while (Date.now() - T0 < MAX_HOURS * 3600 * 1000) {
    try {
      await tick();
    } catch (e) {
      log('本轮异常：' + (e.message || e));
      page = null;                       // 页面可能被导航/关闭，下轮重连
      await sleep(3000);
    }
    await sleep(INTERVAL);
  }
  log('达到最长运行时间，退出。');
}

main().catch((e) => {
  console.error('[driver] 启动失败：' + (e.message || e));
  process.exit(1);
});
