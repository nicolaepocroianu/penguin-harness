/**
 * Scene looks (experimental, behind `activityVideoExperiment`): a small design system a scene
 * composition can be made in, so every scene of an activity shares one palette, shape language,
 * type and motion. A look is a folder of the waf-scene-composition skill
 * (`looks/<id>/` in plugins/waf-authoring): `manifest.json` names and describes it, `DESIGN.md`
 * tells the agent how to use it, and `look.css` holds its tokens as CSS variables.
 *
 * A composition made in a look has `look.md` (the DESIGN.md) staged beside it and links
 * `look.css`, which is served from the plugin like the bridge is, never from the run's workspace,
 * so the agent cannot change it.
 *
 * The format — a manifest, a DESIGN.md of prose for agents, and a tokens.css — is open-design's
 * design-system package (`design-systems/<slug>/` in github.com/nexu-io/open-design, Apache-2.0).
 * The looks themselves are Penguin's own, made for young learners and animated scenes.
 */
import { libraryPlugin } from "@prismshadow/penguin-core";

/** The skill whose folder holds the looks. */
const LOOKS_SKILL = "waf-scene-composition";
/** What a composition made in a look links, and the guidance staged beside it. */
export const COMPOSITION_LOOK_FILE = "look.css";
export const COMPOSITION_LOOK_GUIDE = "look.md";

export interface SceneLook {
  id: string;
  name: string;
  description: string;
}

interface LookFiles extends SceneLook {
  design: string;
  css: string;
}

/** Every look the installed plugin ships, complete with its files, by id. */
function looks(): Map<string, LookFiles> {
  const files =
    libraryPlugin("waf-authoring")?.skills.find((skill) => skill.name === LOOKS_SKILL)?.files ?? {};
  const found = new Map<string, LookFiles>();
  for (const [file, text] of Object.entries(files)) {
    const match = /^looks\/([a-z0-9-]+)\/manifest\.json$/.exec(file);
    if (!match) continue;
    const id = match[1]!;
    const design = files[`looks/${id}/DESIGN.md`];
    const css = files[`looks/${id}/look.css`];
    let manifest: { name?: unknown; description?: unknown };
    try {
      manifest = JSON.parse(text) as typeof manifest;
    } catch {
      continue;
    }
    if (!design || !css || typeof manifest.name !== "string") continue;
    found.set(id, {
      id,
      name: manifest.name,
      description: typeof manifest.description === "string" ? manifest.description : "",
      design,
      css,
    });
  }
  return found;
}

/** The looks a scene can be composed in, by name. */
export function sceneLooks(): SceneLook[] {
  return [...looks().values()]
    .map(({ id, name, description }) => ({ id, name, description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A look's guidance and tokens; null when the installed plugin has no such look. */
export function sceneLook(id: string): { design: string; css: string } | null {
  const look = looks().get(id);
  return look ? { design: look.design, css: look.css } : null;
}
