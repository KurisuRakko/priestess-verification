import {
  Button,
  IconButton,
  SegmentedChoice,
  Snackbar,
  TopBar,
  smoothScrollTo,
  useSnackbar,
} from "@rakko/react";

import type { Lang } from "../shared/i18n";
import { useLang } from "../shared/i18n";
import { usePageConfig } from "../shared/page-config";
import { useThemeToggle } from "../shared/theme";
import type { ShowcaseConfig } from "./config";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  GithubIcon,
  MoonIcon,
  SunIcon,
} from "./icons";
import { Playground } from "./playground";
import type { ShowcaseStrings } from "./strings";
import { STRINGS } from "./strings";

const GATE_DEMO = "/protected";
const PLAYGROUND_ID = "try";

/** Spring-scrolls the playground under the top bar. */
function scrollToPlayground() {
  const target = document.getElementById(PLAYGROUND_ID);
  if (!target) return;
  const bar = document.querySelector<HTMLElement>(".rk-top-bar");
  const top =
    target.getBoundingClientRect().top +
    window.scrollY -
    (bar?.offsetHeight ?? 0) -
    8;
  smoothScrollTo(window, Math.max(0, top));
}

function ShowcaseTopBar({
  lang,
  setLang,
  repo,
  s,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  repo: string;
  s: ShowcaseStrings;
}) {
  const [theme, toggleTheme] = useThemeToggle();
  return (
    <TopBar.Root reveal="scroll" className="pv-bar">
      <div className="pv-bar__inner">
        <TopBar.Title className="pv-bar__brand">
          <span className="pv-bar__mark" aria-hidden="true" />
          {s.brand}
        </TopBar.Title>
        <TopBar.Actions aria-label={s.controlsLabel}>
          <SegmentedChoice.Root
            aria-label={s.langLabel}
            className="pv-bar__lang"
            value={lang}
            onValueChange={(value) => setLang(value as Lang)}
          >
            <SegmentedChoice.Item value="zh">中</SegmentedChoice.Item>
            <SegmentedChoice.Item value="en">EN</SegmentedChoice.Item>
          </SegmentedChoice.Root>
          <IconButton
            pressed={theme === "dark"}
            aria-label={theme === "dark" ? s.themeToLight : s.themeToDark}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </IconButton>
          <IconButton
            render={<a href={repo} target="_blank" rel="noreferrer noopener" />}
            nativeButton={false}
            aria-label={s.github}
          >
            <GithubIcon />
          </IconButton>
        </TopBar.Actions>
      </div>
    </TopBar.Root>
  );
}

function Hero({ s }: { s: ShowcaseStrings }) {
  return (
    <header className="pv-hero">
      <p className="pv-eyebrow">
        <span className="pv-eyebrow__dot" aria-hidden="true" />
        {s.eyebrow}
      </p>
      <h1 className="pv-hero__title">{s.heroTitle}</h1>
      <p className="pv-hero__lede">{s.heroLede}</p>
      <div className="pv-hero__actions">
        <Button
          variant="primary"
          icon={<ArrowDownIcon />}
          onClick={scrollToPlayground}
        >
          {s.tryIt}
        </Button>
        <Button
          variant="secondary"
          render={<a href={GATE_DEMO} />}
          nativeButton={false}
        >
          {s.seeGate}
        </Button>
      </div>
      <ul className="pv-hero__facts">
        {s.heroFacts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </header>
  );
}

function SectionHead({
  eyebrow,
  title,
  lede,
  id,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  id: string;
}) {
  return (
    <header className="pv-section__head">
      <p className="pv-section__eyebrow">{eyebrow}</p>
      <h2 className="pv-section__title" id={id}>
        {title}
      </h2>
      {lede ? <p className="pv-section__lede">{lede}</p> : null}
    </header>
  );
}

function Features({ s }: { s: ShowcaseStrings }) {
  return (
    <section className="pv-section" aria-labelledby="pv-features-title">
      <SectionHead
        id="pv-features-title"
        eyebrow={s.featuresEyebrow}
        title={s.featuresTitle}
      />
      <ol className="pv-features">
        {s.features.map((feature, index) => (
          <li key={feature.title} className="pv-feature">
            <span className="pv-feature__num" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="pv-feature__title">{feature.title}</h3>
            <p className="pv-feature__body">{feature.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GatePreview({ s }: { s: ShowcaseStrings }) {
  return (
    <section className="pv-section" aria-labelledby="pv-gate-title">
      <div className="pv-gate">
        <div className="pv-gate__text">
          <p className="pv-section__eyebrow">{s.gateEyebrow}</p>
          <h2 className="pv-section__title" id="pv-gate-title">
            {s.gateTitle}
          </h2>
          <p className="pv-section__lede">{s.gateBody}</p>
          <Button
            variant="primary"
            icon={<ArrowRightIcon />}
            render={<a href={GATE_DEMO} />}
            nativeButton={false}
            className="pv-gate__cta"
          >
            {s.gateCta}
          </Button>
        </div>
        <ol className="pv-gate__flow" aria-label={s.gateFlowLabel}>
          {s.gateFlow.map((step, index) => (
            <li key={step} className="pv-gate__step">
              <span className="pv-gate__num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="pv-gate__label">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
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

/**
 * The showcase: hero, the playground (every variant solves a real challenge
 * against `/demo/` and is checked by `/demo/siteverify`), why it works, and
 * the site-wide gate. The provenance footer is server-rendered after #root.
 */
export function ShowcaseApp() {
  const config = usePageConfig<ShowcaseConfig>();
  const [lang, setLang] = useLang("pv-lang");
  const s = STRINGS[lang];

  return (
    <Snackbar.Provider>
      <ShowcaseTopBar lang={lang} setLang={setLang} repo={config.repo} s={s} />
      <main className="pv-page">
        <Hero s={s} />
        <section
          className="pv-section"
          id={PLAYGROUND_ID}
          aria-labelledby="pv-play-title"
        >
          <SectionHead
            id="pv-play-title"
            eyebrow={s.playEyebrow}
            title={s.playTitle}
            lede={s.playLede}
          />
          <Playground config={config} lang={lang} s={s} />
        </section>
        <Features s={s} />
        <GatePreview s={s} />
      </main>
      <SnackbarHost />
    </Snackbar.Provider>
  );
}
