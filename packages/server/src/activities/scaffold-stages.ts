/**
 * `scaffold_module` and `assets_configuration` — the pipeline's other two deterministic
 * stages, and like `prepare_media_assets` they are existing Penguin behaviour given a
 * name and a place in the graph rather than new code.
 *
 * `scaffold_module` writes the module tree an activity's behaviour is implemented into,
 * and it is one of the three stages gated to the canonical ref: the module belongs to the
 * product, and a non-canonical ref writing it would rewrite something its siblings share.
 *
 * `assets_configuration` turns the manifest's bound files into the configuration the WAF
 * runtime reads, resolving each to a `{{MEDIA}}` reference. An asset with no file simply
 * has no binding — which is why this stage reports the gap rather than emitting an entry
 * that points nowhere.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import { mediaConfiguration, type AssetManifest } from "./media.js";
import { ASSETS_CONFIG_STAGE, SCAFFOLD_STAGE } from "./pipeline.js";
import { prepareModule } from "./waf-module.js";
import type { StageContext, StageOutcome, StageRunner } from "./stage-registry.js";

/** What scaffolding produced, as a sentence. Pure, so the wording is testable. */
export function describeScaffold(fileCount: number, bookMode: string | undefined): StageOutcome {
  if (fileCount === 0)
    return {
      summary: "Wrote no module files.",
      problems: ["The scaffold produced nothing, so there is no module to implement."],
    };
  const kind = bookMode ? `${bookMode} book module` : "module";
  return {
    summary: `Wrote ${fileCount} ${kind} ${fileCount === 1 ? "file" : "files"}.`,
  };
}

/**
 * What the configuration stage produced.
 *
 * Counts bindings rather than assets: two keys can resolve to one file when an asset
 * carries a source key, and a language with nothing bound yet is worth naming, because a
 * configuration missing a whole language will not fail — it will just play silence.
 */
export function describeAssetsConfiguration(manifest: AssetManifest): StageOutcome {
  const languages = Object.keys(manifest.assets).sort();
  const empty: string[] = [];
  let bound = 0;
  for (const language of languages) {
    const withFiles = (manifest.assets[language] ?? []).filter((asset) => asset.path);
    bound += withFiles.length;
    if (!withFiles.length) empty.push(language);
  }
  if (!languages.length)
    return {
      summary: "Wrote no configuration.",
      problems: ["The manifest holds no languages, so there is nothing to configure."],
    };
  const summary = `Configured ${bound} bound ${bound === 1 ? "asset" : "assets"} across ${languages.length} ${languages.length === 1 ? "language" : "languages"}.`;
  if (!empty.length) return { summary };
  return {
    summary,
    problems: [
      `${empty.length === 1 ? "Language" : "Languages"} with nothing bound: ${empty.join(", ")}. An unbound language plays silence rather than failing.`,
    ],
  };
}

@Component({
  // Literals only -- see the note in prepare-media-stage.ts.
  contributes: {
    "ActivityStagesModule.stages": [
      {
        id: "scaffold_module",
        order: 40,
        execution: "deterministic",
        dependsOn: ["generate_activity_spec"],
        // The module belongs to the product; only the ref that owns it may write it.
        sharedModule: true,
      },
    ],
  },
})
export class ScaffoldModuleStage {
  @Use() private readonly activities!: ActivityAuthoring;
  @Bind(SCAFFOLD_STAGE) runner!: StageRunner;

  setup() {
    this.runner = { run: (context) => this.scaffold(context) };
  }

  private async scaffold(context: StageContext): Promise<StageOutcome> {
    const activity = await this.activities.getActivity(context.projectId, context.activityId);
    if (!context.wafRoot)
      return {
        summary: "Did not scaffold.",
        problems: [
          "No WAF checkout was resolved for this run, and the scaffold needs the framework it compiles against.",
        ],
      };
    const bookMode = activity.activityType === "book" ? context.bookMode : undefined;
    await prepareModule(context.workspace, activity, context.wafRoot, bookMode);
    // prepareModule writes the tree and verifies every bound reference exists before a
    // Session is created, so reaching here means the scaffold is complete and its media
    // references resolve.
    return describeScaffold(await countModuleFiles(context.workspace), bookMode);
  }
}

/** How many files the scaffold left behind, for the run's record. */
async function countModuleFiles(workspace: string): Promise<number> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.join(workspace, "module");
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else total += 1;
    }
  };
  await walk(root);
  return total;
}

@Component({
  contributes: {
    "ActivityStagesModule.stages": [
      {
        id: "assets_configuration",
        order: 50,
        execution: "deterministic",
        dependsOn: ["prepare_media_assets", "scaffold_module"],
      },
    ],
  },
})
export class AssetsConfigurationStage {
  @Use() private readonly activities!: ActivityAuthoring;
  @Bind(ASSETS_CONFIG_STAGE) runner!: StageRunner;

  setup() {
    this.runner = { run: (context) => this.configure(context) };
  }

  private async configure(context: StageContext): Promise<StageOutcome> {
    const activity = await this.activities.getActivity(context.projectId, context.activityId);
    const manifest = activity.draft.mediaPlan?.manifest;
    if (!manifest)
      return {
        summary: "Did not configure assets.",
        problems: ["There is no media plan yet, so there are no bindings to configure."],
      };
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(context.workspace, "module", "asset-configuration.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(mediaConfiguration(manifest), null, 2)}\n`, "utf8");
    return describeAssetsConfiguration(manifest);
  }
}
