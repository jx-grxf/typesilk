import { accountDialogOpen, closeAccountDialog, trapDialogFocus } from "./account-view";
import type { CustomTextDialog } from "./custom-text";
import type { Palette } from "./palette";
import type { ProfilePage } from "./profile-page";
import { shareResult } from "./results";
import type { TypingSession } from "./session";
import type { Settings } from "./settings";

export type KeyboardContext = {
  settings: Settings;
  session: TypingSession;
  palette: Palette;
  customText: CustomTextDialog;
  profilePage: ProfilePage;
  panelOpen(): boolean;
  setPanel(open: boolean): void;
  openPalette(): void;
  change(patch: Partial<Settings>): void;
};

/** One listener for the whole page; whatever is open on top gets the keys first. */
export function listenForKeys(ctx: KeyboardContext): void {
  const { session, palette, customText, profilePage } = ctx;
  window.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (accountDialogOpen()) {
      if (event.key === "Escape") closeAccountDialog();
      trapDialogFocus(event);
      return;
    }
    if (palette.isOpen || customText.isOpen) return;

    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && (key === "k" || (event.shiftKey && key === "p"))) {
      event.preventDefault();
      ctx.openPalette();
      return;
    }
    if (profilePage.isOpen) {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        profilePage.hide();
        if (event.key === "Tab") void session.restart();
      }
      return;
    }

    if (ctx.panelOpen()) {
      if (event.key === "Escape") ctx.setPanel(false);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      void session.restart();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (session.running) {
        if (session.openEnded) session.finish(session.elapsed(event.timeStamp));
        else void session.restart();
      } else {
        ctx.setPanel(true);
      }
      return;
    }
    if (session.state === "done") {
      if (event.key === "Enter") void session.restart();
      // nobody stops typing the instant a run ends, and t, c and s are common letters
      if (!session.shortcutsReady(event.timeStamp)) return;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (key === "t" && plain) ctx.change({ mode: "train" });
      if (key === "c" && plain) void shareResult("copy");
      if (key === "s" && plain) void shareResult("save");
      return;
    }
    if (session.state === "busy") return;

    if (event.key === "Enter" && event.shiftKey && ctx.settings.mode === "zen" && session.running) {
      event.preventDefault();
      session.finish(session.elapsed(event.timeStamp));
      return;
    }

    const altGraph = event.getModifierState("AltGraph");
    if (event.key === "Backspace") {
      event.preventDefault();
      session.typeBackspace(event.ctrlKey || event.altKey, event.code, event.timeStamp);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !altGraph) return;
    if (event.key === " ") {
      event.preventDefault();
      session.typeSpace(event.code, event.timeStamp);
      return;
    }
    if (event.key.length === 1 && !event.repeat) {
      event.preventDefault();
      session.typeChar(event.key, event.code, event.timeStamp);
    }
  });
}
