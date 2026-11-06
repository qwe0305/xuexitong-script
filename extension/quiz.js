/* quiz.js —— 章节测验 AI 答题（隔离世界）
 *
 * 流程：抓题干 + 选项 → 本机 /ask 问大模型 → 按返回的字母点选。
 * 默认不自动提交（autoSubmitQuiz=false），只勾选答案，提交交给你确认。
 * 页面结构在超星多套模板间不一致，这里用多组选择器兜底，抓不到会明确打印原因。
 */
(function () {
    'use strict';

    try {
        if (window.__xxtQuizLoaded) return;
        window.__xxtQuizLoaded = true;
    } catch (e) { return; }

    const CONFIG_KEY = 'xxt_quiz_config';
    let cfg = { enabled: true, autoSubmitQuiz: false, intervalMs: 6000 };
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    } catch (e) {}
    if (!cfg.enabled) return;

    const answered = new WeakSet();
    let running = false;

    function log(msg) {
        try { console.log('%c[AI答题] ' + msg, 'color:#00897B'); } catch (e) {}
    }

    function txt(el) {
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function visible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
    }

    /* ---------- 结构识别 ---------- */

    function findQuestions() {
        const selectors = [
            '.questionLi',          // mooc2 新版
            '.TiMu',                // 旧版
            '.Zy_TItle',            // 旧版题干容器（其父节点是题目）
            '.subject_node',
        ];
        for (const sel of selectors) {
            const nodes = Array.from(document.querySelectorAll(sel));
            if (nodes.length) return nodes;
        }
        return [];
    }

    function questionStem(node) {
        const cands = ['.mark_name', '.Zy_TItle', '.questionTitle', 'h3', '.stem'];
        for (const sel of cands) {
            const el = node.querySelector(sel);
            const t = txt(el);
            if (t && t.length > 3) return t;
        }
        return txt(node).slice(0, 200);
    }

    function optionNodes(node) {
        const cands = ['.answerList li', '.Zy_ulTop li', 'ul li', '.option'];
        for (const sel of cands) {
            const els = Array.from(node.querySelectorAll(sel)).filter(visible);
            if (els.length) return els;
        }
        return [];
    }

    function optionInfo(el, index) {
        const labelEl = el.querySelector('.num_option, .optionKey, .label');
        let label = txt(labelEl).replace(/[.、．)\s]/g, '');
        if (!label || label.length > 3) label = String.fromCharCode(65 + index);
        const body = txt(el);
        return { label: label.toUpperCase().slice(0, 2), text: body.slice(0, 200) };
    }

    function guessType(node, options) {
        const inputs = node.querySelectorAll('input[type="checkbox"]');
        if (inputs.length) return '多选题';
        if (options.length === 2 && options.every((o) => /对|错|正确|错误|是|否/.test(o.text))) return '判断题';
        return '单选题';
    }

    function inputOf(el) {
        return el.querySelector('input[type="radio"], input[type="checkbox"]') || el;
    }

    /* ---------- 通信 ---------- */

    function ask(data, cb) {
        try {
            chrome.runtime.sendMessage({ type: 'xxt-ask', data: data }, function (resp) {
                void chrome.runtime.lastError;
                cb(resp || { ok: false, error: 'NO_RESPONSE' });
            });
        } catch (e) {
            cb({ ok: false, error: 'EXC', hint: String(e) });
        }
    }

    /* ---------- 主流程 ---------- */

    function solveOne(node, done) {
        const options = optionNodes(node).map((el, i) => ({ el, ...optionInfo(el, i) }));
        if (!options.length) { done(false, '未找到选项'); return; }

        const question = questionStem(node);
        if (!question || question.length < 3) { done(false, '未抓到题干'); return; }

        const type = guessType(node, options);
        const payload = { question, type, options: options.map((o) => ({ label: o.label, text: o.text })) };

        ask(payload, (resp) => {
            if (!resp.ok) {
                log('大模型未返回答案：' + (resp.error || '') + (resp.hint ? ' / ' + String(resp.hint).slice(0, 80) : ''));
                done(false, 'AI 不可用');
                return;
            }

            const answer = String(resp.answer || '').trim();
            log('题目：' + question.slice(0, 40) + ' … → ' + answer);

            if (!answer || answer === 'UNKNOWN') { done(false, 'AI 放弃作答'); return; }

            let picked = 0;
            if (type === '判断题') {
                const want = /正确|对|是|√|T/i.test(answer);
                for (const o of options) {
                    const isTrue = /对|正确|是|√/.test(o.text);
                    if (isTrue === want) { clickOption(o.el); picked++; }
                }
            } else {
                for (const ch of answer.toUpperCase().replace(/[^A-Z]/g, '')) {
                    const hit = options.find((o) => o.label === ch);
                    if (hit) { clickOption(hit.el); picked++; }
                }
                if (!picked && answer.length < 40) {
                    const hit = options.find((o) => o.text.includes(answer));
                    if (hit) { clickOption(hit.el); picked++; }
                }
            }

            done(picked > 0, picked > 0 ? '已勾选 ' + picked + ' 项' : '没匹配到选项');
        });
    }

    function clickOption(el) {
        const target = inputOf(el);
        try {
            target.click();
        } catch (e) {
            try {
                target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } catch (e2) {}
        }
    }

    function cycle() {
        if (running) return;
        running = true;
        try {
            const nodes = findQuestions().filter((n) => !answered.has(n) && visible(n));
            if (!nodes.length) {
                if (cfg.autoSubmitQuiz) trySubmit();
                running = false;
                return;
            }
            const node = nodes[0];
            answered.add(node);
            solveOne(node, (ok, why) => {
                log((ok ? '✓ ' : '✗ ') + why);
                running = false;
                if (!ok && cfg.autoSubmitQuiz) trySubmit();
            });
            return;
        } catch (e) {
            log('异常：' + (e.message || e));
        }
        running = false;
    }

    function trySubmit() {
        const labels = ['提交', '提交答案', '交卷'];
        const nodes = Array.from(document.querySelectorAll('button, a, div'));
        for (const el of nodes) {
            const t = txt(el);
            if (labels.includes(t) && visible(el)) {
                log('自动提交：' + t);
                try { el.click(); } catch (e) {}
                return true;
            }
        }
        return false;
    }

    // 仅在疑似测验页面启动：出现题目节点才跑
    function boot() {
        const nodes = findQuestions();
        if (!nodes.length) return;
        log('检测到测验页面，共 ' + nodes.length + ' 题，开始作答');
        setTimeout(cycle, 1500);
        setInterval(cycle, cfg.intervalMs);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 2000));
    } else {
        setTimeout(boot, 2000);
    }
})();
