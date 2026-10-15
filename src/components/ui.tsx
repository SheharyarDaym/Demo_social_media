import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export { PlatformIcon } from './PlatformIcon';

// ---------------------------------------------------------------- status badges

// ---------------------------------------------------------------- dialog (focus-trapped, Escape, focus restore)

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('data-focus-skip'));
}

export function useFocusTrap(active: boolean, onEscape?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first = root ? (root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0]) : null;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!root) return;
      if (e.key === 'Escape' && escRef.current) {
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) return;
      const firstEl = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root?.addEventListener('keydown', onKey);
    return () => {
      root?.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [active]);
  return ref;
}

export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  wide,
  closeOnEscape = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeOnEscape?: boolean;
}) {
  const titleId = useId();
  const ref = useFocusTrap(true, closeOnEscape ? onClose : undefined);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeOnEscape && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-head">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="muted small">{description}</p> : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children ? <div className="dialog-body">{children}</div> : null}
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger' | 'navy';
}

/** Promise-based confirmation dialog. */
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = state ? (
    <Dialog
      title={state.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn ${state.tone === 'danger' ? 'btn-danger' : state.tone === 'navy' ? 'btn-navy' : 'btn-primary'}`}
            onClick={() => close(true)}
            data-autofocus
          >
            {state.confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack small">{state.body}</div>
    </Dialog>
  ) : null;
  return [node, ask];
}

export function IconButton({
  label,
  onClick,
  children,
  className,
  disabled,
  pressed,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button type="button" className={`icon-btn ${className ?? ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {children}
    </button>
  );
}

