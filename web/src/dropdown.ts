/*
 * Custom dropdown for the public pages. It sits on top of a real <select>, which stays in the page
 * (hidden) as the source of truth: page code keeps reading select.value, listening for "change"
 * and swapping its options, and forms keep working. This only draws the button and the list.
 *
 * Keyboard follows the WAI-ARIA "select-only combobox" pattern: focus stays on the button and
 * aria-activedescendant points at the highlighted option.
 *   Closed: Down, Up, Enter, Space or Alt+Down open it. Home and End open it at the first or last option.
 *   Open:   Up and Down move, Home and End jump, Page Up and Page Down move 10,
 *           Enter, Space, Tab or Alt+Up pick, Escape closes without picking.
 *   Typing letters jumps to the next option that starts with them, open or closed.
 * An option can carry data-badge="newest" to show a small tag next to its label.
 */

let next = 0;

export function enhanceSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>('select:not([data-native])').forEach((s) => {
    if (!s.dataset.enhanced) new Dropdown(s);
  });
}

class Dropdown {
  private readonly button: HTMLButtonElement;
  private readonly value: HTMLSpanElement;
  private readonly list: HTMLUListElement;
  private items: HTMLLIElement[] = [];
  private active = -1;
  private typed = '';
  private typedAt = 0;

  constructor(private readonly select: HTMLSelectElement) {
    select.dataset.enhanced = '1';
    const id = `dd${++next}`;
    const wrap = select.closest('.select') ?? wrapIn(select);
    wrap.classList.add('dd');

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.id = `${id}-button`;
    this.button.className = `dd-button ${select.className}`.trim();
    this.button.setAttribute('role', 'combobox');
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', `${id}-list`);
    this.value = document.createElement('span');
    this.value.className = 'dd-value';
    this.button.append(this.value);

    this.list = document.createElement('ul');
    this.list.id = `${id}-list`;
    this.list.className = 'dd-list';
    this.list.setAttribute('role', 'listbox');
    this.list.tabIndex = -1;
    this.list.hidden = true;

    // The <label for="..."> of the select now names the button, and clicking it focuses the button.
    const label = select.labels?.[0];
    if (label) {
      label.id ||= `${id}-label`;
      this.button.setAttribute('aria-labelledby', `${label.id} ${this.button.id}`);
      this.list.setAttribute('aria-labelledby', label.id);
      label.addEventListener('click', (e) => {
        e.preventDefault();
        this.button.focus();
      });
    } else if (select.getAttribute('aria-label')) {
      this.button.setAttribute('aria-label', select.getAttribute('aria-label')!);
      this.list.setAttribute('aria-label', select.getAttribute('aria-label')!);
    }

    select.hidden = true;
    select.tabIndex = -1;
    select.after(this.button, this.list);

    this.button.addEventListener('click', () => (this.isOpen() ? this.close() : this.open()));
    this.button.addEventListener('keydown', (e) => this.onKey(e));
    this.button.addEventListener('blur', (e) => {
      // Clicking inside the list keeps it open; anywhere else closes it.
      if (!this.list.contains(e.relatedTarget as Node | null)) this.close();
    });
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the button
    this.list.addEventListener('click', (e) => {
      const li = (e.target as Element).closest('li');
      const i = li ? this.items.indexOf(li as HTMLLIElement) : -1;
      if (i >= 0 && !this.items[i]!.hasAttribute('aria-disabled')) {
        this.pick(i);
        this.close();
      }
    });
    this.list.addEventListener('mousemove', (e) => {
      const li = (e.target as Element).closest('li');
      const i = li ? this.items.indexOf(li as HTMLLIElement) : -1;
      if (i >= 0 && i !== this.active) this.highlight(i, false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen() && !wrap.contains(e.target as Node)) this.close();
    });

    // Page code swaps options, sets disabled, or sets the value and fires "change": follow along.
    new MutationObserver(() => this.render()).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    select.addEventListener('change', () => this.render());
    this.render();
  }

  private isOpen() {
    return !this.list.hidden;
  }

  private render() {
    const opts = [...this.select.options];
    this.items = opts.map((o, i) => {
      const li = document.createElement('li');
      li.id = `${this.list.id}-${i}`;
      li.className = 'dd-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.select.selectedIndex));
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      li.append(labelFor(o));
      return li;
    });
    this.list.replaceChildren(...this.items);
    const current = this.select.selectedOptions[0];
    this.value.replaceChildren(current ? labelFor(current) : document.createTextNode(''));
    this.button.disabled = this.select.disabled;
    if (this.select.disabled) this.close();
    else if (this.isOpen()) this.highlight(Math.min(Math.max(this.active, 0), this.items.length - 1));
  }

  private open(at = this.select.selectedIndex) {
    if (this.select.disabled || this.items.length === 0) return;
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Open upwards when there is no room below.
    const below = window.innerHeight - this.button.getBoundingClientRect().bottom;
    this.list.classList.toggle('dd-up', below < Math.min(this.list.scrollHeight, 320) + 16 && this.button.getBoundingClientRect().top > below);
    this.highlight(at < 0 ? 0 : at);
  }

  private close() {
    if (!this.isOpen()) return;
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.button.removeAttribute('aria-activedescendant');
  }

  private highlight(i: number, scroll = true) {
    if (i < 0 || i >= this.items.length) return;
    this.items[this.active]?.classList.remove('dd-active');
    this.active = i;
    const li = this.items[i]!;
    li.classList.add('dd-active');
    this.button.setAttribute('aria-activedescendant', li.id);
    if (scroll) li.scrollIntoView({ block: 'nearest' });
  }

  private pick(i: number) {
    if (i < 0 || i >= this.items.length || this.select.options[i]?.disabled) return;
    if (i !== this.select.selectedIndex) {
      this.select.selectedIndex = i;
      this.select.dispatchEvent(new Event('input', { bubbles: true }));
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.render();
  }

  /** Next option (wrapping) whose label starts with what was typed in the last half second. */
  private typeAhead(ch: string): number {
    const now = Date.now();
    this.typed = now - this.typedAt > 500 ? ch : this.typed + ch;
    this.typedAt = now;
    const from = this.isOpen() ? this.active : this.select.selectedIndex;
    const labels = [...this.select.options].map((o) => (o.textContent ?? '').trim().toLowerCase());
    // Repeating one letter cycles through the matches; a longer string searches from the current one.
    const same = this.typed.split('').every((c) => c === this.typed[0]);
    const needle = same ? this.typed[0]! : this.typed;
    const start = same || this.typed.length === 1 ? from + 1 : from;
    for (let k = 0; k < labels.length; k++) {
      const i = (start + k) % labels.length;
      if (labels[i]!.startsWith(needle) && !this.select.options[i]!.disabled) return i;
    }
    return -1;
  }

  private onKey(e: KeyboardEvent) {
    const last = this.items.length - 1;
    if (!this.isOpen()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.open();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        this.open(e.key === 'Home' ? 0 : last);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const i = this.typeAhead(e.key.toLowerCase());
        if (i >= 0) this.open(i);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey && e.key === 'ArrowUp') {
          this.pick(this.active);
          this.close();
        } else this.highlight(Math.min(last, Math.max(0, this.active + (e.key === 'ArrowDown' ? 1 : -1))));
        return;
      case 'Home':
      case 'End':
        e.preventDefault();
        this.highlight(e.key === 'Home' ? 0 : last);
        return;
      case 'PageDown':
      case 'PageUp':
        e.preventDefault();
        this.highlight(Math.min(last, Math.max(0, this.active + (e.key === 'PageDown' ? 10 : -10))));
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.pick(this.active);
        this.close();
        return;
      case 'Tab':
        this.pick(this.active);
        this.close();
        return;
      case 'Escape':
        e.preventDefault();
        this.close();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const i = this.typeAhead(e.key.toLowerCase());
          if (i >= 0) this.highlight(i);
        }
    }
  }
}

function labelFor(o: HTMLOptionElement): DocumentFragment {
  const f = document.createDocumentFragment();
  const text = document.createElement('span');
  text.className = 'dd-text';
  text.textContent = o.textContent ?? '';
  f.append(text);
  if (o.dataset.badge) {
    const b = document.createElement('span');
    b.className = 'dd-badge';
    b.textContent = o.dataset.badge;
    f.append(b);
  }
  return f;
}

function wrapIn(select: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'select';
  select.before(wrap);
  wrap.append(select);
  return wrap;
}
