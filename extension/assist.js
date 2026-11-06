/* assist.js —— 页面侧辅助层（隔离世界运行，注入所有 frame）
 * 职责：
 *   1) 每 3 秒自动点掉防挂机 / 温馨提示类弹窗
 *   2) 每 5 秒把播放状态上报到本机 127.0.0.1:8731
 *   3) 每 4 秒向本机拉取待执行指令，转交给 MAIN 世界的 core.js
 * 心跳与指令都经 background 转发，绕开页面 CSP 的 connect-src 限制。
 */
(function () {
    'use strict';

    const POPUP_TEXTS = ['继续学习', '继续观看', '继续播放', '我知道了', '知道了', '点击继续', '返回继续学习'];
    const RISKY_TEXTS = ['确定', '关闭', '好'];
    const OVERLAY_HINT = /离开|挂机|继续|暂停|提示|长时间|未操作/;

    const IS_TOP = (function () {
        try { return window.top === window; } catch (e) { return false; }
    })();

    try {
        if (window.__xxtAssistLoaded) return;
        window.__xxtAssistLoaded = true;
    } catch (e) { return; }

    const IN_COURSE = /\/mycourse\/studentstudy/.test(location.href);
    if (IS_TOP && !IN_COURSE) return;

    let lastPopupClick = 0;
    let lastSend = 0;
    let lastPoll = 0;
    let sentOnce = false;

    /* ---------------- 弹窗处理 ---------------- */

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.1) return false;
        return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }

    function looksLikeButton(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A') return true;
        const cls = String(el.className || '') + ' ' + String(el.id || '');
        if (/btn|button|popup|confirm|dialog|sure|layui-layer-btn|ans-job-msg/i.test(cls)) return true;
        if (el.getAttribute('role') === 'button') return true;
        return false;
    }

    function overlayTextOf(el) {
        let box = el;
        for (let i = 0; i < 4 && box && box.parentElement; i++) {
            box = box.parentElement;
            const t = (box.innerText || '').slice(0, 200);
            if (t && t.length > 4) return t;
        }
        return '';
    }

    function clickEl(el) {
        try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch (e) { return false; }
    }

    function dismissPopups() {
        if (Date.now() - lastPopupClick < 4000) return;
        const candidates = document.querySelectorAll('button, a, div, span, input[type="button"]');
        for (const el of candidates) {
            const text = (el.innerText || el.value || '').replace(/\s+/g, '');
            if (!text || text.length > 14) continue;
            if (!isVisible(el)) continue;
            if (!looksLikeButton(el)) continue;

            if (POPUP_TEXTS.includes(text)) {
                if (clickEl(el)) {
                    lastPopupClick = Date.now();
                    console.log('[辅助] 已点击弹窗按钮：' + text);
                    return;
                }
                continue;
            }

            if (RISKY_TEXTS.includes(text)) {
                const ctx = overlayTextOf(el);
                if (ctx && OVERLAY_HINT.test(ctx)) {
                    if (clickEl(el)) {
                        lastPopupClick = Date.now();
                        console.log('[辅助] 已点击弹窗按钮：' + text + '（上下文命中）');
                        return;
                    }
                }
            }
        }
    }

    /* ---------------- 视频定位 ---------------- */

    function pickVideo(doc) {
        try {
            if (!doc || !doc.querySelector) return null;
            return doc.querySelector('video#video_html5_api, video[id*="video_html5"], .vjs-tech, video');
        } catch (e) { return null; }
    }

    function findVideoLocal() {
        return pickVideo(document);
    }

    function findVideoDeep() {
        const own = pickVideo(document);
        if (own) return own;
        let frames = [];
        try { frames = Array.from(document.querySelectorAll('iframe')); } catch (e) { return null; }
        for (const f of frames) {
            let d = null;
            try { d = f.contentDocument; } catch (e) { d = null; }
            const v = pickVideo(d);
            if (v) return v;
        }
        return null;
    }

    function currentChapter() {
        try {
            const el = document.querySelector('.posCatalog_select.active, .posCatalog_active');
            if (el) {
                const t = (el.getAttribute('title') || el.innerText || '').replace(/\s+/g, ' ').trim();
                if (t) return t.slice(0, 60);
            }
            const title = document.querySelector('.prev_title');
            if (title) return (title.getAttribute('title') || title.innerText || '').trim().slice(0, 60);
        } catch (e) {}
        return '';
    }

    function frameDiag() {
        const out = [];
        let frames = [];
        try { frames = Array.from(document.querySelectorAll('iframe')); } catch (e) { return out; }
        for (const f of frames.slice(0, 8)) {
            let cross = false;
            let inner = -1;
            try {
                const d = f.contentDocument;
                if (!d) { cross = true; } else { inner = d.querySelectorAll('video').length; }
            } catch (e) { cross = true; }
            out.push({ src: String(f.src || '').slice(0, 90), cross: cross, videos: inner });
        }
        return out;
    }

    function visiblePopupText() {
        try {
            const nodes = document.querySelectorAll('button, a');
            for (const el of nodes) {
                const t = (el.innerText || '').replace(/\s+/g, '');
                if (t && POPUP_TEXTS.includes(t) && isVisible(el)) return t;
            }
        } catch (e) {}
        return '';
    }

    /* ---------------- 上报 ---------------- */

    function send(payload) {
        try {
            chrome.runtime.sendMessage({ type: 'xxt-hb', data: payload }, function () {
                void chrome.runtime.lastError;
            });
        } catch (e) {}
    }

    function heartbeat(force) {
        const now = Date.now();
        if (!force && now - lastSend < 5000) return;
        lastSend = now;

        const video = IS_TOP ? findVideoDeep() : findVideoLocal();
        const payload = {
            ts: new Date().toISOString(),
            top: IS_TOP,
            frameSrc: IS_TOP ? '' : String(location.href).slice(0, 90),
            url: IS_TOP ? location.href.slice(0, 200) : '',
            docTitle: (document.title || '').slice(0, 80),
            chapter: IS_TOP ? currentChapter() : '',
            hasVideo: !!video,
            cur: video ? Number(video.currentTime.toFixed(1)) : null,
            dur: video ? Number((video.duration || 0).toFixed(1)) : null,
            paused: video ? video.paused : null,
            ended: video ? video.ended : null,
            rate: video ? video.playbackRate : null,
            muted: video ? video.muted : null,
            readyState: video ? video.readyState : null,
            popup: IS_TOP ? visiblePopupText() : '',
            frames: IS_TOP ? frameDiag() : [],
            videoCount: document.querySelectorAll('video').length,
        };
        send(payload);
        if (!sentOnce) {
            sentOnce = true;
            console.log('[辅助] 心跳已接入本机监控' + (IS_TOP ? '（主帧）' : '（子帧）'));
        }
    }

    function attachVideoListeners() {
        const v = findVideoLocal() || (IS_TOP ? findVideoDeep() : null);
        if (!v || v.__xxtHbBound) return;
        v.__xxtHbBound = true;
        v.addEventListener('timeupdate', () => heartbeat(false));
        v.addEventListener('ended', () => heartbeat(true));
        v.addEventListener('play', () => heartbeat(true));
        v.addEventListener('pause', () => heartbeat(true));
        console.log('[辅助] 已绑定视频事件');
    }

    /* ---------------- 指令接收 ---------------- */

    function dispatchToPage(cmd) {
        try {
            if (!IS_TOP) return false;
            // 字符串 detail 可安全跨世界传递
            window.dispatchEvent(new CustomEvent('xxt-cmd', { detail: JSON.stringify(cmd) }));
            return true;
        } catch (e) { return false; }
    }

    function clickByText(text) {
        const wanted = String(text || '').replace(/\s+/g, '');
        if (!wanted) return false;
        const nodes = document.querySelectorAll('button, a, div, span');
        for (const el of nodes) {
            const t = (el.innerText || '').replace(/\s+/g, '');
            if (t === wanted && isVisible(el)) return clickEl(el);
        }
        return false;
    }

    function execCommand(cmd) {
        if (!cmd || !cmd.cmd) return;
        if (cmd.cmd === 'click') {
            const ok = clickByText(cmd.text);
            console.log('[辅助] 指令 click(' + (cmd.text || '') + ') → ' + (ok ? '成功' : '未找到目标'));
            return;
        }
        const ok = dispatchToPage(cmd);
        if (!ok) console.log('[辅助] 指令 ' + cmd.cmd + ' 需主帧执行，本帧忽略');
    }

    function pollCommands() {
        const now = Date.now();
        if (now - lastPoll < 4000) return;
        lastPoll = now;
        try {
            chrome.runtime.sendMessage({ type: 'xxt-cmd-poll' }, function (resp) {
                void chrome.runtime.lastError;
                if (!resp || !Array.isArray(resp.cmds) || !resp.cmds.length) return;
                for (const c of resp.cmds) {
                    try { execCommand(c); } catch (e) {}
                }
            });
        } catch (e) {}
    }

    /* ---------------- 启动 ---------------- */

    function boot() {
        setInterval(dismissPopups, 3000);
        dismissPopups();
        setInterval(() => heartbeat(false), 5000);
        setInterval(attachVideoListeners, 4000);
        setInterval(pollCommands, 4000);
        attachVideoListeners();
        heartbeat(true);
        pollCommands();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
    } else {
        setTimeout(boot, 1200);
    }
})();
