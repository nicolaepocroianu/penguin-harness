/**
 * App root: Locale -> Theme -> LocaleScope -> Router, the same composition as the docs. The
 * shared providers own the preferences; this site supplies its dictionary. The site is English
 * only, so every locale reads the English dictionary and there is no language menu.
 */
import {
  SiteLocaleProvider,
  SiteLocaleScope,
  SiteThemeProvider,
} from "@prismshadow/penguin-ui/site";
import { setActiveStrings } from "./lib/strings";
import { en } from "./lib/strings-en";
import { AppRouter } from "./router";

const applyLocale = () => setActiveStrings(en);

export function App() {
  return (
    <SiteLocaleProvider onLocale={applyLocale}>
      <SiteThemeProvider>
        <SiteLocaleScope>
          <AppRouter />
        </SiteLocaleScope>
      </SiteThemeProvider>
    </SiteLocaleProvider>
  );
}
