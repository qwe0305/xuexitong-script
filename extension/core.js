(function () {
    const APP_KEY = '__xuexitongPlayerV3';
    const BOOT_TIMER_KEY = '__xuexitongPlayerV3BootTimer';

    const previousApp = window[APP_KEY];
    if (previousApp && typeof previousApp.destroy === 'function') {
        previousApp.destroy();
    }
    if (window[BOOT_TIMER_KEY]) {
        clearInterval(window[BOOT_TIMER_KEY]);
        window[BOOT_TIMER_KEY] = null;
    }

    if (typeof window.jQuery === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
        script.type = 'text/javascript';
        script.onload = function () {
            console.log("jQuery loaded.");
            waitForCoursePage();
        };
        document.head.appendChild(script);
    } else {
        waitForCoursePage();
    }

    function waitForCoursePage() {
        let attempts = 0;
        const maxAttempts = 20;
        window[BOOT_TIMER_KEY] = setInterval(() => {
            if ($('#coursetree').length > 0) {
                clearInterval(window[BOOT_TIMER_KEY]);
                window[BOOT_TIMER_KEY] = null;
                initializePlayer();
                return;
            }
            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(window[BOOT_TIMER_KEY]);
                window[BOOT_TIMER_KEY] = null;
                console.error('%c脚本启动超时：未检测到课程目录（#coursetree）。请确认当前处于课程播放页。', 'color:#F44336;font-weight:bold');
            }
        }, 1000);
    }

    function initializePlayer() {
        const app = {
            configs: {
                // 实测（tests/rate-125.mjs）：任何非 1.0 倍速都会被 ananas 判为异常并锁死播放，
                // 1.25x 实测推进 0s/27s 且被暂停 9 次。不要改大。
                playbackRate: 1.0,
                autoplay: true,
                retryInterval: 2000,
                maxRetries: 10,
                videoCheckInterval: 1000,
                guardNoProgressMs: 7000,
                guardResumeCooldownMs: 1500,
                autoAdvanceNoVideo: false,
            },
            _videoEl: null,
            _treeContainerEl: null,
            _isPlaying: false,
            _currentRetryCount: 0,
            _checkInterval: null,
            _eventVideoEl: null,
            _boundVideoHandlers: null,
            _nextUnitPending: false,
            _chapterAdvanceTimes: 0,
            _cellData: {
                cells: 0,
                nCells: 0,
                currentCellIndex: 0,
                currentNCellIndex: 0,
                currentVideoTitle: "",
            },
            get cellData() {
                return this._cellData;
            },
            run() {
                console.log("%c=== 学习通自动刷课脚本 V3 优化版启动 ===", "color:#4CAF50;font-size:16px;font-weight:bold");
                this._nextUnitPending = false;
                this._chapterAdvanceTimes = 0;
                this._getTreeContainer();
                this._initCellData();
                this._videoEl = null;
                this._getVideoEl();
                this._clearCheckInterval();
                this._bindStepNavigation();
                this.play();
            },
            nextUnit() {
                if (this._nextUnitPending) {
                    console.warn('%c已有小节切换正在进行，忽略重复请求', 'color:#FF9800');
                    return;
                }
                this._nextUnitPending = true;
                this._clearCheckInterval();
                console.log("%c=== 准备切换到下一小节 ===", "color:#2196F3;font-size:14px");
                try {
                    const el = this._getTreeContainer();
                    const cells = el.children("ul").children("li");
                    const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');

                    if (nCells.length > this._cellData.currentNCellIndex + 1) {
                        const nextNIndex = this._cellData.currentNCellIndex + 1;
                        console.log(`%c切换到同章节下一个视频: ${nextNIndex + 1}/${nCells.length}`, "color:#FF9800");
                        this.playCurrentIndex(nCells.get(nextNIndex));
                    } else {
                        const nextIndex = this._cellData.currentCellIndex + 1;
                        if (nextIndex >= cells.length) {
                            console.log("%c=====================================", "color:#4CAF50;font-size:16px");
                            console.log("%c==============本课程学习完成了==============", "color:#4CAF50;font-size:16px;font-weight:bold");
                            console.log("%c=====================================", "color:#4CAF50;font-size:16px");
                            return;
                        }
                        console.log(`%c切换到下一个章节: ${nextIndex + 1}/${cells.length}`, "color:#FF9800");
                        this._cellData.currentCellIndex = nextIndex;
                        this._cellData.currentNCellIndex = 0;
                        this.playCurrentIndex();
                    }
                } catch (error) {
                    this._nextUnitPending = false;
                    console.error('切换下一小节失败:', error);
                }
            },
            _clearCheckInterval() {
                if (this._checkInterval) {
                    clearInterval(this._checkInterval);
                    this._checkInterval = null;
                }
            },
            _startVideoMonitoring() {
                this._clearCheckInterval();
                this._guardLastTime = 0;
                this._guardLastWallTs = 0;
                this._guardLastResumeTs = 0;
                this._checkInterval = setInterval(() => {
                    this._checkVideoStatus();
                }, this.configs.videoCheckInterval);
            },
            _tryResumePlayback(reason) {
                const now = Date.now();
                if (now - this._guardLastResumeTs < this.configs.guardResumeCooldownMs) {
                    return;
                }
                this._guardLastResumeTs = now;

                const video = this._getVideoEl();
                if (!video || !this._isPlaying) return;

                console.log(`%c触发视频保活恢复(${reason})`, "color:#607D8B");
                video.play().catch((e) => {
                    console.warn("直接恢复播放失败，尝试静音恢复:", e);
                    video.muted = true;
                    video.play().catch((err) => {
                        console.error("静音恢复播放失败:", err);
                    });
                });
            },
            _checkVideoStatus() {
                try {
                    const video = this._getVideoEl();
                    if (!video) return;

                    if (video.paused && this._isPlaying) {
                        console.log("%c检测到视频暂停，尝试恢复播放...", "color:#FF5722");
                        this._tryResumePlayback("paused");
                    } else if (this._isPlaying && !video.ended) {
                        const now = Date.now();
                        const current = Number(video.currentTime || 0);
                        if (this._guardLastWallTs === 0) {
                            this._guardLastWallTs = now;
                            this._guardLastTime = current;
                        } else {
                            const stalled = Math.abs(current - this._guardLastTime) < 0.01;
                            const stalledMs = now - this._guardLastWallTs;
                            if (stalled && stalledMs >= this.configs.guardNoProgressMs) {
                                this._tryResumePlayback("no-progress");
                                this._guardLastWallTs = now;
                                this._guardLastTime = Number(video.currentTime || 0);
                            } else if (!stalled) {
                                this._guardLastWallTs = now;
                                this._guardLastTime = current;
                            }
                        }
                    }

                    if (video.ended && this._isPlaying) {
                        console.log("%c检测到视频结束，准备切换下一个...", "color:#9C27B0");
                        this._isPlaying = false;
                        setTimeout(() => this.nextUnit(), 1000);
                    }
                } catch (e) {
                    console.error("视频状态检查失败:", e);
                }
            },
            _tryTimes: 0,
            _stepAdvanceTimes: 0,
            _stepSwitchAt: 0,
            _stepSwitchPending: false,
            _delayedNextUnitTimer: null,
            _guardLastTime: 0,
            _guardLastWallTs: 0,
            _guardLastResumeTs: 0,
            async play() {
                try {
                    const el = this._getVideoEl();
                    if (el == null) {
                        if (this._currentStepTitle() === '视频') {
                            throw new Error('视频组件尚未加载完成');
                        }
                        if (this._advanceLearningStep()) {
                            console.log("%c当前不在视频页，已尝试切到下一学习步骤，2秒后重试", "color:#607D8B");
                            setTimeout(() => {
                                this.play();
                            }, 2000);
                            return;
                        }
                        if (this._isChapterTest()) {
                            this._advanceChapterTest();
                            return;
                        }
                        this._isPlaying = false;
                        this._clearCheckInterval();
                        if (this.configs.autoAdvanceNoVideo) {
                            console.warn('%c当前小节未发现视频，按配置切换到下一小节', 'color:#FF9800');
                            this.nextUnit();
                        } else {
                            console.warn('%c当前小节未发现视频或可识别的学习步骤，已安全停止。确认无需完成课件后，可执行 app.nextUnit()。', 'color:#FF9800');
                        }
                        return;
                    }

                    this._isPlaying = true;
                    this._videoEventHandle();
                    el.playbackRate = this.configs.playbackRate;

                    try {
                        await el.play();
                        this._tryTimes = 0;
                        console.log(`%c视频开始播放，倍速: ${el.playbackRate}x`, "color:#4CAF50");
                        this._startVideoMonitoring();
                    } catch (playError) {
                        console.error("视频播放失败:", playError);
                        this._handlePlayError(playError);
                    }
                } catch (e) {
                    if (this._tryTimes >= this.configs.maxRetries) {
                        console.error("%c视频播放失败，已达到最大重试次数", "color:#F44336;font-weight:bold", e);
                        this._clearCheckInterval();
                        return;
                    }
                    this._tryTimes++;
                    console.log(`%c播放失败，${this.configs.retryInterval/1000}秒后重试 (${this._tryTimes}/${this.configs.maxRetries})`, "color:#FF9800");
                    setTimeout(() => {
                        this.play();
                    }, this.configs.retryInterval);
                }
            },
            _advanceLearningStep() {
                if (this._stepSwitchPending && Date.now() - this._stepSwitchAt < 4000) {
                    return true;
                }

                const prevTitle = document.getElementsByClassName("prev_title")[0];
                const currentStepTitle = prevTitle ? (prevTitle.title || prevTitle.textContent || "").trim() : "";

                if (currentStepTitle === "章节测验" || currentStepTitle === "视频") {
                    return false;
                }

                const clickElement = (el, label) => {
                    if (!el) return false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    console.log(`%c尝试点击${label}`, "color:#2196F3");
                    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                    return true;
                };

                const videoTab = $(".prev_white:visible").filter((_, el) => {
                    const text = ($(el).text() || "").replace(/\s+/g, "");
                    return text === "2视频" || text === "视频";
                }).get(0);
                if (clickElement(videoTab, "“视频”页签")) {
                    return true;
                }

                return false;
            },
            _currentStepTitle() {
                const prevTitle = document.getElementsByClassName('prev_title')[0];
                return prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';
            },
            _isChapterTest() {
                return this._currentStepTitle() === '章节测验';
            },
            _advanceChapterTest() {
                if (this._chapterAdvanceTimes >= 3) {
                    console.error('%c章节测验页面连续跳转失败，已停止以避免页面循环。请手动处理后执行 app.run()。', 'color:#F44336;font-weight:bold');
                    return;
                }

                const nextButton = $('#prevNextFocusNext:visible, #right1:visible, .nextChapter:visible').first().get(0);
                if (!nextButton) {
                    console.warn('%c未找到章节测验的下一步按钮，已停止。', 'color:#FF9800');
                    return;
                }

                this._chapterAdvanceTimes++;
                console.log('%c检测到章节测验，尝试进入下一学习步骤', 'color:#607D8B');
                nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                setTimeout(() => this.play(), 2000);
            },
            _bindStepNavigation() {
                if (this._stepNavigationBound) {
                    return;
                }
                this._stepNavigationBound = true;

                const reenterVideoMode = () => {
                    this._videoEl = null;
                    this._isPlaying = false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    setTimeout(() => {
                        try {
                            this._initCellData();
                        } catch (e) {}
                        this.play();
                    }, 1800);
                };

                $(document).off('click.xuexitongPlayerV3', '.prev_white').on('click.xuexitongPlayerV3', '.prev_white', (e) => {
                    const text = ($(e.currentTarget).text() || "").replace(/\s+/g, "");
                    if (text.includes("视频")) {
                        console.log(`%c检测到步骤切换点击：${text}，准备重新接管视频页`, "color:#607D8B");
                        reenterVideoMode();
                    }
                });
            },
            _handlePlayError(error) {
                console.error("播放错误详情:", error);
                const video = this._getVideoEl();
                if (video) {
                    video.muted = true;
                    video.play().then(() => {
                        console.log("%c静音播放成功", "color:#4CAF50");
                        this._tryTimes = 0;
                        this._startVideoMonitoring();
                        if (this._delayedNextUnitTimer) {
                            clearTimeout(this._delayedNextUnitTimer);
                            this._delayedNextUnitTimer = null;
                        }
                    }).catch(e => {
                        console.error("静音播放也失败:", e);
                        if (this._delayedNextUnitTimer) {
                            clearTimeout(this._delayedNextUnitTimer);
                        }
                        this._isPlaying = false;
                        if (this._tryTimes >= this.configs.maxRetries) {
                            console.error('%c静音播放失败，已达到最大重试次数', 'color:#F44336;font-weight:bold', e);
                            return;
                        }
                        this._tryTimes++;
                        this._delayedNextUnitTimer = setTimeout(() => {
                            this._delayedNextUnitTimer = null;
                            this.play();
                        }, this.configs.retryInterval);
                    });
                }
            },
            playCurrentIndex(nCell) {
                this._nextUnitPending = false;
                if (!nCell) {
                    const el = this._getTreeContainer();
                    const cells = el.children("ul").children("li");
                    const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
                    nCell = nCells.get(this._cellData.currentNCellIndex);
                }

                const $nCell = $(nCell);
                const clickableSpan = $nCell.find(".posCatalog_name")[0];
                if (!clickableSpan) {
                    console.error("%c===========找不到可点击的课程节点，播放下一个视频失败==============", "color:#F44336");
                    return;
                }

                console.log(`%c点击切换到: ${$(clickableSpan).attr('title') || '未知标题'}`, "color:#2196F3");
                $(clickableSpan).click();
                this._videoEl = null;
                this._isPlaying = false;

                console.log("%c等待视频加载...", "color:#FF9800");
                setTimeout(() => {
                    this._initCellData();
                    if (this.configs.autoplay) {
                        this.play();
                    }
                }, 3000);
            },
            _initCellData() {
                const el = this._getTreeContainer();
                const cells = el.children("ul").children("li");
                this._cellData.cells = cells.length;
                let nCellCounts = 0;
                let foundCurrent = false;

                cells.each((i, v) => {
                    const nCells = $(v).find('.posCatalog_select:not(.firstLayer)');
                    nCellCounts += nCells.length;
                    nCells.each((j, e) => {
                        const _el = $(e);
                        if (_el.hasClass("posCatalog_active")) {
                            this._cellData.currentCellIndex = i;
                            this._cellData.currentNCellIndex = j;
                            foundCurrent = true;
                            const titleSpan = _el.find('.posCatalog_name')[0];
                            if (titleSpan) {
                                this._cellData.currentVideoTitle = $(titleSpan).attr('title');
                            }
                        }
                    });
                });

                this._cellData.nCells = nCellCounts;

                if (!foundCurrent && nCellCounts > 0) {
                    console.warn("%c未找到当前激活的视频节点，可能需要手动选择", "color:#FF9800");
                }

                console.log(`%c课程信息: ${this._cellData.cells}章, ${this._cellData.nCells}节, 当前: 第${this._cellData.currentCellIndex + 1}章第${this._cellData.currentNCellIndex + 1}节`, "color:#607D8B");
            },
            _getTreeContainer() {
                if (!this._treeContainerEl) {
                    const el = $('#coursetree');
                    if (el.length <= 0) {
                        throw new Error("找不到视频列表");
                    }
                    this._treeContainerEl = el;
                }
                return this._treeContainerEl;
            },
            _getVideoEl() {
                if (!this._videoEl) {
                    try {
                        const findVideo = (frame, depth) => {
                            if (depth > 2) return null;
                            const frameDocument = frame.contentDocument || frame.contentWindow?.document;
                            if (!frameDocument) return null;
                            const $frameDocument = $(frameDocument);
                            const directVideo = $frameDocument.find('video#video_html5_api, video[id*="video_html5"]').get(0);
                            if (directVideo) return directVideo;

                            const nestedFrames = $frameDocument.find('iframe.ans-insertvideo-online, iframe[src*="video"]');
                            for (const nestedFrame of nestedFrames.toArray()) {
                                const nestedVideo = findVideo(nestedFrame, depth + 1);
                                if (nestedVideo) return nestedVideo;
                            }
                            return null;
                        };

                        for (const frame of $('iframe').toArray()) {
                            const video = findVideo(frame, 0);
                            if (video) {
                                this._videoEl = video;
                                break;
                            }
                        }
                    } catch (e) {
                        console.error("获取视频元素失败:", e);
                        return null;
                    }
                }
                if (!this._videoEl) return null;
                return this._videoEl;
            },
            _videoEventHandle() {
                const el = this._videoEl;
                if (!el) {
                    console.log("videoEl未加载");
                    return;
                }

                if (this._eventVideoEl === el) return;
                this._detachVideoEvents();
                this._eventVideoEl = el;
                this._boundVideoHandlers = {
                    ended: this._handleVideoEnded.bind(this),
                    loadedmetadata: this._handleVideoLoaded.bind(this),
                    play: this._handleVideoPlay.bind(this),
                    pause: this._handleVideoPause.bind(this),
                };

                el.addEventListener('ended', this._boundVideoHandlers.ended);
                el.addEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
                el.addEventListener('play', this._boundVideoHandlers.play);
                el.addEventListener('pause', this._boundVideoHandlers.pause);
            },
            _detachVideoEvents() {
                if (!this._eventVideoEl || !this._boundVideoHandlers) return;
                this._eventVideoEl.removeEventListener('ended', this._boundVideoHandlers.ended);
                this._eventVideoEl.removeEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
                this._eventVideoEl.removeEventListener('play', this._boundVideoHandlers.play);
                this._eventVideoEl.removeEventListener('pause', this._boundVideoHandlers.pause);
                this._eventVideoEl = null;
                this._boundVideoHandlers = null;
            },
            _handleVideoEnded(e) {
                const title = this._cellData.currentVideoTitle;
                console.warn(`%c============'${title}' 播放完成=============`, "color:#4CAF50;font-weight:bold");
                this._isPlaying = false;
                this._clearCheckInterval();
                setTimeout(() => this.nextUnit(), 1000);
            },
            _handleVideoLoaded(e) {
                console.log(`%c============视频加载完成=============`, "color:#2196F3");
                if (this.configs.autoplay && !this._isPlaying) {
                    this.play();
                }
            },
            _handleVideoPlay(e) {
                const title = this._cellData.currentVideoTitle;
                console.info(`%c============'${title}' 开始播放=============`, "color:#4CAF50");
                this._isPlaying = true;
                this._stepSwitchPending = false;
                const video = this._getVideoEl();
                this._guardLastTime = Number(video?.currentTime || 0);
                this._guardLastWallTs = Date.now();
                if (this._delayedNextUnitTimer) {
                    clearTimeout(this._delayedNextUnitTimer);
                    this._delayedNextUnitTimer = null;
                }
            },
            _handleVideoPause(e) {
                console.log(`%c============视频暂停=============`, "color:#FF9800");
            },
            _bindPageGuards() {
                const preventPause = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                };
                const resumePlaybackNow = () => this._tryResumePlayback('page-event');
                this._pageGuards = { preventPause, resumePlaybackNow };
                document.addEventListener('mouseleave', preventPause);
                window.addEventListener('mouseleave', preventPause);
                document.addEventListener('mouseout', preventPause);
                window.addEventListener('mouseout', preventPause);
                window.addEventListener('blur', resumePlaybackNow);
                document.addEventListener('visibilitychange', resumePlaybackNow);
            },
            destroy() {
                this._isPlaying = false;
                this._clearCheckInterval();
                this._detachVideoEvents();
                if (this._delayedNextUnitTimer) clearTimeout(this._delayedNextUnitTimer);
                $(document).off('.xuexitongPlayerV3');
                if (this._pageGuards) {
                    const { preventPause, resumePlaybackNow } = this._pageGuards;
                    document.removeEventListener('mouseleave', preventPause);
                    window.removeEventListener('mouseleave', preventPause);
                    document.removeEventListener('mouseout', preventPause);
                    window.removeEventListener('mouseout', preventPause);
                    window.removeEventListener('blur', resumePlaybackNow);
                    document.removeEventListener('visibilitychange', resumePlaybackNow);
                    this._pageGuards = null;
                }
            },
        };

        window.app = app;
        window[APP_KEY] = app;

        try {
            app.run();
            app._bindPageGuards();
        } catch (error) {
            console.error("%c脚本运行失败: ", "color:#F44336;font-weight:bold", error.message);
            console.log("请检查是否在正确的课程播放页面，或者页面结构是否再次发生改变。");
        }
    }
})();


/* ================= 本地补丁 v2 start =================
 * 与 app 内部实现完全解耦：自己找 <video>、自己判断播放状态。
 * 目的：原脚本在 iframe 未渲染完时会直接判定"本节无视频"并停止，
 *       这里补一个耐心等待 + 自动接管的看门狗。
 * 全程 try/catch，任何异常都不外抛。
 * ==================================================== */
(function () {
    if (window.__xxtPatchV2 && window.__xxtPatchV2.installed) return;

    const state = {
        installed: true,
        timer: null,
        attempts: 0,
        lastPlayAt: 0,
        warned: false,
    };
    window.__xxtPatchV2 = state;

    const MAX_WAIT = 45;      // 45 * 2s = 90s
    const TICK_MS = 2000;

    function log(msg, color) {
        try { console.log('%c[看门狗] ' + msg, 'color:' + (color || '#607D8B')); } catch (e) {}
    }

    function pickVideo(doc) {
        try {
            if (!doc || !doc.querySelector) return null;
            return doc.querySelector('video#video_html5_api, video[id*="video_html5"], .vjs-tech, video');
        } catch (e) { return null; }
    }

    function findVideo() {
        // 1) 优先用原脚本已定位到的元素
        try {
            const a = window.app;
            if (a && a._videoEl && a._videoEl.tagName === 'VIDEO' && a._videoEl.isConnected) return a._videoEl;
        } catch (e) {}

        // 2) 主文档
        const own = pickVideo(document);
        if (own) return own;

        // 3) 所有同源 iframe
        let frames = [];
        try { frames = Array.from(document.querySelectorAll('iframe')); } catch (e) { frames = []; }
        for (const f of frames) {
            let d = null;
            try { d = f.contentDocument; } catch (e) { d = null; }
            const v = pickVideo(d);
            if (v) return v;
        }
        return null;
    }

    function targetRate() {
        try {
            const a = window.app;
            if (a && a.configs && Number(a.configs.playbackRate) > 0) return Number(a.configs.playbackRate);
        } catch (e) {}
        return 1.0;
    }

    function hardPlay(video) {
        try { video.playbackRate = targetRate(); } catch (e) {}
        let p = null;
        try { p = video.play(); } catch (e) { p = null; }
        if (p && typeof p.catch === 'function') {
            p.catch(function () {
                try { video.muted = true; } catch (e) {}
                try {
                    const p2 = video.play();
                    if (p2 && p2.catch) p2.catch(function () {});
                } catch (e) {}
            });
        }
    }

    function tick() {
        try {
            const video = findVideo();

            if (!video) {
                state.attempts++;
                if (!state.warned) {
                    log('暂未发现 video 元素，继续等待 iframe 渲染…', '#607D8B');
                    state.warned = true;
                }
                if (state.attempts >= MAX_WAIT) {
                    log('已等待 90 秒仍未发现视频。若本节是课件/无视频页，执行 app.nextUnit() 跳过。', '#FF9800');
                    stop();
                }
                return;
            }

            state.attempts = 0;
            if (state.warned) { log('已找到视频元素', '#4CAF50'); state.warned = false; }

            if (video.ended) return;                       // 播放结束交给原脚本切节
            if (!video.paused) { state.lastPlayAt = 0; return; }
            if (Date.now() - state.lastPlayAt < 4000) return;   // 防抖，别和原脚本抢

            state.lastPlayAt = Date.now();
            const a = window.app;
            if (a && typeof a.play === 'function') {
                try { a.play(); return; } catch (e) {}
            }
            hardPlay(video);
        } catch (e) {
            // 静默：看门狗出错绝不影响页面
        }
    }

    function start() {
        stop();
        state.attempts = 0;
        state.warned = false;
        state.lastPlayAt = 0;
        try { state.timer = setInterval(tick, TICK_MS); } catch (e) {}
        tick();
    }

    function stop() {
        if (state.timer) { try { clearInterval(state.timer); } catch (e) {} state.timer = null; }
    }

    try {
        document.addEventListener('click', function (e) {
            const t = e.target;
            if (t && t.closest && t.closest('.posCatalog_select, .prev_white, .prev_next, #prevNextFocusNext')) {
                setTimeout(start, 2000);
            }
        }, true);
        window.addEventListener('load', function () { setTimeout(start, 1500); });
        setTimeout(start, 1000);
    } catch (e) {}

    window.__xxtPatchRestart = start;
    log('看门狗 v2 已启用（与 app 内部解耦）', '#4CAF50');
})();
/* ================= 本地补丁 v2 end ==================== */

/* ================= agent 控制层 v3 start =================
 * 在原始 v3 脚本之上增加：
 *  1) 配置外置：localStorage['xxt_config'] 覆盖默认参数
 *  2) 指令通道：接收 'xxt-cmd' 事件（由 assist.js 从本机服务转发）
 *  3) 无人值守看门狗：视频等待超时自动跳过、播完卡住自动重试、暂停自动恢复
 * 原始逻辑保持不动，仅在外部包装。
 * ========================================================= */
(function () {
    if (window.__xxtAgentV3 && window.__xxtAgentV3.installed) return;

    const app = window.app;
    if (!app) return;

    const DEFAULTS = {
        playbackRate: 1.0,          // 非 1.0 会被平台锁死播放，见 README「倍速与跳播的实测结论」
        autoSkipNoVideo: true,      // 无视频页面等不到就跳过
        skipNoVideoAfterMs: 60000,  // 等 60 秒仍无视频 → 跳过
        endedRetryAfterMs: 30000,   // 播完后 30 秒没跳节 → 重试
        stuckResumeAfterMs: 45000,  // 播放中进度不动 45 秒 → 强制恢复
        tickMs: 2000,
    };

    let cfg = Object.assign({}, DEFAULTS);
    try {
        const raw = localStorage.getItem('xxt_config');
        if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    } catch (e) {}

    try {
        if (app.configs) {
            app.configs.playbackRate = cfg.playbackRate;
            app.configs.autoAdvanceNoVideo = false; // 交给本层看门狗，避免原逻辑立刻跳走
        }
    } catch (e) {}

    const state = {
        installed: true,
        timer: null,
        noVideoSince: 0,
        lastNextAt: 0,
        endedSince: 0,
        lastCur: -1,
        lastCurAt: 0,
        skipped: 0,
        cfg: cfg,
    };
    window.__xxtAgentV3 = state;

    function log(msg, color) {
        try { console.log('%c[agent] ' + msg, 'color:' + (color || '#673AB7')); } catch (e) {}
    }

    function pickVideo(doc) {
        try {
            if (!doc || !doc.querySelector) return null;
            return doc.querySelector('video#video_html5_api, video[id*="video_html5"], .vjs-tech, video');
        } catch (e) { return null; }
    }

    function findVideo() {
        try {
            if (app._videoEl && app._videoEl.tagName === 'VIDEO' && app._videoEl.isConnected) return app._videoEl;
        } catch (e) {}
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

    function chapterKey() {
        try {
            return (location.href.match(/chapterId=(\d+)/) || [])[1] || location.href;
        } catch (e) { return ''; }
    }

    function nextUnit(reason) {
        const now = Date.now();
        if (now - state.lastNextAt < 8000) return false;
        state.lastNextAt = now;
        state.noVideoSince = 0;
        state.endedSince = 0;
        log('切换下一节（' + reason + '）', '#2196F3');
        try {
            app.nextUnit();
            return true;
        } catch (e) {
            log('nextUnit 调用失败：' + e.message, '#F44336');
            return false;
        }
    }

    function doPlay(video) {
        try {
            if (video) video.playbackRate = Number(state.cfg.playbackRate) || 1.0;
        } catch (e) {}
        try {
            if (typeof app.play === 'function') { app.play(); return; }
        } catch (e) {}
        try {
            const p = video.play();
            if (p && p.catch) p.catch(function () {
                try { video.muted = true; } catch (e) {}
                try { video.play().catch(function () {}); } catch (e) {}
            });
        } catch (e) {}
    }

    function tick() {
        try {
            const now = Date.now();
            const video = findVideo();

            if (!video) {
                if (!state.noVideoSince) state.noVideoSince = now;
                state.lastCurAt = 0;
                const waited = now - state.noVideoSince;
                if (state.cfg.autoSkipNoVideo && waited > state.cfg.skipNoVideoAfterMs) {
                    state.skipped++;
                    log('已等待 ' + Math.round(waited / 1000) + ' 秒仍无视频，自动跳过（第 ' + state.skipped + ' 次）', '#FF9800');
                    if (!nextUnit('无视频超时')) state.noVideoSince = now; // 跳不动就重置计时，避免狂刷
                }
                return;
            }

            state.noVideoSince = 0;

            if (video.ended) {
                if (!state.endedSince) state.endedSince = now;
                if (now - state.endedSince > state.cfg.endedRetryAfterMs) {
                    log('视频已播完但未跳节，重试切换', '#FF9800');
                    nextUnit('播完未跳节');
                    state.endedSince = now;
                }
                return;
            }
            state.endedSince = 0;

            if (video.paused) {
                state.lastCurAt = 0;
                log('检测到暂停，尝试恢复', '#FF5722');
                doPlay(video);
                return;
            }

            // 播放中：监控进度是否卡死
            const cur = Number(video.currentTime || 0);
            if (cur !== state.lastCur) {
                state.lastCur = cur;
                state.lastCurAt = now;
            } else if (state.lastCurAt && now - state.lastCurAt > state.cfg.stuckResumeAfterMs) {
                log('进度 ' + Math.round(state.cfg.stuckResumeAfterMs / 1000) + ' 秒未推进，强制恢复播放', '#FF9800');
                doPlay(video);
                state.lastCurAt = now;
            }
        } catch (e) {}
    }

    function start() {
        stop();
        state.noVideoSince = 0;
        state.endedSince = 0;
        state.lastCurAt = 0;
        state.lastCur = -1;
        try { state.timer = setInterval(tick, state.cfg.tickMs); } catch (e) {}
        tick();
    }

    function stop() {
        if (state.timer) { try { clearInterval(state.timer); } catch (e) {} state.timer = null; }
    }

    // ---- 指令通道 ----
    window.addEventListener('xxt-cmd', function (ev) {
        let cmd = null;
        try { cmd = JSON.parse(ev.detail); } catch (e) { return; }
        if (!cmd || !cmd.cmd) return;
        log('收到指令：' + cmd.cmd + (cmd.text ? ' / ' + cmd.text : ''), '#009688');

        try {
            if (cmd.cmd === 'next' || cmd.cmd === 'skip') {
                state.lastNextAt = 0;
                nextUnit('agent 下发');
            } else if (cmd.cmd === 'play') {
                const v = findVideo();
                if (v) { try { v.paused && doPlay(v); } catch (e) {} }
            } else if (cmd.cmd === 'pause') {
                const v = findVideo();
                if (v) v.pause();
            } else if (cmd.cmd === 'rate') {
                const r = Number(cmd.value) || 1.5;
                state.cfg.playbackRate = r;
                try { app.configs.playbackRate = r; } catch (e) {}
                const v = findVideo();
                if (v) { try { v.playbackRate = r; } catch (e) {} }
            } else if (cmd.cmd === 'run') {
                app.run();
            } else if (cmd.cmd === 'config') {
                if (cmd.value && typeof cmd.value === 'object') {
                    state.cfg = Object.assign(state.cfg, cmd.value);
                    try { localStorage.setItem('xxt_config', JSON.stringify(state.cfg)); } catch (e) {}
                    log('配置已更新：' + JSON.stringify(cmd.value));
                }
            } else if (cmd.cmd === 'info') {
                log('章节 ' + chapterKey() + ' 跳过次数 ' + state.skipped);
            }
        } catch (e) {
            log('指令执行异常：' + e.message, '#F44336');
        }
    });

    document.addEventListener('click', function (e) {
        const t = e.target;
        if (t && t.closest && t.closest('.posCatalog_select, .prev_white, .prev_next, #prevNextFocusNext')) {
            setTimeout(start, 2500);
        }
    }, true);
    window.addEventListener('load', function () { setTimeout(start, 1500); });

    setTimeout(start, 1000);
    window.__xxtAgentRestart = start;
    log('控制层已启用（配置 ' + JSON.stringify(state.cfg) + '）', '#4CAF50');
})();
/* ================= agent 控制层 v3 end ================= */
