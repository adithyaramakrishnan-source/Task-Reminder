import express from 'express';
import path from 'path';
import webPush from 'web-push';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const app = express();

app.use(express.json());

// Initialize VAPID keys for Web Push API
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BB2wGIayctYUxPK2DOwNkotnKp2AWgSTSXeQBHcZBB_pNM5RlzNxtEY7QydkiSFkHTOW0AC4wFNm1xZJuKDaOhM';
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'uxZ6VQOkvp52OfiislgiyinbuiZEpJRxn3ZrFI5d_kk';
let vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@taskreminders.app';

if (!vapidPublicKey || !vapidPrivateKey) {
  console.log('[WebPush] No VAPID keys found in environment. Auto-generating key pair...');
  const keys = webPush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
}

webPush.setVapidDetails(
  vapidSubject,
  vapidPublicKey,
  vapidPrivateKey
);

console.log('[WebPush] VAPID Key set successfully. Public Key:', vapidPublicKey.substring(0, 15) + '...');

// In-memory data store for Push Subscriptions & Scheduled Tasks
interface TaskItem {
  id: string;
  title: string;
  date: string;
  time: string;
  notified: boolean;
  completed: boolean;
  category?: string;
  priority?: string;
  soundType?: string;
}

let pushSubscriptions: webPush.PushSubscription[] = [];
let scheduledTasks: TaskItem[] = [];

// Helper: Send Push Notification to all subscribers
async function sendPushNotificationToAll(payload: any) {
  const payloadStr = JSON.stringify(payload);
  const activeSubscriptions: webPush.PushSubscription[] = [];

  for (const subscription of pushSubscriptions) {
    try {
      await webPush.sendNotification(subscription, payloadStr);
      activeSubscriptions.push(subscription);
    } catch (error: any) {
      console.warn('[WebPush] Failed to send push to endpoint:', subscription.endpoint, error.statusCode || error.message);
      // Remove stale/expired subscriptions (404/410 Gone)
      if (error.statusCode !== 404 && error.statusCode !== 410) {
        activeSubscriptions.push(subscription);
      }
    }
  }

  pushSubscriptions = activeSubscriptions;
}

// Background scheduler ticker: Runs every 5 seconds on server
setInterval(async () => {
  if (scheduledTasks.length === 0 || pushSubscriptions.length === 0) return;

  const now = new Date();

  for (const task of scheduledTasks) {
    if (task.completed || task.notified) continue;

    const [sYear, sMonth, sDay] = task.date.split('-').map(Number);
    const [sHour, sMin] = task.time.split(':').map(Number);
    const scheduledDate = new Date(sYear, sMonth - 1, sDay, sHour, sMin, 0, 0);

    if (now.getTime() >= scheduledDate.getTime()) {
      task.notified = true;
      console.log(`[WebPush Server Scheduler] Task Due: "${task.title}". Triggering Web Push to ${pushSubscriptions.length} device(s)...`);

      await sendPushNotificationToAll({
        title: `🔔 Task Due: ${task.title}`,
        body: `Scheduled for ${task.time} (${task.date}). Category: ${task.category || 'General'}`,
        tag: task.id,
        taskId: task.id,
        soundType: task.soundType || 'digital',
        requireInteraction: true,
      });
    }
  }
}, 5000);

// API ROUTES

// 1. Return Public VAPID Key for client pushManager.subscribe()
app.get('/api/push/vapid-key', (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// 1b. Get current VAPID credentials
app.get('/api/push/credentials', (_req, res) => {
  res.json({
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
    subject: vapidSubject
  });
});

// 1c. Update or generate custom VAPID credentials
app.post('/api/push/credentials', (req, res) => {
  const { publicKey, privateKey, subject, action } = req.body;

  if (action === 'generate') {
    const keys = webPush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
  } else {
    if (!publicKey || !privateKey) {
      res.status(400).json({ error: 'Both Public Key and Private Key are required.' });
      return;
    }
    vapidPublicKey = publicKey.trim();
    vapidPrivateKey = privateKey.trim();
    if (subject && subject.trim()) {
      vapidSubject = subject.trim();
    }
  }

  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    pushSubscriptions = []; // Reset subscriptions when keys change
    console.log('[WebPush] Updated VAPID credentials successfully. New Public Key:', vapidPublicKey.substring(0, 15) + '...');
    res.json({
      status: 'ok',
      message: 'VAPID credentials updated successfully.',
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: vapidSubject
    });
  } catch (err: any) {
    console.error('[WebPush] Failed to set VAPID details:', err);
    res.status(400).json({ error: `Invalid VAPID credentials: ${err.message || 'Check key format.'}` });
  }
});

// 2. Save Client Push Subscription
app.post('/api/push/subscribe', (req, res) => {
  const subscription: webPush.PushSubscription = req.body.subscription;

  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Invalid push subscription payload' });
    return;
  }

  const exists = pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
  if (!exists) {
    pushSubscriptions.push(subscription);
    console.log('[WebPush] New Web Push subscription registered. Total subscribers:', pushSubscriptions.length);
  }

  res.json({ status: 'ok', subscribersCount: pushSubscriptions.length });
});

// 3. Unsubscribe endpoint
app.post('/api/push/unsubscribe', (req, res) => {
  const subscription: webPush.PushSubscription = req.body.subscription;
  if (subscription && subscription.endpoint) {
    pushSubscriptions = pushSubscriptions.filter(sub => sub.endpoint !== subscription.endpoint);
    console.log('[WebPush] Unsubscribed endpoint. Remaining subscribers:', pushSubscriptions.length);
  }
  res.json({ status: 'ok' });
});

// 4. Sync client tasks with server for background checking when window closed
app.post('/api/push/sync-tasks', (req, res) => {
  const tasks: TaskItem[] = req.body.tasks || [];
  scheduledTasks = tasks;
  res.json({ status: 'ok', count: scheduledTasks.length });
});

// 5. Send Test Web Push Notification
app.post('/api/push/test', async (_req, res) => {
  if (pushSubscriptions.length === 0) {
    res.status(400).json({ error: 'No active push subscriptions registered. Please subscribe first.' });
    return;
  }

  await sendPushNotificationToAll({
    title: '🚀 Server Web Push Success!',
    body: 'This notification was delivered directly from the Express server via the native Web Push API!',
    tag: 'test-push',
    requireInteraction: false,
  });

  res.json({ status: 'ok', sentToCount: pushSubscriptions.length });
});

async function startServer() {
  // Vite integration in Dev mode vs Static serving in Prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
