/**
 * Gallery chrome copy: the dictionary contract lives in strings-types.ts and the English
 * dictionary, the only one, in strings-en.ts. Pages read it through `useGallery().S`.
 */
import { en } from "./strings-en";
import type { GalleryStrings } from "./strings-types";
export type { A2uiSample, GalleryStrings, SurfaceCopy } from "./strings-types";

/** The active dictionary. */
export const S: GalleryStrings = en;
