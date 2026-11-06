import { LocalNotifications } from '@capacitor/local-notifications';

const DAYS = { Su: 1, M: 2, T: 3, W: 4, Th: 5, F: 6, Sa: 7 };
const ALL_DAYS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
const ROUTINE_MIN_ID = 100000000;
const ROUTINE_MAX_ID = 999999999;
const SESSION_ID = 1900000001;
const DAILY_TASK_ID = 1900000002;
const BRAND_LARGE_ICON = 'ic_large_locked_in';
const BRAND_SMALL_ICON = 'ic_stat_locked_in';
const BRAND_ICON_COLOR = '#292929';
const WINDOW_DAYS = 14;
const MAX_ROUTINE_ALARMS = 400;
const CHUNK_SIZE = 50;
const ALLOW_IDLE_ROUTINE = true;
const ALLOW_IDLE_OTHER = true;

let syncQueue = Promise.resolve();

function hashToId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ROUTINE_MIN_ID + ((hash >>> 0) % (ROUTINE_MAX_ID - ROUTINE_MIN_ID + 1));
}

function makeIdAllocator() {
  const used = new Set();
  return function allocate(value) {
    const range = ROUTINE_MAX_ID - ROUTINE_MIN_ID + 1;
    let id = hashToId(value);
    for (let i = 0; i < range; i++) {
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      id = id >= ROUTINE_MAX_ID ? ROUTINE_MIN_ID : id + 1;
    }
    throw new Error('No notification IDs remain in the routine range.');
  };
}

function validTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localDateAtOffset(offset, hour, minute) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function selectedDays(item) {
  if (!Array.isArray(item.days)) return ALL_DAYS;
  return item.days.filter(day => Object.prototype.hasOwnProperty.call(DAYS, day));
}

async function requestPermission() {
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== 'granted') {
    console.warn('[LockedIn] Notification permission is not granted:', permission.display);
    return false;
  }

  if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
    let exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted') {
      const key = 'lockedin_exact_alarm_settings_opened_v2';
      if (localStorage.getItem(key) !== '1') {
        localStorage.setItem(key, '1');
        await LocalNotifications.changeExactNotificationSetting();
        exact = await LocalNotifications.checkExactNotificationSetting();
      }
    }
    if (exact.exact_alarm !== 'granted') {
  console.warn('[LockedIn] Exact alarm permission is not granted. Android may use inexact alarms.');
    }
  }
  return true;
}

async function cancelIds(ids) {
  const unique = [...new Set(ids)].filter(Number.isInteger);
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    await LocalNotifications.cancel({
      notifications: unique.slice(i, i + CHUNK_SIZE).map(id => ({ id }))
    });
  }
}

async function cancelManagedNotifications() {
  const result = await LocalNotifications.getPending();
  const ids = (result.notifications || [])
    .map(notification => notification.id)
    .filter(id =>
      (id >= ROUTINE_MIN_ID && id <= ROUTINE_MAX_ID) ||
      id === SESSION_ID ||
      id === DAILY_TASK_ID
    );
  await cancelIds(ids);
}

function notificationCopyForHabit(item, name) {
  const generic = {
    title: 'Habit reminder',
    body: "Stay consistent. It's time to complete your habit."
  };

  // User-created habits always keep the neutral custom-habit reminder.
  if (item?.isCustom) return generic;

  const presetId = String(item?.presetId || '').trim().toLowerCase();
  const presetMessages = {
    workout: { title: 'Workout time 💪', body: 'Time to get your workout done.' },
    run: { title: 'Time to run 🏃', body: 'Get moving and enjoy your run.' },
    walk: { title: 'Take a walk 🚶', body: 'Step away and get some fresh air.' },
    water: { title: 'Drink some water 💧', body: 'Take a moment to hydrate.' },
    study: { title: 'Focus time 📚', body: 'Put distractions aside and study.' },
    pray: { title: 'Time for prayer 🙏', body: 'Take a moment to pray.' }
  };

  if (presetMessages[presetId]) return presetMessages[presetId];

  // Name fallback supports older saved built-in habits without presetId.
  const normalizedName = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const nameAliases = {
    workout: 'workout',
    run: 'run',
    running: 'run',
    walk: 'walk',
    walking: 'walk',
    'drink water': 'water',
    water: 'water',
    study: 'study',
    pray: 'pray',
    prayer: 'pray'
  };
  const fallbackId = nameAliases[normalizedName];
  return fallbackId && presetMessages[fallbackId]
    ? presetMessages[fallbackId]
    : generic;
}

function buildRoutineNotifications(routine, routineLog = {}) {
  const allocateId = makeIdAllocator();
  const now = Date.now();
  const notifications = [];

  for (const [slot, items] of Object.entries(routine || {})) {
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const name = String(item?.name || '').trim();
      const time = String(item?.time || '');
      if (!name || !validTime(time)) {
        if (name || time) console.warn('[LockedIn] Skipping invalid habit reminder:', { slot, index, name, time });
        return;
      }

      const days = selectedDays(item);
      if (!days.length) return;
      const [hour, minute] = time.split(':').map(Number);

      for (let offset = 0; offset < WINDOW_DAYS; offset++) {
        const fireAt = localDateAtOffset(offset, hour, minute);
        if (fireAt.getTime() <= now + 1000) continue;
        const dayCode = ALL_DAYS[(fireAt.getDay() + 6) % 7];
        if (!days.includes(dayCode)) continue;

        const dateKey = [fireAt.getFullYear(), String(fireAt.getMonth() + 1).padStart(2, '0'), String(fireAt.getDate()).padStart(2, '0')].join('-');
        const completionKey = slot + '|' + name.toLowerCase();
        if (routineLog[dateKey] && routineLog[dateKey][completionKey] === 1) continue;

        const identity = [slot, index, name, time, fireAt.getFullYear(), fireAt.getMonth(), fireAt.getDate()].join('|');
        const copy = notificationCopyForHabit(item, name);
        notifications.push({
          id: allocateId(identity),
          title: copy.title,
          body: copy.body,
          smallIcon: BRAND_SMALL_ICON,
          iconColor: BRAND_ICON_COLOR,
          largeIcon: BRAND_LARGE_ICON,
          schedule: { at: fireAt, allowWhileIdle: ALLOW_IDLE_ROUTINE }
        });
      }
    });
  }

  notifications.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());
  if (notifications.length > MAX_ROUTINE_ALARMS) {
    console.warn('[LockedIn] Routine reminders exceed the safe alarm limit. Only the first', MAX_ROUTINE_ALARMS, 'will be scheduled.');
    notifications.length = MAX_ROUTINE_ALARMS;
  }
  return notifications;
}

async function scheduleInChunks(notifications) {
  for (let i = 0; i < notifications.length; i += CHUNK_SIZE) {
    await LocalNotifications.schedule({ notifications: notifications.slice(i, i + CHUNK_SIZE) });
  }
}

async function syncRoutine(routine, routineLog) {
  const notifications = buildRoutineNotifications(routine, routineLog);
  await scheduleInChunks(notifications);
  console.info('[LockedIn] Routine reminders scheduled:', notifications.length);
}

async function syncSession(sessionStartTimestamp) {
  if (!sessionStartTimestamp) return;
  const deadline = Number(sessionStartTimestamp) + 12 * 60 * 60 * 1000;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return;

  await LocalNotifications.schedule({
    notifications: [{
      id: SESSION_ID,
      title: 'Your 12-hour session limit has been reached',
      body: 'Open Locked In to end your session and take a break.',
      smallIcon: BRAND_SMALL_ICON,
          iconColor: BRAND_ICON_COLOR,
          largeIcon: BRAND_LARGE_ICON,
      schedule: { at: new Date(deadline), allowWhileIdle: ALLOW_IDLE_OTHER }
    }]
  });
}

async function syncDailyTaskReminder(tasks) {
  const pendingTasks = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task && !task.completed && String(task.text || '').trim());
  if (!pendingTasks.length) return;

  const now = new Date();
  const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30, 0, 0);
  if (reminderTime.getTime() <= Date.now()) return;

  const taskNames = pendingTasks.slice(0, 5).map(task => String(task.text).trim());
  const more = pendingTasks.length > taskNames.length ? ' and more' : '';
  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_TASK_ID,
      title: 'Your day is not over yet',
      body: pendingTasks.length + ' unfinished task' + (pendingTasks.length === 1 ? '' : 's') + ' waiting. Open Locked In to review them.',
      smallIcon: BRAND_SMALL_ICON,
          iconColor: BRAND_ICON_COLOR,
          largeIcon: BRAND_LARGE_ICON,
      largeBody: taskNames.join('\n') + more,
      schedule: { at: reminderTime, allowWhileIdle: ALLOW_IDLE_OTHER }
    }]
  });
}

async function syncAllNow({ routine, routineLog, sessionStartTimestamp, dailyTasks } = {}) {
  try {
    const granted = await requestPermission();
    if (!granted) return false;

    await cancelManagedNotifications();
    await Promise.all([
      syncRoutine(routine || {}, routineLog || {}),
      syncSession(sessionStartTimestamp),
      syncDailyTaskReminder(dailyTasks)
    ]);

    const pending = await LocalNotifications.getPending();
    const managedCount = (pending.notifications || []).filter(n =>
      (n.id >= ROUTINE_MIN_ID && n.id <= ROUTINE_MAX_ID) ||
      n.id === SESSION_ID || n.id === DAILY_TASK_ID
    ).length;
    console.info('[LockedIn] Notification sync complete. Pending managed notifications:', managedCount);
    return true;
  } catch (error) {
    console.error('[LockedIn] Notification sync failed:', error);
    throw error;
  }
}

function syncAll(options) {
  const run = () => syncAllNow(options);
  syncQueue = syncQueue.then(run, run);
  return syncQueue;
}

window.LockedInNotifications = { requestPermission, syncAll };
