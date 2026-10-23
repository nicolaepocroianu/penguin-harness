/**
 * The brand logo's URL (public/wafh-logo.svg, also the favicon), at the base of the build that
 * serves it: `/wafh-logo.svg` for the app, which the server serves from the root. The
 * component gallery compiles this source under a subpath (`/gallery/` on the public site) and
 * ships the same file in its own public directory, so there the logo resolves inside the gallery.
 */
export const WAFH_LOGO_URL = `${import.meta.env.BASE_URL}wafh-logo.svg`;
