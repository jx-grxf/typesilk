import { renderAccountRow } from "./account-view";
import { $, withTransition } from "./dom";
import type { Profile } from "./profile";
import { renderProfile } from "./profile-view";
import type { Language } from "./words";

/** The profile at /me, drawn over the test and reached through the browser's history too. */
export class ProfilePage {
  private readonly root = $("profile");

  constructor(
    private readonly current: () => { profile: Profile; language: Language },
    private readonly beforeShow: () => void,
  ) {
    window.addEventListener("popstate", () => (location.pathname === "/me" ? this.show(false) : this.hide(false)));
    for (const id of ["profile-button", "touch-profile"]) {
      $(id).addEventListener("click", (event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).blur();
        this.toggle();
      });
    }
    // the logo and the back link on the profile both lead back to the test
    document.addEventListener("click", (event) => {
      const link = (event.target as HTMLElement).closest("#home-link, .profile-back");
      if (!link) return;
      event.preventDefault();
      (link as HTMLElement).blur();
      if (this.isOpen) this.hide();
    });
    $("profile-link").addEventListener("click", (event) => {
      event.preventDefault();
      (event.currentTarget as HTMLElement).blur();
      this.show();
    });
  }

  get isOpen(): boolean {
    return document.body.classList.contains("show-profile");
  }

  show(push = true): void {
    this.beforeShow();
    void withTransition(() => {
      this.render();
      this.root.scrollTop = 0;
      document.body.classList.add("show-profile");
    });
    if (push && location.pathname !== "/me") history.pushState(null, "", "/me");
  }

  hide(push = true): void {
    void withTransition(() => document.body.classList.remove("show-profile"));
    if (push && location.pathname === "/me") history.pushState(null, "", "/");
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  /** Draws it again in place, for new stats or a changed account; does nothing while it's closed. */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  private render(): void {
    const { profile, language } = this.current();
    renderProfile(this.root, profile, language);
    renderAccountRow(this.root);
  }
}
