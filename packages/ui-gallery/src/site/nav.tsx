/** Gallery routes and drawer control rendered through the shared public-site header. */
import { SiteGitHubLink, SiteHeader, SiteNavLinks } from "@waterford/waf-harness-ui/site";
import { BASE } from "../lib/location";
import { homeHref } from "../lib/routes";
import { useGallery } from "../state";
import { REPO_API_URL, REPO_URL } from "./links";
import { ThemeToggle } from "./theme-toggle";

/** The drawer button follows the link row or the section list's breakpoint. */
export type MenuWidth = "links" | "list";
const MENU_BUTTON_HIDDEN: Record<MenuWidth, string> = {
  links: "md:hidden",
  list: "min-[901px]:hidden",
};

function useSiteLinks() {
  const { S: G, state } = useGallery();
  const S = G.sitebar;
  return [{ id: "gallery", href: homeHref(BASE, state), label: S.nav.gallery, active: true }];
}

export function SiteNav({
  menuOpen,
  onToggleMenu,
  menuWidth,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuWidth: MenuWidth;
}) {
  const S = useGallery().S.sitebar;
  const links = useSiteLinks();
  return (
    <SiteHeader
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}wafh-logo.svg`}
      home={links[0]!}
      links={links}
      actions={
        <>
          <ThemeToggle />
          <SiteGitHubLink href={REPO_URL} apiUrl={REPO_API_URL} label={S.nav.github} />
        </>
      }
      menu={{
        open: menuOpen,
        onToggle: onToggleMenu,
        hiddenClass: MENU_BUTTON_HIDDEN[menuWidth],
        label: menuOpen ? S.nav.closeMenu : S.nav.openMenu,
      }}
    />
  );
}

export function SiteMenu({ onNavigate }: { onNavigate: () => void }) {
  return <SiteNavLinks links={useSiteLinks()} mobile onNavigate={onNavigate} />;
}
