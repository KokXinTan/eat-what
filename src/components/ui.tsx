import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

// ---------- Icons (simple hand-drawn-ish line icons) ----------

const ICONS = {
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  pin: 'M12 21s-6-6.2-6-11a6 6 0 1 1 12 0c0 4.8-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  book: 'M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h9',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4.2-6 8-6s7 2 8 6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  bookmark: 'M6 3h12v18l-6-4.5L6 21z',
  soundOn: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  map: 'M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5zM9 4v13.5M15 6.5V20',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  back: 'M15 5l-7 7 7 7',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5',
  shuffle: 'M3 7h4c5 0 5 10 10 10h4M18 14l3 3-3 3M3 17h4c2 0 3-1.5 4-3.5M13 9.5c1-2 2-3.5 4-3.5h4M18 3l3 3-3 3',
  pot: 'M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2',
  bowl: 'M3 11h18a9 9 0 0 1-18 0zM8 20h8M14 3l-4 8M18 4l-6 7',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  upload: 'M12 20V9M7 14l5-5 5 5M4 4h16',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3 1 3M16 13.5h2',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  chevron: 'M6 9l6 6 6-6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  cards: 'M8 4h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 7.5l3 -.8M4 7.5l2.5 11.5 1.2-.3',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, class: className }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg class={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

// ---------- Buttons & chips ----------

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'olive';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  type?: 'button' | 'submit';
  disabled?: boolean;
  form?: string;
};

export function Button({ variant = 'secondary', size = 'md', icon, children, class: className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} class={`btn btn-${variant} btn-${size} ${className ?? ''}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  icon,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: ComponentChildren;
  icon?: IconName;
  label?: string;
}) {
  return (
    <button type="button" class={`chip ${selected ? 'is-on' : ''}`} aria-pressed={selected} onClick={onClick} aria-label={label}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/** Single-choice chip row, announced as a radio group. */
export function ChoiceChips<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div class="chip-row" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === index ? 0 : -1}
          class={`chip ${o.value === value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Dialogs ----------

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={`sheet ${wide ? 'sheet-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div class="sheet-inner">
          <header class="sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" class="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </header>
          <div class="sheet-body">{children}</div>
          {footer && <footer class="sheet-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}


/** A compact pill that opens the phone's native picker. */
export function PillSelect<T extends string | number | null>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <label class="pill pill-select">
      <Icon name={icon} size={15} />
      <span class="pill-text">{options[index].label}</span>
      <Icon name="chevron" size={14} class="pill-chevron" />
      <select aria-label={label} value={String(index)} onChange={(e) => onChange(options[Number((e.target as HTMLSelectElement).value)].value)}>
        {options.map((o, i) => (
          <option key={i} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
