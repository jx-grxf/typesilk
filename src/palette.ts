import { fuzzyFilter } from "./fuzzy";

export type Command = {
  group: string;
  label: string;
  current?: boolean;
  /** Shown live while the row is selected, undone if the palette closes without running it. */
  preview?: () => void;
  run(): void;
};

export class Palette {
  private all: Command[] = [];
  private shown: Command[] = [];
  private rows: HTMLElement[] = [];
  private index = 0;
  private previewed = false;
  private open_ = false;

  constructor(
    private root: HTMLElement,
    private input: HTMLInputElement,
    private list: HTMLElement,
    private highlight: HTMLElement,
    private source: () => Command[],
    private revertPreview: () => void,
  ) {
    input.addEventListener("input", () => this.filter(0));
    input.addEventListener("keydown", (event) => this.onKey(event));
    list.addEventListener("pointermove", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".pal-row");
      const at = row ? this.rows.indexOf(row) : -1;
      if (at >= 0 && at !== this.index) this.select(at, false);
    });
    list.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".pal-row");
      const at = row ? this.rows.indexOf(row) : -1;
      if (at >= 0) this.run(at);
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    this.all = this.source();
    this.input.value = "";
    this.open_ = true;
    this.root.inert = false;
    document.body.classList.add("palette-open");
    const current = this.all.findIndex((command) => command.current && command.group === "mode");
    this.filter(Math.max(current, 0));
    this.input.focus();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    if (this.previewed) this.revertPreview();
    this.previewed = false;
    this.root.inert = true;
    this.input.blur();
    document.body.classList.remove("palette-open");
  }

  private filter(selected: number): void {
    this.shown = fuzzyFilter(this.all, this.input.value, (command) => `${command.group} ${command.label}`);
    this.list.querySelectorAll(".pal-row, .pal-empty").forEach((node) => node.remove());
    this.rows = this.shown.map((command) => {
      const row = document.createElement("div");
      row.className = "pal-row";
      row.setAttribute("role", "option");
      const group = document.createElement("span");
      group.className = "pal-group";
      group.textContent = command.group;
      const label = document.createElement("span");
      label.className = "pal-label";
      label.textContent = command.label;
      row.append(group, label);
      if (command.current) row.classList.add("current");
      return row;
    });
    if (this.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pal-empty";
      empty.textContent = "nothing matches";
      this.list.append(empty);
    }
    this.list.append(...this.rows);
    this.highlight.classList.toggle("on", this.rows.length > 0);
    this.select(Math.min(selected, this.rows.length - 1), true, true);
  }

  private select(at: number, scroll: boolean, instant = false): void {
    if (at < 0) return;
    this.rows[this.index]?.removeAttribute("aria-selected");
    this.index = at;
    const row = this.rows[at];
    if (!row) return;
    row.setAttribute("aria-selected", "true");
    this.highlight.style.transition = instant ? "none" : "";
    this.highlight.style.transform = `translateY(${row.offsetTop}px)`;
    this.highlight.style.height = `${row.offsetHeight}px`;
    if (scroll) {
      const { scrollTop, clientHeight } = this.list;
      if (row.offsetTop < scrollTop) this.list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > scrollTop + clientHeight) {
        this.list.scrollTop = row.offsetTop + row.offsetHeight - clientHeight;
      }
    }
    const command = this.shown[at];
    if (command?.preview) {
      command.preview();
      this.previewed = true;
    } else if (this.previewed) {
      this.revertPreview();
      this.previewed = false;
    }
  }

  private run(at: number): void {
    const command = this.shown[at];
    if (!command) return;
    this.previewed = false;
    this.close();
    command.run();
  }

  private onKey(event: KeyboardEvent): void {
    // keys typed here belong to the search field, not to the test underneath
    event.stopPropagation();
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n") || (event.key === "Tab" && !event.shiftKey);
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p") || (event.key === "Tab" && event.shiftKey);
    if (down || up) {
      event.preventDefault();
      const count = this.rows.length;
      if (count > 0) this.select((this.index + (down ? 1 : -1) + count) % count, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.run(this.index);
    } else if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
      event.preventDefault();
      this.close();
    }
  }
}
