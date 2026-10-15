import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type GlassOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: GlassOption[];
  className?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  'aria-label'?: string;
};

type MenuBox = { top: number; left: number; width: number; maxHeight: number };

/** Glass-styled select — portaled menu so options sit above layout overflow. */
export function GlassSelect({
  value,
  onChange,
  options,
  className = '',
  disabled = false,
  required = false,
  name,
  id,
  'aria-label': ariaLabel,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<MenuBox | null>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];
  const label = selected?.label ?? '—';

  const placeMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const pad = 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;
    const below = spaceBelow >= 120 || spaceBelow >= spaceAbove;
    const available = below ? spaceBelow : spaceAbove;
    const maxHeight = Math.max(48, Math.min(16 * 16, available, window.innerHeight * 0.5));
    setBox({
      top: below ? rect.bottom + gap : Math.max(pad, rect.top - gap - maxHeight),
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const menu =
    open && box
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className="glass-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              maxHeight: box.maxHeight,
            }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? 'glass-select-option is-active' : 'glass-select-option'}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`glass-select ${open ? 'is-open' : ''} ${className}`.trim()}
    >
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="glass-select-trigger"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="glass-select-value">{label}</span>
        <span className="glass-select-chevron" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
