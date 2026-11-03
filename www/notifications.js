import { LocalNotifications } from '@capacitor/local-notifications';

const dayNumbers = {
  Su: 1,
  M: 2,
  T: 3,
  W: 4,
  Th: 5,
  F: 6,
  Sa: 7
};

function notificationId(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2000000000) + 1;
}

async function requestPermission() {
  let permission = await LocalNotifications.checkPermissions();

  if (permission.display !== 'granted') {
    permission = await LocalNotifications.requestPermissions();
  }

  return permission.display === 'granted';
}

async function reschedule(routine) {
  const pending = await LocalNotifications.getPending();

  if (pending.notifications.length) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map(n => ({ id: n.id }))
    });
  }

  const notifications = [];

  for (const [slot, items] of Object.entries(routine || {})) {
    (items || []).forEach((item, index) => {
      if (!item.time) return;

      const [hour, minute] = item.time.split(':').map(Number);

      if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        hour < 0 || hour > 23 ||
        minute < 0 || minute > 59
      ) return;

      const days = Array.isArray(item.days)
        ? item.days
        : ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

      days.forEach(day => {
        const weekday = dayNumbers[day];
        if (!weekday) return;

        notifications.push({
          id: notificationId(`${slot}-${index}-${item.name}-${day}`),
          title: 'Locked In',
          body: `${item.name} — time to lock in.`,
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

window.LockedInNotifications = {
  requestPermission,
  reschedule
};
