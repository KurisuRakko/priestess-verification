import {
  Button,
  List,
  NumberRoll,
  Snackbar,
  SwapText,
  TopBar,
  useSnackbar,
} from "@rakko/react";
import { useEffect, useState } from "react";

import { fill, formatLeft, passFacts, secondsLeft } from "./common";
import type { GateConfig } from "./config";
import { postJson } from "./config";
import { Icon } from "./icons";
import type { GateStrings } from "./strings";

/** How long the "pass cleared" snackbar shows before the reload. */
const RELOAD_DELAY_MS = 900;

function clockTime(expiresAt: number, locale: string): string {
  return new Date(expiresAt * 1000).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * The `/protected` example: what a gated page looks like once through. Counts
 * the pass down and can clear it at `POST /__gate/logout`; the reload then
 * lands on the challenge again. The shell renders the same markup as its
 * first frame (with the expiry clock time left blank: the server does not
 * know the visitor's time zone).
 */
export function Passed({ config, s }: { config: GateConfig; s: GateStrings }) {
  return (
    <Snackbar.Provider>
      <PassedPage config={config} s={s} />
      <SnackbarHost />
    </Snackbar.Provider>
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

function PassedPage({ config, s }: { config: GateConfig; s: GateStrings }) {
  const expiresAt = config.expiresAt ?? 0;
  const [left, setLeft] = useState(() => secondsLeft(expiresAt, Date.now()));
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const { add } = useSnackbar();
  const facts = passFacts(config, s);

  const expired = left === 0;
  useEffect(() => {
    setExpiry(clockTime(expiresAt, s.htmlLang));
    if (expired) return;
    const timer = setInterval(
      () => setLeft(secondsLeft(expiresAt, Date.now())),
      1000,
    );
    return () => clearInterval(timer);
  }, [expiresAt, expired, s.htmlLang]);

  async function logout() {
    setBusy(true);
    try {
      const { res } = await postJson(config, "logout");
      if (res.ok) {
        add({ title: s.logoutDone });
        setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        return;
      }
    } catch {}
    setBusy(false);
    add({ title: s.logoutFailed });
  }

  return (
    <>
      <TopBar.Root className="pv-pass-bar">
        <TopBar.Title className="pv-pass-bar__title">
          <Icon name="shield" className="pv-pass-bar__icon" />
          <span className="pv-pass-bar__host">{config.host}</span>
        </TopBar.Title>
        <TopBar.Actions aria-label={s.verified}>
          <span className="pv-pass-badge" data-expired={expired || undefined}>
            <Icon name="check" className="pv-pass-badge__icon" />
            <span>{s.verified}</span>
          </span>
        </TopBar.Actions>
      </TopBar.Root>
      <main className="pv-pass">
        <section className="pv-pass__card" aria-labelledby="pass-heading">
          <p className="pv-pass__eyebrow">{s.passedEyebrow}</p>
          <h1 className="pv-pass__title" id="pass-heading">
            {s.passedHeading}
          </h1>
          <p className="pv-pass__lede">{fill(s.passedLede, facts)}</p>
          <div className="pv-pass__timer" data-expired={expired || undefined}>
            <p className="pv-pass__label">{s.remaining}</p>
            <p className="pv-pass__clock" role="timer">
              <NumberRoll value={formatLeft(left)} />
            </p>
            <p className="pv-pass__expires">
              <SwapText
                value={
                  expired
                    ? s.expired
                    : expiry
                      ? fill(s.expiresAt, { time: expiry })
                      : " "
                }
              />
            </p>
          </div>
          <div className="pv-pass__actions">
            <Button
              variant={expired ? "primary" : "secondary"}
              onClick={expired ? () => location.reload() : logout}
              disabled={busy}
            >
              <SwapText value={expired ? s.reverify : s.logout} />
            </Button>
          </div>
        </section>
        <List.Group
          className="pv-pass__how"
          header={s.howHeading}
          footer={fill(s.howFooter, facts)}
        >
          {s.steps.map((step, index) => (
            <List.Row
              key={step.title}
              leading={<span className="pv-pass__step">{index + 1}</span>}
            >
              <span className="pv-pass__step-title">{step.title}</span>
              <span className="pv-pass__step-text">
                {fill(step.text, facts)}
              </span>
            </List.Row>
          ))}
        </List.Group>
      </main>
    </>
  );
}
