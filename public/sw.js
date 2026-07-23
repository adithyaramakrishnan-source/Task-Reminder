// Task Reminders Background Service Worker with Web Push API
const DB_NAME = 'TaskRemindersDB';
const DB_VERSION = 1;
const STORE_NAME = 'reminders';

// Open IndexedDB in Service Worker
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get all tasks from IndexedDB
async function getAllTasks() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[SW] Error reading IndexedDB:', err);
    return [];
  }
}

// Update task in IndexedDB
async function updateTaskInDB(task) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(task);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[SW] Error updating task in DB:', err);
  }
}

// Check for due reminders from local IndexedDB
async function checkScheduledReminders() {
  const tasks = await getAllTasks();
  const now = new Date();

  for (const task of tasks) {
    if (task.completed || task.notified) continue;

    const [sYear, sMonth, sDay] = task.date.split('-').map(Number);
    const [sHour, sMin] = task.time.split(':').map(Number);
    const scheduledDate = new Date(sYear, sMonth - 1, sDay, sHour, sMin, 0, 0);

    if (now.getTime() >= scheduledDate.getTime()) {
      task.notified = true;
      await updateTaskInDB(task);

      if (self.registration && self.registration.showNotification) {
        try {
          await self.registration.showNotification(`🔔 Task Reminder: ${task.title}`, {
            body: `Scheduled for ${task.time} (${task.date}). Click to view or complete.`,
            tag: task.id,
            requireInteraction: true,
            vibrate: [200, 100, 200],
            data: { taskId: task.id }
          });
        } catch (err) {
          console.error('[SW] Failed to show notification:', err);
        }
      }

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'TASK_DUE', task });
      }
    }
  }
}

// Service worker background timer loop (runs every 5 seconds)
let checkInterval = null;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  if (!checkInterval) {
    checkInterval = setInterval(checkScheduledReminders, 5000);
  }
});

setInterval(checkScheduledReminders, 5000);

// NATIVE WEB PUSH API EVENT HANDLER
// Fired by the browser push manager even when web page/tab is completely closed!
self.addEventListener('push', (event) => {
  console.log('[SW] Web Push Notification event received!');
  let data = {
    title: '🔔 Scheduled Task Reminder',
    body: 'You have a task due!',
    tag: 'web-push-reminder',
    soundType: 'digital'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      data.body = event.data.text();
    }
  }

  const notificationPromise = self.registration.showNotification(data.title || '🔔 Task Reminder', {
    body: data.body || 'You have a scheduled reminder due!',
    tag: data.tag || 'task-push-alert',
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    vibrate: [200, 100, 200, 100, 200],
    data: data
  });

  event.waitUntil(notificationPromise);
});

// Listen to messages from frontend
self.addEventListener('message', async (event) => {
  if (!event.data) return;

  if (event.data.type === 'CHECK_REMINDERS') {
    await checkScheduledReminders();
  }

  if (event.data.type === 'TEST_NOTIFICATION') {
    if (self.registration && self.registration.showNotification) {
      await self.registration.showNotification('🔔 Background System Test', {
        body: 'Background notifications are working perfectly on your laptop!',
        requireInteraction: false
      });
    }
  }
});

// Handle notification click: focus app window or open it
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
