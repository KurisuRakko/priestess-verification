import {
  Badge,
  Button,
  Checkbox,
  Collapsible,
  Dialog,
  EmptyState,
  Field,
  List,
} from "@rakko/react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, isUnauthenticated } from "./api";
import type { SiteField } from "./errors";
import type { SiteAction } from "./errors";
import { describeSiteError, siteFailureText } from "./errors";
import { ChevronIcon, PlusIcon } from "./icons";
import type { Site, SiteForm } from "./sites";
import {
  describeSettings,
  secretWarning,
  siteBody,
  siteForm,
  snippets,
} from "./sites";
import {
  CodeBlock,
  DialogActions,
  Notice,
  PageHead,
  useConfirm,
  useToast,
} from "./ui";

/** The secret dialog: a fresh secret (shown once) or the snippets only. */
interface SecretState {
  site: Site;
  secret: string | null;
}

function SiteRow({
  site,
  onSnippets,
  onEdit,
  onToggle,
  onRotate,
  onDelete,
}: {
  site: Site;
  onSnippets: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const settings = describeSettings(site.settings);
  return (
    <List.Row className="pv-site" data-disabled={site.enabled ? undefined : ""}>
      <div className="pv-site__body">
        <div className="pv-site__top">
          <h2 className="pv-site__name">{site.name}</h2>
          <code className="pv-site__key">{site.siteKey}</code>
          <Badge tone={site.enabled ? "success" : "neutral"} size="sm">
            {site.enabled ? "已启用" : "已停用"}
          </Badge>
        </div>
        <ul className="pv-site__origins" aria-label="允许的域名">
          {site.origins.map((origin) => (
            <li key={origin}>
              <Badge size="sm">{origin}</Badge>
            </li>
          ))}
        </ul>
        {settings ? (
          <p className="pv-site__settings">自定义设置：{settings}</p>
        ) : null}
        <div className="pv-site__actions">
          <Button onClick={onSnippets}>接入代码</Button>
          <Button onClick={onEdit}>编辑</Button>
          <Button onClick={onToggle}>{site.enabled ? "停用" : "启用"}</Button>
          <Button onClick={onRotate}>轮换 secret</Button>
          <Button variant="danger" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
    </List.Row>
  );
}

function SiteDialog({
  open,
  site,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  site: Site | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (result: { site: Site; secret: string | null }) => void;
}) {
  const [form, setForm] = useState<SiteForm>(() => siteForm(site));
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<{ field: SiteField; text: string } | null>(
    null,
  );
  const controls = {
    name: useRef<HTMLInputElement>(null),
    origins: useRef<HTMLTextAreaElement>(null),
    challengeDifficulty: useRef<HTMLInputElement>(null),
    challengeCount: useRef<HTMLInputElement>(null),
    tokenTtlMinutes: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (!open) return;
    setForm(siteForm(site));
    setError("");
    setInvalid(null);
    setAdvanced(false);
  }, [open, site]);

  // The marked field takes focus once its error is on screen.
  useEffect(() => {
    if (invalid) controls[invalid.field].current?.focus();
  }, [invalid]);

  const set = <K extends keyof SiteForm>(key: K) =>
    (value: SiteForm[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      // Editing the marked field takes its error away.
      if (invalid?.field === key) setInvalid(null);
    };

  const fieldError = (field: SiteField) =>
    invalid?.field === field ? (
      <Field.Error match>{invalid.text}</Field.Error>
    ) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = siteBody(form);
    setBusy(true);
    try {
      if (site) {
        await api(`/sites/${site.siteKey}`, { method: "PATCH", body });
        onSaved({ site, secret: null });
      } else {
        const data = await api<{ site: Site; secret: string }>("/sites", {
          method: "POST",
          body,
        });
        onSaved(data);
      }
    } catch (failure) {
      if (isUnauthenticated(failure)) return;
      const { text, field } = describeSiteError(failure as Error);
      if (field) {
        setError("");
        // The settings fields live in the collapsed advanced section.
        if (field !== "name" && field !== "origins") setAdvanced(true);
        setInvalid({ field, text });
      } else {
        setInvalid(null);
        setError(`保存失败：${text}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup className="pv-dialog">
        <Dialog.Title>{site ? "编辑站点" : "新建站点"}</Dialog.Title>
        <form className="pv-form" onSubmit={submit}>
          <Field.Root invalid={invalid?.field === "name"}>
            <Field.Label>名称</Field.Label>
            <Field.Control
              ref={controls.name}
              value={form.name}
              onValueChange={set("name")}
              maxLength={80}
              required
              autoComplete="off"
            />
            {fieldError("name")}
          </Field.Root>
          <Field.Root invalid={invalid?.field === "origins"}>
            <Field.Label>允许的域名</Field.Label>
            <Field.Control
              ref={controls.origins}
              render={<textarea rows={3} />}
              value={form.origins}
              onValueChange={set("origins")}
              required
              spellCheck={false}
              placeholder="https://example.com"
            />
            {fieldError("origins")}
            <Field.Description>
              每行一个，仅填写协议与域名（例如
              https://blog.rakko.cn），不含路径。本地调试可填写
              http://localhost:5173。
            </Field.Description>
          </Field.Root>
          <Collapsible.Root
            open={advanced}
            onOpenChange={setAdvanced}
            className="pv-advanced"
          >
            <Collapsible.Trigger>
              <span>高级设置（留空则使用全局默认值）</span>
              <span className="pv-advanced__mark" aria-hidden="true">
                <ChevronIcon />
              </span>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div className="pv-advanced__grid">
                <Field.Root invalid={invalid?.field === "challengeDifficulty"}>
                  <Field.Label>难度</Field.Label>
                  <Field.Control
              ref={controls.challengeDifficulty}
                    type="number"
                    min={1}
                    max={16}
                    placeholder="4"
                    value={form.challengeDifficulty}
                    onValueChange={set("challengeDifficulty")}
                  />
            {fieldError("challengeDifficulty")}
                </Field.Root>
                <Field.Root invalid={invalid?.field === "challengeCount"}>
                  <Field.Label>题目数量</Field.Label>
                  <Field.Control
              ref={controls.challengeCount}
                    type="number"
                    min={1}
                    max={1000}
                    placeholder="50"
                    value={form.challengeCount}
                    onValueChange={set("challengeCount")}
                  />
            {fieldError("challengeCount")}
                </Field.Root>
                <Field.Root invalid={invalid?.field === "tokenTtlMinutes"}>
                  <Field.Label>token 有效期（分钟）</Field.Label>
                  <Field.Control
              ref={controls.tokenTtlMinutes}
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="20"
                    value={form.tokenTtlMinutes}
                    onValueChange={set("tokenTtlMinutes")}
                  />
            {fieldError("tokenTtlMinutes")}
                </Field.Root>
                <label className="pv-check">
                  <Checkbox.Root
                    checked={form.blockAutomatedBrowsers}
                    onCheckedChange={set("blockAutomatedBrowsers")}
                  >
                    <Checkbox.Indicator />
                  </Checkbox.Root>
                  <span>拦截自动化浏览器</span>
                </label>
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
          <Notice>{error}</Notice>
          <DialogActions>
            <Button render={<Dialog.Close />} variant="secondary">
              取消
            </Button>
            <Button type="submit" variant="filled" disabled={busy}>
              保存
            </Button>
          </DialogActions>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function SecretDialog({
  state,
  onClose,
}: {
  state: SecretState | null;
  onClose: () => void;
}) {
  // Keeps the last content while the dialog animates out.
  const [shown, setShown] = useState(state);
  useEffect(() => {
    if (state) setShown(state);
  }, [state]);
  const code = shown ? snippets(location.origin, shown.site.siteKey) : null;
  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Popup className="pv-dialog pv-dialog--wide">
        <Dialog.Title>接入信息</Dialog.Title>
        {shown ? (
          <Dialog.Description
            className={shown.secret ? "pv-secret-warning" : undefined}
          >
            {secretWarning(shown.site, shown.secret)}
          </Dialog.Description>
        ) : null}
        <div className="pv-form">
          {shown?.secret ? (
            <CodeBlock label="Secret（仅显示一次）" code={shown.secret} />
          ) : null}
          {code ? (
            <>
              <CodeBlock label="前端：添加至页面" code={code.frontend} />
              <CodeBlock label="后端：校验 token" code={code.backend} />
            </>
          ) : null}
        </div>
        <DialogActions>
          <Button render={<Dialog.Close />} variant="filled">
            完成
          </Button>
        </DialogActions>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

/** 站点: the registered sites and their integration. */
export function SitesView() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [sites, setSites] = useState<Site[] | null>(null);
  // The edited site outlives `editOpen` so the closing dialog keeps its title.
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const edit = (site: Site | null) => {
    setEditing(site);
    setEditOpen(true);
  };
  const [secret, setSecret] = useState<SecretState | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ sites: Site[] }>("/sites");
      setSites(data.sites);
    } catch (error) {
      if (!isUnauthenticated(error)) {
        toast(siteFailureText("load", error as Error));
      }
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(kind: SiteAction, action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (!isUnauthenticated(error)) {
        toast(siteFailureText(kind, error as Error));
      }
    }
  }

  const toggle = (site: Site) =>
    run(site.enabled ? "disable" : "enable", async () => {
      await api(`/sites/${site.siteKey}`, {
        method: "PATCH",
        body: { enabled: !site.enabled },
      });
      toast(site.enabled ? "已停用" : "已启用");
      await load();
    });

  const rotate = async (site: Site) => {
    const ok = await confirm(
      "轮换 secret",
      `轮换后，${site.name} 的旧 secret 将立即失效，接入方后端须改用新 secret 方可继续校验。`,
      "轮换",
    );
    if (!ok) return;
    await run("rotate", async () => {
      const data = await api<{ secret: string }>(
        `/sites/${site.siteKey}/rotate`,
        { method: "POST" },
      );
      setSecret({ site, secret: data.secret });
    });
  };

  const remove = async (site: Site) => {
    const ok = await confirm(
      "删除站点",
      `删除 ${site.name}（${site.siteKey}）后，其接入代码与 secret 将全部失效，且无法恢复。`,
      "删除",
    );
    if (!ok) return;
    await run("delete", async () => {
      await api(`/sites/${site.siteKey}`, { method: "DELETE" });
      toast("已删除");
      await load();
    });
  };

  return (
    <>
      <PageHead
        title="站点"
        lede="每个站点拥有独立的 site key、密钥与允许的域名。修改将在 30 秒内生效。"
        action={
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => edit(null)}
          >
            新建站点
          </Button>
        }
      />
      {sites === null ? null : sites.length > 0 ? (
        <List.Group aria-label="站点列表" className="pv-sites">
          {sites.map((site) => (
            <SiteRow
              key={site.siteKey}
              site={site}
              onSnippets={() => setSecret({ site, secret: null })}
              onEdit={() => edit(site)}
              onToggle={() => toggle(site)}
              onRotate={() => rotate(site)}
              onDelete={() => remove(site)}
            />
          ))}
        </List.Group>
      ) : (
        <EmptyState layout="none" className="pv-empty">
          暂无站点。新建站点后，将接入代码添加至目标网站即可。
        </EmptyState>
      )}
      <SiteDialog
        open={editOpen}
        site={editing}
        onOpenChange={setEditOpen}
        onSaved={async ({ site, secret: fresh }) => {
          const created = !editing;
          setEditOpen(false);
          if (!created) toast("已保存，修改将在 30 秒内生效。");
          await load();
          if (created) setSecret({ site, secret: fresh });
        }}
      />
      <SecretDialog state={secret} onClose={() => setSecret(null)} />
      {dialog}
    </>
  );
}
