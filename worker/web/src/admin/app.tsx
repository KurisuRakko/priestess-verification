import { CSPProvider } from "@base-ui/react/csp-provider";
import {
  Button,
  IconButton,
  Skeleton,
  Snackbar,
  Tabs,
  TopBar,
  useSnackbar,
} from "@rakko/react";
import { useEffect, useRef, useState } from "react";

import { usePageConfig } from "../shared/page-config";
import { useThemeToggle } from "../shared/theme";
import { setUnauthenticatedHandler } from "./api";
import { finishSignIn } from "./callback";
import type { AdminConfig } from "./config";
import {
  BOOT_FAILED,
  SESSION_EXPIRED,
  SIGNED_OUT,
  loginErrorText,
} from "./errors";
import { GateView } from "./gate-view";
import { LogoutIcon, MarkIcon, MoonIcon, SunIcon } from "./icons";
import { SitesView } from "./sites-view";
import { StatsView } from "./stats-view";
import { Notice } from "./ui";

/**
 * The console bundle: `/admin` (sign-in panel or the three tabs) and
 * `/admin/callback`. Base UI's own `<style>` elements (Select) carry the
 * page's CSP nonce, read from the script element this bundle runs in.
 */
const NONCE =
  (document.currentScript as HTMLScriptElement | null)?.nonce || undefined;

const VIEWS = ["sites", "stats", "gate"] as const;
type View = (typeof VIEWS)[number];

function viewFromHash(): View {
  const name = location.hash.slice(1);
  return (VIEWS as readonly string[]).includes(name) ? (name as View) : "sites";
}

interface User {
  name: string;
  sub: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "login"; message: string }
  | { kind: "console"; user: User };

function AdminTopBar({
  user,
  themeToggle,
  onSignOut,
}: {
  user: User | null;
  themeToggle: boolean;
  onSignOut: () => void;
}) {
  const [theme, toggleTheme] = useThemeToggle();
  return (
    <TopBar.Root reveal="scroll" className="pv-bar">
      <div className="pv-bar__inner">
        <TopBar.Title className="pv-bar__brand">
          <a className="pv-brand" href="/admin">
            <span className="pv-brand__mark">
              <MarkIcon />
            </span>
            <span>
              Priestess Verification <span className="pv-brand__sub">· 后台</span>
            </span>
          </a>
        </TopBar.Title>
        <TopBar.Actions aria-label="账号与显示">
          {user ? (
            <>
              <span className="pv-bar__user">{user.name}</span>
              <Button variant="ghost" icon={<LogoutIcon />} onClick={onSignOut}>
                退出
              </Button>
            </>
          ) : null}
          {themeToggle ? (
            <IconButton
              pressed={theme === "dark"}
              aria-label="切换深色模式"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </IconButton>
          ) : null}
        </TopBar.Actions>
      </div>
    </TopBar.Root>
  );
}

function LoginPanel({ message }: { message: string }) {
  return (
    <section className="pv-login" aria-labelledby="login-title">
      <h1 className="pv-login__title" id="login-title">
        站点后台
      </h1>
      <p className="pv-login__lede">
        使用 Priestess 账号登录后，可管理接入站点、域名与密钥。
      </p>
      <Notice>{message}</Notice>
      <Button
        variant="filled"
        render={<a href="/admin/login" />}
        nativeButton={false}
      >
        使用 Priestess 登录
      </Button>
    </section>
  );
}

function ConsoleTabs() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const follow = () => setView(viewFromHash());
    addEventListener("hashchange", follow);
    return () => removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    const hash = view === "sites" ? "" : `#${view}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", location.pathname + hash);
    }
  }, [view]);

  return (
    <Tabs.Root
      value={view}
      onValueChange={(value) => setView(value as View)}
      className="pv-tabs"
    >
      <Tabs.List aria-label="后台页面" className="pv-tabs__list">
        <Tabs.Tab value="sites">站点</Tabs.Tab>
        <Tabs.Tab value="stats">统计</Tabs.Tab>
        <Tabs.Tab value="gate">验证网关</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="sites" keepMounted className="pv-view">
        <SitesView />
      </Tabs.Panel>
      <Tabs.Panel value="stats" keepMounted className="pv-view">
        <StatsView active={view === "stats"} />
      </Tabs.Panel>
      <Tabs.Panel value="gate" keepMounted className="pv-view">
        <GateView active={view === "gate"} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function Console() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    setUnauthenticatedHandler(() =>
      setPhase({ kind: "login", message: SESSION_EXPIRED }),
    );
    const error = new URLSearchParams(location.search).get("error");
    if (error) history.replaceState(null, "", location.pathname + location.hash);
    (async () => {
      const res = await fetch("/admin/api/me", { credentials: "same-origin" });
      if (!res.ok) {
        setPhase({ kind: "login", message: loginErrorText(error) });
        return;
      }
      const { user } = (await res.json()) as { user: User };
      setPhase({ kind: "console", user });
    })().catch(() => setPhase({ kind: "login", message: BOOT_FAILED }));
  }, []);

  async function signOut() {
    try {
      await fetch("/admin/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
    } catch {}
    setPhase({ kind: "login", message: SIGNED_OUT });
  }

  return (
    <>
      <AdminTopBar
        user={phase.kind === "console" ? phase.user : null}
        themeToggle
        onSignOut={signOut}
      />
      <main className="pv-main" aria-busy={phase.kind === "loading"}>
        {phase.kind === "loading" ? (
          <Skeleton className="pv-loading" lines={3} />
        ) : phase.kind === "login" ? (
          <LoginPanel message={phase.message} />
        ) : (
          <ConsoleTabs />
        )}
      </main>
    </>
  );
}

function Callback() {
  // Once only: the fragment is gone after the first run.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = location.hash;
    history.replaceState(null, "", location.pathname);
    finishSignIn(hash).then((url) => location.replace(url));
  }, []);
  return (
    <>
      <AdminTopBar user={null} themeToggle={false} onSignOut={() => {}} />
      <main className="pv-main">
        <section className="pv-login" aria-labelledby="login-title" aria-busy="true">
          <h1 className="pv-login__title" id="login-title">
            正在登录…
          </h1>
          <p className="pv-login__lede">正在向 Priestess 确认身份。</p>
        </section>
      </main>
    </>
  );
}

function SnackbarHost() {
  const { toasts } = useSnackbar();
  return (
    <Snackbar.Viewport>
      {toasts.map((toast) => (
        <Snackbar.Root key={toast.id} toast={toast}>
          <Snackbar.Title />
        </Snackbar.Root>
      ))}
    </Snackbar.Viewport>
  );
}

export function AdminApp() {
  const config = usePageConfig<AdminConfig>();
  return (
    <CSPProvider nonce={NONCE}>
      <Snackbar.Provider>
        {config.view === "callback" ? <Callback /> : <Console />}
        <SnackbarHost />
      </Snackbar.Provider>
    </CSPProvider>
  );
}
