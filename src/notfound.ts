import { closestRoute } from "./closest-route";

const MAX_LETTERS = 28;
const KEY_MS = 46;

const typedEl = document.getElementById("typed")!;
const suggestEl = document.getElementById("suggest")!;
const suggestLink = suggestEl.querySelector("a")!;
const enterHint = document.getElementById("enter-hint")!;

function requestedPath(): string {
  try {
    return decodeURIComponent(location.pathname);
  } catch {
    // a broken escape like /%E0%A4 is still something to show, just not decoded
    return location.pathname;
  }
}

const { letters, route } = closestRoute(requestedPath());
const shown = letters.slice(0, MAX_LETTERS);
const caret = document.createElement("span");
caret.className = "nf-caret";
typedEl.append(caret);

function typeLetter(index: number): void {
  const letter = shown[index];
  if (!letter) return;
  const node = document.createElement("span");
  node.textContent = letter.char;
  if (letter.wrong) node.className = "nf-wrong";
  caret.before(node);
  setTimeout(() => typeLetter(index + 1), KEY_MS);
}

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  caret.before(...shown.map((letter) => Object.assign(document.createElement("span"), { textContent: letter.char, className: letter.wrong ? "nf-wrong" : "" })));
} else {
  typeLetter(0);
}
if (letters.length > MAX_LETTERS) typedEl.classList.add("nf-cut");

if (route) {
  suggestLink.href = route;
  suggestLink.textContent = route;
  suggestEl.hidden = false;
  enterHint.textContent = route;
  enterHint.parentElement!.hidden = false;
}

addEventListener("keydown", (event) => {
  // tab only leaves from the page itself, so keyboard users can still reach a focused link
  if (document.activeElement !== document.body || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (event.key === "Tab") {
    event.preventDefault();
    location.href = "/";
  } else if (event.key === "Enter" && route) {
    location.href = route;
  }
});
