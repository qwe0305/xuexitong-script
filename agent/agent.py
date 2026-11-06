#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""超星学习通 Agent —— 命令行控制台 + 自动决策器

用法：
  python agent.py status                  # 看当前状态
  python agent.py next                    # 切下一节
  python agent.py play | pause            # 播放 / 暂停
  python agent.py rate 2                  # 改倍速
  python agent.py click 继续学习          # 按文字点按钮
  python agent.py config '{"autoSkipNoVideo": false}'
  python agent.py watch                   # 无人值守：自动决策循环（默认 20 秒一轮）
  python agent.py watch --interval 30 --once

依赖：仅标准库。需要先启动 server.mjs。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

BASE = os.environ.get("XXT_BASE", "http://127.0.0.1:8731")
DATA_DIR = os.environ.get("XXT_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
LATEST = os.path.join(DATA_DIR, "latest.json")
LOG = os.path.join(DATA_DIR, "heartbeat.log")


# ---------------- 基础通信 ----------------

def http_get(path, timeout=5):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def send_cmd(cmd, **kw):
    payload = {"cmd": cmd}
    payload.update(kw)
    data = json.dumps(payload, ensure_ascii=False)
    url = BASE + "/cmd?d=" + urllib.parse.quote(data)
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read().decode("utf-8", "ignore"))
    except Exception as e:
        print(f"[x] 下发失败：{e}")
        return None


# ---------------- 状态读取 ----------------

def ts_of(rec):
    s = rec.get("received") or rec.get("ts")
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def read_records(limit=300):
    if not os.path.exists(LOG):
        return []
    try:
        with open(LOG, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[-limit:]
    except Exception:
        return []
    out = []
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except Exception:
            pass
    return out


def snapshot():
    """把最近心跳折叠成一份判断用的快照"""
    recs = read_records()
    now = time.time()
    recent = [r for r in recs if now - ts_of(r) < 900]
    if not recent:
        return {"stale": True, "age": None, "records": 0}

    newest = max(recent, key=ts_of)
    top = next((r for r in reversed(recent) if r.get("top")), None)
    vids = [r for r in recent if r.get("hasVideo")]
    v = vids[-1] if vids else None

    snap = {
        "stale": False,
        "age": int(now - ts_of(newest)),
        "records": len(recent),
        "chapter": (top or {}).get("chapter") or "",
        "url": (top or {}).get("url") or "",
        "popup": (top or {}).get("popup") or "",
        "frames": (top or {}).get("frames") or [],
        "has_video": bool(v),
        "cur": v.get("cur") if v else None,
        "dur": v.get("dur") if v else None,
        "paused": v.get("paused") if v else None,
        "ended": v.get("ended") if v else None,
        "rate": v.get("rate") if v else None,
    }

    # 同一个小节内，视频进度是否在推进
    key = (v or {}).get("frameSrc") or "top"
    series = [r for r in recent if (r.get("frameSrc") or "top") == key and r.get("cur") is not None]
    if len(series) >= 2:
        span = ts_of(series[-1]) - ts_of(series[0])
        snap["progress_span"] = int(span)
        snap["progress_delta"] = max(x["cur"] for x in series) - min(x["cur"] for x in series)
    else:
        snap["progress_span"] = 0
        snap["progress_delta"] = 0

    # 该状态下已经持续多久（用最早一条同状态记录估算）
    return snap


def mmss(x):
    if x is None:
        return "--:--"
    x = int(float(x))
    return f"{x // 60:02d}:{x % 60:02d}"


def print_status(snap):
    if snap.get("stale"):
        print("状态：暂无心跳 / 超过 15 分钟无更新。检查学习通页面是否打开、扩展是否启用、server 是否在跑。")
        return
    print("=== 学习通 Agent 状态 ===")
    print(f"心跳：{snap['age']} 秒前   小节：{snap['chapter'] or '(未取到)'}")
    if snap["has_video"]:
        pct = f"{snap['cur'] / snap['dur'] * 100:.1f}%" if snap.get("cur") and snap.get("dur") else "?"
        print(f"视频：{mmss(snap['cur'])} / {mmss(snap['dur'])}  {pct}  {snap['rate']}x  "
              f"暂停={snap['paused']} 结束={snap['ended']}")
        if snap["progress_span"]:
            print(f"推进：近 {snap['progress_span']} 秒 +{snap['progress_delta']:.0f} 秒")
    else:
        print("视频：未找到 <video>（课件页或播放器未加载）")
    if snap["popup"]:
        print(f"弹窗：待处理按钮「{snap['popup']}」")
    fr = snap.get("frames") or []
    if fr:
        print("iframe：" + "；".join(
            f"{'跨域' if f.get('cross') else '同源'}/video={f.get('videos')}" for f in fr[:4]))


# ---------------- 自动决策 ----------------

class Decider:
    """把"该做什么"从人工判断里抽出来，便于在 watch 循环里复用"""

    def __init__(self):
        self.last_action = 0.0
        self.last_cmd = ""
        self.history = []       # (ts, chapter, has_video, cur)

    def record(self, snap):
        self.history.append((time.time(), snap.get("chapter"), snap.get("has_video"), snap.get("cur")))
        if len(self.history) > 500:
            self.history = self.history[-400:]

    def no_video_seconds(self, cur_chapter):
        """当前小节连续多久没视频"""
        since = None
        for ts, ch, has_v, _ in reversed(self.history):
            if ch != cur_chapter:
                break
            if has_v:
                return 0
            since = ts
        return int(time.time() - since) if since else 0

    def stuck_seconds(self, cur_chapter):
        """当前小节视频进度连续多久没动"""
        last = None
        for ts, ch, has_v, cur in reversed(self.history):
            if ch != cur_chapter or not has_v or cur is None:
                break
            if last is None:
                last = cur
                since = ts
            elif abs(cur - last) > 0.5:
                return 0
            else:
                since = ts
        return int(time.time() - since) if last is not None else 0

    def decide(self, snap):
        """返回 (cmd, 理由) 或 (None, 说明)"""
        now = time.time()
        if now - self.last_action < 15:
            return None, "冷却中"

        if snap.get("stale"):
            return None, "无心跳"

        ch = snap.get("chapter") or ""

        if not snap["has_video"]:
            waited = self.no_video_seconds(ch)
            if waited >= 60:
                return "next", f"本节 {waited} 秒无视频，跳过"
            return None, f"本节等视频中（{waited}s）"

        if snap.get("ended"):
            return "next", "视频已播完，切下一节"

        if snap.get("paused"):
            stuck = self.stuck_seconds(ch)
            if stuck >= 20:
                return "play", f"暂停且 {stuck} 秒未推进，恢复播放"
            return None, "已下发播放，观察中"

        if snap.get("progress_span", 0) >= 20 and snap.get("progress_delta", 0) < 2:
            return "play", "进度停滞，强制恢复"

        return None, "正常播放中"

    def act(self, cmd, reason):
        print(f"  → 决策：{cmd}（{reason}）")
        send_cmd(cmd)
        self.last_action = time.time()
        self.last_cmd = cmd


def cmd_watch(interval=20, once=False, max_hours=8.0):
    d = Decider()
    t0 = time.time()
    print(f"[agent] 自动决策启动，间隔 {interval}s，最长 {max_hours}h。Ctrl+C 退出。")
    while True:
        snap = snapshot()
        if not snap.get("stale"):
            d.record(snap)
            stamp = datetime.now().strftime("%H:%M:%S")
            head = f"[{stamp}] {snap['chapter'][:24]:<24} 视频={mmss(snap['cur'])}/{mmss(snap['dur'])} 暂停={snap['paused']}"
            print(head)
            cmd, reason = d.decide(snap)
            if cmd:
                d.act(cmd, reason)
            else:
                print(f"  · {reason}")
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 无心跳，等待…")

        if once:
            return
        if time.time() - t0 > max_hours * 3600:
            print("[agent] 达到最长运行时间，退出。")
            return
        time.sleep(interval)


# ---------------- 入口 ----------------

def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return

    action = argv[1].lower()

    if action == "status":
        print_status(snapshot())
        return

    if action == "watch":
        interval = 20
        once = False
        max_hours = 8.0
        i = 2
        while i < len(argv):
            if argv[i] == "--interval" and i + 1 < len(argv):
                interval = int(argv[i + 1]); i += 2
            elif argv[i] == "--once":
                once = True; i += 1
            elif argv[i] == "--max-hours" and i + 1 < len(argv):
                max_hours = float(argv[i + 1]); i += 2
            else:
                i += 1
        try:
            cmd_watch(interval, once, max_hours)
        except KeyboardInterrupt:
            print("\n[agent] 已停止。")
        return

    if action == "next":
        send_cmd("next")
    elif action == "play":
        send_cmd("play")
    elif action == "pause":
        send_cmd("pause")
    elif action == "rate" and len(argv) > 2:
        send_cmd("rate", value=float(argv[2]))
    elif action == "click" and len(argv) > 2:
        send_cmd("click", text=argv[2])
    elif action == "config" and len(argv) > 2:
        try:
            send_cmd("config", value=json.loads(argv[2]))
        except Exception as e:
            print(f"[x] 配置不是合法 JSON：{e}")
    else:
        print(__doc__)
        return
    print("[ok] 指令已入队（页面 4 秒内执行）")


if __name__ == "__main__":
    main(sys.argv)
