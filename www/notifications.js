import { LocalNotifications } from '@capacitor/local-notifications';

// Keep each notification category in its own ID range. Updating one category
// must never cancel the other categories.
const DAYS = { Su: 1, M: 2, T: 3, W: 4, Th: 5, F: 6, Sa: 7 };
const ROUTINE_MIN_ID = 100000000;
const ROUTINE_MAX_ID = 999999999;
const SESSION_ID = 1900000001;
const DAILY_TASK_ID = 1900000002;
const MIGRATION_KEY = 'lockedin_native_notifications_v2';

function routineId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ROUTINE_MIN_ID + (hash >>> 0) % (ROUTINE_MAX_ID - ROUTINE_MIN_ID + 1);
}

async function requestPermission() {
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== 'granted') return false;

  // Android 12+ needs the separate Alarms & reminders access for exact times.
  if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
    let exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted' &&
        localStorage.getItem('lockedin_exact_alarm_settings_opened') !== '1') {
      localStorage.setItem('lockedin_exact_alarm_settings_opened', '1');
      await LocalNotifications.changeExactNotificationSetting();
      exact = await LocalNotifications.checkExactNotificationSetting();
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
  // The previous scheduler used un-namespaced IDs. Clear this app's old
  // pending schedule once before introducing separate category IDs.
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
  for (const [slot, items] of Object.entries(routine || {})) {
    (items || []).forEach((item, index) => {
      const name = String(item?.name || '').trim();
      if (!name || !item.time) return;

      const [hour, minute] = String(item.time).split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) ||
          hour < 0 || hour > 23 || minute < 0 || minute > 59) return;

      const days = Array.isArray(item.days)
        ? item.days
        : ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

      days.forEach(day => {
        const weekday = DAYS[day];
        if (!weekday) return;
        notifications.push({
          id: routineId(`${slot}|${index}|${name}|${item.time}|${day}`),
          title: `Time for ${name}`,
          body: 'Your scheduled habit is waiting. Stay consistent and get it done.',
          schedule: {
            on: { weekday, hour, minute },
            allowWhileIdle: true
          }
        });
      });
    });
  }

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
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
      schedule: { at: new Date(deadline), allowWhileIdle: true }
    }]
  });
}

async function syncDailyTaskReminder(tasks) {
  await cancelIds([DAILY_TASK_ID]);
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0 || list.some(task => task.completed)) return;

  const now = new Date();
  const reminderTime = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 19, 30, 0, 0
  );
  if (reminderTime <= now) return;

  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_TASK_ID,
      title: "Your day isn't over yet.",
      body: "You haven't completed any of today's planned tasks. Take action before the day ends.",
      schedule: { at: reminderTime, allowWhileIdle: true }
    }]
  });
}

async function syncAll({ routine, sessionStartTimestamp, dailyTasks }) {
  const granted = await requestPermission();
  if (!granted) return false;

  await migrateLegacyScheduleOnce();
  await Promise.all([
    syncRoutine(routine),
    syncSession(sessionStartTimestamp),
    syncDailyTaskReminder(dailyTasks)
  ]);
  return true;
}

window.LockedInNotifications = { requestPermission, syncAll };
