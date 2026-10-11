/**
 * Whether activity runs confine their agent, as the App sees it. Types only, so the web can
 * import them; the route is activity-sandbox-routes.ts.
 */

export interface ActivitySandboxState {
  /** The admin's switch: activity runs confine their agent to the run's workspace. */
  enabled: boolean;
  /**
   * Why runs could not be confined right now (no sandbox backend loaded), or null when they
   * can. Only meaningful while `enabled`: with it off, nothing asks for confinement.
   */
  problem: string | null;
}

export interface ActivitySandboxResponse {
  sandbox: ActivitySandboxState;
}
