/**
 * The Layout menu at the foot of the studio's tool rail: the built-in and saved layouts, "Save current
 * as…", "Manage…" and the Alt+number shortcut switch. It owns only the list of layouts; the
 * arrangement itself belongs to the workspace, which is handed the chosen layout to apply.
 */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  Input,
  Modal,
  toastSuccess,
  ICON_SIZE,
  ICONS,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@waterford/waf-harness-ui";
import { S } from "../../lib/strings";
import {
  BUILT_IN_PRESETS,
  LAYOUTS_KEY,
  allPresets,
  commitPresets,
  currentPresetId,
  deletePreset,
  isTypingTarget,
  readPresets,
  renamePreset,
  savePreset,
  shortcutIndex,
  type LayoutPreset,
  type LayoutState,
  type LayoutStore,
  type PresetError,
  type PresetResult,
  type SavedPreset,
} from "./layout-presets";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD_MIDDLE,
  TH,
} from "../../components/ui/table-classes";

/** A layout's name as the author sees it, read at render time. */
export function presetName(preset: LayoutPreset): string {
  return preset.builtIn ? S.activities.layouts.builtIn[preset.id] : preset.name;
}

function builtInNames(): string[] {
  return BUILT_IN_PRESETS.map((preset) => S.activities.layouts.builtIn[preset.id]);
}

function errorText(error: PresetError): string {
  const words = S.activities.layouts;
  if (error === "limit") return words.limit;
  if (error === "duplicate") return words.duplicate;
  if (error === "tooLong") return words.tooLong;
  return words.empty;
}

export function LayoutMenu({
  state,
  onApply,
}: {
  /** The arrangement on screen, to mark the layout it matches and to save. */
  state: LayoutState;
  onApply: (preset: LayoutPreset) => void;
}) {
  const words = S.activities.layouts;
  const [store, setStoreState] = useState<LayoutStore>(() => readPresets());
  const [open, setOpen] = useState(false);
  // The name dialog, for a new layout or for renaming a saved one.
  const [naming, setNaming] = useState<
    { mode: "save" } | { mode: "rename"; preset: SavedPreset } | null
  >(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<SavedPreset | null>(null);

  // False once storage refused a write: from then on this page's copy is the only one.
  const persisted = useRef(true);

  /**
   * Changes the layouts as storage holds them now, so a layout another tab saved is kept.
   * Blocked storage keeps the layouts for this page; there is nothing more to do about it.
   */
  function change(apply: (current: LayoutStore) => LayoutStore | null): boolean {
    const result = commitPresets(store, persisted.current, apply);
    if (!result) return false;
    persisted.current = result.persisted;
    setStoreState(result.store);
    return true;
  }

  // Another tab saved, renamed or deleted a layout, or flipped the shortcuts.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LAYOUTS_KEY) return;
      if (persisted.current) setStoreState(readPresets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const presets = allPresets(store);
  const current = currentPresetId(state, presets);

  // The latest list and handler for the shortcut listener, which is installed once.
  const latest = useRef({ presets, onApply });
  latest.current = { presets, onApply };
  useEffect(() => {
    if (!store.shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const index = shortcutIndex(event);
      if (index === null) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      const preset = latest.current.presets[index];
      if (!preset) return;
      event.preventDefault();
      latest.current.onApply(preset);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.shortcuts]);

  function startNaming(next: NonNullable<typeof naming>) {
    setOpen(false);
    setName(next.mode === "rename" ? next.preset.name : "");
    setNameError(null);
    setNaming(next);
  }

  function submitName() {
    if (!naming) return;
    // Checked against the layouts as stored now, so a name another tab took is refused.
    const outcome: { result?: PresetResult } = {};
    change((current) => {
      const result =
        naming.mode === "save"
          ? savePreset(current, name, state, builtInNames())
          : renamePreset(current, naming.preset.id, name, builtInNames());
      outcome.result = result;
      return result.ok ? result.store : null;
    });
    const result = outcome.result;
    if (!result) return;
    if (!result.ok && result.error === "missing") {
      // Another tab deleted the layout being renamed: show the list as it now stands.
      setNaming(null);
      if (persisted.current) setStoreState(readPresets());
      return;
    }
    if (!result.ok) {
      setNameError(errorText(result.error));
      return;
    }
    setNaming(null);
    toastSuccess(
      naming.mode === "save" ? words.saved(result.preset.name) : words.renamed(result.preset.name),
    );
  }

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        portal={{ direction: "up", align: "right" }}
        menuClass="w-72 max-w-[calc(100vw-1.5rem)]"
        button={
          // Shaped as the tools above it on the rail, whose foot it sits at.
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            data-tooltip={words.menu}
            onClick={() => setOpen(!open)}
            className={`grid w-10 place-items-center gap-1 rounded-md py-1.5 sm:w-14 ${
              open
                ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <GlyphIcon d={ICONS.panelLeft} size={ICON_SIZE.navRow} />
            <span className="text-xs leading-none max-sm:sr-only">{words.menu}</span>
          </button>
        }
      >
        <Menu label={words.menu} density="md" className="max-h-[60vh] overflow-y-auto py-1">
          {presets.map((preset, index) => (
            <MenuItem
              key={preset.id}
              label={presetName(preset)}
              onSelect={() => {
                setOpen(false);
                onApply(preset);
              }}
              trailing={
                (preset.id === current || (store.shortcuts && index < 9)) && (
                  <span className="flex items-center gap-2">
                    {preset.id === current && <span>{words.current}</span>}
                    {store.shortcuts && index < 9 && (
                      <kbd className="font-mono">{words.shortcutKey(index + 1)}</kbd>
                    )}
                  </span>
                )
              }
            />
          ))}
          <MenuSeparator />
          <MenuItem label={words.saveAs} onSelect={() => startNaming({ mode: "save" })} />
          <MenuItem
            label={words.manage}
            onSelect={() => {
              setOpen(false);
              setManaging(true);
            }}
          />
          <MenuSeparator />
          <MenuItem
            label={words.shortcuts}
            description={words.shortcutsHint}
            checked={store.shortcuts}
            onSelect={() => change((current) => ({ ...current, shortcuts: !store.shortcuts }))}
          />
        </Menu>
      </Dropdown>
      <Modal
        open={naming !== null}
        title={naming?.mode === "rename" ? words.renameTitle(naming.preset.name) : words.saveTitle}
        onClose={() => setNaming(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={submitName}>
              {naming?.mode === "rename" ? words.rename : words.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          autoFocus
          label={words.name}
          hint={words.nameHint}
          value={name}
          maxLength={80}
          error={nameError ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitName();
            }
          }}
        />
      </Modal>
      <Modal
        open={managing && naming === null && deleting === null}
        title={words.manageTitle}
        onClose={() => setManaging(false)}
        widthClass="sm:max-w-lg"
      >
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className={TH}>{words.nameColumn}</th>
                <th className={TH}>{words.kindColumn}</th>
                <th className={TH}>
                  <span className="sr-only">{words.actionsColumn}</span>
                </th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {presets.map((preset) => (
                <tr key={preset.id}>
                  <td className={`${TD_MIDDLE} max-w-[16rem] truncate font-medium`}>
                    {presetName(preset)}
                  </td>
                  <td
                    className={`${TD_MIDDLE} whitespace-nowrap text-xs text-gray-500 dark:text-gray-400`}
                  >
                    {preset.builtIn ? words.builtInTag : words.savedTag}
                  </td>
                  <td className={`${TD_MIDDLE} whitespace-nowrap text-right`}>
                    {!preset.builtIn && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={words.renameLabel(preset.name)}
                          onClick={() => startNaming({ mode: "rename", preset })}
                        >
                          {words.rename}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={words.deleteLabel(preset.name)}
                          onClick={() => setDeleting(preset)}
                        >
                          {words.delete}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {store.presets.length === 0 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{words.manageEmpty}</p>
        )}
      </Modal>
      <ConfirmModal
        cancelLabel={S.common.cancel}
        open={deleting !== null}
        title={words.deleteTitle}
        confirmLabel={words.delete}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          change((current) => deletePreset(current, id));
          toastSuccess(words.deleted(deleting.name));
          setDeleting(null);
        }}
      >
        <p className="text-sm">{deleting ? words.deleteConfirm(deleting.name) : ""}</p>
      </ConfirmModal>
    </>
  );
}
