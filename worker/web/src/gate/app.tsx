import { usePageConfig } from "../shared/page-config";
import { Challenge } from "./challenge";
import type { GateConfig } from "./config";
import { Passed } from "./passed";
import { RayCopy } from "./ray-copy";
import { STRINGS } from "./strings";

/**
 * One bundle for both gate pages, picked by the page config's `view`.
 * Language comes from the server (Accept-Language), the theme follows the OS
 * (the shell's boot script). The footer with the session ID is part of the
 * server shell, outside #root; only its copy button comes from here.
 */
export function GateApp() {
  const config = usePageConfig<GateConfig>();
  const s = STRINGS[config.lang] ?? STRINGS.en;
  return (
    <>
      {config.view === "passed" ? (
        <Passed config={config} s={s} />
      ) : (
        <Challenge config={config} s={s} />
      )}
      <RayCopy ray={config.ray} s={s} />
    </>
  );
}
