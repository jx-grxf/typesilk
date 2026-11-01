# Roadmap

Decided on 2026-11-01. Phase 1 is frontend only and ships as one PR per feature.
Phase 2 adds a small backend once the data shapes from phase 1 have settled.

## Phase 1: breadth without losing the feel

### 1. Classic layout and typing chrome

- New layout `classic` next to `tape` and `lines`: three visible lines, smaller
  type, the config bar sits at the top and stays visible while idle. `tape` stays
  the default.
- Font setting: `serif` (Newsreader) or `mono` (JetBrains Mono, already a
  dependency). Letter positions are measured, so both work in every layout.
- Caret styles: `line`, `block`, `underline`, plus caret smoothness `off`,
  `medium`, `smooth` (spring stiffness presets).
- Live stats while typing: off, or wpm and accuracy above the text, quiet.
- Focus mode: everything except the text fades while typing and comes back on
  pointer movement. Today this is always on; it becomes a setting.

### 2. Command palette

`⌘K` / `ctrl+K` (and `⌘⇧P`) opens a fuzzy
list of every setting and action: mode, length, language, theme, font, layout,
caret, sound pack, restart, train. Keyboard only, closes on `esc`.

### 3. Quotes, zen and custom text

- `quote`: passages from public-domain works in English, German, Spanish and
  French, lengths short / medium / long. Source, author and work shown after the
  run. Only texts whose rights are clear.
- `zen`: no target text, type freely, `shift+enter` finishes.
- `custom`: paste a text, optionally shuffle words, repeat count.
- Normal word mode stays the default.

### 4. Sound packs

Three or four recorded CC0 packs (for example thock, clicky, typewriter, soft)
next to the current one. Each pack ships its licence file. Packs load lazily, only
the selected one is fetched.

### 5. Key heatmap and larger word lists

- Results show a keyboard with per-key error rate and speed, drawn from the
  existing per-letter stats. Layout follows the language (QWERTY / QWERTZ /
  AZERTY).
- Word lists: `200` (current) and `1k` per language, selectable.

### 6. Result card and transitions

- Result card rendered to canvas in the current theme: wpm, accuracy, mode,
  speed curve, date. Copy to clipboard or download as PNG. No server.
- Transitions: test and results morph into each other, the wpm number counts
  up, the chart draws itself. Respects `prefers-reduced-motion`.

### Deploy

A Cloudflare worker with static assets (`wrangler.jsonc`), custom domain
`typesilk.johannesgrof.me`. Builds come from Cloudflare's Git integration:
production on `main`, a preview URL per PR. Open Graph image from
`docs/typing.png`.

## Phase 2: shared stats, optional GitHub login

Platform: the same Cloudflare worker that serves the site, with routes under
`/api` and a D1 database.

### Identity

- Typing never needs an account. Anonymous runs get a random device id
  (`crypto.randomUUID`) plus a secret token in `localStorage`; the server stores
  only a hash of the token. Anonymous runs count for the global `/stats`.
- **Sign in with GitHub** (decided 2026-11-01, GitHub only for now): an OAuth app,
  `/api/auth/github` redirects, the callback exchanges the code with the client
  secret (a worker secret), reads id, login and avatar, and sets an HttpOnly,
  Secure, SameSite=Lax session cookie backed by a sessions table in D1.
- **Leaderboards and public profiles need a login.** No free-text names, so no
  name moderation; banning a cheater bans the GitHub id.
- First login takes over the local data once: level, streak, records and key
  stats. Records that were not replayed on the server show on the profile but
  never on a leaderboard.

### Features

- **Leaderboards**: daily and all-time per setup (mode, length, language). Best
  run per device per board.
- **Activity graph on public profiles**: words per day like the local `/me`
  page, but counted only from runs the server replayed. Zen never counts, since
  it has no target text. Local `days` are not uploaded as activity.
- **Ghosts of others**: race the stored keystroke timeline of a leaderboard run
  or of a friend via a share code.
- **`/stats` page**: total keystrokes, runs, hours typed, words per language,
  most-mistyped letters worldwide, fastest run today, distribution of wpm,
  active typists in the last 24 h, records over time.
- More ideas to check later: weekly challenge with a fixed seed, "your
  percentile" on the results page, per-language records.

### Anti-cheat

The client never sends a result, only the evidence:

1. The server issues a run ticket: seed, setup, issue time, signed (HMAC).
2. Words are generated from the seed with the same deterministic generator on
   client and server.
3. On finish the client sends the ticket and the full keystroke log
   (key, timestamp delta).
4. The server replays the log through the same `TypingEngine` and computes wpm,
   accuracy and duration itself.
5. Plausibility: ticket age vs. run duration, inter-key timing distribution
   (no constant intervals, no sub-human minimums), wpm ceiling per mode,
   duplicate log detection.
6. Rate limits per IP and device (Cloudflare rate limiting rules + D1 counters),
   Turnstile on name changes.
7. Suspicious runs are stored but hidden from boards until reviewed.

This means the engine and word generator must stay pure and shared, which phase 1
should keep in mind: no DOM or `Math.random` inside them without injection.
