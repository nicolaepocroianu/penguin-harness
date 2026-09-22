// Three throwaway variants ask: where should conversation live relative to Loom's editors?
// Everything is in memory. Agent output, translation and builds are explicitly simulated.
const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const names = [
  "Welcome",
  "How to play",
  "Round 1",
  "Round 2",
  "Round 3",
  "Round 4",
  "Round 5",
  "Round 6",
  "Round 7",
  "Round 8",
  "Round 9",
  "Check-in",
  "Treasure found",
];
const variants = { A: "Conversation desk", B: "Storyboard studio", C: "Review room" };
const initialVariant = new URLSearchParams(location.search).get("variant");
const state = {
  variant: variants[initialVariant] ? initialVariant : "A",
  selected: 4,
  view: "Frame",
  editor: "Audio",
  mode: "Inspect",
  attached: "",
  draftMessage: "",
  playing: false,
  playState: "idle",
  language: "EN",
  guide: true,
  building: false,
  built: false,
  lastAction: "Opened the sample activity",
};
const scenes = names.map((name, i) => ({
  id: i + 1,
  name,
  revision: 1,
  script: "Find the capital P.",
  draft: "Find the capital P.",
  spanish: "Encuentra la P mayúscula.",
  voice: "Mia",
  interruptible: true,
  currentAudio: "Original take · 2.8 s",
  currentAudioUrl: "",
  candidate: "",
  candidateUrl: "",
  candidateFor: "",
  stale: false,
  audioStale: false,
  image: 0,
  imageDraft: 0,
  scope: "scene",
  trim: "2.8",
  messages: [],
  history: [],
}));
scenes[3].messages = [
  {
    who: "you",
    text: "Round 2 sounds robotic. Make the prompt warmer, with the same meaning and voice.",
  },
  {
    who: "agent",
    text: "I have a warmer line and a matching speech candidate. Review them together, or keep just the script and record your own take.",
  },
];
scenes[3].proposal = {
  base: 1,
  script: "Can you find the capital P? Tap it when you spot it.",
  includeScript: true,
  includeAudio: true,
  status: "pending",
};
scenes[5].messages = [
  {
    who: "agent",
    text: "Scene 6 is ready for your next instruction. Attach an element or describe the change you want.",
  },
];
if (state.variant === "B") state.view = "Board";
if (state.variant === "C") state.view = "Review";
const current = () => scenes[state.selected - 1];
const pending = () => scenes.filter((s) => s.proposal?.status === "pending");
const staleScenes = () => scenes.filter((s) => s.stale || s.audioStale);
const button = (text, action, cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
let toastTimer;
let uploadedPlayback;
function notify(text) {
  $("#notice").textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#notice").textContent = ""), 4500);
}
function record(text, scene = current()) {
  state.lastAction = text;
  scene.history.push(text);
  state.built = false;
}
function stopAudio() {
  window.speechSynthesis?.cancel();
  uploadedPlayback?.pause();
  state.playing = false;
}
function playSaved() {
  if (!current().currentAudioUrl || state.language === "ES") {
    speak(state.language === "ES" ? current().spanish : current().script, state.language);
    return;
  }
  stopAudio();
  uploadedPlayback = new Audio(current().currentAudioUrl);
  state.playing = true;
  uploadedPlayback.onended = () => {
    state.playing = false;
    render();
  };
  uploadedPlayback.play().catch(() => {
    state.playing = false;
    render();
    notify("This MP3 could not be played. Choose another candidate.");
  });
  render();
}
function speak(text, language = "EN") {
  stopAudio();
  if (!window.speechSynthesis) {
    notify("Browser speech is unavailable. Upload an MP3 to audition real audio.");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "ES" ? "es-ES" : "en-US";
  utterance.rate = 0.86;
  state.playing = true;
  utterance.onend = () => {
    state.playing = false;
    render();
  };
  utterance.onerror = () => {
    state.playing = false;
    render();
  };
  window.speechSynthesis.speak(utterance);
  render();
}
function sceneArt(id = state.selected, image = scenes[id - 1].image) {
  const title =
    id === 1
      ? "A little adventure in letters"
      : id === 2
        ? "Tap a rock. Find a letter."
        : id === 13
          ? "You found the treasure!"
          : id === 12
            ? "Which one is the capital P?"
            : "Can you find the capital P?";
  const rockColors = [
    ["#a9b8b8", "#7f9699"],
    ["#bbc9bd", "#8caaa0"],
    ["#859ca0", "#607e86"],
  ][image];
  return `<svg viewBox="0 0 720 340" role="img" aria-label="${escape(names[id - 1])}: a beach with five letter rocks and a treasure chest">
  <rect width="720" height="340" fill="#d8eaf1"/><circle cx="598" cy="62" r="29" fill="#fff7d8"/>
  <path d="M0 148 Q90 130 180 148T360 145T540 143T720 140V270H0Z" fill="#a6cbd4"/><path d="M0 177Q90 153 190 176T390 172T590 163T720 170V260H0Z" fill="#8db9c4"/>
  <path d="M0 209Q160 166 320 207T720 196V340H0Z" fill="#e4d9ba"/><path d="M0 231Q150 188 325 221T720 211" fill="none" stroke="#f2ead5" stroke-width="8"/>
  <path d="M0 311Q120 274 288 303T720 296V340H0Z" fill="#d8caac"/>
  <g fill="none" stroke="#749ca9" stroke-width="2" stroke-linecap="round"><path d="M70 91q8-9 16 0q8-9 16 0M116 74q6-7 12 0q6-7 12 0"/></g>
  <text x="360" y="71" text-anchor="middle" fill="#345568" font-family="Segoe UI,sans-serif" font-size="23" font-weight="600">${title}</text>
  <text x="360" y="100" text-anchor="middle" fill="#547684" font-family="Segoe UI,sans-serif" font-size="12">${id === 13 ? "Every letter brings you a little closer." : "CAPITAL & LOWERCASE · TREASURE HUNT"}</text>
  <g transform="translate(595 153)"><rect y="15" width="67" height="44" rx="5" fill="#966c49"/><path d="M0 18Q0-5 18-5H50Q67-5 67 18Z" fill="#b38b5b" stroke="#775438" stroke-width="3"/><path d="M12 0v57M55 0v57" stroke="#dac382" stroke-width="6"/><rect x="29" y="19" width="12" height="16" rx="2" fill="#e1ca83"/></g>
  ${["B", "d", "P", "b", "p"]
    .map((letter, i) => {
      const x = 93 + i * 117,
        y = [245, 262, 237, 259, 246][i];
      return `<g><ellipse cx="${x}" cy="${y + 26}" rx="45" ry="10" fill="#b9ad9360"/><path d="M${x - 39} ${y + 15}Q${x - 49} ${y - 10} ${x - 25} ${y - 24}Q${x + 5} ${y - 42} ${x + 31} ${y - 20}Q${x + 48} ${y - 6} ${x + 40} ${y + 16}Q${x} ${y + 36} ${x - 39} ${y + 15}Z" fill="${i === 2 ? rockColors[0] : "#a9b8b8"}" stroke="${i === 2 ? rockColors[1] : "#7f9699"}" stroke-width="2"/><path d="M${x - 27} ${y - 17}Q${x} ${y - 32} ${x + 21} ${y - 15}" fill="none" stroke="#ffffff50" stroke-width="5" stroke-linecap="round"/><text x="${x}" y="${y + 12}" text-anchor="middle" font-family="Georgia,serif" font-size="35" font-weight="bold" fill="#304f5c">${letter}</text></g>`;
    })
    .join("")}
  <g fill="#c2b392"><ellipse cx="43" cy="282" rx="5" ry="2"/><ellipse cx="411" cy="294" rx="4" ry="2"/><ellipse cx="667" cy="265" rx="6" ry="3"/></g></svg>`;
}
function stage() {
  return `<div class="scene-stage ${state.mode === "Inspect" ? "inspect" : ""}"><span class="stage-tag">${state.view === "Player" ? "SIMULATED PLAYER" : "SCENE " + state.selected} · ${state.mode}</span>${sceneArt()}${["B", "d", "P", "b", "p"].map((letter, i) => `<button class="rock-hit ${state.attached === "Rock " + letter ? "picked" : ""}" style="left:${7.3 + i * 16.25}%;top:${[62, 67, 59, 67, 63][i]}%" data-action="rock" data-letter="${letter}" aria-label="${state.mode === "Inspect" ? "Attach" : "Tap"} Rock ${letter}"></button>`).join("")}</div>`;
}
function wave() {
  return `<div class="wave" aria-hidden="true">${Array.from({ length: 42 }, (_, i) => `<i style="height:${9 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.41)) * 32}px"></i>`).join("")}</div>`;
}
function filmstrip() {
  return `<div class="filmstrip" aria-label="Scenes in story order">${scenes.map((s) => `<button class="${s.id === state.selected ? "selected" : ""}" data-action="scene" data-id="${s.id}" aria-label="Select scene ${s.id}, ${s.name}">${sceneArt(s.id)}<small>${String(s.id).padStart(2, "0")} · ${s.name}</small></button>`).join("")}</div>`;
}
function proposalCard(scene) {
  const p = scene.proposal;
  if (!p || p.status !== "pending") return "";
  return `<div class="proposal-card"><header class="row between"><strong>Ready to review</strong><span class="pill attention">2 changes</span></header><div class="proposal-body"><p>${escape(p.script)}</p><small>Script + English speech · Scene ${scene.id} only</small>${p.base !== scene.revision ? '<span class="pill attention">Your edit is newer than this proposal</span>' : ""}${button("Review proposal →", "view", "primary", 'data-view="Review"')}</div></div>`;
}
function thread() {
  const s = current();
  const messages = s.messages.length
    ? s.messages
    : [
        {
          who: "agent",
          text: `What would you like to change in ${s.name}? Select something in the scene to give your message a precise reference.`,
        },
      ];
  return `<section class="thread" aria-label="Scene conversation"><div class="panel-head"><div><h2>${s.name}</h2><small>Conversation · Scene ${s.id}</small></div><span class="pill">${messages.length} messages</span></div><div class="thread-body"><div class="eyebrow">Today · activity workspace</div>${messages.map((m, i) => `<article class="message"><span class="avatar ${m.who === "you" ? "me" : ""}">${m.who === "you" ? "G" : "S"}</span><div class="message-content"><div class="message-title"><strong>${m.who === "you" ? "You" : "Scene writer"}</strong><small>${m.who === "you" ? "" : "Demo agent"}</small></div><p>${escape(m.text)}</p>${m.who === "you" ? `<div class="message-chips"><span class="context-chip">▧ Scene ${s.id}</span>${m.attachment ? `<span class="context-chip">${escape(m.attachment)}</span>` : ""}</div>` : ""}${i === messages.length - 1 ? proposalCard(s) : ""}</div></article>`).join("")}${s.history
    .slice(-3)
    .map((h) => `<div class="system-event">${escape(h)}</div>`)
    .join(
      "",
    )}<div class="system-event">Direct edits stay in the workspace. This conversation keeps their history.</div></div><form class="composer" id="message-form"><div class="composer-box"><div class="row wrap"><span class="context-chip">▧ Scene ${s.id} · ${s.name}</span>${state.attached ? button(escape(state.attached) + " ×", "detach", "context-chip") : ""}</div><textarea name="message" aria-label="Message the demo agent" placeholder="Describe a change to this scene…">${escape(state.draftMessage)}</textarea><div class="row between"><span class="hint">Scene writer · simulated</span><button class="primary small" type="submit">Send ↑</button></div></div></form></section>`;
}
function board() {
  return `<div class="board-intro"><div><div class="eyebrow">Activity storyboard</div><h2>A little adventure in letters</h2><p>13 scenes · English & Spanish · shared beach world</p></div><div class="stack"><span class="pill attention">${pending().length} proposal${pending().length === 1 ? "" : "s"}</span>${button("Open selected scene →", "view", "small", 'data-view="Frame"')}</div></div><div class="board-grid">${scenes.map((s, i) => `<button class="scene-card ${s.id === state.selected ? "selected" : ""}" data-action="scene" data-id="${s.id}" aria-label="Select scene ${s.id}, ${s.name}"><div class="card-label"><span class="scene-number">${String(s.id).padStart(2, "0")}</span><strong>${s.name}</strong></div><div class="thumb">${sceneArt(s.id)}${s.proposal?.status === "pending" ? '<span class="ghost"></span><span class="ghost-tag">↳ Proposal waiting</span>' : ""}</div><div class="card-meta"><span>${s.messages.length ? s.messages.length + " messages" : "Start a conversation"}</span>${s.stale || s.audioStale ? '<span class="pill attention">Out of date</span>' : s.id === 6 ? "<span>Voice · ready</span>" : ""}</div>${i < 12 ? '<span class="arrow" aria-hidden="true">→</span>' : ""}</button>`).join("")}</div>`;
}
function audioEditor() {
  const s = current();
  return `<div class="row between" style="margin-bottom:15px"><div><h3>Narration · prompt_find_P</h3><small>Current take and candidate remain separate</small></div><div class="row">${["EN", "ES"].map((l) => button(l, "language", l === state.language ? "selected small" : "small", `data-language="${l}"`)).join("")}</div></div><div class="field-grid"><label><span class="field-label">Voice</span><select data-field="voice" aria-label="Voice">${["Mia", "Noah", "Ava"].map((v) => `<option ${s.voice === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label><span class="field-label">Playback</span><select data-field="interruptible" aria-label="Playback interruption"><option value="true" ${s.interruptible ? "selected" : ""}>A tap can interrupt</option><option value="false" ${!s.interruptible ? "selected" : ""}>Finish before next action</option></select></label></div><label><span class="field-label">${state.language === "EN" ? "English script" : "Spanish translation"}</span><textarea rows="2" data-field="draft" ${state.language === "ES" ? "readonly" : ""} aria-label="Narration script">${escape(state.language === "EN" ? s.draft : s.spanish)}</textarea></label><div class="audio-strip ${state.playing ? "playing" : ""}">${button(state.playing ? "■" : "▶", "audition", "small", 'aria-label="Audition saved script using browser speech"')}${wave()}<small>${escape(s.currentAudio)}</small></div><small class="caption">Audition uses browser speech, not Loom’s Mia recording.</small><details class="audio-controls"><summary class="muted">Trim & take details</summary><label style="margin-top:10px"><span class="field-label">End time <output id="trim-value">${s.trim}</output> s (prototype selection)</span><input type="range" min="0.5" max="5" step="0.1" value="${s.trim}" data-field="trim" aria-label="Trim end time" /></label><small>The demo records trim selection; it does not process audio.</small></details>${s.candidate ? `<div class="banner success" style="margin-top:12px">Candidate: ${escape(s.candidate)}${s.candidateUrl ? `<audio class="upload-player" controls src="${s.candidateUrl}"></audio>` : ""}</div>` : ""}<label class="dropzone" id="audio-drop">Drop your own MP3 here, or choose a file<input type="file" accept="audio/mpeg,.mp3" data-field="upload" aria-label="Upload candidate MP3" /></label><div class="row between wrap" style="margin-top:16px">${button("Save script", "save-script", "", state.language === "ES" ? "disabled" : "")}<div class="row">${button("Demo candidate", "candidate", "small")}${button("Use candidate", "use-candidate", "primary small", !s.candidate ? "disabled" : "")}</div></div>${s.stale || s.audioStale ? `<div class="banner attention" style="margin-top:14px">${s.audioStale ? "English audio does not match the saved script. " : ""}${s.stale ? "Spanish translation is out of date. " : ""}${button("Refresh matching audio & translation (demo)", "regenerate", "link")}</div>` : ""}`;
}
function imageEditor() {
  const s = current();
  return `<div class="row between"><div><h3>Rock P</h3><small>Shared original · used in Rounds 1–9</small></div><span class="pill">Image</span></div><div class="image-options">${["Original", "Softer", "More contrast"].map((v, i) => `<button class="${s.imageDraft === i ? "selected" : ""}" data-action="image-variant" data-image="${i}"><span class="rock-swatch">P</span><small>${v}</small></button>`).join("")}</div><div class="field-label">Where should this replacement apply?</div><div class="scope"><label><input type="radio" name="scope" value="scene" ${s.scope === "scene" ? "checked" : ""} data-field="scope"/>This scene only</label><label><input type="radio" name="scope" value="shared" ${s.scope === "shared" ? "checked" : ""} data-field="scope"/>All 9 rounds</label></div><p class="caption">${s.scope === "scene" ? `A copy will be used in Scene ${s.id}. The other scenes keep their current image.` : "Affected: Scenes 3–11. Every round will use the selected rock style."}</p>${button(s.scope === "scene" ? `Save in Scene ${s.id}` : "Save in 9 scenes", "save-image", "primary")}`;
}
function frame() {
  return `<div class="row between scene-heading"><div><div class="eyebrow">Scene ${state.selected} / 13</div><h2>${current().name}</h2></div>${button("Inspect elements", "mode", state.mode === "Inspect" ? "selected small" : "small", 'data-mode="Inspect"')}</div>${stage()}<div class="caption">Point at a rock to attach it to the conversation. Open its image or narration below.</div><section class="asset-dock"><div class="dock-tabs">${["Audio", "Image"].map((t) => button(t, "editor", state.editor === t ? "active" : "", `data-editor="${t}"`)).join("")}<span class="grow"></span><small class="row">Loom editor · prototype</small></div><div class="editor-body">${state.editor === "Audio" ? audioEditor() : imageEditor()}</div></section>`;
}
function review() {
  const s = current(),
    p = s.proposal;
  if (!p || p.status !== "pending")
    return `<div class="empty"><span class="pill success">${p?.status === "applied" ? "Applied to this scene" : "No open proposal"}</span><h2>${p?.status === "applied" ? "Your changes are in the activity." : "Ready for another idea."}</h2><p>${p?.status === "applied" ? "Open the player to try the saved version." : "Send a message to create a sample proposal."}</p><div class="row" style="justify-content:center;margin-top:20px">${button("Open player", "view", "primary", 'data-view="Player"')}${button("New demo proposal", "new-proposal")}</div></div>`;
  const conflict = p.base !== s.revision;
  return `<div class="row between scene-heading"><div><div class="eyebrow">Proposal review · Scene ${s.id}</div><h2>A warmer invitation to play</h2></div><span class="pill attention">Not applied</span></div>${conflict ? `<div class="banner attention" style="margin-bottom:16px"><strong>Your manual edit is newer.</strong> This proposal started at revision ${p.base}; the scene is now revision ${s.revision}. Your edit is preserved. ${button("Compare again against my edit", "rebase", "link")}</div>` : ""}<div class="comparison"><section class="compare-card"><header><strong>Current</strong><span class="pill">Revision ${s.revision}</span></header><div class="compare-content"><div class="mini-scene">${sceneArt()}</div><span class="eyebrow">Saved English script</span><blockquote>${escape(s.script)}</blockquote><div class="audio-strip">${button("▶", "audition", "small", 'aria-label="Audition current script"')}${wave()}</div><small>${escape(s.currentAudio)} · ${s.voice}</small></div></section><section class="compare-card proposed"><header><strong>Proposed</strong><span class="pill attention">Scene writer</span></header><div class="compare-content"><div class="mini-scene">${sceneArt()}</div><span class="eyebrow">Candidate English script</span><blockquote>${escape(p.script)}</blockquote><div class="audio-strip">${button("▶", "audition-proposal", "small", 'aria-label="Audition proposed script"')}${wave()}</div><small>New candidate · 3.6 s · ${s.voice}</small></div></section></div><div class="review-footer"><div class="stack"><div class="review-options"><label><input type="checkbox" data-field="includeScript" ${p.includeScript ? "checked" : ""}/>Script change</label><label><input type="checkbox" data-field="includeAudio" ${p.includeAudio ? "checked" : ""}/>Speech candidate</label></div><small>Scene ${s.id} only · Spanish will need a refresh.</small>${p.includeAudio && !p.includeScript ? '<small class="danger">The candidate speaks the proposed script. Select both or just the script.</small>' : ""}</div><div class="row">${button("Discard", "discard")}${button("Apply selected", "apply", "primary", conflict || !p.includeScript || (!p.includeScript && !p.includeAudio) ? "disabled" : "")}</div></div><div class="row wrap" style="margin-top:16px">${button("Edit current script first", "view", "small", 'data-view="Script"')}${button("Inspect proposal trace", "view", "quiet small", 'data-view="Traces"')}<small>Audio previews use your browser’s speech voice.</small></div>`;
}
function player() {
  return `<div class="row between scene-heading"><div><div class="eyebrow">Saved activity · revision ${current().revision}</div><h2>Try ${current().name}</h2></div><div class="row">${["Play", "Inspect"].map((m) => button(m, "mode", state.mode === m ? "selected" : "", `data-mode="${m}"`)).join("")}</div></div>${stage()}<div class="row between" style="margin-top:12px">${button(state.playing ? "Stop narration" : "▶ Play from scene start", "play", "primary")}<span class="pill">${state.mode === "Inspect" ? "Clicks attach references" : "Clicks play the activity"}</span></div><div class="state-map" aria-label="Behavior map">${["idle", "prompt", "waiting", "try again", "success"].map((v, i) => `${i ? "<b>→</b>" : ""}<span class="${state.playState === v ? "current" : ""}">${v}</span>`).join("")}</div><p class="caption">${state.mode === "Play" ? "Try the lowercase b for the retry path, then the capital P for success." : "Select a rock to reference it without triggering gameplay."} This is a simulated player, not the dev-sandbox runtime.</p>`;
}
function script() {
  const s = current();
  return `<div class="row between scene-heading"><div><div class="eyebrow">Current saved version</div><h2>Activity script · ${s.name}</h2></div><span class="pill">Revision ${s.revision}</span></div><div class="banner" style="background:white;margin-bottom:15px">Scene order stays fixed. Proposed changes live in Review until you apply them.</div><pre class="muted">Scene ${s.id}: ${s.name}\n  &lt;video&gt;Beach backdrop&lt;/video&gt;\n  &lt;image&gt;Five rocks: B d P b p&lt;/image&gt;\n  &lt;audio kind="speech" voice="${escape(s.voice)}"&gt;</pre><label><span class="field-label">Edit current English narration</span><textarea class="script-editor" data-field="draft" aria-label="Current English script">${escape(s.draft)}</textarea></label><pre class="muted">  &lt;/audio&gt;\n  &lt;on tap="rock_P"&gt;success&lt;/on&gt;\n  &lt;otherwise&gt;try again&lt;/otherwise&gt;</pre><div class="row between">${button("Save current script", "save-script", "primary")}${s.proposal?.status === "pending" ? button("Compare with pending proposal →", "view", "", 'data-view="Review"') : ""}</div>`;
}
function traces() {
  const s = current();
  const entries = [
    "Read Scene " + s.id + " at revision " + (s.proposal?.base || s.revision),
    "Resolve prompt_find_P and voice " + s.voice,
    "Prepare a warmer script with the same target letter",
    "Prepare a matching English speech candidate",
    "Wait for your review",
    ...s.history,
  ];
  return `<div class="scene-heading"><div class="eyebrow">Trace · simulated run</div><h2>How this change came together</h2><p class="caption">Scope: Scene ${s.id} · source revision ${s.proposal?.base || s.revision} · current revision ${s.revision}</p></div>${entries.map((e, i) => `<div class="trace-row"><span class="num">${i + 1}</span><p>${escape(e)}</p><span class="pill ${i === 4 && s.proposal?.status === "pending" ? "attention" : "success"}">${i === 4 && s.proposal?.status === "pending" ? "Waiting" : "Recorded"}</span></div>`).join("")}`;
}
function build() {
  const stale = staleScenes(),
    proposals = pending();
  return `<div class="build-card stack"><div class="eyebrow">Assemble WAF module · demo</div><h2>Ready for a playthrough?</h2><p class="muted">Check the saved activity before assembling. Unapplied proposals remain outside the build.</p><div><div class="check-row"><span>Scene sequence</span><span class="pill success">13 scenes</span></div><div class="check-row"><span>Audio & language coverage</span><span class="pill ${stale.length ? "attention" : "success"}">${stale.length ? stale.length + " scenes out of date" : "Current"}</span></div><div class="check-row"><span>Open proposals</span><span class="pill ${proposals.length ? "attention" : "success"}">${proposals.length} excluded from build</span></div></div>${stale.length ? button("Refresh out-of-date scenes (demo)", "regenerate-all") : ""}${state.built ? '<div class="banner success"><strong>Demo assembly complete.</strong><br>No files were written to Loom or your checkout. Download the review snapshot to keep this prototype state.</div>' : ""}<div class="row">${button(state.building ? "Assembling demo…" : "Assemble saved version", "build", "primary", stale.length || state.building ? "disabled" : "")}${state.built ? button("Download demo snapshot", "download") : ""}</div>${state.built ? "<pre>✓ Read saved scene revisions\n✓ Verify script / audio alignment\n✓ Collect language variants\n✓ Demo complete — no WAF module generated</pre>" : ""}</div>`;
}
function rail() {
  return `<aside class="review-rail"><div class="panel-head"><div><h2>Scene sequence</h2><small>13 scenes · story order</small></div></div><div class="scene-list">${scenes.map((s) => `<button data-action="scene" data-id="${s.id}" class="${state.selected === s.id ? "selected" : ""}"><span class="mini">${sceneArt(s.id)}</span><span><strong>${s.id}. ${s.name}</strong><small>${s.proposal?.status === "pending" ? "◌ Proposal" : s.stale ? "Translation stale" : "Current"}</small></span></button>`).join("")}</div></aside>`;
}
function workspace() {
  const views = {
    Board: board,
    Frame: frame,
    Review: review,
    Player: player,
    Script: script,
    Traces: traces,
    Build: build,
  };
  const hints = {
    A: "Pick a rock, ask for a change, then open Review. The thread stays beside your tools.",
    B: "Select a scene to see its conversation. Open the frame when you want to edit.",
    C: "Compare the proposal. Try editing the current script first to expose an overlapping edit.",
  };
  return `<section class="workspace" aria-label="Activity workspace"><nav class="tabs" aria-label="Workspace views">${Object.keys(
    views,
  )
    .map((v) =>
      button(
        v,
        "view",
        state.view === v ? "active" : "",
        `data-view="${v}" aria-current="${state.view === v ? "page" : "false"}"`,
      ),
    )
    .join(
      "",
    )}</nav><div class="workspace-content">${state.guide ? `<div class="guide"><strong>Try this</strong><p>${hints[state.variant]}</p>${button("×", "hide-guide", "quiet small", 'aria-label="Dismiss prototype hint"')}</div>` : ""}${views[state.view]()}</div>${["Frame", "Player"].includes(state.view) ? filmstrip() : ""}</section>`;
}
function relevantState() {
  return {
    variant: state.variant,
    scene: state.selected,
    view: state.view,
    mode: state.mode,
    attachment: state.attached,
    revision: current().revision,
    script: current().script,
    draft: current().draft,
    proposal: current().proposal || null,
    audioStale: current().audioStale,
    spanishStale: current().stale,
    imageScope: current().scope,
    lastAction: state.lastAction,
  };
}
function render() {
  const threadScroll = $(".thread-body")?.scrollTop,
    workspaceScroll = $(".workspace-content")?.scrollTop;
  $("#app").innerHTML =
    `<div class="app variant-${state.variant.toLowerCase()}"><aside class="rail" aria-label="Prototype navigation"><div class="brand" title="Penguin">p.</div>${button("Scenes", "view", state.view === "Board" ? "selected" : "quiet", 'data-view="Board"')}${button("Review", "view", state.view === "Review" ? "selected" : "quiet", 'data-view="Review"')}${button("Trace", "view", state.view === "Traces" ? "selected" : "quiet", 'data-view="Traces"')}<span class="rail-spacer"></span>${button("Reset", "reset", "quiet", 'title="Reset all prototype edits"')}<span class="avatar me">G</span></aside><header class="topbar"><div class="top-title"><span class="crumb">penguin / Activities</span><h1>Letter treasure hunt</h1><span class="pill ref-label">test3 · ref 0</span></div><div class="row"><span class="pill stale-count ${staleScenes().length ? "attention" : "success"}">${staleScenes().length ? staleScenes().length + " out of date" : "All media current"}</span>${button("Assemble ↗", "view", "primary small", 'data-view="Build"')}</div></header><main class="shell">${state.variant === "C" ? rail() : ""}${state.variant === "A" ? thread() + workspace() : workspace() + thread()}</main><footer class="bottom"><div class="prototype-label"><strong>WAF-LOOM PORT · INTERACTIVE PROTOTYPE</strong><small>Mock activity · edits stay in this tab · no backend</small></div><nav class="switcher" aria-label="Prototype variations">${button("←", "previous", "arrow-button", 'aria-label="Previous prototype"')}${Object.entries(
      variants,
    )
      .map(([key, name]) =>
        button(
          `${key} <span>${name}</span>`,
          "variant",
          state.variant === key ? "active" : "",
          `data-variant="${key}" aria-pressed="${state.variant === key}"`,
        ),
      )
      .join(
        "",
      )}${button("→", "next", "arrow-button", 'aria-label="Next prototype"')}</nav><details class="state-details"><summary>State · scene ${state.selected} · rev ${current().revision}</summary><pre>${escape(JSON.stringify(relevantState(), null, 2))}</pre></details></footer></div>`;
  if (threadScroll) $(".thread-body").scrollTop = threadScroll;
  if (workspaceScroll) $(".workspace-content").scrollTop = workspaceScroll;
}
function changeVariant(v) {
  stopAudio();
  state.variant = v;
  state.view = { A: "Frame", B: "Board", C: "Review" }[v];
  state.guide = true;
  const url = new URL(location.href);
  url.searchParams.set("variant", v);
  history.replaceState(null, "", url);
  render();
}
function createProposal(message) {
  const s = current();
  if (message) s.messages.push({ who: "you", text: message, attachment: state.attached });
  s.proposal = {
    base: s.revision,
    script: "Can you find the capital P? Tap it when you spot it.",
    includeScript: true,
    includeAudio: true,
    status: "pending",
  };
  s.messages.push({
    who: "agent",
    text: "Demo response: here is the sample warmer-prompt proposal. It targets this scene only. You can review both changes, or save a manual edit first to try the conflict flow.",
  });
  state.draftMessage = "";
  state.attached = "";
  record("Created a sample proposal from revision " + s.revision);
  render();
  $(".thread-body").scrollTop = $(".thread-body").scrollHeight;
}
function saveScript() {
  const s = current();
  if (!s.draft.trim()) {
    notify("Enter a script before saving.");
    return;
  }
  if (s.script === s.draft) {
    notify("The current script is already saved.");
    return;
  }
  s.script = s.draft;
  s.revision++;
  s.stale = true;
  s.audioStale = true;
  record("You saved the script · revision " + s.revision);
  render();
  notify(
    s.proposal?.status === "pending"
      ? "Saved. The pending proposal now needs a fresh comparison."
      : "Saved. English audio and Spanish translation need a refresh.",
  );
}
function refreshScene(s) {
  if (s.audioStale || !s.currentAudioUrl) {
    if (s.currentAudioUrl) URL.revokeObjectURL(s.currentAudioUrl);
    s.currentAudioUrl = "";
    s.currentAudio = "Refreshed demo take · 3.6 s";
  }
  s.stale = false;
  s.audioStale = false;
  s.spanish =
    s.script === "Find the capital P."
      ? "Encuentra la P mayúscula."
      : "¿Puedes encontrar la P mayúscula? Tócala cuando la veas.";
  record("Demo: refreshed audio and Spanish coverage", s);
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const s = current();
  switch (target.dataset.action) {
    case "variant":
      changeVariant(target.dataset.variant);
      return;
    case "previous":
    case "next": {
      const keys = Object.keys(variants),
        i = keys.indexOf(state.variant);
      changeVariant(keys[(i + (target.dataset.action === "next" ? 1 : 2)) % 3]);
      return;
    }
    case "view":
      stopAudio();
      state.view = target.dataset.view;
      if (state.view === "Player") state.mode = "Play";
      if (state.view === "Frame") state.mode = "Inspect";
      break;
    case "scene":
      stopAudio();
      state.selected = Number(target.dataset.id);
      state.attached = "";
      state.draftMessage = "";
      state.playState = "idle";
      break;
    case "mode":
      stopAudio();
      state.mode = target.dataset.mode;
      break;
    case "rock":
      if (state.mode === "Inspect") {
        state.attached = "Rock " + target.dataset.letter;
        state.lastAction = "Attached " + state.attached + " from Scene " + state.selected;
        notify(state.attached + " attached to your next message.");
      } else {
        if (state.playing && !s.interruptible) {
          notify("Narration must finish before this tap counts.");
          return;
        }
        state.playState = target.dataset.letter === "P" ? "success" : "try again";
        speak(
          state.playState === "success"
            ? "Great job! That is the capital P."
            : "Try again. Look for the big P.",
        );
        return;
      }
      break;
    case "detach":
      state.attached = "";
      break;
    case "editor":
      state.editor = target.dataset.editor;
      break;
    case "language":
      stopAudio();
      state.language = target.dataset.language;
      break;
    case "hide-guide":
      state.guide = false;
      break;
    case "save-script":
      saveScript();
      return;
    case "candidate":
      if (s.candidateUrl) URL.revokeObjectURL(s.candidateUrl);
      s.candidateUrl = "";
      s.candidate = "Generated demo take · " + s.voice;
      s.candidateFor = s.script;
      record("Prepared a demo candidate for the saved script");
      break;
    case "use-candidate":
      if (s.candidateFor !== s.script) {
        notify("The script changed after this candidate was prepared. Generate a new candidate.");
        return;
      }
      s.currentAudio = s.candidate;
      if (s.currentAudioUrl) URL.revokeObjectURL(s.currentAudioUrl);
      s.currentAudioUrl = s.candidateUrl;
      s.candidateUrl = "";
      s.candidate = "";
      s.audioStale = false;
      record("You saved the candidate as current audio");
      break;
    case "audition":
      if (state.playing) {
        stopAudio();
        break;
      }
      playSaved();
      return;
    case "audition-proposal":
      speak(s.proposal.script);
      return;
    case "play":
      if (state.playing) {
        stopAudio();
        state.playState = "idle";
        break;
      }
      state.mode = "Play";
      state.playState = "waiting";
      playSaved();
      return;
    case "image-variant":
      s.imageDraft = Number(target.dataset.image);
      break;
    case "save-image":
      if (s.scope === "shared") {
        scenes.slice(2, 11).forEach((x) => {
          x.image = s.imageDraft;
          x.imageDraft = s.imageDraft;
        });
        record("You replaced the shared rock style in Scenes 3–11");
      } else {
        s.image = s.imageDraft;
        record("You saved a separate image copy in Scene " + s.id);
      }
      notify(
        s.scope === "shared"
          ? "Image replaced in all 9 rounds."
          : "Image changed in this scene only.",
      );
      break;
    case "apply": {
      const p = s.proposal;
      if (!p || p.base !== s.revision || !p.includeScript) return;
      s.script = p.script;
      s.draft = p.script;
      s.revision++;
      s.stale = true;
      s.audioStale = !p.includeAudio;
      if (p.includeAudio) {
        if (s.currentAudioUrl) URL.revokeObjectURL(s.currentAudioUrl);
        s.currentAudioUrl = "";
        s.currentAudio = "Accepted demo candidate · 3.6 s";
      }
      p.status = "applied";
      record(
        "Applied " +
          (p.includeAudio ? "script + audio" : "script only") +
          " · Spanish needs a refresh",
      );
      notify("Proposal applied to Scene " + s.id + ".");
      break;
    }
    case "discard":
      s.proposal.status = "discarded";
      record("Discarded proposal; current scene preserved");
      break;
    case "rebase":
      s.proposal.base = s.revision;
      record("Compared the proposal again with your latest saved edit");
      notify("Comparison refreshed. Review Current and Proposed before applying.");
      break;
    case "new-proposal":
      createProposal();
      return;
    case "regenerate":
      refreshScene(s);
      break;
    case "regenerate-all":
      staleScenes().forEach(refreshScene);
      break;
    case "build":
      if (staleScenes().length) return;
      state.building = true;
      render();
      setTimeout(() => {
        state.building = false;
        state.built = true;
        state.lastAction = "Completed demo assembly without writing a WAF module";
        render();
      }, 900);
      return;
    case "download": {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              prototype: true,
              notice: "Design exploration only; not a WAF module",
              scenes: scenes.map(({ candidateUrl, currentAudioUrl, ...x }) => x),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "waf-loom-prototype-snapshot.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      notify("Downloaded prototype state.");
      return;
    }
    case "reset":
      stopAudio();
      location.reload();
      return;
  }
  render();
});
document.addEventListener("input", (event) => {
  const input = event.target;
  if (input.name === "message") {
    state.draftMessage = input.value;
    return;
  }
  if (input.dataset.field === "draft") {
    current().draft = input.value;
    return;
  }
  if (input.dataset.field === "trim") {
    current().trim = input.value;
    $("#trim-value").textContent = input.value;
  }
});
document.addEventListener("change", (event) => {
  const input = event.target,
    s = current();
  switch (input.dataset.field) {
    case "voice":
      s.voice = input.value;
      record("Selected voice " + s.voice + " for the next candidate");
      break;
    case "interruptible":
      s.interruptible = input.value === "true";
      record("Changed tap interruption behavior");
      break;
    case "scope":
      s.scope = input.value;
      break;
    case "includeScript":
      s.proposal.includeScript = input.checked;
      if (!input.checked) s.proposal.includeAudio = false;
      break;
    case "includeAudio":
      s.proposal.includeAudio = input.checked;
      break;
    case "upload":
      upload(input.files[0]);
      return;
    default:
      return;
  }
  render();
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "message-form") return;
  event.preventDefault();
  if (!state.draftMessage.trim()) {
    notify("Write a message first.");
    return;
  }
  createProposal(state.draftMessage.trim());
});
function upload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".mp3") && file.type !== "audio/mpeg") {
    notify("Choose an MP3 for this narration prototype.");
    return;
  }
  const s = current();
  if (s.candidateUrl) URL.revokeObjectURL(s.candidateUrl);
  s.candidate = file.name;
  s.candidateUrl = URL.createObjectURL(file);
  s.candidateFor = s.script;
  record("Loaded local MP3 candidate " + file.name);
  render();
  notify("MP3 loaded locally. Audition it before using the candidate.");
}
document.addEventListener("dragover", (event) => {
  if (event.target.closest("#audio-drop")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (event.target.closest("#audio-drop")) {
    event.preventDefault();
    upload(event.dataTransfer.files[0]);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,[contenteditable],audio")) return;
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const keys = Object.keys(variants),
    i = keys.indexOf(state.variant);
  changeVariant(keys[(i + (event.key === "ArrowRight" ? 1 : 2)) % 3]);
});
render();
