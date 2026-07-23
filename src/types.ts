export interface TaskReminder {
  id: string;
  title: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  dateTimeString: string; // Combined ISO or formatted date-time string
  completed: boolean;
  notified: boolean;
  createdAt: string;
  soundType: 'digital' | 'classic' | 'bell' | 'gentle';
  category?: 'Work' | 'Personal' | 'Health' | 'Urgent' | 'General';
  priority?: 'high' | 'medium' | 'low';
}

export type SoundType = 'digital' | 'classic' | 'bell' | 'gentle';
export type TaskCategory = 'Work' | 'Personal' | 'Health' | 'Urgent' | 'General';
export type TaskPriority = 'high' | 'medium' | 'low';
