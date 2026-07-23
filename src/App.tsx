import { useState, useEffect, useMemo, FormEvent } from 'react';
import { 
  Clock, 
  Bell, 
  BellRing, 
  Trash2, 
  Check, 
  Plus, 
  Search, 
  ExternalLink, 
  Volume2, 
  VolumeX, 
  Play, 
  X, 
  CheckCircle, 
  Edit2, 
  CalendarDays,
  Sparkles,
  Laptop,
  ShieldAlert,
  Briefcase,
  User,
  HeartPulse,
  Flame,
  Layers,
  Flag,
  RotateCcw,
  CheckCircle2,
  Radio,
  Send,
  Zap,
  Key,
  Copy,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  Settings,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playSound, stopSound } from './utils/audio';
import { syncTasksToIndexedDB, loadTasksFromIndexedDB } from './utils/db';
import { 
  checkIsPushSubscribed, 
  subscribeUserToWebPush, 
  unsubscribeUserFromWebPush, 
  syncTasksWithPushServer, 
  sendTestServerPush,
  getVapidCredentials,
  updateVapidCredentials,
  VapidCredentials
} from './utils/push';
import { TaskReminder, SoundType, TaskCategory, TaskPriority } from './types';

// Local storage key
const STORAGE_KEY = 'task_reminders_data';

// Category metadata for sleek visual styling
const CATEGORIES: { id: TaskCategory; label: string; icon: any; color: string; bg: string; border: string }[] = [
  { id: 'General', label: 'General', icon: Layers, color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200' },
  { id: 'Work', label: 'Work', icon: Briefcase, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  { id: 'Personal', label: 'Personal', icon: User, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { id: 'Health', label: 'Health', icon: HeartPulse, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
  { id: 'Urgent', label: 'Urgent', icon: Flame, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
];

// Priority metadata
const PRIORITIES: { id: TaskPriority; label: string; color: string; badge: string }[] = [
  { id: 'low', label: 'Low', color: 'text-slate-500', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  { id: 'medium', label: 'Medium', color: 'text-blue-600', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'high', label: 'High', color: 'text-rose-600', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
];

// Helper: Format date to YYYY-MM-DD in local time
const getLocalDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper: Format time to HH:MM in local time
const getLocalTimeString = (d: Date): string => {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// Helper: Relative time countdown string
const getRelativeTimeString = (dateStr: string, timeStr: string, completed: boolean): { text: string; isOverdue: boolean; isUrgent: boolean } => {
  if (completed) return { text: 'Completed', isOverdue: false, isUrgent: false };

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, min] = timeStr.split(':').map(Number);
  const target = new Date(year, month - 1, day, hour, min, 0, 0);
  const diffMs = target.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return { text: `Overdue by ${absMins}m`, isOverdue: true, isUrgent: true };
    const absHours = Math.floor(absMins / 60);
    if (absHours < 24) return { text: `Overdue by ${absHours}h`, isOverdue: true, isUrgent: true };
    return { text: `Overdue by ${Math.floor(absHours / 24)}d`, isOverdue: true, isUrgent: true };
  }

  if (diffMins === 0) return { text: 'Due right now!', isOverdue: false, isUrgent: true };
  if (diffMins < 60) return { text: `Due in ${diffMins}m`, isOverdue: false, isUrgent: diffMins <= 10 };
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return { text: `Due in ${diffHours}h ${diffMins % 60}m`, isOverdue: false, isUrgent: false };
  const diffDays = Math.floor(diffHours / 24);
  return { text: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`, isOverdue: false, isUrgent: false };
};

export default function App() {
  // Reminders state
  const [reminders, setReminders] = useState<TaskReminder[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load reminders from localStorage', e);
    }
    return [];
  });

  // Clock state
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Form states
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(() => getLocalDateString(new Date()));
  const [taskTime, setTaskTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return getLocalTimeString(now);
  });
  const [soundType, setSoundType] = useState<SoundType>('digital');
  const [category, setCategory] = useState<TaskCategory>('Work');
  const [priority, setPriority] = useState<TaskPriority>('medium');

  // Interactive filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<TaskCategory | 'all'>('all');
  const [editingReminder, setEditingReminder] = useState<TaskReminder | null>(null);

  // System notification permissions & PWA / iFrame state
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isInIframe, setIsInIframe] = useState(false);
  const [showClosedGuide, setShowClosedGuide] = useState(false);

  // Web Push API States
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isSubscribingPush, setIsSubscribingPush] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(null);
  const [testPushLoading, setTestPushLoading] = useState(false);

  // VAPID Credentials Management State
  const [showVapidModal, setShowVapidModal] = useState(false);
  const [showInlineVapidConfig, setShowInlineVapidConfig] = useState(false);
  const [vapidForm, setVapidForm] = useState<VapidCredentials>({
    publicKey: '',
    privateKey: '',
    subject: 'mailto:admin@taskreminders.app'
  });
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [isSavingVapid, setIsSavingVapid] = useState(false);
  const [vapidFeedback, setVapidFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch current VAPID credentials on load
  useEffect(() => {
    getVapidCredentials().then(creds => {
      if (creds) setVapidForm(creds);
    });
  }, []);

  const handleOpenVapidModal = async () => {
    setVapidFeedback(null);
    const creds = await getVapidCredentials();
    if (creds) setVapidForm(creds);
    setShowVapidModal(true);
  };

  const handleSaveVapidCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingVapid(true);
    setVapidFeedback(null);

    try {
      const updated = await updateVapidCredentials(vapidForm);
      setVapidForm(updated);
      setVapidFeedback({ type: 'success', msg: 'VAPID credentials saved and applied to Express Web Push engine!' });
      setIsPushSubscribed(false);
    } catch (err: any) {
      setVapidFeedback({ type: 'error', msg: err.message || 'Failed to save credentials' });
    } finally {
      setIsSavingVapid(false);
    }
  };

  const handleGenerateNewKeys = async () => {
    setIsSavingVapid(true);
    setVapidFeedback(null);

    try {
      const updated = await updateVapidCredentials({ action: 'generate' });
      setVapidForm(updated);
      setVapidFeedback({ type: 'success', msg: 'New VAPID Keypair auto-generated and applied!' });
      setIsPushSubscribed(false);
    } catch (err: any) {
      setVapidFeedback({ type: 'error', msg: err.message || 'Key generation failed' });
    } finally {
      setIsSavingVapid(false);
    }
  };

  const handleCopyText = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleCopyEnvBlock = () => {
    const envBlock = `# Web Push VAPID Keys
VAPID_PUBLIC_KEY="${vapidForm.publicKey}"
VAPID_PRIVATE_KEY="${vapidForm.privateKey}"
VAPID_SUBJECT="${vapidForm.subject}"`;
    navigator.clipboard.writeText(envBlock);
    setCopiedField('envBlock');
    setTimeout(() => setCopiedField(null), 2500);
  };

  // Currently firing active alarm
  const [activeAlarm, setActiveAlarm] = useState<TaskReminder | null>(null);
  const [isPreviewingSound, setIsPreviewingSound] = useState<SoundType | null>(null);
  const [lastTestedTask, setLastTestedTask] = useState<string | null>(null);

  // Initialize Service Worker, IndexedDB, Web Push & Notification checks
  useEffect(() => {
    const inIframe = window.self !== window.top;
    setIsInIframe(inIframe);

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    loadTasksFromIndexedDB().then(dbTasks => {
      if (dbTasks && dbTasks.length > 0 && reminders.length === 0) {
        setReminders(dbTasks);
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service Worker registered:', reg.scope);
        checkIsPushSubscribed().then(subscribed => {
          setIsPushSubscribed(subscribed);
        });
      }).catch(err => {
        console.warn('Service Worker registration skipped (iframe restricted environment):', err);
      });

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TASK_DUE') {
          const dueTask = event.data.task;
          setActiveAlarm(dueTask);
          playSound(dueTask.soundType);
        }
      });
    }
  }, []);

  // Sync reminders with LocalStorage, IndexedDB AND Web Push Express Server
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    syncTasksToIndexedDB(reminders);
    syncTasksWithPushServer(reminders);
  }, [reminders]);

  // Clock tick every 1 second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // In-App Alarm Checker Loop
  useEffect(() => {
    if (activeAlarm) return;

    const now = new Date();

    const dueReminder = reminders.find(reminder => {
      if (reminder.completed || reminder.notified) return false;

      const [sYear, sMonth, sDay] = reminder.date.split('-').map(Number);
      const [sHour, sMin] = reminder.time.split(':').map(Number);
      const scheduledDate = new Date(sYear, sMonth - 1, sDay, sHour, sMin, 0, 0);

      return now.getTime() >= scheduledDate.getTime();
    });

    if (dueReminder) {
      setReminders(prev => prev.map(r => r.id === dueReminder.id ? { ...r, notified: true } : r));
      setActiveAlarm(dueReminder);
      playSound(dueReminder.soundType);
      triggerDesktopNotification(dueReminder);
    }
  }, [currentTime, reminders, activeAlarm]);

  // Trigger system desktop notification
  const triggerDesktopNotification = (reminder: TaskReminder) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            task: reminder
          });
        } else {
          new Notification(`🔔 Task Due: ${reminder.title}`, {
            body: `Scheduled for ${reminder.time} on ${reminder.date}. Click to dismiss alarm.`,
            tag: reminder.id,
            requireInteraction: true,
          });
        }
      } catch (err) {
        console.warn('Desktop notification fallback triggered.', err);
      }
    }
  };

  // Request browser Notification permissions
  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === 'granted') {
        new Notification('Reminders Connected! 🔔', {
          body: 'System notifications are active on your laptop.',
        });
      }
    } catch (err) {
      console.error('Error requesting notification permission', err);
    }
  };

  // Enable/Disable Web Push API
  const handleToggleWebPush = async () => {
    if (isInIframe) {
      handleOpenNewTab();
      return;
    }

    setIsSubscribingPush(true);
    setPushStatusMessage(null);

    try {
      if (isPushSubscribed) {
        await unsubscribeUserFromWebPush();
        setIsPushSubscribed(false);
        setPushStatusMessage('Web Push unsubscribed.');
      } else {
        const sub = await subscribeUserToWebPush();
        if (sub) {
          setIsPushSubscribed(true);
          setNotificationPermission('granted');
          setPushStatusMessage('Web Push API active! You will receive push notifications even when the web page is completely closed.');
          await syncTasksWithPushServer(reminders);
        }
      }
    } catch (err: any) {
      console.error('Web Push subscription error:', err);
      setPushStatusMessage(`Web Push Error: ${err.message || 'Failed to activate Web Push.'}`);
    } finally {
      setIsSubscribingPush(false);
      setTimeout(() => setPushStatusMessage(null), 6000);
    }
  };

  // Test Server-Initiated Web Push Notification
  const handleTestServerPush = async () => {
    setTestPushLoading(true);
    setPushStatusMessage(null);

    try {
      if (!isPushSubscribed) {
        await subscribeUserToWebPush();
        setIsPushSubscribed(true);
      }

      await sendTestServerPush();
      setPushStatusMessage('🚀 Server Web Push sent! Check your operating system notification popups.');
    } catch (err: any) {
      setPushStatusMessage(`Push Test Error: ${err.message || 'Please enable Web Push first.'}`);
    } finally {
      setTestPushLoading(false);
      setTimeout(() => setPushStatusMessage(null), 6000);
    }
  };

  // Open App in Standalone Tab
  const handleOpenNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  // Sound preview handler
  const toggleSoundPreview = (type: SoundType) => {
    if (isPreviewingSound === type) {
      stopSound();
      setIsPreviewingSound(null);
    } else {
      playSound(type);
      setIsPreviewingSound(type);
      setTimeout(() => {
        setIsPreviewingSound(prev => prev === type ? null : prev);
      }, 2500);
    }
  };

  const clearSoundPreview = () => {
    if (isPreviewingSound) {
      stopSound();
      setIsPreviewingSound(null);
    }
  };

  // Form submission: Save task
  const handleSaveReminder = (e: FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    clearSoundPreview();

    if (editingReminder) {
      setReminders(prev => prev.map(r => r.id === editingReminder.id ? {
        ...r,
        title: taskTitle.trim(),
        date: taskDate,
        time: taskTime,
        dateTimeString: `${taskDate} ${taskTime}`,
        soundType,
        category,
        priority,
        completed: false,
        notified: false,
      } : r));
      setEditingReminder(null);
    } else {
      const newReminder: TaskReminder = {
        id: Math.random().toString(36).substring(2, 9),
        title: taskTitle.trim(),
        date: taskDate,
        time: taskTime,
        dateTimeString: `${taskDate} ${taskTime}`,
        completed: false,
        notified: false,
        createdAt: new Date().toISOString(),
        soundType,
        category,
        priority,
      };
      setReminders(prev => [newReminder, ...prev]);
    }

    setTaskTitle('');
    const defaultFuture = new Date();
    defaultFuture.setMinutes(defaultFuture.getMinutes() + 5);
    setTaskTime(getLocalTimeString(defaultFuture));
  };

  // Quick Preset Adders
  const addQuickPreset = (minutes: number, labelName?: string) => {
    clearSoundPreview();
    const futureTime = new Date();
    futureTime.setMinutes(futureTime.getMinutes() + minutes);

    const qDate = getLocalDateString(futureTime);
    const qTime = getLocalTimeString(futureTime);

    const newReminder: TaskReminder = {
      id: Math.random().toString(36).substring(2, 9),
      title: labelName || `⚡ Quick Trial (${minutes}m)`,
      date: qDate,
      time: qTime,
      dateTimeString: `${qDate} ${qTime}`,
      completed: false,
      notified: false,
      createdAt: new Date().toISOString(),
      soundType: 'digital',
      category: 'Urgent',
      priority: 'high',
    };

    setReminders(prev => [newReminder, ...prev]);
    setLastTestedTask(newReminder.id);

    setTimeout(() => {
      setLastTestedTask(null);
    }, 4000);
  };

  // Alarm Actions
  const handleDismissComplete = () => {
    if (!activeAlarm) return;
    stopSound();
    setReminders(prev => prev.map(r => r.id === activeAlarm.id ? { ...r, completed: true } : r));
    setActiveAlarm(null);
  };

  const handleSnooze = (minutes: number) => {
    if (!activeAlarm) return;
    stopSound();

    const snoozeTime = new Date();
    snoozeTime.setMinutes(snoozeTime.getMinutes() + minutes);

    const snoozedDate = getLocalDateString(snoozeTime);
    const snoozedTime = getLocalTimeString(snoozeTime);

    setReminders(prev => prev.map(r => {
      if (r.id === activeAlarm.id) {
        return {
          ...r,
          date: snoozedDate,
          time: snoozedTime,
          dateTimeString: `${snoozedDate} ${snoozedTime}`,
          notified: false,
          completed: false,
        };
      }
      return r;
    }));

    setActiveAlarm(null);
  };

  const handleStopOnly = () => {
    stopSound();
    setActiveAlarm(null);
  };

  const toggleComplete = (id: string) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: !r.completed } : r));
  };

  const deleteReminder = (id: string) => {
    clearSoundPreview();
    setReminders(prev => prev.filter(r => r.id !== id));
    if (editingReminder?.id === id) {
      setEditingReminder(null);
      setTaskTitle('');
    }
  };

  const startEditing = (reminder: TaskReminder) => {
    clearSoundPreview();
    setEditingReminder(reminder);
    setTaskTitle(reminder.title);
    setTaskDate(reminder.date);
    setTaskTime(reminder.time);
    setSoundType(reminder.soundType);
    setCategory(reminder.category || 'Work');
    setPriority(reminder.priority || 'medium');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditing = () => {
    setEditingReminder(null);
    setTaskTitle('');
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    setTaskTime(getLocalTimeString(now));
  };

  // Filtered & Searched Tasks
  const filteredReminders = useMemo(() => {
    return reminders.filter(reminder => {
      const matchesSearch = reminder.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategoryFilter === 'all' || reminder.category === selectedCategoryFilter;
      
      if (!matchesSearch || !matchesCategory) return false;

      if (activeFilter === 'completed') return reminder.completed;
      if (activeFilter === 'upcoming') return !reminder.completed;
      return true;
    });
  }, [reminders, activeFilter, selectedCategoryFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = reminders.length;
    const completed = reminders.filter(r => r.completed).length;
    const upcoming = total - completed;
    const overdue = reminders.filter(r => {
      if (r.completed) return false;
      const [year, month, day] = r.date.split('-').map(Number);
      const [hour, min] = r.time.split(':').map(Number);
      return new Date(year, month - 1, day, hour, min).getTime() < Date.now();
    }).length;
    return { total, completed, upcoming, overdue };
  }, [reminders]);

  // Clock display details
  const clockDisplay = useMemo(() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[currentTime.getDay()];
    const monthName = months[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    let hours = currentTime.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const mins = String(currentTime.getMinutes()).padStart(2, '0');
    const secs = String(currentTime.getSeconds()).padStart(2, '0');
    
    return {
      dateString: `${dayName}, ${monthName} ${dayNum}, ${year}`,
      timeString: `${String(hours).padStart(2, '0')}:${mins}:${secs}`,
      ampm
    };
  }, [currentTime]);

  return (
    <div className="min-h-screen bg-slate-900/5 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/40 via-slate-50 to-slate-100/80 font-sans text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      
      {/* HEADER SECTION */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-md shadow-2xs">
        <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            
            {/* Title & Brand */}
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-white">
                  {stats.upcoming}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 font-display flex items-center gap-2">
                  Task Reminders
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-500/20">
                    <Radio className="h-2.5 w-2.5 text-indigo-600 animate-pulse" />
                    Web Push API
                  </span>
                </h1>
                <p className="text-xs font-medium text-slate-500">Express server background scheduler & OS Push notifications</p>
              </div>
            </div>

            {/* Header Right Actions & Digital Clock */}
            <div className="flex flex-wrap items-center gap-2.5">
              
              {/* Standalone Tab Button */}
              <button
                onClick={handleOpenNewTab}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/70 hover:bg-indigo-100/80 px-3 py-2 text-xs font-semibold text-indigo-700 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
                title="Open app in a full browser tab for native Web Push API permissions"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Tab</span>
              </button>

              {/* Guide Modal Trigger */}
              <button
                onClick={() => setShowClosedGuide(true)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-all cursor-pointer shadow-2xs"
              >
                <Laptop className="h-3.5 w-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Closed Web Page Guide</span>
                <span className="sm:hidden">Guide</span>
              </button>

              {/* Glowing Clock Box */}
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900 text-white px-3.5 py-1.5 shadow-md shadow-slate-950/10">
                <Clock className="h-4 w-4 text-indigo-400 animate-pulse" />
                <div className="text-right">
                  <div className="font-mono text-sm font-bold tracking-wider text-indigo-100">
                    {clockDisplay.timeString} <span className="text-[10px] font-semibold text-indigo-400">{clockDisplay.ampm}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* WEB PUSH API & IFRAME ACTION BANNERS */}
      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        
        {/* Banner 1: If inside iFrame */}
        {isInIframe && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50/50 p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-500/10 p-2 text-amber-700">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-amber-950 text-sm font-display">Web Push API Security Notice</h3>
                  <p className="mt-0.5 text-xs text-amber-800/90 leading-relaxed max-w-2xl">
                    You are currently viewing this inside an embedded preview frame. Browsers block native Web Push permissions inside embedded frames. Click below to open in a full tab to enable native Web Push API notifications when the web page is closed!
                  </p>
                </div>
              </div>
              <button
                onClick={handleOpenNewTab}
                className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all cursor-pointer active:scale-95"
              >
                <ExternalLink className="h-4 w-4" />
                Open Standalone App Tab
              </button>
            </div>
          </motion.div>
        )}

        {/* Banner 2: WEB PUSH API ACTIVE CONTROL CARD */}
        <div className="mb-6 rounded-2xl border border-indigo-200/90 bg-gradient-to-r from-indigo-900 via-slate-900 to-slate-950 text-white p-4 sm:p-5 shadow-lg shadow-indigo-950/20">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3.5">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                isPushSubscribed 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 ring-4 ring-emerald-500/10' 
                  : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
              }`}>
                <Radio className={`h-5 w-5 ${isPushSubscribed ? 'animate-pulse' : ''}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-sm sm:text-base font-display">
                    Web Push API Engine
                  </h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border ${
                    isPushSubscribed 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {isPushSubscribed ? '● Push Active (Closed-Page Ready)' : '○ Disabled'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300 leading-relaxed max-w-2xl">
                  Uses the browser's native <strong>PushManager API</strong> & VAPID keys. Scheduled reminders are synced with the Express backend server, which delivers OS push notifications directly to your desktop even when this web page is completely closed!
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
              {/* Toggle Web Push */}
              <button
                onClick={handleToggleWebPush}
                disabled={isSubscribingPush}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 ${
                  isPushSubscribed
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                }`}
              >
                {isSubscribingPush ? (
                  <>
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>Connecting Push...</span>
                  </>
                ) : isPushSubscribed ? (
                  <>
                    <X className="h-3.5 w-3.5" />
                    <span>Disable Web Push</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 text-amber-300" />
                    <span>Enable Web Push API</span>
                  </>
                )}
              </button>

              {/* Test Server Web Push */}
              <button
                onClick={handleTestServerPush}
                disabled={testPushLoading}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                title="Sends a test push packet directly from Express server to browser Push daemon"
              >
                {testPushLoading ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>Test Closed-Page Push</span>
              </button>

              {/* VAPID Credentials Settings Trigger */}
              <button
                onClick={() => {
                  setShowInlineVapidConfig(!showInlineVapidConfig);
                  if (!showInlineVapidConfig) handleOpenVapidModal();
                }}
                className={`flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all cursor-pointer shadow-2xs active:scale-95 ${
                  showInlineVapidConfig
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800/90 hover:bg-slate-700/90 text-indigo-300 border border-indigo-500/30 hover:text-white'
                }`}
                title="Enter custom VAPID public and private keys"
              >
                <Key className="h-3.5 w-3.5 text-indigo-300" />
                <span>VAPID Keys Settings</span>
              </button>
            </div>
          </div>

          {/* Inline VAPID Public & Private Keys Configuration Panel */}
          <AnimatePresence>
            {showInlineVapidConfig && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 pt-4 border-t border-slate-800"
              >
                <div className="rounded-2xl bg-slate-950/80 p-4 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display">
                        Enter Custom VAPID Credentials
                      </h4>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Active: {vapidForm.publicKey ? `${vapidForm.publicKey.substring(0, 12)}...` : 'Not Set'}
                    </span>
                  </div>

                  {vapidFeedback && (
                    <div className={`flex items-center gap-2 rounded-xl p-3 text-xs font-semibold ${
                      vapidFeedback.type === 'success'
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                    }`}>
                      {vapidFeedback.type === 'success' ? (
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                      )}
                      <span>{vapidFeedback.msg}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveVapidCredentials} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          VAPID Public Key
                        </label>
                        <input
                          type="text"
                          value={vapidForm.publicKey}
                          onChange={(e) => setVapidForm(prev => ({ ...prev, publicKey: e.target.value }))}
                          placeholder="Paste Public Key..."
                          required
                          className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-indigo-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-bold text-slate-300">
                            VAPID Private Key
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowPrivateKey(!showPrivateKey)}
                            className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                          >
                            {showPrivateKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            <span>{showPrivateKey ? 'Hide' : 'Show'}</span>
                          </button>
                        </div>
                        <input
                          type={showPrivateKey ? 'text' : 'password'}
                          value={vapidForm.privateKey}
                          onChange={(e) => setVapidForm(prev => ({ ...prev, privateKey: e.target.value }))}
                          placeholder="Paste Private Key..."
                          required
                          className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-amber-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        VAPID Subject (mailto: or URL)
                      </label>
                      <input
                        type="text"
                        value={vapidForm.subject}
                        onChange={(e) => setVapidForm(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="mailto:admin@example.com"
                        required
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={isSavingVapid}
                        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isSavingVapid ? (
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>Save & Apply Keys</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleGenerateNewKeys}
                        disabled={isSavingVapid}
                        className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 text-amber-400 ${isSavingVapid ? 'animate-spin' : ''}`} />
                        <span>Auto-Generate Keypair</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyEnvBlock}
                        className="flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-3 py-2 text-xs font-semibold transition-all cursor-pointer"
                      >
                        {copiedField === 'envBlock' ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-bold">Copied .env!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Copy .env Format</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Status Message feedback banner */}
          <AnimatePresence>
            {pushStatusMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3.5 pt-3 border-t border-slate-800 text-xs font-semibold text-indigo-300 flex items-center gap-2"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>{pushStatusMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-8 pb-20">
        
        {/* STATS OVERVIEW CARDS */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 mb-6">
          <div className="group rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-md p-4 shadow-2xs transition-all hover:shadow-xs hover:border-slate-300">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Tasks</span>
              <Layers className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-900 font-display">{stats.total}</p>
          </div>

          <div className="group rounded-2xl border border-indigo-100 bg-white/80 backdrop-blur-md p-4 shadow-2xs transition-all hover:shadow-xs hover:border-indigo-200">
            <div className="flex items-center justify-between text-indigo-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">Upcoming Alerts</span>
              <Bell className="h-4 w-4 text-indigo-500 group-hover:text-indigo-600 transition-colors" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-indigo-600 font-display">{stats.upcoming}</p>
          </div>

          <div className="group rounded-2xl border border-rose-100 bg-white/80 backdrop-blur-md p-4 shadow-2xs transition-all hover:shadow-xs hover:border-rose-200">
            <div className="flex items-center justify-between text-rose-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-600">Overdue Tasks</span>
              <Flame className="h-4 w-4 text-rose-500 group-hover:text-rose-600 transition-colors" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-rose-600 font-display">{stats.overdue}</p>
          </div>

          <div className="group rounded-2xl border border-emerald-100 bg-white/80 backdrop-blur-md p-4 shadow-2xs transition-all hover:shadow-xs hover:border-emerald-200">
            <div className="flex items-center justify-between text-emerald-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Completed</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 group-hover:text-emerald-600 transition-colors" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-emerald-600 font-display">{stats.completed}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          {/* LEFT SIDE: CREATION / EDITING FORM */}
          <section className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
              
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h2 className="font-bold text-slate-900 text-base font-display">
                    {editingReminder ? 'Reschedule Reminder' : 'Set Task Reminder'}
                  </h2>
                </div>
                {editingReminder && (
                  <button 
                    onClick={cancelEditing}
                    className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Cancel Edit
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveReminder} className="space-y-4">
                
                {/* Task Title */}
                <div>
                  <label htmlFor="task-title" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Task Title / Note
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    required
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g., Standup meeting, Drink water, Call client..."
                    className="w-full rounded-2xl border border-slate-200/90 bg-slate-50/50 px-4 py-3 text-sm font-medium text-slate-800 placeholder-slate-400 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                  />
                </div>

                {/* Date & Time Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="task-date" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Scheduled Date
                    </label>
                    <input
                      id="task-date"
                      type="date"
                      required
                      value={taskDate}
                      min={getLocalDateString(new Date())}
                      onChange={(e) => setTaskDate(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200/90 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                    />
                  </div>

                  <div>
                    <label htmlFor="task-time" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Scheduled Time
                    </label>
                    <input
                      id="task-time"
                      type="time"
                      required
                      value={taskTime}
                      onChange={(e) => setTaskTime(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200/90 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                    />
                  </div>
                </div>

                {/* Category Selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Task Category
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((cat) => {
                      const CatIcon = cat.icon;
                      const isSelected = category === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.id)}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                            isSelected 
                              ? 'bg-slate-900 text-white shadow-xs' 
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          <CatIcon className={`h-3.5 w-3.5 ${isSelected ? 'text-indigo-400' : cat.color}`} />
                          <span>{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Priority Selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Priority Level
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPriority(p.id)}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold capitalize transition-all cursor-pointer ${
                          priority === p.id 
                            ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-2xs' 
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Flag className={`h-3 w-3 ${p.color}`} />
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alarm Sound Picker */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Alarm Tone
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'digital', label: 'Beep Beep', desc: 'Digital Pulse' },
                      { id: 'classic', label: 'Vintage Ring', desc: 'Mechanical Bell' },
                      { id: 'bell', label: 'Crystal Bell', desc: 'Decaying Strike' },
                      { id: 'gentle', label: 'Ambient Sweep', desc: 'Soft Chord' }
                    ].map((sound) => (
                      <div 
                        key={sound.id}
                        className={`group relative flex items-center justify-between rounded-2xl border p-2.5 transition-all ${
                          soundType === sound.id 
                            ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/10' 
                            : 'border-slate-200/80 bg-slate-50/60 hover:bg-slate-100/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSoundType(sound.id as SoundType)}
                          className="flex-1 text-left outline-none cursor-pointer"
                        >
                          <p className="text-xs font-bold text-slate-900">{sound.label}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{sound.desc}</p>
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => toggleSoundPreview(sound.id as SoundType)}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer ${
                            isPreviewingSound === sound.id
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-slate-400 hover:bg-slate-200/60 hover:text-slate-700'
                          }`}
                          title="Preview tone"
                        >
                          {isPreviewingSound === sound.id ? (
                            <div className="flex items-center gap-0.5">
                              <span className="h-2 w-0.5 bg-white animate-bounce" />
                              <span className="h-3 w-0.5 bg-white animate-bounce [animation-delay:0.1s]" />
                              <span className="h-1.5 w-0.5 bg-white animate-bounce [animation-delay:0.2s]" />
                            </div>
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-indigo-600/20 active:scale-98 transition-all cursor-pointer"
                >
                  {editingReminder ? (
                    <>
                      <Check className="h-4 w-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 stroke-[3]" />
                      Set Task Reminder
                    </>
                  )}
                </button>

              </form>
            </div>

            {/* QUICK PRESET TRIAL ACTIONS */}
            <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-violet-50/30 to-white p-5 shadow-2xs">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950 font-display">
                  Instant Web Push Trial Presets
                </h3>
              </div>
              <p className="text-xs text-slate-500 mb-3.5 leading-relaxed">
                Set a trial reminder for 1 or 2 minutes, then close this browser tab! The Express server will trigger a Web Push notification to your OS.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => addQuickPreset(1, '⚡ Trial Push Alarm (1 Min)')}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-white border border-indigo-200/80 hover:border-indigo-400 px-2 py-2.5 text-xs font-bold text-indigo-700 shadow-2xs hover:shadow-xs transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 1 min
                </button>
                <button
                  onClick={() => addQuickPreset(2, '⚡ Trial Push Alarm (2 Min)')}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-white border border-indigo-200/80 hover:border-indigo-400 px-2 py-2.5 text-xs font-bold text-indigo-700 shadow-2xs hover:shadow-xs transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 2 min
                </button>
                <button
                  onClick={() => addQuickPreset(5, '⚡ Trial Push Alarm (5 Min)')}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-white border border-indigo-200/80 hover:border-indigo-400 px-2 py-2.5 text-xs font-bold text-indigo-700 shadow-2xs hover:shadow-xs transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 5 min
                </button>
              </div>
            </div>

          </section>

          {/* RIGHT SIDE: FILTERABLE TASK LIST */}
          <section className="lg:col-span-7 space-y-4">
            
            {/* Filter & Search Bar */}
            <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Main Status Filter Tabs */}
                <div className="flex bg-slate-100/80 rounded-xl p-1 self-start sm:self-auto">
                  <button
                    onClick={() => setActiveFilter('all')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      activeFilter === 'all' 
                        ? 'bg-white text-slate-900 shadow-2xs' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    All ({reminders.length})
                  </button>
                  <button
                    onClick={() => setActiveFilter('upcoming')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      activeFilter === 'upcoming' 
                        ? 'bg-white text-indigo-700 shadow-2xs' 
                        : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Upcoming ({stats.upcoming})
                  </button>
                  <button
                    onClick={() => setActiveFilter('completed')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      activeFilter === 'completed' 
                        ? 'bg-white text-emerald-700 shadow-2xs' 
                        : 'text-slate-500 hover:text-emerald-600'
                    }`}
                  >
                    Completed ({stats.completed})
                  </button>
                </div>

                {/* Search Box */}
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks..."
                    className="w-full rounded-xl border border-slate-200/80 bg-slate-50/50 pl-9 pr-8 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-500 focus:bg-white"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category Sub-Filters */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 no-scrollbar">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-1">Category:</span>
                <button
                  onClick={() => setSelectedCategoryFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
                    selectedCategoryFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/60'
                  }`}
                >
                  All Categories
                </button>
                {CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategoryFilter(c.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
                      selectedCategoryFilter === c.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

            </div>

            {/* Task List Items */}
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {filteredReminders.length > 0 ? (
                  filteredReminders.map((reminder) => {
                    const relativeTime = getRelativeTimeString(reminder.date, reminder.time, reminder.completed);
                    const catMeta = CATEGORIES.find(c => c.id === (reminder.category || 'Work')) || CATEGORIES[0];
                    const priorityMeta = PRIORITIES.find(p => p.id === (reminder.priority || 'medium')) || PRIORITIES[1];
                    const CatIcon = catMeta.icon;

                    return (
                      <motion.div
                        key={reminder.id}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -50 }}
                        className={`group relative overflow-hidden rounded-3xl border bg-white p-5 transition-all shadow-2xs hover:shadow-xs ${
                          reminder.completed 
                            ? 'border-slate-100 bg-slate-50/40 opacity-60' 
                            : relativeTime.isOverdue
                              ? 'border-rose-200 bg-rose-50/10'
                              : lastTestedTask === reminder.id
                                ? 'border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-200'
                                : 'border-slate-200/90 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          
                          <div className="flex items-start gap-3.5 min-w-0">
                            {/* Checkbox */}
                            <button
                              onClick={() => toggleComplete(reminder.id)}
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                                reminder.completed
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : relativeTime.isOverdue
                                    ? 'border-rose-300 hover:border-rose-500 hover:bg-rose-50/50'
                                    : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/50'
                              }`}
                            >
                              {reminder.completed && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                            </button>

                            {/* Task Content */}
                            <div className="min-w-0">
                              <h3 className={`text-sm font-bold tracking-tight text-slate-900 ${
                                reminder.completed ? 'line-through text-slate-400' : ''
                              }`}>
                                {reminder.title}
                              </h3>
                              
                              {/* Metadata Badges */}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                
                                {/* Date & Time */}
                                <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-600 bg-slate-100/80 px-2 py-0.5 rounded-md">
                                  <Clock className="h-3 w-3 text-slate-400" />
                                  {reminder.date} • {reminder.time}
                                </span>

                                {/* Category Tag */}
                                <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${catMeta.bg} ${catMeta.color}`}>
                                  <CatIcon className="h-3 w-3" />
                                  {catMeta.label}
                                </span>

                                {/* Priority Tag */}
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${priorityMeta.badge}`}>
                                  {priorityMeta.label}
                                </span>

                                {/* Relative time pill */}
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  reminder.completed
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : relativeTime.isOverdue
                                      ? 'bg-rose-100 text-rose-800 animate-pulse'
                                      : relativeTime.isUrgent
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {relativeTime.text}
                                </span>

                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {!reminder.completed && (
                              <button
                                onClick={() => {
                                  playSound(reminder.soundType);
                                  setActiveAlarm(reminder);
                                }}
                                className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 text-indigo-600 transition-all cursor-pointer"
                                title="Trigger Sound Alarm Now"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {!reminder.completed && (
                              <button
                                onClick={() => startEditing(reminder)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                                title="Edit reminder details"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => deleteReminder(reminder.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all cursor-pointer"
                              title="Delete task"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200/80 bg-white/50 px-4 py-16 text-center"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
                      <Bell className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 font-bold text-slate-800 font-display">No Reminders Found</h3>
                    <p className="mt-1 text-xs text-slate-400 max-w-sm">
                      {searchQuery 
                        ? 'No tasks match your search query.' 
                        : 'No reminders in this view. Set a reminder above to test Web Push API notifications!'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </section>
        </div>
      </main>

      {/* MODAL: VAPID CREDENTIALS SETTINGS */}
      <AnimatePresence>
        {showVapidModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-xl my-8 overflow-hidden rounded-3xl bg-slate-900 text-white p-6 shadow-2xl border border-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    <Key className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white font-display text-base flex items-center gap-2">
                      VAPID Key Credentials
                      <span className="rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold px-2 py-0.5 border border-emerald-500/30">
                        Active Server Keys
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">Enter custom keys or auto-generate keypair for Web Push API</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVapidModal(false)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Feedback Alert */}
              {vapidFeedback && (
                <div className={`mt-4 flex items-center gap-2.5 rounded-2xl p-3.5 text-xs font-semibold ${
                  vapidFeedback.type === 'success'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}>
                  {vapidFeedback.type === 'success' ? (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                  )}
                  <span>{vapidFeedback.msg}</span>
                </div>
              )}

              <form onSubmit={handleSaveVapidCredentials} className="mt-5 space-y-4">
                
                {/* VAPID Public Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <span>VAPID Public Key</span>
                      <span className="text-[10px] text-slate-500 font-normal">(Client pushManager key)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopyText(vapidForm.publicKey, 'publicKey')}
                      className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'publicKey' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={vapidForm.publicKey}
                    onChange={(e) => setVapidForm(prev => ({ ...prev, publicKey: e.target.value }))}
                    placeholder="Enter VAPID Public Key..."
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-mono text-indigo-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* VAPID Private Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <span>VAPID Private Key</span>
                      <span className="text-[10px] text-rose-400 font-normal">(Keep secret)</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                      >
                        {showPrivateKey ? (
                          <>
                            <EyeOff className="h-3 w-3" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            <span>Show</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyText(vapidForm.privateKey, 'privateKey')}
                        className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedField === 'privateKey' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={vapidForm.privateKey}
                    onChange={(e) => setVapidForm(prev => ({ ...prev, privateKey: e.target.value }))}
                    placeholder="Enter VAPID Private Key..."
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-mono text-amber-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Subject / Contact Email */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-300">VAPID Subject (mailto: or URL)</label>
                    <button
                      type="button"
                      onClick={() => handleCopyText(vapidForm.subject, 'subject')}
                      className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'subject' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={vapidForm.subject}
                    onChange={(e) => setVapidForm(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder="mailto:admin@example.com"
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Submit & Secondary Action Buttons */}
                <div className="pt-3 border-t border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <button
                      type="submit"
                      disabled={isSavingVapid}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-3 text-xs font-bold text-white shadow-md shadow-indigo-950/40 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSavingVapid ? (
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span>Save & Apply Credentials</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerateNewKeys}
                      disabled={isSavingVapid}
                      className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-3 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      title="Auto-generates a new VAPID keypair"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 text-amber-400 ${isSavingVapid ? 'animate-spin' : ''}`} />
                      <span>Auto-Generate Keys</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyEnvBlock}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 py-2.5 text-xs font-semibold transition-all cursor-pointer"
                  >
                    {copiedField === 'envBlock' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">.env block copied to clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Copy .env Format Block</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: CLOSED WEB PAGE & WEB PUSH GUIDE */}
      <AnimatePresence>
        {showClosedGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-xl overflow-hidden rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Radio className="h-4 w-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 font-display text-base">How Web Push Works When Page is Closed</h3>
                </div>
                <button
                  onClick={() => setShowClosedGuide(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3.5 text-xs text-slate-600 leading-relaxed">
                <p>
                  Standard client scripts stop when a web page is closed. The <strong>W3C Web Push API</strong> solves this completely using standard browser infrastructure:
                </p>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">1</span>
                    <span>Server-Side VAPID Keys & Push Service</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    When you click <strong>Enable Web Push API</strong>, your browser registers a unique Push Subscription endpoint with Google (FCM), Apple (APNs), or Mozilla Push Service.
                  </p>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">2</span>
                    <span>Express Server Background Scheduler</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    Our Express backend checks scheduled tasks in the background. When a task is due, the server transmits a Web Push packet directly to your browser's push service endpoint.
                  </p>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">3</span>
                    <span>OS System Notification Delivery</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    Your operating system's native push daemon wakes up the Service Worker in the background and displays a system popup notification on your screen—even if the web page is closed!
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={handleTestServerPush}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white transition-all cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  Test Push Now
                </button>

                <button
                  onClick={handleOpenNewTab}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Standalone Tab
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FULL-SCREEN ACTIVE ALARM DIALOG OVERLAY */}
      <AnimatePresence>
        {activeAlarm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-indigo-500/20 bg-slate-900 text-white p-6 shadow-2xl shadow-indigo-950/50"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1/2 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                <div className="absolute h-48 w-48 rounded-full border border-indigo-500/10 animate-ping" />
                <div className="absolute h-36 w-36 rounded-full border border-indigo-500/20 animate-ping [animation-delay:0.3s]" />
                <div className="absolute h-24 w-24 rounded-full border border-indigo-500/30 animate-ping [animation-delay:0.6s]" />
              </div>

              <div className="relative text-center mt-6">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600/30 border border-indigo-500 text-indigo-400 animate-bounce">
                  <BellRing className="h-8 w-8" />
                </div>
                
                <h2 className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-400">
                  Task Reminder Due
                </h2>
                
                <h3 className="mt-2 text-2xl font-bold tracking-tight px-4 leading-snug">
                  {activeAlarm.title}
                </h3>

                <p className="mt-1.5 font-mono text-sm text-indigo-300">
                  Scheduled time: {activeAlarm.date} • {activeAlarm.time}
                </p>
              </div>

              <div className="relative mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400 bg-slate-800/40 py-1.5 px-3 rounded-lg w-max mx-auto">
                <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
                <span>Ringing <strong>{activeAlarm.soundType}</strong> tone...</span>
              </div>

              <div className="relative mt-8 space-y-3">
                <button
                  onClick={handleDismissComplete}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3.5 font-semibold text-white shadow-lg shadow-emerald-950/40 transition-all cursor-pointer active:scale-98"
                >
                  <CheckCircle className="h-5 w-5" />
                  Dismiss & Mark Completed
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSnooze(5)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-200 transition-all cursor-pointer"
                  >
                    Snooze 5 mins
                  </button>
                  <button
                    onClick={() => handleSnooze(15)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-200 transition-all cursor-pointer"
                  >
                    Snooze 15 mins
                  </button>
                </div>

                <button
                  onClick={handleStopOnly}
                  className="w-full text-center text-xs text-slate-400 hover:text-white pt-1 cursor-pointer"
                >
                  Stop sound without marking done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
