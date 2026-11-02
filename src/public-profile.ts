import "./profile.css";
import { avatarNode } from "./avatar";
import { BADGES, badgeCard, RARITIES, showcase } from "./badges";
import { emptyProfile, type Profile } from "./profile";
import { renderActivity, setupName } from "./profile-view";
import type { PublicProfile } from "./public-profile-data";
import { buildChart } from "./results";

const number = new Intl.NumberFormat("en-GB");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function figure(label: string, value: string, unit = ""): HTMLElement {
  const wrap = el("div", "figure");
  const dd = el("dd", "", value);
  if (unit) dd.append(el("small", "", unit));
  wrap.append(el("dt", "", label), dd);
  return wrap;
}

/** Just enough of a Profile for the badge pieces, which only look at the badges. */
function asProfile(data: PublicProfile): Profile {
  return { ...emptyProfile(), badges: data.badges };
}

function render(root: HTMLElement, data: PublicProfile): void {
  const name = data.displayName ?? data.username;
  document.title = `${name} | typesilk`;
  const profile = asProfile(data);

  const head = el("section", "profile-head");
  const identity = el("div", "identity");
  const avatar = el("span", "avatar");
  avatar.setAttribute("aria-hidden", "true");
  avatar.append(avatarNode(data.username));
  const who = el("div", "who");
  const earned = BADGES.filter((badge) => data.badges[badge.id]).length;
  who.append(el("h2", "", name), el("p", "", `@${data.username} · Level ${data.level} · ${earned} of ${BADGES.length} badges`));
  const shelf = el("div", "showcase");
  for (const badge of showcase(profile)) shelf.append(badgeCard(badge, profile).querySelector("svg")!);
  identity.append(avatar, who, shelf);

  const best = Math.max(0, ...Object.values(data.bests).map((b) => b.wpm));
  const figures = el("dl", "figures");
  figures.append(
    figure("best", best > 0 ? String(Math.round(best)) : "–", best > 0 ? "wpm" : ""),
    figure("streak", String(data.streakDays), data.streakDays === 1 ? "day" : "days"),
    figure("runs", number.format(data.tests)),
    figure("words", number.format(data.words)),
  );
  head.append(identity, figures);

  const parts: HTMLElement[] = [head, renderActivity(data.days)];
  if (data.recent.length >= 3) {
    parts.push(buildChart(data.recent, {
      title: "Speed over the latest runs",
      description: "Words per minute of each recent run, oldest first",
      tick: (i) => `#${i + 1}`,
      point: (i) => `run ${i + 1}`,
    }));
  }

  const badges = el("section", "badges");
  badges.append(el("h3", "", "Badges"));
  const grid = el("div", "badge-grid");
  const owned = BADGES.filter((badge) => data.badges[badge.id])
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  for (const badge of owned) grid.append(badgeCard(badge, profile));
  if (owned.length === 0) grid.append(el("p", "empty", "No badges yet."));
  badges.append(grid);
  parts.push(badges);

  const records = el("section", "records");
  records.append(el("h3", "", "Records"));
  for (const [key, record] of Object.entries(data.bests).sort(([, a], [, b]) => b.wpm - a.wpm)) {
    const row = el("div", "stat");
    const value = el("span", "stat-value", `${Math.round(record.wpm)} `);
    value.append(el("small", "", `wpm · ${Math.round(record.accuracy)}%`));
    row.append(el("span", "stat-label", setupName(key)), value);
    records.append(row);
  }
  parts.push(records);

  root.replaceChildren(...parts);
}

async function load(): Promise<void> {
  const root = document.getElementById("public-profile")!;
  const status = document.getElementById("public-status")!;
  const username = location.pathname.split("/")[2] ?? "";
  try {
    const response = await fetch(`/api/u/${encodeURIComponent(username)}`);
    if (response.status === 404) {
      status.textContent = "There is no public profile under this name.";
      return;
    }
    if (response.status === 429) {
      status.textContent = "Too many requests. Try again in a minute.";
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    render(root, (await response.json()) as PublicProfile);
  } catch {
    status.textContent = "The profile couldn't be loaded. Try again later.";
  }
}

void load();
