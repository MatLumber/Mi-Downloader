// GravityDown Companion — service worker
//
// Reads YouTube/Google cookies through chrome.cookies (which sidesteps Chrome 127+
// app-bound encryption entirely — the API returns plaintext values to the extension),
// then POSTs them to the local GravityDown backend at 127.0.0.1:8765.
//
// Triggers:
//   - On install / browser startup → sync once.
//   - On every YouTube tab that finishes loading → sync (debounced to once per 30s).
//   - Every 30 minutes via alarm → sync.
//   - From the popup "Sincronizar ahora" button → sync immediately.

// The engine binds the first free port from 8765 upward, so a fixed URL breaks
// whenever 8765 is already taken. We remember the last port that worked and
// only fall back to scanning the range when it stops answering.
const BASE_PORT = 8765;
const PORT_SCAN_RANGE = 24;
const PORT_CACHE_KEY = 'backendPort';

const syncUrl = (port) => `http://127.0.0.1:${port}/cookies/sync`;

async function isEngine(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            signal: AbortSignal.timeout(800),
        });
        if (!response.ok) return false;
        const body = await response.json();
        return body && body.name === 'GravityDown API';
    } catch {
        return false;
    }
}

async function resolveBackendPort() {
    const cached = (await chrome.storage.local.get(PORT_CACHE_KEY))[PORT_CACHE_KEY];
    if (Number.isInteger(cached) && (await isEngine(cached))) return cached;

    for (let offset = 0; offset < PORT_SCAN_RANGE; offset += 1) {
        const port = BASE_PORT + offset;
        if (port === cached) continue;
        if (await isEngine(port)) {
            await chrome.storage.local.set({ [PORT_CACHE_KEY]: port });
            return port;
        }
    }
    return null;
}

const SYNC_DOMAINS = ['.youtube.com', '.google.com'];
const ALARM_NAME = 'gravitydown-cookie-sync';
const ALARM_PERIOD_MIN = 30;
const TAB_DEBOUNCE_KEY = 'lastTabSync';
const TAB_DEBOUNCE_MS = 30 * 1000;

async function readAllCookies() {
    const collected = [];
    for (const domain of SYNC_DOMAINS) {
        try {
            const cookies = await chrome.cookies.getAll({ domain });
            collected.push(...cookies);
        } catch (err) {
            console.warn('[GravityDown] failed to read cookies for', domain, err);
        }
    }
    // Deduplicate by (domain, path, name) — chrome.cookies.getAll for ".youtube.com"
    // and ".google.com" can return overlapping entries.
    const seen = new Set();
    const unique = [];
    for (const c of collected) {
        const key = `${c.domain}|${c.path}|${c.name}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(c);
        }
    }
    return unique;
}

async function syncCookies() {
    const cookies = await readAllCookies();
    if (cookies.length === 0) {
        return { ok: false, reason: 'no_cookies' };
    }
    const port = await resolveBackendPort();
    if (port === null) {
        return { ok: false, reason: 'backend_unreachable', message: 'GravityDown no está abierto' };
    }

    let response;
    try {
        response = await fetch(syncUrl(port), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'extension',
                cookies: cookies.map((c) => ({
                    domain: c.domain,
                    name: c.name,
                    value: c.value,
                    path: c.path || '/',
                    // chrome.cookies returns expirationDate in seconds since epoch (float).
                    // 0 = session cookie (no persistence in Netscape format).
                    expires: c.expirationDate ? Math.floor(c.expirationDate) : 0,
                    secure: !!c.secure,
                    httpOnly: !!c.httpOnly,
                })),
            }),
        });
    } catch (err) {
        return { ok: false, reason: 'backend_unreachable', message: String(err) };
    }
    if (!response.ok) {
        return { ok: false, reason: 'backend_error', status: response.status };
    }
    const data = await response.json().catch(() => ({}));
    await chrome.storage.local.set({
        lastSync: Date.now(),
        lastCount: cookies.length,
        lastPath: data.path || null,
    });
    return { ok: true, count: cookies.length, data };
}

// --- Triggers ---

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
    syncCookies();
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
    syncCookies();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        syncCookies();
    }
});

// Sync on YouTube navigation. tabs.onUpdated fires multiple times per page load;
// we only act when status === 'complete' to avoid storms, and we debounce to one
// sync per 30 seconds globally.
chrome.tabs.onUpdated.addListener(async (_tabId, change, tab) => {
    if (change.status !== 'complete') return;
    if (!tab.url || !/^https:\/\/(www\.)?youtube\.com\//.test(tab.url)) return;
    const stored = await chrome.storage.local.get(TAB_DEBOUNCE_KEY);
    const last = stored[TAB_DEBOUNCE_KEY] || 0;
    if (Date.now() - last < TAB_DEBOUNCE_MS) return;
    await chrome.storage.local.set({ [TAB_DEBOUNCE_KEY]: Date.now() });
    syncCookies();
});

// Manual sync from the popup.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'sync-now') {
        syncCookies().then(sendResponse);
        return true; // tell Chrome the response is async
    }
    if (message && message.type === 'get-status') {
        chrome.storage.local
            .get(['lastSync', 'lastCount', 'lastPath'])
            .then(sendResponse);
        return true;
    }
});
