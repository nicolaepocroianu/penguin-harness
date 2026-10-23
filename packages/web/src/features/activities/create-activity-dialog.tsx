/**
 * Loom-style create dialog, starting from the idea: what the learner should do comes first and
 * becomes the first lines of the script, so the author lands on their own words rather than an
 * empty editor. The codes follow, with what they are for; the ref number arrives filled in with
 * the next free one for the product code typed (deleted refs keep theirs), unless the author
 * types one of their own.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button, Input, Textarea, Modal, Select } from "@waterford/waf-harness-ui";
import { projectActivitiesApi } from "./activity-api";

/** How long typing pauses before the next free number is asked for. */
const ASK_AFTER_MS = 250;

export function CreateActivityDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (activityId: string) => void;
}) {
  const words = S.activities.createActivity;
  const [description, setDescription] = useState("");
  const [productCode, setProductCode] = useState("");
  const [refNum, setRefNum] = useState("");
  // The number the server suggested for the code typed, and whether the code is a new product.
  const [suggested, setSuggested] = useState<{ refNum: number; first: boolean } | null>(null);
  const typedRef = useRef(false);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("standard");
  const [bookMode, setBookMode] = useState<"" | "readAlong" | "decodable">("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const code = productCode.trim();
    if (!code) {
      setSuggested(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      projectActivitiesApi(projectId)
        .refNumber(code)
        .then((answer) => {
          if (!live || typeof answer?.refNum !== "number" || !Array.isArray(answer.taken)) return;
          setSuggested({ refNum: answer.refNum, first: answer.taken.length === 0 });
          if (!typedRef.current) setRefNum(String(answer.refNum));
        })
        .catch(() => {
          // A code the server cannot read is said when the activity is created.
          if (live) setSuggested(null);
        });
    }, ASK_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, productCode]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const result = await projectActivitiesApi(projectId).create({
        productCode,
        refNum: Number(refNum),
        title,
        activityType,
        ...(activityType === "book" ? { bookMode } : {}),
        ...(description.trim() ? { description } : {}),
      });
      setDescription("");
      setProductCode("");
      setRefNum("");
      setTitle("");
      setBookMode("");
      onCreated(result.id);
    } catch (e) {
      // A deleted ref still holds its number; say so rather than "already reserved".
      setError(
        e instanceof ApiError && e.code === "activity_archived"
          ? S.activities.archivedConflict
          : apiErrorText(e),
      );
    } finally {
      setCreating(false);
    }
  }
  const filled = suggested !== null && refNum === String(suggested.refNum);
  return (
    <Modal
      open
      title={S.activities.create}
      // Wide enough for a few sentences about the activity to read as a paragraph.
      widthClass="sm:max-w-xl"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={creating}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form="create-activity"
            disabled={creating || (activityType === "book" && !bookMode)}
          >
            {creating ? S.activities.busy : S.activities.create}
          </Button>
        </>
      }
    >
      <form id="create-activity" onSubmit={(event) => void create(event)} className="space-y-3">
        <Textarea
          size="sm"
          rows={4}
          label={words.learner}
          info={<p>{words.learnerHint}</p>}
          infoLabel={words.learner}
          placeholder={words.learnerPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={100_000}
          disabled={creating}
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Input
            size="sm"
            label={S.activities.productCode}
            hint={words.productCodeHint}
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            required
            maxLength={100}
            disabled={creating}
          />
          <Input
            size="sm"
            label={S.activities.refNum}
            hint={filled ? (suggested.first ? words.refFirst : words.refNext) : undefined}
            type="number"
            min={0}
            step={1}
            value={refNum}
            onChange={(e) => {
              typedRef.current = true;
              setRefNum(e.target.value);
            }}
            required
            disabled={creating}
          />
        </div>
        <Input
          size="sm"
          label={S.activities.name}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          disabled={creating}
        />
        <Select
          size="sm"
          label={S.activities.type}
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
          disabled={creating}
        >
          <option value="standard">{S.activities.standard}</option>
          <option value="book">{S.activities.book}</option>
        </Select>
        {activityType === "book" && (
          <Select
            size="sm"
            label={S.activities.readingMode}
            aria-label={S.activities.readingMode}
            info={<p>{S.activities.readingModeHint}</p>}
            infoLabel={S.activities.readingMode}
            value={bookMode}
            onChange={(e) => setBookMode(e.target.value as typeof bookMode)}
            required
            disabled={creating}
          >
            <option value="">{S.activities.chooseReadingMode}</option>
            <option value="readAlong">{S.activities.readAlong}</option>
            <option value="decodable">{S.activities.decodable}</option>
          </Select>
        )}
        {error && (
          <p role="alert" className={`text-xs ${toneInk.danger}`}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
