const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const btn = document.getElementById('sync');

function fmtAgo(ms) {
    const sec = Math.round((Date.now() - ms) / 1000);
    if (sec < 60) return `hace ${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `hace ${min} min`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `hace ${hr}h`;
    return `hace ${Math.round(hr / 24)}d`;
}

async function loadStatus() {
    const { lastSync, lastCount } = await chrome.storage.local.get([
        'lastSync',
        'lastCount',
    ]);
    if (lastSync) {
        statusEl.innerHTML = `<strong>Última sync:</strong> ${fmtAgo(lastSync)}<br>${lastCount || '?'} cookies enviadas a la app.`;
    } else {
        statusEl.textContent = 'Aún no se ha sincronizado. Asegúrate de que la app GravityDown esté abierta y pulsa el botón.';
    }
}

btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Sincronizando…';
    resultEl.textContent = '';
    resultEl.className = 'result';

    let res;
    try {
        res = await chrome.runtime.sendMessage({ type: 'sync-now' });
    } catch (err) {
        res = { ok: false, reason: 'service_worker_error', message: String(err) };
    }

    if (res && res.ok) {
        resultEl.className = 'result ok';
        resultEl.textContent = `✓ ${res.count} cookies sincronizadas.`;
    } else {
        resultEl.className = 'result err';
        const reason = res?.reason || 'unknown';
        const map = {
            no_cookies: 'No se encontraron cookies de YouTube. Inicia sesión en youtube.com primero.',
            backend_unreachable: 'No se pudo conectar con la app. ¿Está GravityDown abierta?',
            backend_error: `La app respondió con error (HTTP ${res?.status || '?'}).`,
            service_worker_error: 'Error interno de la extensión.',
        };
        resultEl.textContent = `✗ ${map[reason] || reason}`;
    }

    btn.disabled = false;
    btn.textContent = 'Sincronizar ahora';
    await loadStatus();
});

loadStatus();
