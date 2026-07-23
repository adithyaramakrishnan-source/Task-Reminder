import { useState, useEffect, useMemo, FormEvent } from 'react';
import { 
  Clock, 
  Bell, 
  BellRing, 
  Trash2, 
  Check, 
  Plus, 
  Search, 
  AlertCircle, 
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
  Download,
  Info,
  ShieldAlert,
  Power
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playSound, stopSound } from './utils/audio';
import { syncTasksToIndexedDB, loadTasksFromIndexedDB } from './utils/db';
import { TaskReminder, SoundType } from './types';

// Local storage key
const STORAGE_KEY = 'task_reminders_data';

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

export default function App() {
  // Reminders list
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

  // Interactive filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [editingReminder, setEditingReminder] = useState<TaskReminder | null>(null);

  // System notification permissions & PWA / iFrame state
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isInIframe, setIsInIframe] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);
  const [swRegistered, setSwRegistered] = useState(false);
  const [showClosedGuide, setShowClosedGuide] = useState(false);

  // Currently firing active alarm
  const [activeAlarm, setActiveAlarm] = useState<TaskReminder | null>(null);
  const [isPreviewingSound, setIsPreviewingSound] = useState<SoundType | null>(null);
  const [lastTestedTask, setLastTestedTask] = useState<string | null>(null);

  // Initialize Service Worker, IndexedDB, and Notification checks
  useEffect(() => {
    // Detect iframe
    const inIframe = window.self !== window.top;
    setIsInIframe(inIframe);

    // Check notification permission
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    // Load from IndexedDB if localStorage was empty
    loadTasksFromIndexedDB().then(dbTasks => {
      if (dbTasks && dbTasks.length > 0 && reminders.length === 0) {
        setReminders(dbTasks);
      }
    });

    // Register Service Worker for background notifications when tab is closed
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Background Service Worker registered successfully:', reg.scope);
        setSwRegistered(true);
      }).catch(err => {
        console.warn('Service Worker registration failed (normal in restricted iframe environments):', err);
      });

      // Listen for task triggers from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TASK_DUE') {
          const dueTask = event.data.task;
          setActiveAlarm(dueTask);
          playSound(dueTask.soundType);
        }
      });
    }

    // Capture PWA Install Prompt
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Check if running as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsPwaInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  // Sync reminders with LocalStorage AND IndexedDB for Service Worker
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    syncTasksToIndexedDB(reminders);
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

  // Trigger system notification
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
        console.warn('Desktop notification triggered fallback.', err);
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
          body: 'System notifications are now active on your laptop.',
        });
      }
    } catch (err) {
      console.error('Error requesting notification permission', err);
    }
  };

  // Open App in Standalone Tab / New Window
  const handleOpenNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  // Install Desktop App (PWA)
  const handleInstallPWA = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsPwaInstalled(true);
      }
      setDeferredInstallPrompt(null);
    } else {
      setShowClosedGuide(true);
    }
  };

  // Sound play preview handler
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
      };
      setReminders(prev => [newReminder, ...prev]);
    }

    setTaskTitle('');
    const defaultFuture = new Date();
    defaultFuture.setMinutes(defaultFuture.getMinutes() + 5);
    setTaskTime(getLocalTimeString(defaultFuture));
  };

  // Quick Preset Adders
  const addQuickPreset = (minutes: number) => {
    clearSoundPreview();
    const futureTime = new Date();
    futureTime.setMinutes(futureTime.getMinutes() + minutes);

    const qDate = getLocalDateString(futureTime);
    const qTime = getLocalTimeString(futureTime);

    const newReminder: TaskReminder = {
      id: Math.random().toString(36).substring(2, 9),
      title: `⚡ Quick Reminder (${minutes}m)`,
      date: qDate,
      time: qTime,
      dateTimeString: `${qDate} ${qTime}`,
      completed: false,
      notified: false,
      createdAt: new Date().toISOString(),
      soundType: 'digital',
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
      if (activeFilter === 'completed') return matchesSearch && reminder.completed;
      if (activeFilter === 'upcoming') return matchesSearch && !reminder.completed;
      return matchesSearch;
    });
  }, [reminders, activeFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = reminders.length;
    const completed = reminders.filter(r => r.completed).length;
    const upcoming = total - completed;
    return { total, completed, upcoming };
  }, [reminders]);

  // Clock display
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors duration-300">
      
      {/* HEADER SECTION */}
      <header className="border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* App Title */}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
                <Bell className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">Task Reminders</h1>
                <p className="text-xs text-slate-500">System alert & audio alarms for your workflow</p>
              </div>
            </div>

            {/* Header Right Actions & Clock */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Open in Standalone Tab Button */}
              <button
                onClick={handleOpenNewTab}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-700 transition-all cursor-pointer shadow-2xs active:scale-95"
                title="Open app in a full browser tab for system permissions"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Standalone Tab</span>
              </button>

              {/* Closed Window Guide Modal Trigger */}
              <button
                onClick={() => setShowClosedGuide(true)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-all cursor-pointer shadow-2xs"
              >
                <Laptop className="h-3.5 w-3.5 text-indigo-600" />
                <span>Closed Window Guide</span>
              </button>

              {/* Clock Widget */}
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-900 text-white px-3 py-1.5 shadow-2xs">
                <Clock className="h-4 w-4 text-indigo-400" />
                <div className="text-right">
                  <div className="font-mono text-sm font-bold tracking-wider">
                    {clockDisplay.timeString} <span className="text-[10px] text-indigo-400">{clockDisplay.ampm}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* SYSTEM PERMISSION & IFRAME ACTION BANNERS */}
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        
        {/* Banner 1: If inside iFrame, provide 1-click Standalone tab button */}
        {isInIframe && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/90 p-4 shadow-2xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <h3 className="font-bold text-amber-950 text-sm">Action Needed for System Popups</h3>
                  <p className="mt-0.5 text-xs text-amber-800 leading-relaxed">
                    You are currently viewing this inside an <strong>AI Studio iFrame preview</strong>. Web browsers block system notification permission popups inside embedded frames.
                  </p>
                </div>
              </div>
              <button
                onClick={handleOpenNewTab}
                className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-amber-700 shadow-xs transition-all cursor-pointer active:scale-95"
              >
                <ExternalLink className="h-4 w-4" />
                Open Standalone App Tab
              </button>
            </div>
          </div>
        )}

        {/* Banner 2: Permission request if not granted and not in iframe */}
        {!isInIframe && notificationPermission !== 'granted' && (
          <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 shadow-2xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-indigo-950 text-sm">Enable Laptop System Notifications</h3>
                  <p className="mt-0.5 text-xs text-indigo-800">
                    Allow notifications so reminders pop up directly on your desktop screen even when working in other apps.
                  </p>
                </div>
              </div>
              <button
                onClick={requestNotificationPermission}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-all cursor-pointer"
              >
                <Bell className="h-4 w-4" />
                Allow Laptop Popups
              </button>
            </div>
          </div>
        )}

        {/* Banner 3: Closed Window Notification Capability status */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-emerald-900">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold">Background Sync Engine Ready</span>
            <span className="text-slate-500 hidden md:inline">• Service Worker registered for laptop background alerts.</span>
          </div>

          <div className="flex items-center gap-3">
            {deferredInstallPrompt && (
              <button
                onClick={handleInstallPWA}
                className="flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-100 hover:bg-indigo-200 px-2.5 py-1 rounded-lg transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Install Desktop App
              </button>
            )}

            <button
              onClick={() => setShowClosedGuide(true)}
              className="text-[11px] font-semibold text-slate-600 hover:text-indigo-700 underline underline-offset-2 cursor-pointer"
            >
              How do notifications work when window is closed?
            </button>
          </div>
        </div>

      </div>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        
        {/* STATS OVERVIEW CARDS */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Reminders</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pending Alerts</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{stats.upcoming}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.completed}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          {/* LEFT SIDE: ADD & CONFIG FORM */}
          <section className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  <h2 className="font-semibold text-slate-900">
                    {editingReminder ? 'Reschedule Reminder' : 'Set New Reminder'}
                  </h2>
                </div>
                {editingReminder && (
                  <button 
                    onClick={cancelEditing}
                    className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveReminder} className="space-y-4">
                {/* Title */}
                <div>
                  <label htmlFor="task-title" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Task Name / Reminder
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    required
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g. Call Client, Standup meeting, Take medication..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                {/* Date & Time Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="task-date" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Select Date
                    </label>
                    <input
                      id="task-date"
                      type="date"
                      required
                      value={taskDate}
                      min={getLocalDateString(new Date())}
                      onChange={(e) => setTaskDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <div>
                    <label htmlFor="task-time" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Select Time
                    </label>
                    <input
                      id="task-time"
                      type="time"
                      required
                      value={taskTime}
                      onChange={(e) => setTaskTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>

                {/* Sound Preset Picker */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Alarm Sound Preset
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'digital', label: 'Beep Beep', desc: 'Digital Alarm' },
                      { id: 'classic', label: 'Vintage Bell', desc: 'Mechanical Ring' },
                      { id: 'bell', label: 'Crystal Bell', desc: 'Decaying Strike' },
                      { id: 'gentle', label: 'Ambient Sweep', desc: 'Soothing Chord' }
                    ].map((sound) => (
                      <div 
                        key={sound.id}
                        className={`group relative flex items-center justify-between rounded-xl border p-2.5 text-left transition-all ${
                          soundType === sound.id 
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-950' 
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSoundType(sound.id as SoundType)}
                          className="flex-1 text-left outline-none cursor-pointer"
                        >
                          <p className="text-xs font-semibold">{sound.label}</p>
                          <p className="text-[9px] text-slate-400 mt-0.5">{sound.desc}</p>
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => toggleSoundPreview(sound.id as SoundType)}
                          className={`flex h-6 w-6 items-center justify-center rounded-md transition-all ${
                            isPreviewingSound === sound.id
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-400 hover:bg-slate-200/50 hover:text-slate-700'
                          }`}
                          title="Preview sound tone"
                        >
                          {isPreviewingSound === sound.id ? (
                            <VolumeX className="h-3.5 w-3.5 animate-bounce" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-100 hover:bg-indigo-700 active:scale-98 transition-all cursor-pointer"
                >
                  {editingReminder ? (
                    <>
                      <Check className="h-4 w-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Set Task Reminder
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* QUICK PRESET TESTER */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-5">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">Quick One-Click Tester</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3.5 leading-relaxed">
                Add an immediate trial reminder in 1 or 2 minutes to test sound and desktop notification delivery.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => addQuickPreset(1)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 1 min
                </button>
                <button
                  onClick={() => addQuickPreset(2)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 2 min
                </button>
                <button
                  onClick={() => addQuickPreset(5)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs transition-all cursor-pointer active:scale-95"
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
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
              
              <div className="flex bg-slate-100 rounded-lg p-0.5 self-start sm:self-auto">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    activeFilter === 'all' 
                      ? 'bg-white text-slate-900 shadow-2xs' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveFilter('upcoming')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    activeFilter === 'upcoming' 
                      ? 'bg-white text-indigo-700 shadow-2xs' 
                      : 'text-slate-500 hover:text-indigo-600'
                  }`}
                >
                  Upcoming
                </button>
                <button
                  onClick={() => setActiveFilter('completed')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    activeFilter === 'completed' 
                      ? 'bg-white text-emerald-700 shadow-2xs' 
                      : 'text-slate-500 hover:text-emerald-600'
                  }`}
                >
                  Completed
                </button>
              </div>

              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Tasks Container */}
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {filteredReminders.length > 0 ? (
                  filteredReminders.map((reminder) => {
                    const [year, month, day] = reminder.date.split('-').map(Number);
                    const [hour, min] = reminder.time.split(':').map(Number);
                    const isOverdue = !reminder.completed && (new Date(year, month - 1, day, hour, min).getTime() < Date.now());
                    
                    return (
                      <motion.div
                        key={reminder.id}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -50 }}
                        className={`group relative overflow-hidden rounded-2xl border bg-white p-4.5 transition-all shadow-2xs hover:shadow-xs ${
                          reminder.completed 
                            ? 'border-slate-100 opacity-60 bg-slate-50/55' 
                            : isOverdue 
                              ? 'border-rose-200 bg-rose-50/10'
                              : lastTestedTask === reminder.id
                                ? 'border-indigo-400 bg-indigo-50/20 ring-2 ring-indigo-100'
                                : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => toggleComplete(reminder.id)}
                              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all cursor-pointer ${
                                reminder.completed
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : isOverdue
                                    ? 'border-rose-300 hover:border-rose-500 hover:bg-rose-50/50'
                                    : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/30'
                              }`}
                            >
                              {reminder.completed && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                            </button>

                            <div>
                              <h3 className={`text-sm font-semibold tracking-tight text-slate-800 ${
                                reminder.completed ? 'line-through text-slate-400' : ''
                              }`}>
                                {reminder.title}
                              </h3>
                              
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400 text-[11px]">
                                <span className="flex items-center gap-1 font-medium">
                                  <CalendarDays className="h-3 w-3 text-slate-400" />
                                  {reminder.date}
                                </span>
                                <span className={`flex items-center gap-1 font-mono font-semibold ${
                                  reminder.completed 
                                    ? 'text-slate-400' 
                                    : isOverdue 
                                      ? 'text-rose-600' 
                                      : 'text-indigo-600'
                                }`}>
                                  <Clock className="h-3 w-3" />
                                  {reminder.time}
                                </span>
                                <span className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 capitalize text-[9px]">
                                  <Volume2 className="h-2.5 w-2.5 text-slate-400" />
                                  {reminder.soundType} sound
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                              reminder.completed
                                ? 'bg-emerald-100 text-emerald-800'
                                : isOverdue
                                  ? 'bg-rose-100 text-rose-800 animate-pulse'
                                  : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {reminder.completed ? 'Completed' : isOverdue ? 'Overdue' : 'Upcoming'}
                            </span>

                            {!reminder.completed && (
                              <button
                                onClick={() => {
                                  playSound(reminder.soundType);
                                  setActiveAlarm(reminder);
                                }}
                                className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 text-indigo-600 transition-all cursor-pointer"
                                title="Trigger Alert Now to Test Output"
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
                    className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 px-4 py-16 text-center"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <Bell className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 font-semibold text-slate-700">No Reminders Found</h3>
                    <p className="mt-1 text-xs text-slate-400 max-w-sm">
                      {searchQuery 
                        ? 'No tasks match your current search queries.' 
                        : 'You do not have any reminders set up yet. Add a reminder above to get started!'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>

      {/* MODAL: CLOSED WINDOW NOTIFICATION GUIDE */}
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
              className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <Laptop className="h-5 w-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-900">How to Receive Reminders When Window is Closed</h3>
                </div>
                <button
                  onClick={() => setShowClosedGuide(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 space-y-4 text-xs text-slate-600 leading-relaxed">
                <p>
                  When a web browser tab or window is completely terminated, standard client-side scripts pause execution. Here are 3 ways to ensure you never miss a reminder:
                </p>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">1</span>
                    <span>Open in Standalone Browser Tab</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    Click <strong>"Open in Standalone Tab"</strong> at the top. Allow browser notification permissions once in the standalone tab so your OS can deliver desktop popups.
                  </p>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">2</span>
                    <span>Background Service Worker Engine</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    This app includes a registered <strong>Background Service Worker</strong> and <strong>IndexedDB database</strong>. As long as your browser (Chrome/Edge/Brave/Safari) is open in the background, notifications will trigger even if this specific tab is closed!
                  </p>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-indigo-950">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">3</span>
                    <span>Install as Laptop Desktop App (PWA)</span>
                  </div>
                  <p className="pl-7 text-slate-600">
                    Click the <strong>Install Desktop App</strong> button or use your browser's address bar icon (Install Task Reminders) to add this app to your Windows/Mac Dock or Start Menu as a native desktop application.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={handleOpenNewTab}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition-all cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Standalone App Now
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
                <span>Ringing <strong>{activeAlarm.soundType}</strong> sound...</span>
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
                    className="flex items-center justify-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700/80 px-4 py-3 text-xs font-bold text-amber-400 border border-amber-400/20 transition-all cursor-pointer active:scale-98"
                  >
                    Snooze 5 Min
                  </button>
                  <button
                    onClick={() => handleSnooze(15)}
                    className="flex items-center justify-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700/80 px-4 py-3 text-xs font-bold text-amber-400 border border-amber-400/20 transition-all cursor-pointer active:scale-98"
                  >
                    Snooze 15 Min
                  </button>
                </div>

                <button
                  onClick={handleStopOnly}
                  className="flex w-full items-center justify-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-all cursor-pointer py-2.5"
                >
                  Stop Audio Alarm (Keep Pending)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
