(function () {
  'use strict';

  const plugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppBlocker;
  const byId = (id) => document.getElementById(id);
  let apps = [];
  let selected = new Set();
  let manualEnabled = false;
  let sessionActive = false;
  let accessibilityEnabled = false;
  let loading = false;
  let notice = '';

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function renderSummary() {
    const count = selected.size;
    const title = byId('blockedCount');
    const sub = byId('blockedChipsText');
    if (title) title.textContent = count ? `${count} Selected App${count === 1 ? '' : 's'}` : 'Blocked Apps';
    if (sub) sub.textContent = count ? `${count} app${count === 1 ? '' : 's'} selected` : 'No apps selected';
  }

  function render() {
    const screen = byId('appblocker');
    if (!screen) return;
    const query = (byId('appBlockerSearch')?.value || '').trim().toLowerCase();
    const filtered = apps.filter((app) => app.name.toLowerCase().includes(query) || app.packageName.toLowerCase().includes(query));
    const list = byId('appBlockerList');
    if (list) {
      if (loading && !apps.length) list.innerHTML = '<div class="muted" style="padding:20px;text-align:center;">Loading installed apps…</div>';
      else if (!filtered.length) list.innerHTML = `<div class="muted" style="padding:20px;text-align:center;">${apps.length ? 'No apps match your search.' : 'No launchable apps were found.'}</div>`;
      else list.innerHTML = filtered.map((app) => {
        const checked = selected.has(app.packageName);
        const icon = app.icon ? `<img alt="" src="data:image/png;base64,${app.icon}" style="width:38px;height:38px;border-radius:10px;object-fit:cover;flex:none;">` : '<div style="width:38px;height:38px;border-radius:10px;background:var(--card2);flex:none;"></div>';
        return `<div class="kw" style="gap:10px;padding:10px 12px;align-items:center;"><div style="display:flex;align-items:center;gap:11px;min-width:0;flex:1;">${icon}<div style="min-width:0;"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(app.name)}</div><div style="font-size:10px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(app.packageName)}</div></div></div><input type="checkbox" aria-label="Block ${escapeHtml(app.name)}" data-package="${escapeHtml(app.packageName)}" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--red);flex:none;"></div>`;
      }).join('');
    }
    const manual = byId('appBlockerManualToggle');
    if (manual) {
      manual.classList.toggle('on', manualEnabled);
      manual.setAttribute('aria-checked', manualEnabled ? 'true' : 'false');
    }
    const manualLabel = byId('appBlockerManualLabel');
    if (manualLabel) manualLabel.textContent = manualEnabled ? 'Manual blocking is ON' : 'Manual blocking is OFF';
    const service = byId('appBlockerServiceStatus');
    if (service) service.textContent = accessibilityEnabled ? 'Accessibility service is enabled.' : 'Enable the Locked In accessibility service to detect apps you open.';
    const session = byId('appBlockerSessionStatus');
    if (session) session.textContent = sessionActive ? 'Lock In session is active. Blocking is enabled.' : 'Lock In session is not active.';
    const message = byId('appBlockerNotice');
    if (message) message.textContent = notice || ((manualEnabled || sessionActive) && selected.size && !accessibilityEnabled ? 'Blocking is switched on, but Android Accessibility permission is not enabled yet.' : (selected.size ? `${selected.size} app${selected.size === 1 ? '' : 's'} selected.` : 'No apps selected. Choose apps below.'));
    renderSummary();
  }

  async function refreshStatus() {
    const p = plugin();
    if (!p || typeof p.getStatus !== 'function') {
      notice = 'App Blocker needs the updated Android APK.';
      render();
      return;
    }
    try {
      const status = await p.getStatus();
      selected = new Set(Array.isArray(status.blockedPackages) ? status.blockedPackages : []);
      manualEnabled = !!status.manualEnabled;
      sessionActive = !!status.sessionActive;
      accessibilityEnabled = !!status.accessibilityEnabled;
    } catch (error) {
      notice = error?.message || 'Could not read App Blocker status.';
    }
    render();
  }

  async function refreshApps() {
    const p = plugin();
    if (!p || typeof p.listApps !== 'function') {
      notice = 'Installed-app search needs the updated Android APK.';
      render();
      return;
    }
    loading = true;
    render();
    try {
      const result = await p.listApps();
      apps = Array.isArray(result.apps) ? result.apps : [];
      notice = '';
    } catch (error) {
      notice = error?.message || 'Could not load installed apps.';
    }
    loading = false;
    render();
  }

  async function saveSelection() {
    const p = plugin();
    if (!p) return;
    try {
      const result = await p.setBlockedApps({ packages: Array.from(selected) });
      selected = new Set(Array.isArray(result.blockedPackages) ? result.blockedPackages : Array.from(selected));
      notice = selected.size ? 'Your blocked-app list is saved.' : 'No apps selected.';
      render();
    } catch (error) {
      notice = error?.message || 'Could not save selected apps.';
      render();
    }
  }

  async function setManual(value) {
    const p = plugin();
    if (!p) return;
    try {
      const result = await p.setManualEnabled({ enabled: !!value });
      manualEnabled = !!result.manualEnabled;
      sessionActive = !!result.sessionActive;
      accessibilityEnabled = !!result.accessibilityEnabled;
      notice = manualEnabled ? 'Manual blocking enabled.' : 'Manual blocking disabled. Lock In sessions can still enable blocking.';
    } catch (error) { notice = error?.message || 'Could not change manual blocking.'; }
    render();
  }

  async function openAccessibilitySettings() {
    const p = plugin();
    if (!p) return;
    try { await p.openAccessibilitySettings(); }
    catch (error) { notice = error?.message || 'Could not open Accessibility settings.'; render(); }
  }

  function buildScreen() {
    const screen = byId('appblocker');
    if (!screen || screen.dataset.nativeBlockerReady === '1') return;
    screen.dataset.nativeBlockerReady = '1';
    screen.innerHTML = `
      <div class="backrow" onclick="showScreen('focus')">← Focus</div>
      <h1 class="title">App Blocker</h1>
      <div class="tracker-card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="min-width:0;"><div id="appBlockerManualLabel" style="font-weight:800;">Manual blocking is OFF</div><div class="muted" style="font-size:11px;margin-top:4px;">Works independently from Lock In sessions.</div></div>
          <button id="appBlockerManualToggle" class="toggle" role="switch" aria-checked="false" aria-label="Manual app blocking" style="border:0;" type="button"></button>
        </div>
        <div id="appBlockerSessionStatus" class="muted" style="font-size:11px;margin-top:10px;"></div>
      </div>
      <div class="tracker-card" style="margin-bottom:12px;">
        <div style="font-weight:800;margin-bottom:5px;">Required Android permission</div>
        <div id="appBlockerServiceStatus" class="muted" style="font-size:12px;line-height:1.5;margin-bottom:10px;"></div>
        <button class="btn-sm" style="width:100%;" id="appBlockerAccessibilityButton" type="button">Open Accessibility Settings</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0 8px;"><div style="font-weight:800;">Installed apps</div><button id="appBlockerRefresh" class="btn-sm" style="flex:none;" type="button">Refresh</button></div>
      <input id="appBlockerSearch" class="modal-input" placeholder="Search installed apps…" autocomplete="off" style="margin-bottom:8px;">
      <div id="appBlockerNotice" class="muted" style="font-size:11px;margin:8px 0 10px;"></div>
      <div id="appBlockerList"></div>
      <div class="muted" style="font-size:11px;line-height:1.5;margin:12px 2px 24px;">The list is read from Android each time you refresh, so newly installed launchable apps can appear here. Blocking uses Android Accessibility permission to detect the app currently opened.</div>`;
    byId('appBlockerManualToggle').addEventListener('click', () => setManual(!manualEnabled));
    byId('appBlockerAccessibilityButton').addEventListener('click', openAccessibilitySettings);
    byId('appBlockerRefresh').addEventListener('click', async () => { await refreshApps(); await refreshStatus(); });
    byId('appBlockerSearch').addEventListener('input', render);
    byId('appBlockerList').addEventListener('change', async (event) => {
      const input = event.target.closest('input[data-package]');
      if (!input) return;
      const packageName = input.getAttribute('data-package');
      if (input.checked) selected.add(packageName); else selected.delete(packageName);
      await saveSelection();
    });
  }

  function onScreenChange() {
    const screen = byId('appblocker');
    if (screen && screen.classList.contains('active')) {
      refreshStatus();
      refreshApps();
    }
  }

  function syncSessionFromSavedData() {
    try {
      const saved = JSON.parse(localStorage.getItem('lockedin_master_v6') || 'null');
      const active = !!(saved && saved.isLockedIn);
      plugin()?.setSessionActive?.({ active }).catch(() => {});
    } catch (_) { }
  }

  function wrapSessionFunctions() {
    const originalStart = window.startLockInSession;
    if (typeof originalStart === 'function' && !originalStart.__appBlockerWrapped) {
      const wrapped = function () {
        const result = originalStart.apply(this, arguments);
        plugin()?.setSessionActive?.({ active: true }).catch(() => {});
        sessionActive = true;
        render();
        return result;
      };
      wrapped.__appBlockerWrapped = true;
      window.startLockInSession = wrapped;
    }
    const originalStop = window.completeLockOffSession;
    if (typeof originalStop === 'function' && !originalStop.__appBlockerWrapped) {
      const wrapped = function () {
        const result = originalStop.apply(this, arguments);
        plugin()?.setSessionActive?.({ active: false }).catch(() => {});
        sessionActive = false;
        render();
        return result;
      };
      wrapped.__appBlockerWrapped = true;
      window.completeLockOffSession = wrapped;
    }
  }

  window.renderBlocker = function () { buildScreen(); refreshStatus(); render(); };
  window.renderBlockedSummary = renderSummary;
  window.LockedInAppBlocker = {
    refresh: async function () { buildScreen(); await refreshStatus(); await refreshApps(); },
    setSessionActive: async function (active) { const p = plugin(); if (p) { const result = await p.setSessionActive({ active: !!active }); sessionActive = !!result.sessionActive; render(); } }
  };

  buildScreen();
  wrapSessionFunctions();
  syncSessionFromSavedData();
  refreshStatus();
  renderSummary();

  const observer = new MutationObserver(onScreenChange);
  const screen = byId('appblocker');
  if (screen) observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
})();
