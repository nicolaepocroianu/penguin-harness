import { useEffect, useState } from "react";
import type { CodexConnectionStatus } from "@prismshadow/penguin-server/api";
import { codexConnection } from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { useProject } from "../../state/project";
import { useAuth } from "../../state/auth";

export function CodexConnect({
  onReady,
  onStart,
}: {
  onReady: () => Promise<void>;
  onStart: () => void;
}) {
  const { currentProject, currentAgent } = useProject();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed =
    !!user && !!currentProject && currentProject.ownerUserId === user.userId && !!currentAgent;
  return (
    <>
      <Button
        size="sm"
        disabled={!allowed}
        title={!currentAgent ? S.plugins.codexAgent : !allowed ? S.plugins.codexOwner : undefined}
        onClick={() => setOpen(true)}
      >
        {S.plugins.codexConnect}
      </Button>
      {open && currentProject && currentAgent && (
        <ConnectionDialog
          key={currentProject.projectId + "/" + currentAgent.agentId}
          projectId={currentProject.projectId}
          agentId={currentAgent.agentId}
          onClose={() => setOpen(false)}
          onReady={onReady}
          onStart={onStart}
        />
      )}
    </>
  );
}

function ConnectionDialog({
  projectId,
  agentId,
  onClose,
  onReady,
  onStart,
}: {
  projectId: string;
  agentId: string;
  onClose: () => void;
  onReady: () => Promise<void>;
  onStart: () => void;
}) {
  const [status, setStatus] = useState<CodexConnectionStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => {
    if (busy) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await codexConnection(projectId, agentId);
        if (disposed) return;
        setStatus(next);
        if (next.state === "pending") timer = setTimeout(() => void read(), 2000);
      } catch (e) {
        if (!disposed) setError(apiErrorText(e));
      }
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [projectId, agentId, busy]);
  const act = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await codexConnection(projectId, agentId, method);
      setStatus(next);
      if (method === "POST") {
        setPrepared(true);
        await onReady();
      } else setPrepared(false);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const connected = status?.state === "connected";
  return (
    <Modal
      open
      title={S.plugins.codexTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {status?.state === "pending" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act("DELETE")}
            >
              {S.common.cancel}
            </Button>
          )}
          {connected && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              {S.plugins.codexDisconnect}
            </Button>
          )}
          {connected && prepared ? (
            <Button size="sm" onClick={onStart}>
              {S.plugins.codexChat}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || status?.state === "pending"}
              onClick={() => void act("POST")}
            >
              {connected ? S.plugins.codexEnable : S.plugins.codexStart}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p>{S.plugins.codexDescription}</p>
        <p className="text-xs text-gray-500">{S.plugins.codexPolicy}</p>
        <div aria-live="polite">
          {connected ? (
            <p className={toneInk.success}>
              {prepared ? S.plugins.codexReady : S.plugins.codexConnected}
            </p>
          ) : status?.state === "pending" ? (
            <p>{S.plugins.codexWaiting}</p>
          ) : status?.state === "failed" ? (
            <p className={toneInk.danger}>{S.plugins.codexFailed}</p>
          ) : (
            <p>{status ? S.plugins.codexDisconnected : S.common.loading}</p>
          )}
        </div>
        {status?.verificationUrl && status.state === "pending" && (
          <div className="space-y-3">
            <p className="break-words rounded-lg border border-gray-200 p-3 font-mono dark:border-gray-800">
              {status.message}
            </p>
            <a
              className="inline-block underline"
              href={status.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {S.plugins.codexOpen}
            </a>
          </div>
        )}
        {error && (
          <p role="alert" className={toneInk.danger}>
            {error}
          </p>
        )}
      </div>
      {confirmDisconnect && (
        <ConfirmModal
          open
          title={S.plugins.codexDisconnect}
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={() => {
            setConfirmDisconnect(false);
            void act("DELETE");
          }}
        >
          {S.plugins.codexDisconnectConfirm}
        </ConfirmModal>
      )}
    </Modal>
  );
}
