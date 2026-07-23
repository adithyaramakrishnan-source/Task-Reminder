// Web Push API Helper Utilities
import { TaskReminder } from '../types';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Fetch VAPID Public Key from server
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) throw new Error('Failed to fetch VAPID key');
    const data = await res.json();
    return data.publicKey;
  } catch (err) {
    console.error('Error getting VAPID public key:', err);
    return null;
  }
}

// Subscribe user browser to Web Push Notifications
export async function subscribeUserToWebPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Web Push API is not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was denied.');
  }

  const registration = await navigator.serviceWorker.ready;
  const publicKey = await getVapidPublicKey();

  if (!publicKey) {
    throw new Error('Unable to retrieve server VAPID public key.');
  }

  const convertedKey = urlBase64ToUint8Array(publicKey);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedKey
  });

  // Send subscription to server
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  });

  if (!response.ok) {
    throw new Error('Server failed to save push subscription.');
  }

  return subscription;
}

// Unsubscribe from Web Push
export async function unsubscribeUserFromWebPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    return await subscription.unsubscribe();
  }

  return false;
}

// Check if currently subscribed
export async function checkIsPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch (e) {
    return false;
  }
}

// Sync task reminders with Express server Web Push scheduler
export async function syncTasksWithPushServer(tasks: TaskReminder[]): Promise<boolean> {
  try {
    const res = await fetch('/api/push/sync-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    return res.ok;
  } catch (err) {
    console.warn('Syncing tasks with push server failed:', err);
    return false;
  }
}

// Send instant test push notification from Express server
export async function sendTestServerPush(): Promise<boolean> {
  try {
    const res = await fetch('/api/push/test', { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Server test push failed');
    }
    return true;
  } catch (err: any) {
    console.error('Test push trigger error:', err);
    throw err;
  }
}

export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// Get current VAPID credentials
export async function getVapidCredentials(): Promise<VapidCredentials | null> {
  try {
    const res = await fetch('/api/push/credentials');
    if (!res.ok) throw new Error('Failed to fetch credentials');
    return await res.json();
  } catch (err) {
    console.error('Error fetching VAPID credentials:', err);
    return null;
  }
}

// Update VAPID credentials on server
export async function updateVapidCredentials(creds: Partial<VapidCredentials> & { action?: string }): Promise<VapidCredentials> {
  const res = await fetch('/api/push/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to update credentials');
  }

  return {
    publicKey: data.publicKey,
    privateKey: data.privateKey,
    subject: data.subject
  };
}
