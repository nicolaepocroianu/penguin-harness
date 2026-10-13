/**
 * Prompt text only (decision 18): what an image run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and generated-image.ts fills it in.
 */

export const IMAGE_PROMPT = `Generate the single image candidate specified in image-input.json.
The supplied generate-image.mjs helper calls the configured image provider through AgentHub and reads GEMINI_API_KEY only from the Agent Vault-injected process environment.
Use normal Harness exec_command approval for npm install --ignore-scripts and node generate-image.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes image.png. Never draw a substitute or change the provider, model or prompt. If credentials, installation or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will inspect and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;
