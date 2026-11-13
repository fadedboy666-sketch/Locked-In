(function () {
  'use strict';
  const plugin = () => window.Capacitor?.Plugins?.AppBlocker;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function appState() { return typeof state !== 'undefined' ? state : null; }
  function habits() { const s=appState(); return Array.isArray(s?.trackerHabits) ? s.trackerHabits : []; }
  function render() {
    const host = document.getElementById('homeWidgetSettings');
    if (!host) return;
    const list = habits();
    const chosen = localStorage.getItem('lockedin_widget_habit_name_v1') || '';
    host.innerHTML = '<div style="font-weight:800;margin-bottom:8px;">Home-screen widgets</div>' +
      '<div class="muted" style="font-size:12px;line-height:1.5;margin-bottom:12px;">Add optional widgets to your Android home screen. Your streak and habit data stay connected to the app.</div>' +
      '<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:8px;">' +
      '<div style="font-weight:700;margin-bottom:8px;">Streak widget</div><div class="muted" style="font-size:11px;margin-bottom:9px;">Your live streak, with the crimson growth arrow.</div>' +
      '<button class="btn-sm" id="addStreakHomeWidget" type="button" style="width:100%;">Add streak widget</button></div>' +
      '<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px;">' +
      '<div style="font-weight:700;margin-bottom:8px;">30-day habit widget</div>' +
      (list.length ? '<select id="homeWidgetHabitSelect" class="modal-input" style="width:100%;margin:0 0 9px;">' + list.map(h => '<option value="' + esc(h.name) + '"' + (h.name === chosen ? ' selected' : '') + '>' + esc(h.name) + '</option>').join('') + '</select><button class="btn-sm" id="addHabitHomeWidget" type="button" style="width:100%;">Add selected habit widget</button>' :
      '<div class="muted" style="font-size:12px;">Create a habit in your 30-day tracker first.</div>') +
      '</div><div id="homeWidgetNotice" class="muted" style="font-size:11px;margin-top:10px;line-height:1.45;"></div>';
    document.getElementById('addStreakHomeWidget')?.addEventListener('click', addStreak);
    document.getElementById('addHabitHomeWidget')?.addEventListener('click', addHabit);
  }
  async function addStreak() {
    const p=plugin(), note=document.getElementById('homeWidgetNotice');
    if (!p?.requestStreakWidget) { if(note) note.textContent='Build and install the updated Android APK to add widgets.'; return; }
    try { const r=await p.requestStreakWidget(); if(note) note.textContent=r?.pinned?'Widget request sent. Choose Locked In in your home-screen widget picker.':'Your launcher did not accept the widget request.'; }
    catch(e){if(note)note.textContent=e?.message||'Could not request the streak widget.';}
  }
  async function addHabit() {
    const p=plugin(), select=document.getElementById('homeWidgetHabitSelect'), note=document.getElementById('homeWidgetNotice');
    if (!p?.requestHabitWidget || !select) { if(note)note.textContent='Build and install the updated Android APK to add widgets.'; return; }
    const name=select.value; localStorage.setItem('lockedin_widget_habit_name_v1',name);
    try { await sync(); const r=await p.requestHabitWidget({habitName:name}); if(note)note.textContent=r?.pinned?'Widget request sent. Choose Locked In in your home-screen widget picker.':'Your launcher did not accept the widget request.'; }
    catch(e){if(note)note.textContent=e?.message||'Could not request the habit widget.';}
  }
  async function sync() {
    const p=plugin(), s=appState(); if(!p?.syncHomeWidgets || !s) return;
    try {
      const selected=localStorage.getItem('lockedin_widget_habit_name_v1')||'';
      const safeHabits=habits().map(h=>({name:String(h.name||''),icon:String(h.icon||''),metric:String(h.metric||''),days:Array.isArray(h.days)?h.days.slice(0,30):[],createdOn:String(h.createdOn||''),firstUseDate:String(s.firstUseDate||'')}));
      await p.syncHomeWidgets({streak:Number(s.streak)||0,streakStartMs:s.streakStart instanceof Date?s.streakStart.getTime():0,lapsed:!!s.lapsed,habits:safeHabits,selectedHabitName:selected});
    } catch(e) { console.warn('Home widget sync failed:',e); }
  }
  async function applyPending() {
    const p=plugin(); if(!p?.getPendingWidgetChanges || !appState() || typeof window.cycleTrackerDayCell!=='function') return;
    try {
      const result=await p.getPendingWidgetChanges();
      const changes=Array.isArray(result?.changes)?result.changes:[];
      for(const change of changes) {
        const idx=habits().findIndex(h=>String(h.name||'')===String(change.habitName||''));
        if(idx>=0 && Number.isInteger(change.dayIndex) && change.dayIndex>=0 && change.dayIndex<30) window.cycleTrackerDayCell(idx,change.dayIndex);
      }
      if(changes.length) await sync();
    } catch(e) { console.warn('Could not apply home widget changes:',e); }
  }
  window.renderHomeWidgetSettings=render;
  window.LockedInHomeWidgets={sync,applyPending,render};
  document.addEventListener('DOMContentLoaded',()=>{render();sync();applyPending();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){sync();applyPending();}});
  window.addEventListener('focus',()=>{sync();applyPending();});
  setInterval(()=>{if(document.visibilityState==='visible')applyPending();},2500);
})();