import { LocalNotifications } from '@capacitor/local-notifications';

const DAYS = { Su: 1, M: 2, T: 3, W: 4, Th: 5, F: 6, Sa: 7 };
const ROUTINE_MIN_ID = 100000000;
const ROUTINE_MAX_ID = 999999999;
const SESSION_ID = 1900000001;
const DAILY_TASK_ID = 1900000002;
const BRAND_LARGE_ICON = 'ic_large_locked_in';
const MIGRATION_KEY = 'lockedin_native_notifications_v2';
const DIAG_TEST_ID = 1999999999;

function routineId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ROUTINE_MIN_ID + (hash >>> 0) % (ROUTINE_MAX_ID - ROUTINE_MIN_ID + 1);
}

function nextLocalOccurrence(weekday, hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  const targetDay = weekday - 1;
  let daysAhead = (targetDay - now.getDay() + 7) % 7;
  if (daysAhead === 0 && next <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

async function requestPermission() {
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== 'granted') {
    console.warn('[LockedIn] Notification display permission is not granted:', permission);
    return false;
  }

  if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
    let exact = await LocalNotifications.checkExactNotificationSetting();
    console.info('[LockedIn] Exact alarm permission:', exact.exact_alarm);
    if (exact.exact_alarm !== 'granted' &&
        localStorage.getItem('lockedin_exact_alarm_settings_opened') !== '1') {
      localStorage.setItem('lockedin_exact_alarm_settings_opened', '1');
      await LocalNotifications.changeExactNotificationSetting();
      exact = await LocalNotifications.checkExactNotificationSetting();
      console.info('[LockedIn] Exact alarm permission after settings:', exact.exact_alarm);
    }
    if (exact.exact_alarm !== 'granted') return false;
  }
  return true;
}

async function cancelIds(ids) {
  if (!ids.length) return;
  await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
}

async function migrateLegacyScheduleOnce() {
  if (localStorage.getItem(MIGRATION_KEY) === 'done') return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map(n => ({ id: n.id }))
    });
  }
  localStorage.setItem(MIGRATION_KEY, 'done');
}

async function syncRoutine(routine) {
  const pending = await LocalNotifications.getPending();
  const oldRoutineIds = pending.notifications
    .map(n => n.id)
    .filter(id => id >= ROUTINE_MIN_ID && id <= ROUTINE_MAX_ID);
  await cancelIds(oldRoutineIds);

  const notifications = [];
  const debugTargets = [];
  for (const [slot, items] of Object.entries(routine || {})) {
    (items || []).forEach((item, index) => {
      const name = String(item?.name || '').trim();
      if (!name || !item.time) {
        console.warn('[LockedIn] Skipping habit with missing name/time:', { slot, index, item });
        return;
      }

      const [hour, minute] = String(item.time).split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) ||
          hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn('[LockedIn] Skipping habit with invalid time:', { slot, index, name, time: item.time });
        return;
      }

      const days = Array.isArray(item.days)
        ? item.days
        : ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

      days.forEach(day => {
        const weekday = DAYS[day];
        if (!weekday) {
          console.warn('[LockedIn] Skipping unknown weekday:', { name, day });
          return;
        }
        const nextFireAt = nextLocalOccurrence(weekday, hour, minute);
        debugTargets.push({ name, day, selectedTime: item.time, nextFireAt: nextFireAt.toString() });
        notifications.push({
          id: routineId(`${slot}|${index}|${name}|${item.time}|${day}`),
          title: `Time for ${name}`,
          body: 'Your scheduled habit is waiting. Stay consistent and get it done.',
          largeIcon: BRAND_LARGE_ICON,
          schedule: {
            on: { weekday, hour, minute, second: 0 },
            allowWhileIdle: true
          }
        });
      });
    });
  }

  console.info('[LockedIn] Routine reminder targets:', debugTargets);
  if (notifications.length) {
    const result = await LocalNotifications.schedule({ notifications });
    console.info('[LockedIn] Routine reminders accepted by plugin:', result.notifications.length);
    const after = await LocalNotifications.getPending();
    const pendingRoutine = after.notifications.filter(n => n.id >= ROUTINE_MIN_ID && n.id <= ROUTINE_MAX_ID);
    console.info('[LockedIn] Pending routine reminders after sync:', pendingRoutine.length, pendingRoutine);
  } else {
    console.info('[LockedIn] No valid routine reminders to schedule.');
  }
}

async function syncSession(sessionStartTimestamp) {
  await cancelIds([SESSION_ID]);
  if (!sessionStartTimestamp) return;

  const deadline = Number(sessionStartTimestamp) + 12 * 60 * 60 * 1000;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return;

  await LocalNotifications.schedule({
    notifications: [{
      id: SESSION_ID,
      title: '12 HOURS. COMMITMENT RECOGNIZED.',
      body: "Exceptional dedication! You've completed the maximum 12-hour session. Your Locked In session has been automatically locked off.",
      largeIcon: BRAND_LARGE_ICON,
      schedule: { at: new Date(deadline), allowWhileIdle: true }
    }]
  });
}

async function syncDailyTaskReminder(tasks) {
  await cancelIds([DAILY_TASK_ID]);
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0 || list.some(task => task.completed)) return;

  const now = new Date();
  const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30, 0, 0);
  if (reminderTime <= now) return;

  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_TASK_ID,
      title: "Your day isn't over yet.",
      body: "You haven't completed any of today's planned tasks. Take action before the day ends.",
      largeIcon: BRAND_LARGE_ICON,
      schedule: { at: reminderTime, allowWhileIdle: true }
    }]
  });
}

async function syncAll({ routine, sessionStartTimestamp, dailyTasks }) {
  try {
    const granted = await requestPermission();
    if (!granted) return false;

    await migrateLegacyScheduleOnce();
    await Promise.all([
      syncRoutine(routine),
      syncSession(sessionStartTimestamp),
      syncDailyTaskReminder(dailyTasks)
    ]);
    return true;
  } catch (error) {
    console.error('[LockedIn] Notification sync failed:', error);
    throw error;
  }
}

function addDiagnosticsUI() {
  if (!document.body || document.getElementById('li-notif-diagnostics-launcher')) return;

  const style = document.createElement('style');
  style.textContent = `
    #li-notif-diagnostics-launcher{position:fixed;right:14px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:9998;width:46px;height:46px;border:1px solid #444;background:#202127;color:#fff;border-radius:50%;font-size:20px;box-shadow:0 4px 16px #0008}
    #li-notif-diagnostics{display:none;position:fixed;inset:0;z-index:9999;background:#000b;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif}
    #li-notif-diagnostics .li-diag-card{width:100%;max-width:390px;max-height:82vh;overflow:auto;background:#15161c;border:1px solid #383943;border-radius:16px;padding:18px;color:#f2f2f5}
    #li-notif-diagnostics h2{font-size:18px;margin:0 0 12px}
    #li-notif-diagnostics p{font-size:13px;color:#c3c4cc;line-height:1.45}
    #li-notif-diagnostics pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b0c10;border:1px solid #30313a;border-radius:10px;padding:10px;font-size:11px;color:#ddd;max-height:34vh;overflow:auto}
    #li-notif-diagnostics button{border:0;border-radius:10px;padding:12px;background:#e3364c;color:white;font-weight:700;margin:5px 4px 0 0}
    #li-notif-diagnostics button.secondary{background:#30313a;color:#fff}
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.id = 'li-notif-diagnostics-launcher';
  launcher.type = 'button';
  launcher.textContent = '🔔';
  launcher.title = 'Notification diagnostics';
  launcher.addEventListener('click', () => {
    document.getElementById('li-notif-diagnostics').style.display = 'flex';
    refreshDiagnostics();
  });

  const panel = document.createElement('div');
  panel.id = 'li-notif-diagnostics';
  panel.innerHTML = `
    <div class="li-diag-card">
      <h2>Notification Diagnostics</h2>
      <p>Check whether Android has your reminders registered. The test sends one notification in about 10 seconds.</p>
      <pre id="li-notif-diagnostics-output">Loading status…</pre>
      <button id="li-notif-test" type="button">Send test notification</button>
      <button id="li-notif-refresh" class="secondary" type="button">Refresh status</button>
      <button id="li-notif-close" class="secondary" type="button">Close</button>
    </div>`;
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  document.getElementById('li-notif-close').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  document.getElementById('li-notif-refresh').addEventListener('click', refreshDiagnostics);
  document.getElementById('li-notif-test').addEventListener('click', sendDiagnosticTest);
}

async function refreshDiagnostics() {
  const output = document.getElementById('li-notif-diagnostics-output');
  if (!output) return;
  output.textContent = 'Checking permissions and pending reminders…';
  const lines = [`Checked: ${new Date().toLocaleString()}`];

  try {
    const permission = await LocalNotifications.checkPermissions();
    lines.push(`Notification permission: ${permission.display}`);
  } catch (error) {
    lines.push(`Notification permission check ERROR: ${error?.message || error}`);
  }

  try {
    if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      lines.push(`Exact alarm access: ${exact.exact_alarm}`);
    } else {
      lines.push('Exact alarm check: plugin method unavailable');
    }
  } catch (error) {
    lines.push(`Exact alarm check ERROR: ${error?.message || error}`);
  }

  try {
    const result = await LocalNotifications.getPending();
    const pending = result.notifications || [];
    const routine = pending.filter(n => n.id >= ROUTINE_MIN_ID && n.id <= ROUTINE_MAX_ID);
    lines.push(`Total pending: ${pending.length}`);
    lines.push(`Pending routine reminders: ${routine.length}`);
    lines.push('Pending reminder details:');
    if (!pending.length) lines.push('(none)');
    pending.forEach(n => {
      lines.push(`• ID ${n.id} | ${n.title || '(no title)'} | ${JSON.stringify(n.schedule || {})}`);
    });
  } catch (error) {
    lines.push(`Pending reminder check ERROR: ${error?.message || error}`);
  }

  output.textContent = lines.join('\n');
}

async function sendDiagnosticTest() {
  const output = document.getElementById('li-notif-diagnostics-output');
  const button = document.getElementById('li-notif-test');
  button.disabled = true;
  button.textContent = 'Scheduling test…';
  try {
    await cancelIds([DIAG_TEST_ID]);
    await LocalNotifications.schedule({
      notifications: [{
        id: DIAG_TEST_ID,
        title: 'Locked In test notification',
        body: 'If you can see this, Android delivered a local notification.',
        largeIcon: BRAND_LARGE_ICON,
        schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true }
      }]
    });
    if (output) output.textContent = `Test notification scheduled at ${new Date(Date.now() + 10000).toLocaleTimeString()}.\nWait 15 seconds. Then refresh status if it does not appear.`;
  } catch (error) {
    if (output) output.textContent = `TEST SCHEDULING FAILED:\n${error?.message || error}\n${JSON.stringify(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Send test notification';
  }
}

window.LockedInNotifications = { requestPermission, syncAll, refreshDiagnostics };
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addDiagnosticsUI, { once: true });
} else {
  addDiagnosticsUI();
}
