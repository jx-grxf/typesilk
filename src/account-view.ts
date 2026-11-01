import {
  currentAccount,
  deleteAccount,
  PROVIDER_NAMES,
  saveNames,
  signInProviders,
  signOut,
  submitDaily,
} from "./account";
import { avatarNode } from "./avatar";
import type { RunLog } from "./replay";
import type { Language } from "./words";

const NAME_ERRORS: Record<string, string> = {
  bad_username: "Use 3 to 20 characters: a to z, 0 to 9, - and _. Some names are blocked.",
  username_taken: "That username is taken.",
  username_locked: "Your username can't be changed.",
  bad_display_name: "Use 1 to 32 characters. Some names are blocked.",
  rate_limited: "Too many tries. Wait a minute.",
  offline: "Couldn't reach the server. Try again.",
};

const dialog = (): HTMLElement => document.getElementById("account-dialog")!;

export const accountDialogOpen = (): boolean => document.body.classList.contains("account-open");

let afterChange: () => void = () => {};

export function onAccountChange(listener: () => void): void {
  afterChange = listener;
}

export function closeAccountDialog(): void {
  document.body.classList.remove("account-open");
  dialog().inert = true;
}

function showDialog(...children: HTMLElement[]): void {
  dialog().replaceChildren(...children);
  dialog().inert = false;
  document.body.classList.add("account-open");
  dialog().querySelector<HTMLElement>("a, button, input:not(:disabled)")?.focus();
}

/** Keeps tab inside the open dialog, because the page behind it has its own use for the key. */
export function trapDialogFocus(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const items = [...dialog().querySelectorAll<HTMLElement>("a, button, input:not(:disabled)")];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const inside = dialog().contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

function signInLinks(): HTMLElement {
  const row = text("p", "signin-links", "");
  signInProviders().forEach((provider, index) => {
    if (index > 0) row.append(" · ");
    const link = text("a", "", `Sign in with ${PROVIDER_NAMES[provider]}`);
    link.href = `/api/auth/${provider}`;
    row.append(link);
  });
  return row;
}

function closeButton(label: string): HTMLButtonElement {
  const button = text("button", "account-close", label);
  button.type = "button";
  button.addEventListener("click", closeAccountDialog);
  return button;
}

function agreement(): HTMLElement {
  const note = text("p", "account-note", "Signing in means you accept the ");
  const terms = text("a", "", "terms");
  terms.href = "/terms";
  const privacy = text("a", "", "privacy notice");
  privacy.href = "/privacy";
  note.append(terms, " and the ", privacy, ".");
  return note;
}

export function openSignIn(message = "Sign in to rank on the daily."): void {
  const foot = document.createElement("div");
  foot.className = "account-foot";
  foot.append(closeButton("close"));
  showDialog(
    text("h2", "account-title", "Sign in"),
    text("p", "account-note", `${message} Typing never needs an account.`),
    signInLinks(),
    agreement(),
    foot,
  );
}

function field(label: string, name: string, value: string, note: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = text("label", "account-field", "");
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  // this isn't a login, so password managers shouldn't offer to fill it
  input.setAttribute("data-1p-ignore", "");
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-bwignore", "");
  row.append(text("span", "account-label", label), input, text("small", "", note));
  return { row, input };
}

export function openNames(suggested = ""): void {
  const user = currentAccount();
  if (!user) return;
  const form = document.createElement("form");
  const locked = user.username !== null;
  const username = field(
    "Username",
    "board-address",
    user.username ?? suggested.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20),
    locked ? "Your address on the board. It stays as it is." : "Your address on the board. You can't change it later.",
  );
  username.input.disabled = locked;
  const display = field("Display name", "board-name", user.displayName ?? "", "What people see next to your speed.");
  const error = text("p", "account-error", "");
  error.setAttribute("role", "alert");
  const submit = text("button", "account-save", "save");
  submit.type = "submit";
  const foot = document.createElement("div");
  foot.className = "account-foot";
  foot.append(closeButton("not now"), submit);
  form.append(text("h2", "account-title", locked ? "Your name" : "Pick a name"), username.row, display.row, error, foot);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void saveNames(username.input.value, display.input.value).then((code) => {
      submit.disabled = false;
      if (code) {
        error.textContent = NAME_ERRORS[code] ?? "That didn't work. Try again.";
        return;
      }
      closeAccountDialog();
      afterChange();
    });
  });
  showDialog(form);
  (locked ? display : username).input.focus();
}

/** Drawn here from the name, so no picture is stored and no other host is asked for one. */
export function fillAvatar(node: HTMLElement): void {
  const user = currentAccount();
  if (user) node.replaceChildren(avatarNode(user.username ?? user.id));
  else node.textContent = "Y";
}

export function signOutNow(): void {
  void signOut().then(() => afterChange());
}

export function openDeleteAccount(): void {
  const foot = document.createElement("div");
  foot.className = "account-foot";
  const remove = text("button", "account-save", "delete my account");
  remove.type = "button";
  remove.addEventListener("click", () => {
    void deleteAccount().then((done) => {
      if (done) {
        closeAccountDialog();
        afterChange();
      } else {
        note.textContent = "That didn't work. Try again.";
      }
    });
  });
  foot.append(closeButton("keep it"), remove);
  const note = text("p", "account-note", "This removes your account and all your ranked runs. Your local stats stay in this browser.");
  showDialog(text("h2", "account-title", "Delete your account?"), note, foot);
}

function linkButton(label: string, action: () => void): HTMLButtonElement {
  const button = text("button", "", label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

/** The row on the profile page: how to sign in, or who you are and how to leave. */
export function renderAccountRow(root: HTMLElement): void {
  const user = currentAccount();
  const row = document.createElement("section");
  row.className = "account-row";
  if (!user) {
    if (signInProviders().length === 0) return;
    row.append(text("span", "", "Rank on the daily:"), signInLinks(), agreement());
  } else {
    const who = text("span", "account-who", "");
    who.append(avatarNode(user.username ?? user.id), user.displayName ?? "");
    const heading = root.querySelector(".profile-head h2");
    if (heading && user.displayName) heading.textContent = user.displayName;
    root.querySelector(".profile-head .avatar")?.replaceChildren(avatarNode(user.username ?? user.id));
    if (user.username) who.append(text("small", "", `@${user.username}`));
    const actions = document.createElement("span");
    actions.className = "account-actions";
    const board = text("a", "", "daily board");
    board.href = "/daily";
    const remove = linkButton("delete account", openDeleteAccount);
    actions.append(
      board,
      linkButton("edit name", () => openNames()),
      linkButton("sign out", signOutNow),
      remove,
    );
    row.append(who, actions);
  }
  root.querySelector(".profile-back")?.after(row);
}

/** A line under the daily's result. The run itself is already saved locally either way. */
export function showDailyRank(results: HTMLElement, daily: number, language: Language, log: RunLog): void {
  const line = text("p", "daily-rank", "");
  results.querySelector(".headline")?.append(line);
  const boardLink = (): HTMLAnchorElement => {
    const link = text("a", "", "See the board");
    link.href = `/daily?day=${daily}&lang=${language}`;
    return link;
  };
  const user = currentAccount();
  if (!user) {
    if (signInProviders().length === 0) {
      line.remove();
      return;
    }
    line.append(linkButton("Sign in", () => openSignIn()), " before your next daily to rank on the board.");
    return;
  }
  if (!user.username) {
    line.append(linkButton("Pick a name", () => openNames()), " before your next daily to rank on the board.");
    return;
  }
  line.textContent = "Checking your run…";
  void submitDaily(daily, language, log).then((rank) => {
    if (!rank) {
      line.textContent = "This run couldn't be ranked.";
      return;
    }
    if (rank.hidden) {
      line.textContent = "Your first try is being reviewed and isn't on the board yet.";
      return;
    }
    const place = `#${rank.rank} of ${rank.total}`;
    line.textContent = rank.first ? `You're ${place} on this daily. ` : `Your first try stands at ${place}, ${Math.round(rank.wpm)} wpm. `;
    line.append(boardLink());
  });
}
