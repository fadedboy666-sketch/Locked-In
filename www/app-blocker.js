(function () {
  'use strict';

  const plugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppBlocker;
  const byId = (id) => document.getElementById(id);
  let apps = [];
  let selected = new Set();
  let draft = new Set();
  let manualEnabled = false;
  let sessionActive = false;
  let accessibilityEnabled = false;
  let loading = false;
  let busy = false;
  let notice = '';
  let initialized = false;
  let sessionStarting = false;
  const FILTER_OWNED_KEY = 'lockedin_session_started_internet_filter_v1';

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sameSet = (a, b) => a.size === b.size && Array.from(a).every((value) => b.has(value));

  function buildScreen() {
    const screen = byId('appblocker');
    if (!screen || initialized) return;
    initialized = true;
    screen.innerHTML = `
      <div class="backrow" onclick="showScreen('focus')">← Focus</div>
      <h1 class="title">App Blocker</h1>
      <div class="tracker-card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="min-width:0;"><div id="appBlockerStatusTitle" style="font-weight:800;">App Blocking is OFF</div><div id="appBlockerStatusSub" class="muted" style="font-size:11px;margin-top:4px;">Choose apps and turn blocking on.</div></div>
          <button id="appBlockerManualToggle" class="toggle" role="switch" aria-checked="false" aria-label="App Blocking" style="border:0;flex:none;" type="button"></button>
        </div>
      </div>
      <div class="tracker-card" style="margin-bottom:12px;">
        <div style="font-weight:800;margin-bottom:10px;">Selected Apps</div>
        <div id="appBlockerSelectedApps" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;max-height:160px;overflow:auto;"></div>
      </div>
      <div id="appBlockerPermissionWarning" class="tracker-card" style="display:none;margin-bottom:12px;border:1px solid var(--red);">
        <div style="font-weight:800;margin-bottom:5px;">Accessibility permission required</div>
        <div class="muted" style="font-size:12px;line-height:1.5;margin-bottom:10px;">Allow Locked In in Android Accessibility Settings so it can detect when a selected app opens.</div>
        <button id="appBlockerGoAccessibility" class="btn-sm" style="width:100%;" type="button">Go to Accessibility Settings</button>
      </div>
      <div style="font-weight:800;margin:16px 0 8px;">Choose Apps</div>
      <input id="appBlockerSearch" class="modal-input" placeholder="Search installed apps…" autocomplete="off" style="margin-bottom:8px;">
      <div id="appBlockerNotice" class="muted" style="font-size:11px;line-height:1.45;margin:6px 0 8px;"></div>
      <div id="appBlockerConfirmWrap" style="display:none;margin:8px 0 10px;"><button id="appBlockerConfirm" class="addbtn" style="margin:0;width:100%;" type="button">Confirm Selection</button></div>
      <div id="appBlockerList"></div>
      <div style="height:24px;"></div>`;

    byId('appBlockerManualToggle').addEventListener('click', () => setManual(!manualEnabled));
    byId('appBlockerGoAccessibility').addEventListener('click', openAccessibilitySettings);
    byId('appBlockerSearch').addEventListener('input', render);
    byId('appBlockerConfirm').addEventListener('click', confirmSelection);
    const toggleDraftRow = (row) => {
      if (!row) return;
      const packageName = row.dataset.package;
      if (sessionActive && draft.size === 1 && draft.has(packageName)) {
        notice = 'Keep at least one app selected during a Lock In session.';
        render();
        return;
      }
      if (draft.has(packageName)) draft.delete(packageName); else draft.add(packageName);
      notice = '';
      render();
    };
    byId('appBlockerList').addEventListener('click', (event) => toggleDraftRow(event.target.closest('[data-package]')));
    byId('appBlockerList').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-package]');
      if (!row) return;
      event.preventDefault();
      toggleDraftRow(row);
    });
  }

  function renderSummary() {
    const count = selected.size;
    const title = byId('blockedCount');
    const sub = byId('blockedChipsText');
    if (title) title.textContent = count ? `${count} Selected App${count === 1 ? '' : 's'}` : 'Blocked Apps';
    if (sub) sub.textContent = count ? `${count} app${count === 1 ? '' : 's'} selected` : 'No apps selected';
  }

  function renderSelectedApps() {
    const container = byId('appBlockerSelectedApps');
    if (!container) return;
    const selectedApps = apps.filter((app) => selected.has(app.packageName));
    if (!selectedApps.length) {
      container.style.display = 'block';
      container.innerHTML = '<div class="muted" style="font-size:12px;padding:8px 0;">No apps selected</div>';
      return;
    }
    container.style.display = 'grid';
    container.innerHTML = selectedApps.map((app) => {
      const icon = app.icon ? `<img alt="" src="data:image/png;base64,${app.icon}" style="width:42px;height:42px;border-radius:11px;object-fit:cover;">` : '<div style="width:42px;height:42px;border-radius:11px;background:var(--card2);"></div>';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;">${icon}<div style="font-size:10px;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(app.name)}</div></div>`;
    }).join('');
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
        const checked = draft.has(app.packageName);
        const icon = app.icon ? `<img alt="" src="data:image/png;base64,${app.icon}" style="width:38px;height:38px;border-radius:10px;object-fit:cover;flex:none;">` : '<div style="width:38px;height:38px;border-radius:10px;background:var(--card2);flex:none;"></div>';
        return `<div data-package="${escapeHtml(app.packageName)}" role="button" tabindex="0" style="display:flex;gap:10px;padding:10px 12px;align-items:center;border-bottom:1px solid var(--line);cursor:pointer;"><div style="display:flex;align-items:center;gap:11px;min-width:0;flex:1;">${icon}<div style="min-width:0;"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(app.name)}</div><div style="font-size:10px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(app.packageName)}</div></div></div><span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;border:2px solid ${checked ? 'var(--red)' : 'var(--line)'};background:${checked ? 'var(--red)' : 'transparent'};color:#fff;display:flex;align-items:center;justify-content:center;flex:none;font-size:14px;">${checked ? '✓' : ''}</span></div>`;
      }).join('');
    }

    const enabled = manualEnabled || sessionActive;
    const operational = enabled && accessibilityEnabled && selected.size > 0;
    const toggle = byId('appBlockerManualToggle');
    if (toggle) {
      toggle.classList.toggle('on', operational);
      toggle.setAttribute('aria-checked', operational ? 'true' : 'false');
      toggle.disabled = busy || sessionActive;
      toggle.style.opacity = sessionActive ? '0.65' : '1';
    }
    const title = byId('appBlockerStatusTitle');
    if (title) title.textContent = operational ? 'App Blocking is ON' : 'App Blocking is OFF';
    const sub = byId('appBlockerStatusSub');
    if (sub) sub.textContent = sessionActive
      ? (operational ? 'LOCK IN SESSION ACTIVE · You cannot turn this feature off while your Lock In session is active. Get back to work.' : 'LOCK IN SESSION ACTIVE · App Blocker needs Accessibility permission and at least one selected app.')
      : (!accessibilityEnabled ? 'Enable Accessibility permission to turn on blocking.' : (!selected.size ? 'No apps selected. Choose at least one app.' : (manualEnabled ? 'Blocking is enabled manually.' : 'Choose apps and turn blocking on.')));

    const warning = byId('appBlockerPermissionWarning');
    if (warning) warning.style.display = accessibilityEnabled ? 'none' : 'block';
    const confirmWrap = byId('appBlockerConfirmWrap');
    if (confirmWrap) confirmWrap.style.display = sameSet(selected, draft) ? 'none' : 'block';
    const message = byId('appBlockerNotice');
    if (message) message.textContent = notice || (selected.size ? `${selected.size} app${selected.size === 1 ? '' : 's'} selected.` : 'No apps selected. Select at least one app to enable blocking.');
    renderSelectedApps();
    renderSummary();
  }

  async function refreshStatus() {
    const p = plugin();
    if (!p || typeof p.getStatus !== 'function') {
      notice = 'App Blocker needs the updated Android APK.';
      render();
      return null;
    }
    try {
      const status = await p.getStatus();
      selected = new Set(Array.isArray(status.blockedPackages) ? status.blockedPackages : []);
      draft = new Set(selected);
      manualEnabled = !!status.manualEnabled;
      sessionActive = !!status.sessionActive;
      accessibilityEnabled = !!status.accessibilityEnabled;
      if (accessibilityEnabled && /Accessibility permission/i.test(notice)) notice = '';
      if (selected.size > 0 && /Select at least one app/i.test(notice)) notice = '';
      render();
      return status;
    } catch (error) {
      notice = error?.message || 'Could not read App Blocker status.';
      render();
      return null;
    }
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

  async function confirmSelection() {
    const p = plugin();
    if (!p || busy) return;
    if (sessionActive && draft.size === 0) {
      notice = 'Keep at least one app selected during a Lock In session.';
      render();
      return;
    }
    busy = true;
    render();
    try {
      const result = await p.setBlockedApps({ packages: Array.from(draft) });
      selected = new Set(Array.isArray(result.blockedPackages) ? result.blockedPackages : Array.from(draft));
      draft = new Set(selected);
      manualEnabled = !!result.manualEnabled;
      sessionActive = !!result.sessionActive;
      accessibilityEnabled = !!result.accessibilityEnabled;
      notice = selected.size ? 'Selected apps saved.' : 'No apps selected.';
    } catch (error) {
      draft = new Set(selected);
      notice = error?.message || 'Could not save selected apps.';
    }
    busy = false;
    render();
  }

  async function setManual(value) {
    const p = plugin();
    if (!p || busy || sessionActive) return;
    if (value && !selected.size) {
      notice = 'Select an app first to turn this on.';
      render();
      return;
    }
    if (value && !accessibilityEnabled) {
      notice = 'Enable Locked In Accessibility permission first.';
      render();
      await openAccessibilitySettings();
      return;
    }
    busy = true;
    render();
    try {
      const result = await p.setManualEnabled({ enabled: !!value });
      manualEnabled = !!result.manualEnabled;
      sessionActive = !!result.sessionActive;
      accessibilityEnabled = !!result.accessibilityEnabled;
      notice = manualEnabled ? 'App Blocking is ON.' : 'App Blocking is OFF.';
    } catch (error) {
      notice = error?.message || 'Could not change App Blocker.';
    }
    busy = false;
    render();
  }

  async function openAccessibilitySettings() {
    const p = plugin();
    if (!p) return;
    try { await p.openAccessibilitySettings(); }
    catch (error) {
      notice = error?.message || 'Could not open Accessibility Settings.';
      render();
    }
  }

  async function updateGoal() {
    const p = plugin();
    if (!p || typeof p.setBlockerConfig !== 'function') return;
    const goals = Array.isArray(state?.yearlyGoals) ? state.yearlyGoals : [];
    const goal = goals.find((item) => typeof item === 'string' && item.trim()) || '';
    try { await p.setBlockerConfig({ yearlyGoal: goal }); }
    catch (error) { console.warn('Could not sync yearly goal to App Blocker:', error); }
  }

  async function prepareSessionStart() {
    const status = await refreshStatus();
    if (!status) return { ok: false, message: 'App Blocker needs the updated Android APK.' };
    if (!status.accessibilityEnabled) {
      notice = 'Enable Accessibility permission before starting Lock In.';
      render();
      showScreen('appblocker');
      return { ok: false, message: 'Enable Locked In Accessibility permission first.' };
    }
    if (!Array.isArray(status.blockedPackages) || status.blockedPackages.length === 0) {
      notice = 'Select at least one app before starting Lock In.';
      render();
      showScreen('appblocker');
      return { ok: false, message: 'Select an app first to turn App Blocker on.' };
    }
    return { ok: true };
  }

  async function activateSession() {
    const p = plugin();
    if (!p) throw new Error('App Blocker needs the updated Android APK.');
    const result = await p.setSessionActive({ active: true });
    sessionActive = !!result.sessionActive;
    render();
  }

  async function deactivateSession() {
    const p = plugin();
    if (!p) return;
    try {
      const result = await p.setSessionActive({ active: false });
      sessionActive = !!result.sessionActive;
      manualEnabled = !!result.manualEnabled;
      render();
    } catch (error) {
      console.error('Could not end App Blocker session state:', error);
    }
  }

  async function enableInternetFilterForSession() {
    const filter = window.Capacitor?.Plugins?.InternetFilter;
    if (!filter || typeof filter.status !== 'function') throw new Error('Internet Filter needs the updated Android APK.');
    const status = await filter.status();
    if (status.enabled) {
      localStorage.setItem(FILTER_OWNED_KEY, '0');
      return false;
    }
    localStorage.setItem(FILTER_OWNED_KEY, '1');
    try {
      await filter.start();
      return true;
    } catch (error) {
      localStorage.removeItem(FILTER_OWNED_KEY);
      throw error;
    }
  }

  async function restoreInternetFilterAfterSession() {
    const owned = localStorage.getItem(FILTER_OWNED_KEY) === '1';
    localStorage.removeItem(FILTER_OWNED_KEY);
    if (!owned) return;
    const filter = window.Capacitor?.Plugins?.InternetFilter;
    if (!filter || typeof filter.stop !== 'function') return;
    try { await filter.stop(); }
    catch (error) { console.error('Could not turn off session-started Internet Filter:', error); }
  }

  function wrapSessionFunctions() {
    const originalStart = window.startLockInSession;
    if (typeof originalStart === 'function' && !originalStart.__appBlockerWrapped) {
      const wrapped = async function () {
        if (sessionStarting || state.isLockedIn) return;
        sessionStarting = true;
        try {
          const check = await prepareSessionStart();
          if (!check.ok) {
            showPlainToast(check.message, true, 4500);
            return;
          }
          internetFilterBusy = true;
          if (typeof renderInternetFilterCard === 'function') renderInternetFilterCard();
          await updateGoal();
          await enableInternetFilterForSession();
          await activateSession();
          originalStart.apply(this, arguments);
          await refreshStatus();
          if (typeof refreshInternetFilterStatus === 'function') await refreshInternetFilterStatus();
        } catch (error) {
          await deactivateSession();
          await restoreInternetFilterAfterSession();
          showPlainToast(error?.message || 'Could not activate Lock In protections.', true, 5000);
        } finally {
          internetFilterBusy = false;
          if (typeof renderInternetFilterCard === 'function') renderInternetFilterCard();
          sessionStarting = false;
        }
      };
      wrapped.__appBlockerWrapped = true;
      window.startLockInSession = wrapped;
    }

    const originalStop = window.completeLockOffSession;
    if (typeof originalStop === 'function' && !originalStop.__appBlockerWrapped) {
      const wrapped = function () {
        if (!state.isLockedIn) return;
        internetFilterBusy = true;
        if (typeof renderInternetFilterCard === 'function') renderInternetFilterCard();
        const result = originalStop.apply(this, arguments);
        deactivateSession();
        restoreInternetFilterAfterSession().then(() => {
          if (typeof refreshInternetFilterStatus === 'function') refreshInternetFilterStatus();
        }).finally(() => {
          internetFilterBusy = false;
          if (typeof renderInternetFilterCard === 'function') renderInternetFilterCard();
        });
        return result;
      };
      wrapped.__appBlockerWrapped = true;
      window.completeLockOffSession = wrapped;
    }
  }

  async function syncActiveSession() {
    await updateGoal();
    if (!state?.isLockedIn) return;
    try {
      const status = await refreshStatus();
      if (status && status.accessibilityEnabled && status.blockedPackages?.length) await activateSession();
      if (localStorage.getItem(FILTER_OWNED_KEY) === '1') {
        const filter = window.Capacitor?.Plugins?.InternetFilter;
        const current = await filter?.status?.();
        if (filter && current && !current.enabled) await filter.start();
      }
    } catch (error) {
      console.warn('Could not restore Lock In protection state:', error);
    }
  }

  function onScreenChange() {
    const screen = byId('appblocker');
    if (screen && screen.classList.contains('active')) {
      refreshStatus();
      refreshApps();
      updateGoal();
    }
  }

  window.openAppBlockerAccessibilitySettings = openAccessibilitySettings;
  window.renderBlockedSummary = renderSummary;
  window.renderBlocker = function () { buildScreen(); refreshStatus(); render(); };
  window.LockedInAppBlocker = {
    refresh: async function () { buildScreen(); await refreshStatus(); await refreshApps(); },
    prepareSessionStart,
    activateSession,
    deactivateSession,
    syncActiveSession,
    updateGoal
  };

  buildScreen();
  wrapSessionFunctions();
  refreshStatus();
  refreshApps();
  syncActiveSession();
  const observer = new MutationObserver(onScreenChange);
  const screen = byId('appblocker');
  if (screen) observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshStatus();
      updateGoal();
    }
  });
})();
