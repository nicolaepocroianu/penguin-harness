/** Bind the shared site control to this site's preferences and translations. */
import { SiteThemeToggle, useSiteTheme } from "@waterford/waf-harness-ui/site";
import { S } from "../lib/strings";

export function ThemeToggle() {
  const { mode, setMode } = useSiteTheme();
  return <SiteThemeToggle mode={mode} onChange={setMode} labels={S.theme} />;
}
