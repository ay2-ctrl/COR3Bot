// ==UserScript==
// @name         COR3
// @match        https://cor3.gg/
// @match        https://os.cor3.gg/
// @run-at       document-start
// @grant        none
// @description  COR3 ARG Tools
// @version      1.0
// ==/UserScript==

// Utils
(() => {
    window.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
})();

// Socket hook
(() => {
    if (window.__socketHookActive) {
        console.warn('⚠️ Socket hook is already active. Aborting duplicate initialization.');
        return;
    }

    window.__socketHookActive = true;

    const eventListeners = {};

    window.onSocketEvent = (eventName, handler) => {
        if (!eventListeners[eventName]) eventListeners[eventName] = [];
        eventListeners[eventName].push(handler);
    };

    window.offSocketEvent = (eventName, handler) => {
        if (!eventListeners[eventName]) return;
        eventListeners[eventName] = eventListeners[eventName].filter((fn) => fn !== handler);
    };

    window.onceSocketEvent = (eventName, handler) => {
        const wrapper = (...args) => {
            window.offSocketEvent(eventName, wrapper);
            handler(...args);
        };
        window.onSocketEvent(eventName, wrapper);
    };

    window.awaitSocketEvent = (eventName) => {
        return new Promise((resolve) => {
            const wrapper = (...args) => {
                window.offSocketEvent(eventName, wrapper);
                resolve(...args);
            };
            window.onSocketEvent(eventName, wrapper);
        });
    };

    function dispatchEvent(direction, parsed) {
        if (parsed.type !== 'event') return;

        const { event: room, payload } = parsed;
        const name = payload?.event?.name ?? '';
        const action = payload?.event?.action ?? '';
        const detail = [name, action].filter(Boolean).join(':');

        const pre = direction === 'out' ? 'out:' : '';

        if (payload?.message === 'token-expired') {
            console.warn(`⚠️ Ignoring "${detail ? pre + detail : room}" dispatch due to token expiration.`);
            return;
        } else if (payload?.error) {
            console.warn(`⚠️ Ignoring "${detail ? pre + detail : room}" dispatch due to error:`, payload.error);
            return;
        } else if (payload?.message) {
            console.debug(`⚠️ Event "${detail ? pre + detail : room}" has message:`, payload.message);
        }

        const keys = [
            ...(detail ? [`${pre}${detail}`] : payload?.room ? [`${pre}${room}(${payload?.room})`] : [`${pre}${room}`]), // exact: "stash:get.state"
            `${pre}${room}:*`, // wildcard: "stash:*"
            `${pre}*` // global:   "*"
        ];

        const seen = new Set();
        for (const key of keys) {
            for (const fn of eventListeners[key] ?? []) {
                if (seen.has(fn)) continue;
                seen.add(fn);

                try {
                    fn(payload?.data, parsed.ack);
                } catch (err) {
                    console.error(`Error in socket event handler for "${key}":`, err);
                }
            }
        }
    }

    function parseSocketIO(raw) {
        if (raw === '2' || raw === '2probe') return { type: 'ping' };
        if (raw === '3' || raw === '3probe') return { type: 'pong' };

        const code = parseInt(raw);

        if (code === 42) {
            try {
                const arr = JSON.parse(raw.slice(2));
                return { type: 'event', event: arr[0], payload: arr[1], ack: arr[2] ?? null };
            } catch {
                return { type: 'raw', data: raw };
            }
        }

        if (code === 43) {
            try {
                return { type: 'ack', data: JSON.parse(raw.slice(2)) };
            } catch {
                return { type: 'raw', data: raw };
            }
        }

        if (code === 40) return { type: 'connect' };
        if (code === 41) return { type: 'disconnect' };

        return { type: 'raw', data: raw };
    }

    function logMessage(direction, parsed) {
        const arrow = direction === 'in' ? '▼ IN ' : '▲ OUT';
        const color = direction === 'in' ? '#4FC3F7' : '#FFB74D';

        switch (parsed.type) {
            case 'ping':
            case 'pong':
                // console.debug(`%c${arrow} [${parsed.type.toUpperCase()}]`, `color: #888`);
                break;

            case 'event': {
                const { event, payload, ack } = parsed;
                const name = payload?.event?.name ?? '';
                const action = payload?.event?.action ?? '';
                const room = payload?.room ?? '';
                const detail = [name, action].filter(Boolean).join(':');
                const label = detail ? `${event} → ${detail}` : room ? `${event}(${room})` : event;
                const data = payload?.data;

                const knownKeys = new Set(['event', 'room', 'data', 'requestId', 'error', 'message']);
                const unknownKeys = Object.keys(payload ?? {}).filter((k) => !knownKeys.has(k));
                if (unknownKeys.length > 0) {
                    console.warn(`[${event}] Unhandled payload fields:`, unknownKeys, payload);
                }

                if (data === null || data === undefined) {
                    console.groupCollapsed(
                        `%c${arrow} [${label}]%c  (no data)`,
                        `color: ${color}; font-weight: bold`,
                        'color: #888'
                    );
                    console.debug('raw:', payload);
                    console.groupEnd();
                } else {
                    console.groupCollapsed(`%c${arrow} [${label}]`, `color: ${color}; font-weight: bold`);
                    console.log(data);
                    if (ack) console.debug('ack:', ack);
                    console.debug('raw:', payload);
                    console.groupEnd();
                }
                break;
            }

            case 'ack':
                console.groupCollapsed(`%c${arrow} [ACK]`, `color: #CE93D8; font-weight: bold`);
                console.log(parsed.data);
                console.debug('raw:', parsed.data);
                console.groupEnd();
                break;

            case 'connect':
                console.info(`%c${arrow} [CONNECT]`, `color: #A5D6A7; font-weight: bold`);
                break;

            default:
                console.log(`%c${arrow}`, `color: ${color}`, parsed.data);
        }
    }

    const hookedInstances = new WeakSet();

    function hookInstance(ws) {
        if (hookedInstances.has(ws)) return;
        hookedInstances.add(ws);

        ws.addEventListener('message', (e) => {
            const parsed = parseSocketIO(e.data);
            logMessage('in', parsed);
            dispatchEvent('in', parsed);
        });

        if (
            ws.url.startsWith('wss://svc-corie.cor3.gg/socket.io/?') ||
            ws.url.startsWith('wss://svc-corie.cor3.gg:443/socket.io/?')
        ) {
            window.argSocket = ws;
            window.send = (data) => {
                try {
                    ws.send(data);
                } catch (e) {
                    console.error('❌ [Hook] Error sending data through WebSocket:', e);
                }
            };
            window.emitRaw = (event, payload) => send(`42${JSON.stringify([event, payload])}`);
            window.emitEvent = (event, payload) =>
                emitRaw('event', {
                    event: {
                        name: event.split(':')[0],
                        action: event.split(':')[1]
                    },
                    data: payload
                });
            window.emitEventInterval = (event, payload, interval = 6000, retries = 5) => {
                let count = 0;
                emitEvent(event, payload);

                const id = setInterval(() => {
                    if (++count >= retries) clearInterval(id);
                    emitEvent(event, payload);
                }, interval);
                return () => clearInterval(id);
            };

            console.info(
                `%c[Hook] Send/emit connected to target WebSocket: ${ws.url}`,
                'color: #81C784; font-weight: bold'
            );
        } else {
            console.info(
                `%c[Hook] Connected to WebSocket: ${ws.url} (not target)`,
                'color: #FFB74D; font-weight: bold'
            );
        }
    }

    const _originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        try {
            hookInstance(this);

            const parsed = parseSocketIO(data);
            logMessage('out', parsed);
            dispatchEvent('out', parsed);
        } catch (e) {
            console.error('Error in WebSocket.send hook:', e);
        }

        return _originalSend.call(this, data);
    };

    const _WS = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        const ws = protocols ? new _WS(url, protocols) : new _WS(url);

        try {
            hookInstance(ws);
            console.info(`%cWebSocket hooked: ${url}`, 'color: #A5D6A7; font-weight: bold');
        } catch (e) {
            console.error('Error hooking WebSocket instance:', e);
        }

        return ws;
    };
    Object.assign(window.WebSocket, _WS);

    console.info('%cHook ready', 'color: #B4DAB5; font-weight: bold');
})();

// Highlighter
(() => {
    if (window.__highlighterActive) {
        console.warn('⚠️ Highlighter is already active. Aborting duplicate initialization.');
        return;
    }

    window.__highlighterActive = true;

    const cache = {};
    let observer = null;

    const EVENT_CONFIG = {
        'sai:get.transit': { tab: 'SaiTransit', getEntries: (data) => data.ips },
        'sai:get.files': { tab: 'SaiFiles', getEntries: (data) => data.files },
        'sai:get.logs': { tab: 'SaiLogs', getEntries: (data) => data.logs }
    };

    const MUTATION_CONFIG = {
        'sai:transit.remove': {
            tab: 'SaiTransit',
            apply: (data, entries) => entries.filter((e) => e.ip !== data.removedIp)
        },
        'sai:transit.add': {
            tab: 'SaiTransit',
            apply: (data, entries) => [data.ip, ...entries]
        },
        'sai:file.delete': {
            tab: 'SaiFiles',
            apply: (data, entries) => entries.filter((e) => e.fileId !== data.deletedFileId)
        },
        'sai:file.upload': {
            tab: 'SaiFiles',
            apply: (data, entries) => [data.file, ...entries]
        },
        'sai:log.delete': {
            tab: 'SaiLogs',
            apply: (data, entries) => entries.filter((e) => e.seq !== data.deletedSeq)
        }
    };

    const applyBackgroundHighlight = (element, type) => {
        let color = 'rgba(226, 9, 197, 0.2)';
        if (type === 'user') color = 'rgba(0, 100, 255, 0.2)';
        else if (type === 'system') color = 'rgba(176, 49, 44, 0.2)';
        else if (type === 'job') color = 'rgba(238, 215, 7, 0.3)';
        element.style.background = color;
    };

    function getSaiRoot() {
        return document.querySelector('[data-component-name="ServerAdministrationInterfaceApplication"]');
    }

    function getActiveTabName() {
        const root = getSaiRoot();
        if (!root) return null;

        for (const name of ['SaiTransit', 'SaiFiles', 'SaiLogs']) {
            if (root.querySelector(`[data-component-name="${name}"]`)) return name;
        }
        return null;
    }

    function getContainerElement() {
        const root = getSaiRoot();
        if (!root) return null;

        const scrollArea = root.querySelector('[data-component-name="ScrollArea"]');
        if (!scrollArea) return null;

        const container = scrollArea.firstChild;
        if (!container) return null;

        return container;
    }

    function clearHighlights(container) {
        if (!container || !container.children) return;
        for (const child of container.children) {
            child.style.background = '';
        }
    }

    function applyHighlights(container, entries) {
        if (!entries || entries.length === 0) return;
        if (!container || !container.children || container.children.length === 0) return;

        clearHighlights(container);

        entries.forEach((entry, index) => {
            if (entry.source === 'generated') return;
            const child = container.children[index];
            if (!child) return;

            applyBackgroundHighlight(child, entry.source);
        });
    }

    function refreshHighlights() {
        const currentTab = getActiveTabName();
        if (!currentTab || !cache[currentTab]) return;

        const container = getContainerElement();
        if (!container) return;

        applyHighlights(container, cache[currentTab]);
    }

    function ensureObserver() {
        if (observer) return;
        const root = getSaiRoot();
        if (!root) return;

        observer = new MutationObserver(() => {
            const currentTab = getActiveTabName();
            if (!currentTab) return;

            if (cache[currentTab]) {
                setTimeout(() => {
                    refreshHighlights();
                }, 100);
            }
        });

        observer.observe(root, { childList: true, subtree: true });
    }

    // Full-data listeners (initial load / full refresh)
    Object.entries(EVENT_CONFIG).forEach(([event, { tab, getEntries }]) => {
        onSocketEvent(event, (data) => {
            if (!data) return;

            const entries = getEntries(data);
            if (!entries) return;

            cache[tab] = entries;
            ensureObserver();
            setTimeout(() => {
                refreshHighlights();
            }, 100);
        });
    });

    // Mutation listeners (add / remove / delete / upload)
    Object.entries(MUTATION_CONFIG).forEach(([event, { tab, apply }]) => {
        onSocketEvent(event, (data) => {
            if (!data) return;
            if (!cache[tab]) return;

            cache[tab] = apply(data, cache[tab]);

            setTimeout(() => {
                refreshHighlights();
            }, 100);
        });
    });

    onSocketEvent('out:leave-room(sai)', () => {
        for (const key in cache) delete cache[key];
        observer?.disconnect();
        observer = null;
    });

    console.log('%c👀 Watching for SAI events...', 'color: #888; font-style: italic');
})();

// Stash Values
(() => {
    if (window.__stashValueDisplayActive) {
        console.warn('⚠️ Stash value display is already active. Aborting duplicate initialization.');
        return;
    }

    window.__stashValueDisplayActive = true;

    let stashCache = null;

    const CR_BADGE_SVG = `<svg width="19" height="14" viewBox="0 0 19 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: unset;"><rect width="19" height="14" rx="3" fill="currentColor"></rect><path d="M8.66852 9.458C8.54719 9.75667 8.41652 9.99933 8.27652 10.186C7.66986 10.942 7.09586 11.32 6.55452 11.32H4.70652C4.44519 11.32 4.17452 11.2407 3.89452 11.082C3.75452 10.998 3.57252 10.8487 3.34852 10.634C3.12452 10.41 2.97052 10.2327 2.88652 10.102C2.74652 9.89667 2.67652 9.64933 2.67652 9.36V4.74C2.67652 4.46 2.74652 4.21733 2.88652 4.012C2.97986 3.88133 3.13852 3.704 3.36252 3.48C3.58652 3.24667 3.76386 3.09267 3.89452 3.018C4.17452 2.85933 4.44052 2.78 4.69252 2.78H6.55452C7.13319 2.78 7.70719 3.158 8.27652 3.914C8.37919 4.03533 8.50986 4.27333 8.66852 4.628L7.54852 4.95C7.39919 4.53 7.09119 4.17533 6.62452 3.886C6.58719 3.87667 6.54986 3.872 6.51252 3.872H4.76252C4.71586 3.872 4.67386 3.88133 4.63652 3.9C4.53386 3.956 4.39852 4.06333 4.23052 4.222C4.07186 4.38067 3.95052 4.52533 3.86652 4.656C3.84786 4.684 3.83852 4.74467 3.83852 4.838V9.346C3.83852 9.458 3.93652 9.612 4.13252 9.808C4.33786 10.004 4.50586 10.1347 4.63652 10.2C4.67386 10.2187 4.71586 10.228 4.76252 10.228H6.51252C6.56852 10.228 6.61519 10.2187 6.65252 10.2C6.82052 10.1067 6.99319 9.962 7.17052 9.766C7.34786 9.57 7.47386 9.36933 7.54852 9.164L8.66852 9.458ZM16.6347 11.25H15.3887L13.4147 7.75H11.4827V11.25H10.3347V2.85H14.2827C14.6374 2.85 14.9501 2.948 15.2207 3.144C15.3234 3.21867 15.4587 3.34 15.6267 3.508C15.7947 3.676 15.9067 3.802 15.9627 3.886C16.1214 4.12867 16.2007 4.39467 16.2007 4.684V5.944C16.2007 6.224 16.1214 6.48533 15.9627 6.728C15.9067 6.812 15.7947 6.938 15.6267 7.106C15.4587 7.274 15.3234 7.39533 15.2207 7.47C15.0154 7.61933 14.8054 7.70333 14.5907 7.722L16.6347 11.25ZM15.0527 5.916V4.712C15.0527 4.61867 15.0481 4.56733 15.0387 4.558C14.9827 4.46467 14.8754 4.34333 14.7167 4.194C14.5581 4.03533 14.4367 3.95133 14.3527 3.942H14.2687H11.4827V6.658H14.2687C14.3807 6.658 14.5207 6.588 14.6887 6.448C14.8661 6.308 14.9827 6.182 15.0387 6.07C15.0481 6.05133 15.0527 6 15.0527 5.916Z" fill="#0A0F10"></path></svg>`;

    function createCRBadge(value) {
        const span = document.createElement('span');
        span.innerHTML = CR_BADGE_SVG + value.toLocaleString();
        span.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #00CDAB;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        `;
        return span;
    }

    function applyStashCR() {
        if (!stashCache) return false;

        const totalCR = stashCache.items.reduce((sum, item) => sum + (item.sellPrice || 0), 0);

        // Total CR in header
        const header = document.querySelector('[data-component-name="ExpeditionsStashHeader"]');
        if (header) {
            let totalEl = header.querySelector('.stash-total-cr');
            if (!totalEl) {
                totalEl = createCRBadge(totalCR);
                totalEl.className = 'stash-total-cr';
                totalEl.style.marginLeft = '8px';
                header.appendChild(totalEl);
            } else {
                totalEl.innerHTML = CR_BADGE_SVG + totalCR.toLocaleString();
            }
        }

        // Per-item CR
        const items = document.querySelectorAll('[data-component-name="StashItem"]');
        if (items.length === 0) return false;

        const used = new Set();

        items.forEach((el) => {
            if (el.querySelector('.stash-item-cr')) return;

            const img = el.querySelector('[data-component-name="StashItemImage"] img');
            if (!img) return;
            const src = img.getAttribute('src');

            const idx = stashCache.items.findIndex((item, i) => !used.has(i) && item.imageUrl === src);
            if (idx === -1) return;
            used.add(idx);

            const item = stashCache.items[idx];
            const category = el.querySelector('[data-component-name="StashItemCategory"]');
            if (!category) return;

            const badge = createCRBadge(item.sellPrice);
            badge.className = 'stash-item-cr';
            badge.style.fontSize = '11px';
            badge.style.marginLeft = '6px';
            badge.style.gap = '3px';
            badge.style.verticalAlign = 'middle';
            category.appendChild(badge);
        });

        return true;
    }

    onSocketEvent('stash:get.state', (data) => {
        if (!data) return;
        stashCache = data;

        if (!applyStashCR()) {
            const delays = [150, 500, 1500];
            delays.forEach((d) => setTimeout(applyStashCR, d));
        }
    });
})();

// Solver
(() => {
    if (window.__solverActive) {
        console.warn('⚠️ Solver is already active. Aborting duplicate initialization.');
        return;
    }
    window.__solverActive = true;

    const solverListeners = [];

    window.awaitSolver = () => {
        return new Promise((resolve) => {
            solverListeners.push(resolve);
        });
    };

    function reactSet(el, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function submit(el, text) {
        reactSet(el, text);
        await sleep(10);
        ['keydown', 'keypress', 'keyup'].forEach((type) =>
            el.dispatchEvent(
                new KeyboardEvent(type, {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    charCode: type === 'keypress' ? 13 : 0,
                    bubbles: true,
                    cancelable: true
                })
            )
        );
    }

    function logLines() {
        const container = document.querySelector(
            '[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
        );
        return [...(container?.querySelectorAll('div') ?? [])].map((d) => d.textContent.trim()).filter(Boolean);
    }

    async function waitForResponse(inputEl, combo, timeout = 5000) {
        const pattern = new RegExp(
            `^Input: ${combo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nResult:\\nMismatched (\\d+)`
        );
        const start = Date.now();
        while (Date.now() - start < timeout && document.contains(inputEl)) {
            const lines = logLines();
            for (const line of lines) {
                const m = line.match(pattern);
                if (m) return parseInt(m[1]);
            }
            await sleep(100);
        }
        return null;
    }

    function buildCombo(indices, fields) {
        return indices.map((vi, fi) => fields[fi][vi]).join(' ');
    }

    function detectFields(lines) {
        const fields = [];
        for (const line of lines) {
            const m = line.match(/→\s*(.+)/);
            if (m) {
                fields.push(m[1].split('/').map((s) => s.trim()));
            }
        }
        return fields;
    }

    function generateAllCombinations(numFields, optsPerField) {
        let results = [[]];
        for (let i = 0; i < numFields; i++) {
            const next = [];
            for (const r of results) {
                for (let j = 0; j < optsPerField[i]; j++) {
                    next.push([...r, j]);
                }
            }
            results = next;
        }
        return results;
    }

    let cachedSolver = null;

    function getOrCreateSolver(FIELDS) {
        const key = FIELDS.map((f) => f.join('|')).join('||');
        if (cachedSolver && cachedSolver.key === key) return cachedSolver;

        const numFields = FIELDS.length;
        const allGuesses = generateAllCombinations(
            numFields,
            FIELDS.map((f) => f.length)
        );
        const N = allGuesses.length;

        const distMatrix = new Uint8Array(N * N);
        for (let i = 0; i < N; i++) {
            for (let j = i; j < N; j++) {
                let d = 0;
                for (let k = 0; k < numFields; k++) {
                    if (allGuesses[i][k] !== allGuesses[j][k]) d++;
                }
                distMatrix[i * N + j] = d;
                distMatrix[j * N + i] = d;
            }
        }

        const memo = new Map();

        cachedSolver = { key, distMatrix, memo, allGuesses, N, numFields };
        return cachedSolver;
    }

    async function runSolver() {
        const lines = logLines();
        const FIELDS = detectFields(lines);

        if (FIELDS.length === 0) {
            console.warn('⚠️ Could not detect fields from logs.');
            return;
        }

        console.log(
            '%c📋 Detected fields:',
            'color: #b08944; font-weight: bold',
            FIELDS.map((f, i) => `\n   ${i}: [${f.join(', ')}]`).join('')
        );

        const placeholder = FIELDS.map((f) => f[0]).join(' ');
        const input = document.querySelector(`input[placeholder="${placeholder}"]`);

        if (!input) {
            console.error(`❌ Input field not found (looked for placeholder="${placeholder}")`);
            return;
        }

        const solver = getOrCreateSolver(FIELDS);
        const { distMatrix, memo, allGuesses, N, numFields } = solver;
        const getDist = (a, b) => distMatrix[a * N + b];

        if (solver.key === cachedSolver.key && memo.size > 0) {
            console.log('%c♻️ Reusing cached solver', 'color: #8fb24e; font-weight: bold');
        }

        function getBestGuess(possibilities, parentBest = Infinity) {
            if (possibilities.length === 1) {
                return { guess: possibilities[0], depth: 1 };
            }

            const key = possibilities.join(',');
            if (memo.has(key)) return memo.get(key);

            let bestDepth = Infinity;
            let bestGuess = -1;

            for (let g = 0; g < N; g++) {
                const partitions = new Array(numFields + 1);
                for (let i = 0; i <= numFields; i++) partitions[i] = [];

                let isPossibleAnswer = false;

                for (let i = 0; i < possibilities.length; i++) {
                    const p = possibilities[i];
                    const d = getDist(g, p);
                    if (d === 0) {
                        isPossibleAnswer = true;
                    } else {
                        partitions[d].push(p);
                    }
                }

                let dominated = false;
                for (let d = 1; d <= numFields; d++) {
                    if (partitions[d].length === possibilities.length) {
                        dominated = true;
                        break;
                    }
                }
                if (dominated) continue;

                let currentMax = isPossibleAnswer ? 1 : 0;
                let aborted = false;

                for (let d = 1; d <= numFields; d++) {
                    if (partitions[d].length === 0) continue;

                    const res = getBestGuess(partitions[d], bestDepth);
                    const candidate = res.depth + 1;
                    if (candidate > currentMax) currentMax = candidate;

                    if (currentMax > bestDepth || currentMax >= parentBest) {
                        aborted = true;
                        break;
                    }
                }

                if (aborted) continue;

                if (currentMax < bestDepth) {
                    bestDepth = currentMax;
                    bestGuess = g;
                } else if (currentMax === bestDepth) {
                    const newInSet = possibilities.includes(g);
                    const curInSet = possibilities.includes(bestGuess);
                    if (newInSet && !curInSet) {
                        bestGuess = g;
                    }
                }
            }

            const result = { guess: bestGuess, depth: bestDepth };
            memo.set(key, result);
            return result;
        }

        let possibilities = Array.from({ length: N }, (_, i) => i);
        let guessNum = 0;

        const doGuess = async (combo, label) => {
            console.log(`%c▶ [${label}] ${combo}`, 'color: #7c9ef3; font-weight: bold');
            await submit(input, combo);
            const val = await waitForResponse(input, combo);
            if (val === null) {
                console.info(`❌ Mismatch count not found for ${label}`);
            } else {
                console.log(`   Mismatch: ${val}`);
            }
            return val;
        };

        while (possibilities.length > 0) {
            const best = getBestGuess(possibilities);
            const bestGuessIdx = best.guess;
            const m = await doGuess(buildCombo(allGuesses[bestGuessIdx], FIELDS), `guess ${++guessNum}`);

            if (m == null || m === 0) return;

            possibilities = possibilities.filter((p) => getDist(bestGuessIdx, p) === m);

            if (possibilities.length === 0) {
                console.error('❌ No possibilities left. Something went wrong.');
                return;
            }
        }
    }

    async function waitForMinigame() {
        console.log('%c👀 Watching for minigame...', 'color: #888; font-style: italic');
        getOrCreateSolver([
            ['v1.0', 'v1.1', 'v2.0'],
            ['GET', 'PUT', 'POST'],
            ['LTE', 'Fiber', 'Sat'],
            ['AES', 'RSA', 'DES']
        ]);

        while (true) {
            const container = document.querySelector(
                '[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
            );

            if (container) {
                const lines = logLines();
                const isReady = lines.length > 0 && lines[lines.length - 1].startsWith('Attempts:');

                if (isReady) {
                    console.log('%c✅ Minigame detected, starting solver...', 'color: #8fb24e; font-weight: bold');
                    await runSolver();

                    console.log('%c⏳ Waiting for minigame to close...', 'color: #888; font-style: italic');
                    while (
                        document.querySelector(
                            '[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
                        )
                    ) {
                        await sleep(100);
                    }

                    while (solverListeners.length) {
                        try {
                            solverListeners.shift()();
                        } catch (e) {
                            console.error('Error in solver listener:', e);
                        }
                    }

                    console.log('%c👀 Minigame closed. Watching for next one...', 'color: #888; font-style: italic');
                }
            }

            await sleep(250);
        }
    }

    waitForMinigame();
})();

// Job timer
(() => {
    if (window.__jobTimerActive) {
        console.warn('⚠️ Job timer is already active. Aborting duplicate initialization.');
        return;
    }
    window.__jobTimerActive = true;

    const timers = {};

    function getTimer(marketId) {
        if (!timers[marketId]) timers[marketId] = { resetAt: null, timeout: null, interval: null };
        return timers[marketId];
    }

    function scheduleRefresh(marketId, resetAt) {
        const timer = getTimer(marketId);
        if (timer.timeout) clearTimeout(timer.timeout);

        const delay = Math.max(0, new Date(resetAt).getTime() - Date.now() + 1000);
        console.log(`⏱️ Market ${marketId}: Scheduling job refresh in ${(delay / 1000).toFixed(0)}s.`);

        timer.timeout = setTimeout(async () => {
            timer.timeout = null;
            console.log(`⏰ Market ${marketId}: Cooldown elapsed. Polling for refresh...`);

            const clear = emitEventInterval('market:get.options', { marketId });
            timer.interval = clear;

            while (true) {
                const {
                    market: { id }
                } = await awaitSocketEvent('market:get.options');
                if (id === marketId) break;
            }
            clear();
            timer.interval = null;
        }, delay);
    }

    onSocketEvent('market:get.options', ({ market: { id: marketId }, nextJobsResetAt }) => {
        const timer = getTimer(marketId);

        if (timer.resetAt !== null && timer.resetAt !== nextJobsResetAt) {
            console.log(`✅ Market ${marketId}: Jobs refreshed. Stopping poll.`);
            if (timer.interval) {
                timer.interval();
                timer.interval = null;
            }
        }

        if (timer.resetAt !== nextJobsResetAt) {
            timer.resetAt = nextJobsResetAt;
            scheduleRefresh(marketId, nextJobsResetAt);
        }
    });

    console.log('%c👀 Watching for market socket events...', 'color: #888; font-style: italic');
})();

// Auto job
(() => {
    if (window.__jobAutomation) {
        console.warn('⚠️ Job automation is already active. Aborting duplicate initialization.');
        return;
    }

    window.__jobAutomation = true;

    const seen = new Set();
    const queue = [];
    let processing = false;

    async function completeJob(marketId, jobId) {
        const clearComplete = emitEventInterval('market:job.complete', {
            marketId,
            jobId
        });

        await awaitSocketEvent('market:job.complete');
        clearComplete();
    }

    async function processQueue() {
        if (processing) return;
        processing = true;

        while (queue.length > 0) {
            const { marketId, jobId } = queue.shift();
            await completeJob(marketId, jobId);
            await sleep(1500);
        }

        processing = false;
    }

    function enqueueJob(marketId, jobId) {
        if (seen.has(jobId)) return;
        seen.add(jobId);
        queue.push({ marketId, jobId });
        processQueue();
    }

    onSocketEvent('market:job.can-complete', ({ canComplete, marketId, jobId }) => {
        if (canComplete) enqueueJob(marketId, jobId);
    });

    onSocketEvent('market:get.options', ({ market: { id: marketId }, recentJobs }) => {
        for (const { canComplete, id: jobId } of recentJobs) {
            if (canComplete) enqueueJob(marketId, jobId);
        }
    });
})();

// Auto expedition event
(() => {
    if (window.__autoExpeditionEventActive) {
        console.warn('⚠️ Auto expedition event is already active. Aborting duplicate initialization.');
        return;
    }
    window.__autoExpeditionEventActive = true;

    const CONFIG = {
        enabled: true,
        lootWeight: 1.0,
        riskWeight: 0.8
    };

    const activeMessageIds = new Set();

    const playNotificationSound = () => {
        try {
            new Audio('https://cdn.pixabay.com/audio/2026/03/01/audio_4182fd0ce7.mp3').play().catch(console.error);
        } catch {}
    };

    const effectiveRiskWeight = (riskScore) => CONFIG.riskWeight * (1 + ((riskScore ?? 0) / 100) * 3);

    const scoreOption = (option, riskScore) =>
        (option.lootModifier ?? 0) * CONFIG.lootWeight - (option.riskModifier ?? 0) * effectiveRiskWeight(riskScore);

    function findBestOption(options, riskScore) {
        if (!options?.length) return null;
        return options.reduce((best, candidate) => {
            const bs = scoreOption(best, riskScore);
            const cs = scoreOption(candidate, riskScore);
            if (cs !== bs) return cs > bs ? candidate : best;
            return (best.riskModifier ?? 0) <= (candidate.riskModifier ?? 0) ? best : candidate;
        });
    }

    function processExpedition(expedition) {
        if (expedition?.status === 'COMPLETED') playNotificationSound();
        if (!CONFIG.enabled || !expedition?.id) return;
        if (expedition.status === 'EVENT') tryDecide(expedition);
    }

    // Show a popup so the user can manually choose an option
    function showDecisionPopup(expedition, unresolvedMessage) {
        return new Promise((resolve) => {
            const existing = document.getElementById('cor3-decision-popup');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'cor3-decision-popup';
            overlay.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.75);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: sans-serif;
            `;

            const box = document.createElement('div');
            box.style.cssText = `
                background: #111128;
                border: 1px solid #2244aa;
                border-radius: 12px;
                padding: 20px;
                max-width: 340px;
                width: 90%;
                color: #e0e0ff;
            `;

            const title = document.createElement('div');
            title.style.cssText = 'font-size:16px;font-weight:bold;color:#aaaaff;margin-bottom:8px;';
            title.textContent = '⚔️ Decision Required';
            box.appendChild(title);

            const loc = document.createElement('div');
            loc.style.cssText = 'font-size:12px;color:#6666aa;margin-bottom:12px;';
            loc.textContent = (expedition.locationName || '') + (expedition.objectiveName ? ' · ' + expedition.objectiveName : '');
            box.appendChild(loc);

            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:13px;color:#ccccff;margin-bottom:16px;line-height:1.4;';
            msg.textContent = unresolvedMessage.content || '';
            box.appendChild(msg);

            if (unresolvedMessage.decisionDeadline) {
                const dl = document.createElement('div');
                dl.style.cssText = 'font-size:11px;color:#ff8844;margin-bottom:12px;';
                dl.textContent = '⏰ Deadline: ' + new Date(unresolvedMessage.decisionDeadline).toLocaleTimeString();
                box.appendChild(dl);
            }

            unresolvedMessage.decisionOptions.forEach((option) => {
                const btn = document.createElement('button');
                const risk = option.riskModifier ?? 0;
                const loot = option.lootModifier ?? 0;
                const riskColor = risk > 0 ? '#ff4444' : '#44ff88';
                const lootColor = loot > 0 ? '#44ff88' : '#ff4444';

                btn.style.cssText = `
                    display: block;
                    width: 100%;
                    margin-bottom: 8px;
                    padding: 10px 14px;
                    background: #1e1e3a;
                    border: 1px solid #2244aa;
                    border-radius: 8px;
                    color: #e0e0ff;
                    font-size: 13px;
                    text-align: left;
                    cursor: pointer;
                `;

                btn.innerHTML = '<strong>' + option.label + '</strong><br>' +
                    '<span style="font-size:11px;">' +
                    '<span style="color:' + riskColor + ';">Risk: ' + (risk > 0 ? '+' : '') + risk + '</span>' +
                    '&nbsp;&nbsp;' +
                    '<span style="color:' + lootColor + ';">Loot: ' + (loot > 0 ? '+' : '') + loot + '</span>' +
                    '</span>';

                btn.addEventListener('mouseover', () => { btn.style.background = '#2a2a4a'; });
                btn.addEventListener('mouseout', () => { btn.style.background = '#1e1e3a'; });
                btn.addEventListener('click', () => {
                    overlay.remove();
                    resolve(option);
                });

                box.appendChild(btn);
            });

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    async function tryDecide(expedition) {
        const unresolvedMessage = (expedition.messages ?? []).find(
            (msg) =>
                msg.messageType === 'DECISION' &&
                Array.isArray(msg.decisionOptions) &&
                msg.decisionOptions.length > 0 &&
                !msg.isResolved &&
                !msg.isAutoResolved &&
                msg.selectedOption == null &&
                !activeMessageIds.has(msg.id)
        );
        if (!unresolvedMessage) return;
        activeMessageIds.add(unresolvedMessage.id);

        try {
            if (
                unresolvedMessage.decisionDeadline &&
                Date.now() > new Date(unresolvedMessage.decisionDeadline).getTime() + 5000
            ) {
                console.warn('[DECISION] ⏰ Deadline passed - skipping ' + unresolvedMessage.id);
                return;
            }

            // Send Android notification to alert user
            playNotificationSound();
            if (window.AndroidBridge) {
                AndroidBridge.notifyDecision(
                    '⚔️ Decision Required!',
                    'Open the app to choose: ' + (expedition.locationName || 'Expedition')
                );
            }

            // Show popup and wait for user to choose
            const chosenOption = await showDecisionPopup(expedition, unresolvedMessage);
            if (!chosenOption) return;

            console.log('[DECISION] User chose: "' + chosenOption.label + '"');

            const clearRespond = emitEventInterval('expeditions:respond.event', {
                expeditionId: expedition.id,
                messageId: unresolvedMessage.id,
                selectedOption: chosenOption.id
            });

            await awaitSocketEvent('expeditions:respond.event');
            clearRespond();
            console.log('[DECISION] ✓ Decision confirmed');

            if (window.AndroidBridge) {
                AndroidBridge.notify('✅ Decision Sent!', 'Chosen: ' + chosenOption.label);
            }
        } catch (e) {
            console.error('[DECISION] ✗ Decision failed:', e);
        } finally {
            activeMessageIds.delete(unresolvedMessage.id);
        }
    }


    onSocketEvent('expeditions:*', (data) => {
        if (Array.isArray(data)) data.forEach((e) => e?.id && processExpedition(e));
        else if (data?.id) processExpedition(data);
    });

    window.autoExpedition = {
        cfg: CONFIG,
        on() {
            CONFIG.enabled = true;
            console.log('[AUTO] ✓ on');
        },
        off() {
            CONFIG.enabled = false;
            console.log('[AUTO] ✗ off');
        },
        riskWeight(w) {
            CONFIG.riskWeight = w;
            console.log('[AUTO] riskWeight =', w);
        },
        lootWeight(w) {
            CONFIG.lootWeight = w;
            console.log('[AUTO] lootWeight =', w);
        },
        status() {
            console.groupCollapsed('%c[AUTO] Status', 'color:#FFD700;font-weight:bold');
            console.log('enabled        :', CONFIG.enabled);
            console.log('riskWeight     :', CONFIG.riskWeight);
            console.log('lootWeight     :', CONFIG.lootWeight);
            console.log('active messages:', activeMessageIds.size);
            console.groupEnd();
        },
        reset() {
            activeMessageIds.clear();
            console.log('[AUTO] reset');
        }
    };

    console.info(
        '%c[AUTO] Expedition auto-decision ready │ .on() .off() .riskWeight(n) .lootWeight(n) .status() .reset()',
        'color:#FFD700;font-weight:bold'
    );
})();

// Auto expedition restart
(() => {
    if (window.__autoExpeditionRestartActive) {
        console.warn('⚠️ Auto-expedition restart is already active. Aborting duplicate initialization.');
        return;
    }
    window.__autoExpeditionRestartActive = true;

    let startingNewExpedition = false;

    async function startNextExpedition() {
        if (startingNewExpedition) return;
        startingNewExpedition = true;

        try {
            const marketId = '019d3ea4-85bd-7389-904d-8f7c85841134';

            const clearGetMercenaries = emitEventInterval('expeditions:get.mercenaries', {
                marketId
            });
            const { mercenaries } = await awaitSocketEvent('expeditions:get.mercenaries');
            clearGetMercenaries();

            const availableMercenaries = mercenaries.filter((m) => m.status === 'AVAILABLE');
            if (availableMercenaries.length === 0) return;

            const clearGetConfig = emitEventInterval('expeditions:get.config');
            const { locations } = await awaitSocketEvent('expeditions:get.config');
            clearGetConfig();

            const location = locations[Math.floor(Math.random() * locations.length)];
            if (!location.zones.length) return;
            const zone = location.zones[Math.floor(Math.random() * location.zones.length)];
            if (!zone.objectives.length) return;
            const objective = zone.objectives[Math.floor(Math.random() * zone.objectives.length)];

            let cheapestMercenary = null;
            let cheapestMercenaryCost = Infinity;

            async function scoreMercenary(mercenary) {
                const clearConfigure = emitEventInterval('expeditions:configure', {
                    mercenaryId: mercenary.id,
                    marketId,
                    locationConfigId: location.id,
                    zoneConfigId: zone.id,
                    objectiveId: objective.id,
                    hasInsurance: false
                });

                const { totalCost } = await awaitSocketEvent('expeditions:configure');
                clearConfigure();

                if (totalCost < cheapestMercenaryCost) {
                    cheapestMercenaryCost = totalCost;
                    cheapestMercenary = mercenary;
                }
            }

            for (const mercenary of availableMercenaries) {
                await scoreMercenary(mercenary);
                await sleep(1500);
            }

            if (!cheapestMercenary) {
                console.warn('No mercenaries available to start an expedition.');
                return;
            }

            const clearLaunch = emitEventInterval('expeditions:launch', {
                mercenaryId: cheapestMercenary.id,
                marketId,
                locationConfigId: location.id,
                zoneConfigId: zone.id,
                objectiveId: objective.id,
                hasInsurance: false
            });

            await awaitSocketEvent('expeditions:launch');
            clearLaunch();
            await sleep(2000);
            emitEvent('expeditions:get.active');
        } catch (e) {
            console.error('Error starting expedition:', e);
        } finally {
            startingNewExpedition = false;
        }
    }

    let collectingExpedition = false;

    async function handleCollection(expedition) {
        if (collectingExpedition) return;
        collectingExpedition = true;

        try {
            const clearOpenContainer = emitEventInterval('expeditions:open.container', {
                expeditionId: expedition.id
            });

            await awaitSocketEvent('expeditions:open.container');
            clearOpenContainer();
            await sleep(500);

            const clearCollectAll = emitEventInterval('expeditions:collect.all', {
                expeditionId: expedition.id
            });

            await awaitSocketEvent('expeditions:collect.all');
            clearCollectAll();
        } catch (e) {
            console.error('Error collecting expedition:', e);
        } finally {
            collectingExpedition = false;
        }
    }

    onSocketEvent('expeditions:get.active', async (expeditions) => {
        if (expeditions.length === 0) return startNextExpedition();

        const expedition = expeditions[0];
        if (
            expedition.status !== 'COMPLETED' &&
            (expedition.status !== 'FULL_SUCCESS' || expedition.status !== 'PARTIAL_SUCCESS')
        )
            return;
        if (expedition.containerOpenedAt != null) return;

        handleCollection(expedition);
    });

    onSocketEvent('expeditions:insert.archive', () => {
        startNextExpedition();
    });

    if (window.emitEvent) emitEvent('expeditions:get.active');
})();

// Open menus
(() => {
    let expeditionsTries = 0;
    const openExpeditionsInterval = setInterval(() => {
        const btn = document.querySelector('[data-component-name="TabBarItem-EXPEDITIONS"]');
        if (btn) {
            btn.click();
            clearInterval(openExpeditionsInterval);
        } else if (++expeditionsTries >= 60) {
            clearInterval(openExpeditionsInterval);
        }
    }, 1000);

    let networkMapTries = 0;
    const openNetworkMapInterval = setInterval(() => {
        const btn = document.querySelector('[data-component-name="TabBarItem-NETWORK_MAP"]');
        if (btn) {
            btn.click();
            clearInterval(openNetworkMapInterval);

            let marketTries = 0;
            const clickMarketInterval = setInterval(() => {
                const marketBtn = document.querySelector('button:has([data-sentry-component="MarketIcon"])');
                if (marketBtn) {
                    marketBtn.click();
                    clearInterval(clickMarketInterval);
                } else if (++marketTries >= 120) {
                    clearInterval(clickMarketInterval);
                }
            }, 500);
        } else if (++networkMapTries >= 60) {
            clearInterval(openNetworkMapInterval);
        }
    }, 1000);
})();

// Clear videos
(() => {
    const selectors = ['#app-background', '#glitch-background', '#video-glitch', '#video-waves'];

    setTimeout(() => {
        selectors.forEach((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.remove();
                console.log(`Removed element: ${sel}`);
            }
        });
    }, 500);
})();
