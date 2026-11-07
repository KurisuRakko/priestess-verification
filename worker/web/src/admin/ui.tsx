import {
  Button,
  CopyButton,
  Dialog,
  EmptyState,
  useSnackbar,
} from "@rakko/react";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

/**
 * Small compositions of Rakko Design primitives shared by the console views.
 * Only layout classes (`pv-*`) are added here; every control is a primitive.
 */

/** Short confirmations ("已删除") and failures as a Snackbar. */
export function useToast(): (title: string) => void {
  const { add } = useSnackbar();
  return useCallback((title: string) => add({ title }), [add]);
}

/** An error line (`role="alert"`); renders nothing for an empty message. */
export function Notice({ children }: { children: string }) {
  if (!children) return null;
  return (
    <EmptyState layout="none" role="alert" className="pv-notice">
      {children}
    </EmptyState>
  );
}

/** Page heading, lede and the page's main action. */
export function PageHead({
  title,
  lede,
  action,
}: {
  title: string;
  lede: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pv-head">
      <div className="pv-head__text">
        <h1 className="pv-head__title">{title}</h1>
        <p className="pv-head__lede">{lede}</p>
      </div>
      {action}
    </div>
  );
}

/** A labelled code block with a copy button. */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  const toast = useToast();
  return (
    <section className="pv-code">
      <header className="pv-code__head">
        <span className="pv-code__label">{label}</span>
        <CopyButton
          text={code}
          aria-label={`复制${label}`}
          copiedLabel="已复制"
          onCopied={() => toast("已复制")}
          onCopyError={() => toast("复制失败，请手动选择内容后复制。")}
        />
      </header>
      <pre className="pv-code__body">
        <code>{code}</code>
      </pre>
    </section>
  );
}

/** Action row at the bottom of a dialog; `start` sits on the opposite side. */
export function DialogActions({
  start,
  children,
}: {
  start?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pv-dialog-actions">
      {start ? <div className="pv-dialog-actions__start">{start}</div> : null}
      {children}
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  text: string;
  okLabel: string;
}

/**
 * `confirm(title, text, okLabel)` resolves true when the destructive action
 * is confirmed. Render `dialog` where the confirmation should stack: inside
 * another dialog's popup when one is open, so the two nest.
 */
export function useConfirm(): {
  confirm: (title: string, text: string, okLabel: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback(
    (title: string, text: string, okLabel: string) => {
      resolver.current?.(false);
      setRequest({ title, text, okLabel });
      setOpen(true);
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  );

  const dialog = (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <Dialog.Popup className="pv-dialog pv-dialog--small">
        <Dialog.Title>{request?.title}</Dialog.Title>
        <Dialog.Description>{request?.text}</Dialog.Description>
        <DialogActions>
          <Button variant="secondary" onClick={() => settle(false)}>
            取消
          </Button>
          <Button variant="filled-danger" onClick={() => settle(true)}>
            {request?.okLabel}
          </Button>
        </DialogActions>
      </Dialog.Popup>
    </Dialog.Root>
  );

  return { confirm, dialog };
}
