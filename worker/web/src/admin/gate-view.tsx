import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  List,
  Switch,
} from "@rakko/react";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { api, isUnauthenticated } from "./api";
import type { GateField } from "./errors";
import { describeError, describeGateError } from "./errors";
import type { GateForm, GateHost } from "./gate";
import {
  GATE_COPY,
  deleteGateText,
  gateBody,
  gateDialogTitle,
  gateForm,
  isReadOnly,
  sourceLabel,
} from "./gate";
import { PlusIcon } from "./icons";
import { fmt } from "./stats";
import { DialogActions, Notice, PageHead, useConfirm, useToast } from "./ui";

/*
 * The host list is a Rakko Design Table once that primitive is synced into
 * vendor/ (see GateTable in stats-tables.tsx); until then it is a List.Group.
 */
function GateRow({
  host,
  onOpen,
  onDelete,
}: {
  host: GateHost;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const readOnly = isReadOnly(host);
  return (
    <List.Row className="pv-gate-row" data-disabled={host.enabled ? undefined : ""}>
      <div className="pv-gate-row__body">
        <div className="pv-gate-row__top">
          <h2 className="pv-gate-row__host">{host.host}</h2>
          <Badge tone={host.enabled ? "success" : "neutral"} size="sm">
            {host.enabled ? "已启用" : "已停用"}
          </Badge>
          <Badge size="sm">{sourceLabel(host)}</Badge>
        </div>
        <dl className="pv-gate-row__facts">
          <div>
            <dt>源站地址</dt>
            <dd className="pv-mono">{host.upstream}</dd>
          </div>
          <div>
            <dt>放行路径</dt>
            <dd>{fmt(host.exemptPaths?.length)}</dd>
          </div>
        </dl>
      </div>
      <div className="pv-gate-row__actions">
        {readOnly ? (
          <Button onClick={onOpen}>查看</Button>
        ) : (
          <>
            <Button onClick={onOpen}>编辑</Button>
            <Button variant="danger" onClick={onDelete}>
              删除
            </Button>
          </>
        )}
      </div>
    </List.Row>
  );
}

function GateDialog({
  open,
  host,
  onOpenChange,
  onSaved,
  onDelete,
  error,
  setError,
  confirmDialog,
}: {
  open: boolean;
  host: GateHost | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (creating: boolean) => void;
  onDelete: (host: GateHost) => void;
  error: string;
  setError: (text: string) => void;
  confirmDialog: ReactNode;
}) {
  const readOnly = isReadOnly(host);
  const creating = host === null;
  const [form, setForm] = useState<GateForm>(() => gateForm(host));
  const [invalid, setInvalid] = useState<{ field: GateField; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const enabledLabel = useId();
  const controls = {
    host: useRef<HTMLInputElement>(null),
    upstream: useRef<HTMLInputElement>(null),
    exemptPaths: useRef<HTMLTextAreaElement>(null),
  };

  useEffect(() => {
    if (!open) return;
    setForm(gateForm(host));
    setInvalid(null);
  }, [open, host]);

  // The marked field takes focus once its error is on screen.
  useEffect(() => {
    if (invalid) controls[invalid.field].current?.focus();
  }, [invalid]);

  const set = <K extends keyof GateForm>(key: K) =>
    (value: GateForm[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      // Editing the marked field takes its error away.
      if (invalid?.field === key) setInvalid(null);
    };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setBusy(true);
    try {
      const body = gateBody(form, creating);
      if (creating) {
        await api("/gate", { method: "POST", body });
      } else if (host) {
        await api(`/gate/${encodeURIComponent(host.host)}`, {
          method: "PATCH",
          body,
        });
      }
      onSaved(creating);
    } catch (failure) {
      if (isUnauthenticated(failure)) return;
      const { text, field } = describeGateError(failure as Error, creating);
      if (field) {
        setError("");
        setInvalid({ field, text: `保存失败：${text}` });
      } else {
        setInvalid(null);
        setError(`保存失败：${text}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field: GateField) =>
    invalid?.field === field ? (
      <Field.Error match>{invalid.text}</Field.Error>
    ) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup className="pv-dialog">
        <Dialog.Title>{gateDialogTitle(host)}</Dialog.Title>
        {readOnly ? (
          <Dialog.Description className="pv-readonly">
            <Badge tone="info" size="sm">
              部署配置
            </Badge>
            <span>{GATE_COPY.readOnly}</span>
          </Dialog.Description>
        ) : null}
        <form className="pv-form" onSubmit={submit}>
          <Field.Root invalid={invalid?.field === "host"}>
            <Field.Label>域名</Field.Label>
            <Field.Control
              ref={controls.host}
              value={form.host}
              onValueChange={set("host")}
              readOnly={!creating}
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="blog.example.com"
            />
            {fieldError("host")}
            <Field.Description>{GATE_COPY.hostHint}</Field.Description>
          </Field.Root>
          <Field.Root invalid={invalid?.field === "upstream"}>
            <Field.Label>源站地址</Field.Label>
            <Field.Control
              ref={controls.upstream}
              value={form.upstream}
              onValueChange={set("upstream")}
              readOnly={readOnly}
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="https://origin.example.com"
            />
            {fieldError("upstream")}
            <Field.Description>{GATE_COPY.upstreamHint}</Field.Description>
          </Field.Root>
          <Field.Root invalid={invalid?.field === "exemptPaths"}>
            <Field.Label>放行路径</Field.Label>
            <Field.Control
              ref={controls.exemptPaths}
              render={<textarea rows={4} />}
              value={form.exemptPaths}
              onValueChange={set("exemptPaths")}
              readOnly={readOnly}
              spellCheck={false}
              placeholder={"/api/webhook\n/static/"}
            />
            {fieldError("exemptPaths")}
            <Field.Description>{GATE_COPY.exemptHint}</Field.Description>
          </Field.Root>
          <div className="pv-switch-row">
            <span className="pv-switch-row__text">
              <span className="pv-switch-row__label" id={enabledLabel}>
                启用网关
              </span>
              <span className="pv-hint">{GATE_COPY.enabledHint}</span>
            </span>
            <Switch.Root
              aria-labelledby={enabledLabel}
              checked={form.enabled}
              onCheckedChange={set("enabled")}
              disabled={readOnly}
            >
              <Switch.Thumb />
            </Switch.Root>
          </div>
          <Notice>{error}</Notice>
          <DialogActions
            start={
              host && !readOnly ? (
                <Button variant="danger" onClick={() => onDelete(host)}>
                  删除
                </Button>
              ) : null
            }
          >
            <Button render={<Dialog.Close />} variant="secondary">
              {readOnly ? "关闭" : "取消"}
            </Button>
            {readOnly ? null : (
              <Button type="submit" variant="filled" disabled={busy}>
                保存
              </Button>
            )}
          </DialogActions>
        </form>
        {confirmDialog}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

/** 验证网关: hosts whose whole site sits behind the verification page. */
export function GateView({ active }: { active: boolean }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [hosts, setHosts] = useState<GateHost[] | null>(null);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  // The edited host outlives `open` so the closing dialog keeps its content.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GateHost | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ hosts?: GateHost[] }>("/gate");
      setHosts(data.hosts || []);
      setPageError("");
    } catch (error) {
      if (isUnauthenticated(error)) return;
      setPageError(`网关列表加载失败：${describeError(error as Error)}`);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const edit = (host: GateHost | null) => {
    setEditing(host);
    setFormError("");
    setOpen(true);
  };

  const remove = async (host: GateHost) => {
    const ok = await confirm("删除网关域名", deleteGateText(host), "删除");
    if (!ok) return;
    try {
      await api(`/gate/${encodeURIComponent(host.host)}`, { method: "DELETE" });
      setOpen(false);
      toast(GATE_COPY.deleted);
      await load();
    } catch (error) {
      if (isUnauthenticated(error)) return;
      const message = `删除失败：${describeGateError(error as Error, false).text}`;
      if (open) setFormError(message);
      else setPageError(message);
    }
  };

  return (
    <>
      <PageHead
        title="验证网关"
        lede={GATE_COPY.lede}
        action={
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => edit(null)}
          >
            添加域名
          </Button>
        }
      />
      <ul className="pv-notes">
        {GATE_COPY.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Notice>{pageError}</Notice>
      {hosts === null ? null : hosts.length > 0 ? (
        <List.Group aria-label="网关域名" className="pv-gate-list">
          {hosts.map((host) => (
            <GateRow
              key={host.host}
              host={host}
              onOpen={() => edit(host)}
              onDelete={() => remove(host)}
            />
          ))}
        </List.Group>
      ) : (
        <EmptyState layout="none" className="pv-empty">
          {GATE_COPY.empty}
        </EmptyState>
      )}
      <GateDialog
        open={open}
        host={editing}
        onOpenChange={setOpen}
        error={formError}
        setError={setFormError}
        onDelete={remove}
        confirmDialog={open ? dialog : null}
        onSaved={async (creating) => {
          setOpen(false);
          toast(creating ? GATE_COPY.added : GATE_COPY.saved);
          await load();
        }}
      />
      {open ? null : dialog}
    </>
  );
}
