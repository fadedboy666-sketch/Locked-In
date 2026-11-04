import { LocalNotifications } from '@capacitor/local-notifications';

const DAY_NAMES = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
const ALL_DAYS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

// Habit alarms live in this ID range. Every sync wipes and rebuilds this range.
const ROUTINE_MIN_ID = 100000000;
const ROUTINE_MAX_ID = 999999999;
const SESSION_ID = 1900000001;
const DAILY_TASK_ID = 1900000002;

const BRAND_LARGE_ICON = 'ic_large_locked_in';
const MIGRATION_KEY = 'lockedin_native_notifications_v2';

const WINDOW_DAYS = 14;          // rolling schedule length
const MAX_ROUTINE_ALARMS = 400;  // Android caps an app at ~500 alarms; stay under it
const CHUNK_SIZE = 50;

// false = plain exact alarms. If reminders are late after the phone sat idle
// (screen off for a while), change this to true.
const ALLOW_IDLE = false;

/* ---------- IDs ---------- */

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
