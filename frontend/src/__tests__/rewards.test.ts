import { describe, expect, it } from "vitest";
import {
  calculateDailyGoal,
  calculateLevelFromXp,
  getUnlockedAccessories,
  StreakState,
  updateStreakWithGrace,
} from "../buddy/rewards";

describe("Study Buddy Phase 7C - Rewards, Streak Grace, and Accessories", () => {
  describe("Daily Goal Ring", () => {
    it("calculates percentage and completion accurately", () => {
      // 15 minutes studied with 30 min target
      const half = calculateDailyGoal(15 * 60, 30);
      expect(half.studiedMinutes).toBe(15);
      expect(half.percentage).toBe(50);
      expect(half.isComplete).toBe(false);

      // 30 minutes studied with 30 min target
      const done = calculateDailyGoal(30 * 60, 30);
      expect(done.percentage).toBe(100);
      expect(done.isComplete).toBe(true);

      // Overachieved goal
      const over = calculateDailyGoal(45 * 60, 30);
      expect(over.percentage).toBe(100);
      expect(over.isComplete).toBe(true);
    });
  });

  describe("Streak with Grace", () => {
    const initialStreak: StreakState = {
      currentStreak: 3,
      longestStreak: 5,
      lastStudiedDate: "2026-10-25",
      graceDaysUsed: 0,
      maxGraceDays: 1,
      isStreakActive: true,
      streakMessage: "3-day streak!",
    };

    it("increments streak on consecutive day", () => {
      const updated = updateStreakWithGrace(initialStreak, "2026-10-26");
      expect(updated.currentStreak).toBe(4);
      expect(updated.graceDaysUsed).toBe(0);
      expect(updated.isStreakActive).toBe(true);
      expect(updated.streakMessage).toContain("4-day streak");
    });

    it("preserves streak using grace when exactly 1 day is missed (guilt-free)", () => {
      // Missed 2026-10-26, studying on 2026-10-27
      const updated = updateStreakWithGrace(initialStreak, "2026-10-27");
      expect(updated.currentStreak).toBe(4); // Preserved and incremented!
      expect(updated.graceDaysUsed).toBe(1);
      expect(updated.isStreakActive).toBe(true);
      expect(updated.streakMessage).toContain("preserved with grace");
    });

    it("resets to 1 warmly without guilt when grace is exceeded (>1 day missed)", () => {
      // Missed 2026-10-26 and 2026-10-27, studying on 2026-10-28 (diff = 3)
      const updated = updateStreakWithGrace(initialStreak, "2026-10-28");
      expect(updated.currentStreak).toBe(1);
      expect(updated.longestStreak).toBe(5); // Preserves historical record
      expect(updated.streakMessage).toContain("Fresh start today");
      expect(updated.streakMessage).not.toContain("lost");
      expect(updated.streakMessage).not.toContain("failed");
    });

    it("is idempotent when studying multiple times on the same day", () => {
      const sameDay = updateStreakWithGrace(initialStreak, "2026-10-25");
      expect(sameDay).toEqual(initialStreak);
    });
  });

  describe("XP and Level System", () => {
    it("computes level and next level progress", () => {
      // Level 1: 0 - 50 XP
      const lvl1 = calculateLevelFromXp(25);
      expect(lvl1.level).toBe(1);
      expect(lvl1.currentLevelXp).toBe(0);
      expect(lvl1.nextLevelXp).toBe(50);
      expect(lvl1.progressPercent).toBe(50);

      // Level 2: 50 - 200 XP
      const lvl2 = calculateLevelFromXp(100);
      expect(lvl2.level).toBe(2);
      expect(lvl2.currentLevelXp).toBe(50);
      expect(lvl2.nextLevelXp).toBe(200);
      expect(lvl2.progressPercent).toBe(33);
    });
  });

  describe("Unlockable Accessories", () => {
    it("unlocks accessories based on stats milestones", () => {
      const earlyStats = { xp: 50, streak: 1, pomodoros: 1 };
      const early = getUnlockedAccessories(earlyStats);

      // Chai cup and classic hat are always unlocked
      expect(early.unlocked.some((i) => i.id === "hat_none")).toBe(true);
      expect(early.unlocked.some((i) => i.id === "desk_chai")).toBe(true);
      // Crown requires 5-day streak
      expect(early.locked.some((i) => i.id === "hat_crown")).toBe(true);

      const advancedStats = { xp: 550, streak: 6, pomodoros: 6 };
      const advanced = getUnlockedAccessories(advancedStats);

      expect(advanced.unlocked.some((i) => i.id === "hat_crown")).toBe(true);
      expect(advanced.unlocked.some((i) => i.id === "hat_grad_cap")).toBe(true);
      expect(advanced.unlocked.some((i) => i.id === "desk_trophy")).toBe(true);
      expect(advanced.locked).toHaveLength(0);
    });
  });
});
