import { dailyKey, dailyNumber } from "./daily";
import { $ } from "./dom";
import { levelOf, levelProgress, localDay, type Profile } from "./profile";
import type { Settings } from "./settings";

/** Level, streak flame, words-per-day goal and the daily link above the test. `flare` relights the flame. */
export function renderTopBar(profile: Profile, settings: Settings, flare = false): void {
  const level = $("level");
  level.querySelector("b")!.textContent = `Level ${levelOf(profile.xp)}`;
  level.querySelector<HTMLElement>(".level-fill")!.style.transform = `scaleX(${levelProgress(profile.xp)})`;
  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400000));
  const typedToday = profile.lastDay === today;
  const alive = typedToday || profile.lastDay === yesterday;

  const streak = $("streak");
  streak.hidden = !(alive && profile.streakDays > 0);
  streak.querySelector("b")!.textContent = String(profile.streakDays);
  streak.classList.toggle("lit", typedToday);
  streak.title = typedToday
    ? `${profile.streakDays}-day streak, today is in`
    : `${profile.streakDays}-day streak, type today to keep it`;
  if (flare && typedToday) {
    streak.classList.remove("flare");
    void streak.offsetWidth;
    streak.classList.add("flare");
  }

  const goal = $("goal");
  const words = profile.days[today]?.words ?? 0;
  goal.hidden = settings.dailyGoal === 0;
  goal.classList.toggle("done", words >= settings.dailyGoal);
  goal.title = `${words} of ${settings.dailyGoal} words today`;
  goal.querySelector<HTMLElement>(".goal-fill")!.style.transform = `scaleX(${Math.min(words / Math.max(settings.dailyGoal, 1), 1)})`;

  const daily = $("daily-link");
  const number = dailyNumber();
  const done = profile.dailies[dailyKey(number, settings.language)];
  daily.textContent = `daily #${number}`;
  daily.classList.toggle("open", !done);
  daily.title = done ? `Your first try today: ${Math.round(done.wpm)} wpm` : "Today's words, the same for everyone";
}
