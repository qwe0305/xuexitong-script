/**
 * tests/seek-probe.mjs —— 只读：看视频的可 seek 范围与缓冲范围，
 * 判断「能不能跳着看」。
 */
import { attach, listPages } from '../driver/cdp.mjs';

const PORT = Number(process.env.XXT_CDP_PORT || 9222);
const pages = await listPages(PORT).catch(() => null);
if (!Array.isArray(pages)) { console.log('CDP 未就绪'); process.exit(0); }
const page = await attach('', PORT);
await page.watchContexts(600);

const P = `(() => {
  const v = document.querySelector('video');
  if (!v) return null;
  const rng = (o) => { const a = []; for (let i = 0; i < o.length; i++) a.push([+o.start(i).toFixed(1), +o.end(i).toFixed(1)]); return a; };
  return {
    cur: +v.currentTime.toFixed(1),
    dur: +(v.duration||0).toFixed(1),
    seekable: rng(v.seekable),
    buffered: rng(v.buffered),
    src: String(v.currentSrc||'').slice(0, 80),
  };
})()`;

let out = null;
for (const id of page.contexts.keys()) { try { const v = await page.evalIn(id, P); if (v) { out = v; break; } } catch (e) {} }
if (!out) for (const sid of page.sessions.keys()) { try { const v = await page.evalInSession(sid, P); if (v) { out = v; break; } } catch (e) {} }
console.log(JSON.stringify(out, null, 2));
if (out) {
  const maxSeekable = out.seekable.length ? out.seekable[out.seekable.length - 1][1] : 0;
  console.log(`\n可 seek 最远：${maxSeekable}s / 总长 ${out.dur}s`);
  console.log(maxSeekable < out.dur - 60
    ? '→ 只能跳到已缓冲位置，无法快进到未加载的片段（MSE 分片流），所以「跳结尾」不可行'
    : '→ 全片可 seek');
}
page.close();
setTimeout(() => process.exit(0), 200);
