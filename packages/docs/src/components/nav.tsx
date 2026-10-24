/** Docs routes and drawer control rendered through the shared public-site header. */
import type { RefObject } from "react";
import { Link } from "react-router";
import { SiteGitHubLink, SiteHeader, type SiteLink } from "@waterford/waf-harness-ui/site";
import { S } from "../lib/strings";
import { REPO_API_URL, REPO_URL } from "../lib/links";
import { ThemeToggle } from "./theme-toggle";

export function Nav({
  menuOpen,
  onToggleMenu,
  menuButtonRef,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const home: SiteLink = {
    id: "home",
    href: "/",
    label: S.nav.home,
    render: ({ href, ...props }) => <Link to={href} {...props} />,
  };
  return (
    <SiteHeader
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}wafh-logo.svg`}
      home={home}
      links={[
        {
          id: "docs",
          href: "/",
          label: S.nav.docs,
          active: true,
          render: ({ href, ...props }) => <Link to={href} {...props} />,
        },
      ]}
      actions={
        <>
          <ThemeToggle />
          <SiteGitHubLink href={REPO_URL} apiUrl={REPO_API_URL} label={S.nav.github} />
        </>
      }
      menu={{
        open: menuOpen,
        onToggle: onToggleMenu,
        buttonRef: menuButtonRef,
        label: menuOpen ? S.nav.closeMenu : S.nav.openMenu,
        hiddenClass: "lg:hidden",
      }}
    />
  );
}
