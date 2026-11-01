import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./tokens.css";
import "./style.css";
import { currentAccount, loadAccount, onAccountDeleted, onBeforeSignOut, prepareTicket } from "./account";
import { fillAvatar, onAccountChange, openNames, openSignIn } from "./account-view";
import { awardBadges } from "./badges";
import { commands } from "./commands";
import { CustomTextDialog } from "./custom-text";
import { dailyNumber } from "./daily";
import { $, prefersReducedMotion, withTransition } from "./dom";
import { listenForKeys } from "./keyboard";
import { Palette } from "./palette";
import { ProfilePage } from "./profile-page";
import { ProfileStore } from "./profile-store";
import { QUOTE_LENGTHS } from "./quotes";
import { TypingSession } from "./session";
import { loadSettings, MODES, saveSettings, type Mode, type Settings } from "./settings";
import { Sound } from "./sound";
import { applySpringTokens } from "./spring";
import { renderTopBar } from "./top-bar";
import { buildPanel, segment, toggleWord, type Segment } from "./ui";
import { LANGUAGES, type Language } from "./words";

// changing any of these throws away the current test
const TEST_KEYS: (keyof Settings)[] = [
  "mode", "time", "count", "quoteLength", "customText", "customShuffle",
  "language", "wordList", "punctuation", "numbers", "textSize", "layout", "font",
];

const settings = loadSettings();
const entryParams = new URLSearchParams(location.search);
// language landing pages link here; the bare URL stays the canonical one
const requestedLanguage = entryParams.get("lang");
if (requestedLanguage && Object.hasOwn(LANGUAGES, requestedLanguage)) {
  settings.language = requestedLanguage as Language;
  saveSettings(settings);
}
if (entryParams.get("mode") === "daily") {
  settings.mode = "daily";
  saveSettings(settings);
}
if (location.search) history.replaceState(null, "", location.pathname);

const root = document.documentElement;
const { soft: springSoft } = applySpringTokens(root);
const store = new ProfileStore();
store.watchVisibility();
const sound = new Sound();
const panelEl = $("panel");

let segments: Segment[] = [];
let optionsWrap: HTMLElement | undefined;

const session = new TypingSession(settings, store, sound, springSoft, {
  beforeRestart: () => {
    if (profilePage.isOpen) profilePage.hide();
  },
  afterRun: (firstToday) => renderTopBar(store.profile, settings, firstToday),
});

const profilePage = new ProfilePage(
  () => ({ profile: store.profile, language: settings.language }),
  () => {
    if (session.running) void session.restart();
    if (panelOpen()) setPanel(false);
  },
);

const customText = new CustomTextDialog(
  settings,
  () => {
    if (panelOpen()) setPanel(false);
    if (session.running) void session.restart();
  },
  (patch) => change(patch),
);

const palette = new Palette($("palette"), $<HTMLInputElement>("palette-input"), $("palette-list"), $("palette-hl"), () => commands({
  settings,
  hasWeakKeys: session.weakKeys.length > 0,
  change,
  restart: () => void session.restart(),
  showProfile: () => profilePage.show(),
  openCustom: () => customText.open(),
  openSettings: () => setPanel(true),
  previewTheme: (theme) => { root.dataset.theme = theme; },
  previewSound: (pack) => void sound.use(pack).then(() => sound.preview()),
}), () => applySettings());

function panelOpen(): boolean {
  return document.body.classList.contains("panel-open");
}

function setPanel(open: boolean): void {
  document.body.classList.toggle("panel-open", open);
  panelEl.inert = !open;
  // rows slide in one after another, so the panel reads top to bottom as it opens
  if (open) [...$("panel-body").children].forEach((row, i) => (row as HTMLElement).style.setProperty("--i", String(i)));
  if (open) requestAnimationFrame(() => segments.forEach((seg) => seg.sync()));
}

function openPalette(): void {
  if (panelOpen()) setPanel(false);
  // a timed run would keep counting behind the palette
  if (session.running) void session.restart();
  palette.open();
}

function applySettings(): void {
  root.dataset.theme = settings.theme;
  root.dataset.size = settings.textSize;
  root.dataset.layout = settings.layout;
  root.dataset.font = settings.font;
  root.dataset.caret = settings.caret;
  sound.enabled = settings.sound;
  sound.setVolume(settings.volume);
  void sound.use(settings.soundPack);
  const { stage } = session;
  stage.layout = settings.layout;
  stage.caretStyle = settings.caret;
  stage.setMotion(prefersReducedMotion ? "off" : settings.caretMotion);
  stage.letterFx = settings.letterFx && !prefersReducedMotion;
  $("flow-track").style.display = settings.flowLine ? "" : "none";
  if (optionsWrap) {
    optionsWrap.dataset.mode = settings.mode;
    segments.forEach((seg) => seg.sync());
  }
}

function change(patch: Partial<Settings>): void {
  if (patch.mode === "custom" && settings.customText.trim() === "" && !("customText" in patch)) customText.open();
  Object.assign(settings, patch);
  saveSettings(settings);
  // a theme change crossfades the whole page instead of repainting colour by colour
  if ("theme" in patch) void withTransition(applySettings);
  else applySettings();
  if ("soundPack" in patch) void sound.use(settings.soundPack).then(() => sound.preview());
  renderTopBar(store.profile, settings);
  if (TEST_KEYS.some((key) => key in patch)) void session.restart();
  else if ("caret" in patch) session.redrawCaret();
}

function buildControls(): void {
  const modeSeg = segment(MODES.map((value) => ({ label: value, value })), settings.mode, (mode: Mode) => change({ mode }));
  const timeSeg = segment([15, 30, 60].map((value) => ({ label: String(value), value })), settings.time, (time) => change({ time }));
  const countSeg = segment([25, 50, 100].map((value) => ({ label: String(value), value })), settings.count, (count) => change({ count }));
  const quoteSeg = segment(QUOTE_LENGTHS.map((value) => ({ label: value, value })), settings.quoteLength, (quoteLength) => change({ quoteLength }));
  timeSeg.root.classList.add("only-time");
  countSeg.root.classList.add("only-count");
  quoteSeg.root.classList.add("only-quote");
  const customEdit = document.createElement("button");
  customEdit.type = "button";
  customEdit.className = "toggle-word only-custom";
  customEdit.textContent = "edit text";
  customEdit.addEventListener("click", () => {
    customEdit.blur();
    customText.open();
  });
  const languageSeg = segment(
    (Object.keys(LANGUAGES) as Language[]).map((value) => ({ label: value, value })),
    settings.language,
    (language) => change({ language }),
  );
  optionsWrap = document.createElement("div");
  optionsWrap.className = "options";
  optionsWrap.dataset.mode = settings.mode;
  const extras = document.createElement("div");
  extras.className = "extras";
  extras.append(
    toggleWord("punctuation", settings.punctuation, (punctuation) => change({ punctuation })),
    toggleWord("numbers", settings.numbers, (numbers) => change({ numbers })),
  );
  optionsWrap.append(timeSeg.root, countSeg.root, quoteSeg.root, customEdit, extras);
  $("controls-left").append(modeSeg.root, optionsWrap);
  $("controls-right").append(languageSeg.root);
  segments = [modeSeg, timeSeg, countSeg, quoteSeg, languageSeg];
}

const profileReset = {
  prompt: (): string => (store.signedIn() ? "clear on every device?" : "really?"),
  run: async (): Promise<boolean> => {
    if (!(await store.reset())) return false;
    void session.restart();
    return true;
  },
};

listenForKeys({ settings, session, palette, customText, profilePage, panelOpen, setPanel, openPalette, change });

let lastPointer = { x: -1, y: -1 };
window.addEventListener("pointermove", (event) => {
  if (!document.body.classList.contains("focus")) return;
  if (lastPointer.x >= 0 && Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 6) {
    document.body.classList.add("pointer-awake");
  }
  lastPointer = { x: event.clientX, y: event.clientY };
});
window.addEventListener("keydown", () => document.body.classList.remove("pointer-awake"));

window.addEventListener("resize", () => {
  segments.forEach((seg) => seg.sync());
  session.remeasure();
});

$("daily-link").addEventListener("click", (event) => {
  (event.currentTarget as HTMLElement).blur();
  if (settings.mode === "daily") void session.restart();
  else change({ mode: "daily" });
});
$("open-settings").addEventListener("click", (event) => {
  (event.currentTarget as HTMLElement).blur();
  setPanel(true);
});
$("close-settings").addEventListener("click", () => setPanel(false));
$("backdrop").addEventListener("click", () => {
  setPanel(false);
  palette.close();
  customText.close();
});

// touch screens get a note instead of a test they can't take, until a real key arrives
if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
  document.body.classList.add("touch");
  const noticeKeyboard = (event: KeyboardEvent): void => {
    // a phone's on-screen keyboard fires keys too, but only into a field it opened for
    if ((event.target as HTMLElement).matches?.("input, textarea")) return;
    document.body.classList.add("has-keyboard");
    window.removeEventListener("keydown", noticeKeyboard, { capture: true });
  };
  window.addEventListener("keydown", noticeKeyboard, { capture: true });
}

async function boot(): Promise<void> {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    document.querySelectorAll(".palette-key").forEach((key) => { key.textContent = "⌘k"; });
    $("custom-key").textContent = "⌘ enter";
  }
  const version = $<HTMLAnchorElement>("version");
  version.textContent = `v${__APP_VERSION__}`;
  version.href = `https://github.com/jx-grxf/typesilk/releases/tag/v${__APP_VERSION__}`;
  buildControls();
  segments.push(...buildPanel($("panel-body"), settings, change, profileReset));
  applySettings();
  renderTopBar(store.profile, settings);
  await session.fontsReady();
  // badges for what someone already did before badges existed, without a fanfare
  if (awardBadges(store.profile, null).length > 0) store.save();
  segments.forEach((seg) => seg.sync());
  session.newTest();
  if (location.pathname === "/me") profilePage.show(false);
  document.body.classList.add("ready");
}

function renderAccountChrome(): void {
  const user = currentAccount();
  const button = $("profile-button");
  fillAvatar(button.querySelector<HTMLElement>(".mini-avatar")!);
  button.querySelector<HTMLElement>(".profile-label")!.textContent = user?.username ?? "profile";
  profilePage.refresh();
  if (settings.mode === "daily") prepareTicket(dailyNumber(), settings.language);
}

function syncAccount(): void {
  const user = currentAccount();
  if (user) store.connect(user.id);
  else store.disconnect();
}

store.onChange(() => {
  // badges for totals that only add up across devices, earned quietly like the ones at boot
  if (awardBadges(store.profile, null).length > 0) store.save();
  renderTopBar(store.profile, settings);
  profilePage.refresh();
});
onBeforeSignOut(() => store.flush());
onAccountDeleted(() => store.release());

void boot();
onAccountChange(() => {
  syncAccount();
  renderAccountChrome();
});
void loadAccount().then((reached) => {
  // offline is not signed out: keep showing the account's stats from the last visit
  if (reached) syncAccount();
  renderAccountChrome();
  const signin = entryParams.get("signin");
  const user = currentAccount();
  if (signin === "failed") openSignIn("That sign-in didn't work. Try again.");
  else if (signin === "blocked") openSignIn("This account is blocked from the board.");
  else if (user && !user.username) openNames(entryParams.get("name") ?? "");
});
