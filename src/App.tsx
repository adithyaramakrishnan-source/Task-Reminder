import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import { 
  Clock, 
  Calendar, 
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
  Info,
  CalendarDays,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playSound, stopSound } from './utils/audio';
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
      console.error('Failed to load reminders', e);
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
    // Default to 5 minutes from now
    now.setMinutes(now.getMinutes() + 5);
    return getLocalTimeString(now);
  });
  const [soundType, setSoundType] = useState<SoundType>('digital');

  // Interactive filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [editingReminder, setEditingReminder] = useState<TaskReminder | null>(null);

  // System notification permissions
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isInIframe, setIsInIframe] = useState(false);

  // Currently firing active alarm
  const [activeAlarm, setActiveAlarm] = useState<TaskReminder | null>(null);
  const [isPreviewingSound, setIsPreviewingSound] = useState<SoundType | null>(null);

  // Track user-triggered test flag for clean visual state
  const [lastTestedTask, setLastTestedTask] = useState<string | null>(null);

  // Initialize and check iframe state and notification permission
  useEffect(() => {
    // Detect iframe
    setIsInIframe(window.self !== window.top);

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // Sync reminders with Local Storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  }, [reminders]);

  // Keep digital clock ticking every 1 second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // System Reminder Check Engine: Runs every tick of currentTime
  useEffect(() => {
    if (activeAlarm) return; // Wait until current firing alarm is addressed

    const now = new Date();
    const todayStr = getLocalDateString(now);
    const timeStr = getLocalTimeString(now);

    // Find any pending task that has reached or passed its scheduled time
    const dueReminder = reminders.find(reminder => {
      if (reminder.completed || reminder.notified) return false;

      // Parse schedule
      const [sYear, sMonth, sDay] = reminder.date.split('-').map(Number);
      const [sHour, sMin] = reminder.time.split(':').map(Number);
      const scheduledDate = new Date(sYear, sMonth - 1, sDay, sHour, sMin, 0, 0);

      return now.getTime() >= scheduledDate.getTime();
    });

    if (dueReminder) {
      // 1. Instantly flag as notified in state/cache to prevent duplicate trigger loops
      setReminders(prev => prev.map(r => r.id === dueReminder.id ? { ...r, notified: true } : r));
      
      // 2. Open active alarm screen
      setActiveAlarm(dueReminder);

      // 3. Play the looping audio synthesized in our audio engine
      playSound(dueReminder.soundType);

      // 4. Fire the System Level Browser Notification
      triggerDesktopNotification(dueReminder);
    }
  }, [currentTime, reminders, activeAlarm]);

  // Fire system level notification
  const triggerDesktopNotification = (reminder: TaskReminder) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification(`🔔 Task Due: ${reminder.title}`, {
          body: `Scheduled for ${reminder.time} on ${reminder.date}. Click to dismiss alarm.`,
          tag: reminder.id,
          requireInteraction: true,
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch (err) {
        console.warn('Notification API crashed, falling back to fully-featured in-app alert.', err);
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
        // Send a celebratory confirmation pop-up
        new Notification('Reminders Connected! 🔔', {
          body: 'You will now receive system notifications on your laptop when tasks are due.',
        });
      }
    } catch (err) {
      console.error('Error requesting notification permissions', err);
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
      // Automatically stop preview sound after 2.5s for bells/chimes or if user leaves it
      setTimeout(() => {
        setIsPreviewingSound(prev => prev === type ? null : prev);
      }, 2500);
    }
  };

  // Stop any active preview on form submit or changes
  const clearSoundPreview = () => {
    if (isPreviewingSound) {
      stopSound();
      setIsPreviewingSound(null);
    }
  };

  // Form submission: Create or Update Task
  const handleSaveReminder = (e: FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    clearSoundPreview();

    if (editingReminder) {
      // Update existing
      setReminders(prev => prev.map(r => r.id === editingReminder.id ? {
        ...r,
        title: taskTitle.trim(),
        date: taskDate,
        time: taskTime,
        dateTimeString: `${taskDate} ${taskTime}`,
        soundType,
        completed: false, // Reset completion when rescheduling
        notified: false,  // Reset notification flag to fire again
      } : r));
      setEditingReminder(null);
    } else {
      // Add new
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

    // Reset fields
    setTaskTitle('');
    // Set default time to 5 minutes in future
    const defaultFuture = new Date();
    defaultFuture.setMinutes(defaultFuture.getMinutes() + 5);
    setTaskTime(getLocalTimeString(defaultFuture));
  };

  // Quick Preset Adders (e.g. +1 Min, +2 Min, +5 Min)
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

    // Auto clear last tested notification banner highlight after 4 seconds
    setTimeout(() => {
      setLastTestedTask(null);
    }, 4000);
  };

  // Alarm Handle Action: Dismiss & Mark Complete
  const handleDismissComplete = () => {
    if (!activeAlarm) return;
    stopSound();
    setReminders(prev => prev.map(r => r.id === activeAlarm.id ? { ...r, completed: true } : r));
    setActiveAlarm(null);
  };

  // Alarm Handle Action: Snooze
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
          notified: false, // reset so it will fire again
          completed: false,
        };
      }
      return r;
    }));

    setActiveAlarm(null);
  };

  // Alarm Handle Action: Stop sound, leave pending
  const handleStopOnly = () => {
    stopSound();
    setActiveAlarm(null);
  };

  // Toggle complete manually in list
  const toggleComplete = (id: string) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: !r.completed } : r));
  };

  // Delete reminder
  const deleteReminder = (id: string) => {
    clearSoundPreview();
    setReminders(prev => prev.filter(r => r.id !== id));
    if (editingReminder?.id === id) {
      setEditingReminder(null);
      setTaskTitle('');
    }
  };

  // Populate form to edit reminder
  const startEditing = (reminder: TaskReminder) => {
    clearSoundPreview();
    setEditingReminder(reminder);
    setTaskTitle(reminder.title);
    setTaskDate(reminder.date);
    setTaskTime(reminder.time);
    setSoundType(reminder.soundType);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Cancel editing mode
  const cancelEditing = () => {
    setEditingReminder(null);
    setTaskTitle('');
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    setTaskTime(getLocalTimeString(now));
  };

  // Filtered and searched reminders list
  const filteredReminders = useMemo(() => {
    return reminders.filter(reminder => {
      const matchesSearch = reminder.title.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (activeFilter === 'completed') {
        return matchesSearch && reminder.completed;
      }
      if (activeFilter === 'upcoming') {
        return matchesSearch && !reminder.completed;
      }
      return matchesSearch;
    });
  }, [reminders, activeFilter, searchQuery]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = reminders.length;
    const completed = reminders.filter(r => r.completed).length;
    const upcoming = total - completed;
    return { total, completed, upcoming };
  }, [reminders]);

  // Clock formatter for visual display
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
    hours = hours ? hours : 12; // conversion of 0 to 12
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
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Title Block */}
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
                <Bell className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Task Reminders</h1>
                <p className="text-xs text-slate-500">System alert & sound notifications for your scheduled workflow</p>
              </div>
            </div>

            {/* Glowing Monospace Clock Widget */}
            <div className="flex items-center gap-3 rounded-2xl border border-indigo-50 bg-indigo-50/40 p-3 pr-4">
              <Clock className="h-5 w-5 text-indigo-600" />
              <div className="text-right">
                <div className="font-mono text-lg font-bold tracking-wider text-indigo-950">
                  {clockDisplay.timeString} <span className="text-xs font-semibold text-indigo-600">{clockDisplay.ampm}</span>
                </div>
                <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                  {clockDisplay.dateString}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* CORE ALERTS & HELP BAR */}
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        
        {/* Permission and Iframe Constraints Warning */}
        <AnimatePresence mode="wait">
          {notificationPermission !== 'granted' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-xs"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <h3 className="font-semibold text-amber-900 text-sm">Enable Laptop System Notifications</h3>
                    <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                      To make reminders pop up directly on your desktop notification center (even when working in other tabs), please allow browser notifications.
                      {isInIframe && (
                        <span className="block mt-1 font-medium text-amber-800">
                          💡 <strong>Notice:</strong> You are currently viewing this in an iframe frame. For security, browsers block system notification permission queries inside iframes. <strong>Click 'Open in New Tab' in the top right menu</strong> to authorize and receive real pop-ups!
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {!isInIframe && (
                  <button
                    onClick={requestNotificationPermission}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 transition-all cursor-pointer active:scale-95"
                  >
                    <BellRing className="h-4 w-4" />
                    Allow System Popups
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {notificationPermission === 'granted' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-2.5"
            >
              <div className="flex items-center gap-2 text-emerald-800 text-xs">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="font-semibold text-emerald-900">Desktop Push Notifications Enabled</span>
                <span>• Reminders will trigger system level OS popups on your laptop!</span>
              </div>
              <button 
                onClick={() => {
                  if ('Notification' in window) {
                    new Notification('Reminders Test! 🔔', {
                      body: 'This is an instant check to verify that system notifications are reaching your OS screen.',
                    });
                  }
                }}
                className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
              >
                Send Quick Test
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        
        {/* STATS OVERVIEW CARDS */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Reminders</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pending Alerts</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{stats.upcoming}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.completed}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          {/* LEFT SIDE: ADD & CONFIG FORM */}
          <section className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
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
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveReminder} className="space-y-4">
                {/* Title */}
                <div>
                  <label htmlFor="task-name" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Task Reminder Title
                  </label>
                  <input
                    id="task-name"
                    type="text"
                    required
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g. Call Client, Standup meeting, Drink water..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                {/* Date & Time Input Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="task-date" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Select Date
                    </label>
                    <div className="relative">
                      <input
                        id="task-date"
                        type="date"
                        required
                        value={taskDate}
                        min={getLocalDateString(new Date())}
                        onChange={(e) => setTaskDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 pl-3.5 pr-2 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>
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

                {/* Sound preset select and preview */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Alarm Sound Preset
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'digital', label: 'Beep Beep', desc: 'Digital Alarm' },
                      { id: 'classic', label: 'Vintage Bell', desc: 'Mechanical Telephone' },
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

            {/* QUICK PRESETS BOX FOR RAPID TESTING */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-5">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">Quick One-Click Tester</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3.5 leading-relaxed">
                Add an immediate trial reminder in exactly 1 or 2 minutes to verify system volume and notifications on your laptop screen.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => addQuickPreset(1)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs hover:shadow-sm transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 1 min
                </button>
                <button
                  onClick={() => addQuickPreset(2)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs hover:shadow-sm transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  In 2 min
                </button>
                <button
                  onClick={() => addQuickPreset(5)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-white border border-indigo-100 hover:border-indigo-400 px-2 py-2.5 text-xs font-semibold text-indigo-700 shadow-2xs hover:shadow-sm transition-all cursor-pointer active:scale-95"
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
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              
              {/* Filter pills */}
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

              {/* Search */}
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
                            {/* Complete Tick Box */}
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

                            {/* Task Info details */}
                            <div>
                              <h3 className={`text-sm font-semibold tracking-tight text-slate-800 ${
                                reminder.completed ? 'line-through text-slate-400' : ''
                              }`}>
                                {reminder.title}
                              </h3>
                              
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400 text-[11px]">
                                {/* Scheduled date */}
                                <span className="flex items-center gap-1 font-medium">
                                  <CalendarDays className="h-3 w-3 text-slate-400" />
                                  {reminder.date}
                                </span>
                                {/* Scheduled time */}
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
                                {/* Sound chosen */}
                                <span className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 capitalize text-[9px]">
                                  <Volume2 className="h-2.5 w-2.5 text-slate-400" />
                                  {reminder.soundType} sound
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action Controls */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Status Pill */}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                              reminder.completed
                                ? 'bg-emerald-100 text-emerald-800'
                                : isOverdue
                                  ? 'bg-rose-100 text-rose-800 animate-pulse'
                                  : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {reminder.completed ? 'Completed' : isOverdue ? 'Overdue' : 'Upcoming'}
                            </span>

                            {/* Trigger Immediate Alarm Simulation (Perfect helper for checking laptop volume) */}
                            {!reminder.completed && (
                              <button
                                onClick={() => {
                                  // Immediate alarm sound test
                                  playSound(reminder.soundType);
                                  setActiveAlarm(reminder);
                                }}
                                className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 text-indigo-600 transition-all cursor-pointer"
                                title="Trigger Alert Now to Test Output"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {/* Edit Button */}
                            {!reminder.completed && (
                              <button
                                onClick={() => startEditing(reminder)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                                title="Edit reminder details"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {/* Delete Button */}
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
                        ? 'No tasks match your current search queries. Try clearing parameters!' 
                        : 'You do not have any reminders set up yet. Use the form on the left to set a reminder or trigger a 1-minute quick test!'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>

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
              {/* Animated Alarm Rings / Radiating Waves */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1/2 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                <div className="absolute h-48 w-48 rounded-full border border-indigo-500/10 animate-ping" />
                <div className="absolute h-36 w-36 rounded-full border border-indigo-500/20 animate-ping [animation-delay:0.3s]" />
                <div className="absolute h-24 w-24 rounded-full border border-indigo-500/30 animate-ping [animation-delay:0.6s]" />
              </div>

              {/* Icon & Title */}
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

              {/* Sound preset notice */}
              <div className="relative mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400 bg-slate-800/40 py-1.5 px-3 rounded-lg w-max mx-auto">
                <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
                <span>Ringing <strong>{activeAlarm.soundType}</strong> sound...</span>
              </div>

              {/* Big Responsive Action Controls */}
              <div className="relative mt-8 space-y-3">
                {/* Dismiss & Mark Complete */}
                <button
                  onClick={handleDismissComplete}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3.5 font-semibold text-white shadow-lg shadow-emerald-950/40 transition-all cursor-pointer active:scale-98"
                >
                  <CheckCircle className="h-5 w-5" />
                  Dismiss & Mark Completed
                </button>

                {/* Snooze Options Grid */}
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

                {/* Stop Sound But Keep Task Active */}
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
