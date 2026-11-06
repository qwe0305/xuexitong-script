// bg.js —— 扩展后台：心跳转发 + 指令拉取（不受页面 CSP 限制）
const BASE = 'http://127.0.0.1:8731';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'xxt-hb') {
        fetch(BASE + '/hb', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(msg.data || {}),
        }).then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (msg.type === 'xxt-cmd-poll') {
        fetch(BASE + '/poll', { cache: 'no-store' })
            .then((r) => r.json())
            .then((j) => sendResponse(j))
            .catch(() => sendResponse({ cmds: [] }));
        return true;
    }

    if (msg.type === 'xxt-ask') {
        const d = encodeURIComponent(JSON.stringify(msg.data || {}));
        fetch(BASE + '/ask?d=' + d, { cache: 'no-store' })
            .then((r) => r.json())
            .then((j) => sendResponse(j))
            .catch((e) => sendResponse({ ok: false, error: 'NETWORK', hint: String(e) }));
        return true;
    }
});
