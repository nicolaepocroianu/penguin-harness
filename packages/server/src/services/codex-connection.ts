import path from "node:path";
import { pathToFileURL } from "node:url";
import { libraryPluginPackagePath, projectDir } from "@prismshadow/penguin-core";
import type { CodexConnectionStatus } from "../api/types.js";

export interface CodexControl {
  call(name: string): Promise<unknown>;
  close(): Promise<void>;
}
export function codexServerPath(): string {
  const root = libraryPluginPackagePath("use-codex");
  if (!root) throw new Error("The Codex plugin is not available in this installation");
  return path.join(root, "src", "server.mjs");
}

/** Account setup only. Tasks continue through the agent's existing MCP boundary. */
export class CodexConnections {
  private entries = new Map<
    string,
    { control: Promise<CodexControl>; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private root: string,
    private factory: (dir: string) => Promise<CodexControl> = async (dir) => {
      const bridgeUrl = pathToFileURL(
        path.join(path.dirname(codexServerPath()), "bridge.mjs"),
      ).href;
      const module = await import(/* @vite-ignore */ bridgeUrl);
      return new module.CodexBridge({ projectDir: dir, cwd: dir }) as CodexControl;
    },
  ) {}

  private control(projectId: string): Promise<CodexControl> {
    let entry = this.entries.get(projectId);
    if (!entry) {
      if (this.entries.size >= 16)
        throw new Error("Too many active subscription connections; try again later");
      const control = this.factory(projectDir(this.root, projectId));
      entry = { control, timer: setTimeout(() => {}, 0) };
      this.entries.set(projectId, entry);
      void control.catch(() => this.release(projectId));
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.release(projectId), 16 * 60_000);
    entry.timer.unref();
    return entry.control;
  }

  async status(projectId: string): Promise<CodexConnectionStatus> {
    const control = await this.control(projectId);
    try {
      const raw = (await control.call("codex_status")) as {
        account?: { type?: string };
        login?: { status?: string; verificationUrl?: string; message?: string } | null;
      };
      const connected = raw.account?.type === "chat-gpt";
      const pending = raw.login?.status === "pending";
      // Only offer the official device-login origin as a clickable link.
      let verificationUrl: string | undefined;
      if (pending && raw.login?.verificationUrl) {
        const url = new URL(raw.login.verificationUrl);
        if (url.origin === "https://auth.openai.com" && !url.username && !url.password)
          verificationUrl = url.href;
      }
      return {
        state: connected
          ? "connected"
          : pending
            ? "pending"
            : raw.login?.status === "failed"
              ? "failed"
              : "disconnected",
        ...(verificationUrl
          ? { verificationUrl, message: raw.login?.message?.slice(0, 2000) }
          : {}),
      };
    } catch (error) {
      this.release(projectId);
      throw error;
    }
  }
  async connect(projectId: string): Promise<CodexConnectionStatus> {
    const control = await this.control(projectId);
    try {
      await control.call("codex_connect");
      return await this.status(projectId);
    } catch (error) {
      this.release(projectId);
      throw error;
    }
  }
  async disconnect(projectId: string): Promise<CodexConnectionStatus> {
    const control = await this.control(projectId);
    await control.call("codex_disconnect");
    this.release(projectId);
    return { state: "disconnected" };
  }
  private release(projectId: string) {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(projectId);
    void entry.control.then((c) => c.close()).catch(() => {});
  }
  dispose() {
    for (const id of this.entries.keys()) this.release(id);
  }
}
