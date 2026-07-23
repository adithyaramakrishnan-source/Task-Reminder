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
}

export type SoundType = 'digital' | 'classic' | 'bell' | 'gentle';
