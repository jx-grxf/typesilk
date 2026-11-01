import { $ } from "./dom";
import { customWords } from "./quotes";
import type { Settings } from "./settings";

/** The dialog for pasting your own text. `start` receives the settings that turn it into a test. */
export class CustomTextDialog {
  private readonly root = $("custom");
  private readonly text = $<HTMLTextAreaElement>("custom-text");
  private readonly shuffle = $("custom-shuffle");

  constructor(
    private readonly settings: Settings,
    private readonly beforeOpen: () => void,
    private readonly start: (patch: Partial<Settings>) => void,
  ) {
    this.text.addEventListener("input", () => this.updateCount());
    this.text.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") this.close();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.submit();
      }
    });
    this.shuffle.addEventListener("click", () => {
      this.shuffle.setAttribute("aria-pressed", String(this.shuffle.getAttribute("aria-pressed") !== "true"));
      this.text.focus();
    });
    $("custom-cancel").addEventListener("click", () => this.close());
    $("custom-start").addEventListener("click", () => this.submit());
  }

  get isOpen(): boolean {
    return document.body.classList.contains("custom-open");
  }

  open(): void {
    this.beforeOpen();
    this.text.value = this.settings.customText;
    this.shuffle.setAttribute("aria-pressed", String(this.settings.customShuffle));
    this.updateCount();
    document.body.classList.add("custom-open");
    this.root.inert = false;
    this.text.focus();
  }

  close(): void {
    document.body.classList.remove("custom-open");
    this.root.inert = true;
    this.text.blur();
  }

  private updateCount(): void {
    const count = customWords(this.text.value, false).length;
    $("custom-count").textContent = count === 1 ? "1 word" : `${count} words`;
  }

  private submit(): void {
    this.close();
    this.start({
      mode: "custom",
      customText: this.text.value.trim(),
      customShuffle: this.shuffle.getAttribute("aria-pressed") === "true",
    });
  }
}
