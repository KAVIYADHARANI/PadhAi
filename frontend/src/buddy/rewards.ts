/**
 * Rewards, Streak Grace, XP, and Desk Accessories for Study Buddy.
 * Strictly implements README Section 11.1 and Phase 7 Task 7C:
 * - Daily goal ring calculation
 * - Streak with grace (a missed day pauses it, never resets with guilt)
 * - XP and Level calculations
 * - Data-driven unlock definitions for hats and desk accessories
 */

export interface DailyGoalProgress {
  targetMinutes: number;
  studiedMinutes: number;
  percentage: number;
  isComplete: boolean;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastStudiedDate: string | null; // YYYY-MM-DD
  graceDaysUsed: number;
  maxGraceDays: number;
  isStreakActive: boolean;
  streakMessage: string;
}

export interface AccessoryItem {
  id: string;
  name: string;
  category: "hat" | "desk";
  description: string;
  requiredXp?: number;
  requiredStreak?: number;
  requiredPomodoros?: number;
  icon: string;
}

export const UNLOCKABLE_ACCESSORIES: AccessoryItem[] = [
  // Hats
  {
    id: "hat_none",
    name: "Classic",
    category: "hat",
    description: "Default clean mascot look.",
    icon: "mascot_default",
  },
  {
    id: "hat_grad_cap",
    name: "Graduation Cap",
    category: "hat",
    description: "Earned by reaching Level 2 (100 XP).",
    requiredXp: 100,
    icon: "mortarboard",
  },
  {
    id: "hat_headphones",
    name: "Lo-Fi Headphones",
    category: "hat",
    description: "Unlocked after completing 3 Pomodoro sessions.",
    requiredPomodoros: 3,
    icon: "headphones",
  },
  {
    id: "hat_crown",
    name: "Focus Crown",
    category: "hat",
    description: "Earned with a 5-day study streak.",
    requiredStreak: 5,
    icon: "crown",
  },
  // Desk Items
  {
    id: "desk_chai",
    name: "Hot Chai Cup",
    category: "desk",
    description: "Fresh tea on your desk to keep you warm.",
    icon: "coffee",
  },
  {
    id: "desk_succulent",
    name: "Study Succulent",
    category: "desk",
    description: "A green desk companion unlocked at Level 2.",
    requiredXp: 150,
    icon: "sprout",
  },
  {
    id: "desk_lamp",
    name: "Cozy Desk Lamp",
    category: "desk",
    description: "Warm glow unlocked after 5 Pomodoro sessions.",
    requiredPomodoros: 5,
    icon: "lamp",
  },
  {
    id: "desk_trophy",
    name: "Mastery Trophy",
    category: "desk",
    description: "Unlocked with 500 XP.",
    requiredXp: 500,
    icon: "trophy",
  },
];

/**
 * Calculates daily study goal progress ring (0 - 100%).
 */
export function calculateDailyGoal(studiedSeconds: number, targetMinutes: number = 25): DailyGoalProgress {
  const studiedMinutes = Math.round((studiedSeconds / 60) * 10) / 10;
  const percentage = Math.min(100, Math.round((studiedMinutes / Math.max(1, targetMinutes)) * 100));

  return {
    targetMinutes,
    studiedMinutes,
    percentage,
    isComplete: percentage >= 100,
  };
}

/**
 * Computes level and progress to next level from total XP.
 * Level = floor(sqrt(XP / 50)) + 1
 */
export function calculateLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const validXp = Math.max(0, xp);
  const level = Math.floor(Math.sqrt(validXp / 50)) + 1;
  const currentLevelXp = Math.pow(level - 1, 2) * 50;
  const nextLevelXp = Math.pow(level, 2) * 50;
  const diff = nextLevelXp - currentLevelXp;
  const progressPercent = Math.min(
    100,
    Math.round(((validXp - currentLevelXp) / Math.max(1, diff)) * 100)
  );

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    progressPercent,
  };
}

/**
 * Streak with Grace Logic:
 * A missed day uses a grace pause rather than resetting with guilt!
 * Only missing two or more consecutive days without grace pauses/resets the active streak.
 */
export function updateStreakWithGrace(
  currentStreak: StreakState,
  studyDateStr: string // YYYY-MM-DD
): StreakState {
  const lastDateStr = currentStreak.lastStudiedDate;
  if (!lastDateStr) {
    // First day ever
    return {
      currentStreak: 1,
      longestStreak: Math.max(1, currentStreak.longestStreak),
      lastStudiedDate: studyDateStr,
      graceDaysUsed: 0,
      maxGraceDays: 1,
      isStreakActive: true,
      streakMessage: "1-day streak! Welcome aboard.",
    };
  }

  if (lastDateStr === studyDateStr) {
    // Already counted today
    return currentStreak;
  }

  const lastDate = new Date(`${lastDateStr}T00:00:00Z`);
  const currentDate = new Date(`${studyDateStr}T00:00:00Z`);
  const diffDays = Math.round((currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    // Consecutive day
    const newStreak = currentStreak.currentStreak + 1;
    return {
      currentStreak: newStreak,
      longestStreak: Math.max(newStreak, currentStreak.longestStreak),
      lastStudiedDate: studyDateStr,
      graceDaysUsed: 0,
      maxGraceDays: 1,
      isStreakActive: true,
      streakMessage: `${newStreak}-day streak! Keep up the great pace.`,
    };
  }

  if (diffDays === 2) {
    // Missed exactly 1 day -> Streak Grace activated!
    // Streak is preserved without guilt
    const newStreak = currentStreak.currentStreak + 1;
    return {
      currentStreak: newStreak,
      longestStreak: Math.max(newStreak, currentStreak.longestStreak),
      lastStudiedDate: studyDateStr,
      graceDaysUsed: 1,
      maxGraceDays: 1,
      isStreakActive: true,
      streakMessage: `Streak preserved with grace! Welcome back at ${newStreak} days.`,
    };
  }

  // Missed 3+ days: Grace is exhausted, but start fresh with a warm, encouraging welcome
  return {
    currentStreak: 1,
    longestStreak: currentStreak.longestStreak,
    lastStudiedDate: studyDateStr,
    graceDaysUsed: 0,
    maxGraceDays: 1,
    isStreakActive: true,
    streakMessage: "Fresh start today! Consistency is built one step at a time.",
  };
}

/**
 * Checks which accessories are unlocked based on player statistics.
 */
export function getUnlockedAccessories(stats: {
  xp: number;
  streak: number;
  pomodoros: number;
}): {
  unlocked: AccessoryItem[];
  locked: AccessoryItem[];
} {
  const unlocked: AccessoryItem[] = [];
  const locked: AccessoryItem[] = [];

  for (const item of UNLOCKABLE_ACCESSORIES) {
    let isUnlocked = true;
    if (item.requiredXp && stats.xp < item.requiredXp) isUnlocked = false;
    if (item.requiredStreak && stats.streak < item.requiredStreak) isUnlocked = false;
    if (item.requiredPomodoros && stats.pomodoros < item.requiredPomodoros) isUnlocked = false;

    if (isUnlocked) {
      unlocked.push(item);
    } else {
      locked.push(item);
    }
  }

  return { unlocked, locked };
}
