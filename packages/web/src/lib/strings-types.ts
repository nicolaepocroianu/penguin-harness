import type { ActivityRunStatus, OutcomeFactName } from "@waterford/waf-harness-server/api";
import type { PeakWindows } from "../features/models/model-grouping";

/** Shared dictionary contract for supported translations. */
export type Strings = {
  appName: string;
  activities: {
    mediaLanguage: string;
    noMediaAssets: string;
    boundMedia: string;
    /** An asset bound to the placeholder the server names: bound, but not finished media. */
    placeholderMedia: string;
    placeholderMediaHint: string;
    downloadCurrent: string;
    unboundMedia: string;
    usedInScenes: string;
    noSceneUsage: string;
    assetPath: string;
    assetPathHint: string;
    sceneAssets: string;
    workspaceRail: string;
    /** The hierarchy panel, named the way Loom names it. */
    studioTree: {
      label: string;
      rows: Record<
        | "activityScript"
        | "activitySpec"
        | "implementationFeatures"
        | "configurationData"
        | "assessmentData"
        | "moduleDefinition"
        | "stateMachine"
        | "audios"
        | "scenes"
        | "activityStats"
        | "unassigned"
        | "mediaLibrary"
        | "history"
        | "deploy",
        string
      >;
      phases: { write: string; media: string; build: string; more: string };
      groups: Record<"image" | "video" | "audio" | "animation" | "bookWord", string>;
      fold: (name: string) => string;
      unfold: (name: string) => string;
      needsMedia: string;
      /** An asset, or a scene holding one, bound only to the placeholder. */
      placeholder: string;
      /** A section row's state beside its name. */
      trail: { unsaved: string; valid: string; invalid: string };
      /** What a disabled section waits for: short beside the name, and in full on hover. */
      waits: Record<"spec" | "plan" | "module", string>;
      waitsHelp: Record<"spec" | "plan" | "module", string>;
      /** A scene row named by the script, with the id the specification knows it by. */
      sceneTitle: (number: number, title: string, id: string) => string;
    };
    /** What the playing activity reports about itself, under the player. */
    studioPlayer: {
      waiting: string;
      pick: string;
      picking: string;
      opened: (name: string) => string;
      noMatch: (id: string) => string;
      noMedia: string;
      silent: string;
      map: {
        /** The map's section title. */
        title: string;
        /** The fold button's name while the map is hidden, and while it is shown. */
        show: string;
        hide: string;
        /** Opens the state machine's editor from the map. */
        edit: string;
        scene: string;
        loading: string;
        none: string;
        unreadable: (reason: string) => string;
        trigger: { after: (ms: string) => string; done: string; error: string };
        live: (phase: string) => string;
        graph: (scene: string) => string;
        liveCount: (count: number) => string;
        liveTargets: (phase: string) => string;
        more: (count: number) => string;
        targetTitle: (id: string, inputType: string) => string;
        inputTypes: { CLICK: string; SELECT: string; SELECT_CLICK: string; DRAG: string };
        resizeMap: string;
        zoom: string;
        zoomIn: string;
        zoomOut: string;
        zoomFit: string;
        zoomLevel: (percent: number) => string;
        /** How to move around the drawing, for a screen reader. */
        canvasHelp: string;
        /** A state's marks: where the scene starts, where it ends, a state outside it. */
        badges: { start: string; final: string; external: string };
        /** A state's hint: the action it runs on entry, or the service it invokes. */
        actionTitle: (action: string) => string;
        serviceTitle: (service: string) => string;
        /** The words the layout writes (ported from Loom's state machine viewer). */
        layout: {
          lanes: { retry: string; flow: string; outcome: string };
          otherwise: string;
          completed: string;
          promptCompleted: string;
          choiceSelected: string;
          incorrectFeedback: string;
          guarded: (label: string) => string;
          guards: {
            incorrect: string;
            correct: string;
            hangUp: string;
            disengaged: string;
            guided: string;
          };
          scene: (number: string) => string;
          /** A jump to a distant scene, drawn as a badge: the event, the scene, the state. */
          stub: (event: string, scene: string, state: string) => string;
        };
        inspect: {
          hint: string;
          title: (phase: string) => string;
          initial: string;
          final: string;
          entry: string;
          exit: string;
          invokes: string;
          outgoing: string;
          incoming: string;
          via: (trigger: string) => string;
          to: string;
          leaves: (trigger: string, target: string) => string;
          nothing: string;
          close: string;
        };
      };
    };
    /**
     * Play mode and the player's lines: the scene timeline under the player, the scene's
     * narration with the spoken line lit, and what can be tapped now, in words.
     */
    studioPlay: {
      /** The heading over the scene being shown, and its lines. */
      now: string;
      /** A scene by its place and its title in the script. */
      scene: (number: number, title: string | null) => string;
      lines: (scene: string) => string;
      noLines: string;
      /** Said to a reader on the line being spoken, and on one an author chose. */
      speaking: string;
      chosen: string;
      /** A line's length when it comes from its words rather than its clip. */
      about: (length: string) => string;
      /** A line's button: light it here and in the script. */
      showLine: (words: string) => string;
      timeline: string;
      /** A scene on the timeline: restart the activity there. */
      jump: (scene: string) => string;
      restart: string;
      previous: string;
      next: string;
      /** What can be tapped now, in words. */
      tap: {
        speaking: string;
        video: string;
        nothing: string;
        /** "Tap First rock or rock-c · Drag rock-b · 2 more". */
        verbs: Record<"CLICK" | "SELECT" | "SELECT_CLICK" | "DRAG", string>;
      };
      /** A module that never reports its media: no line can be lit as it plays. */
      quiet: string;
      /** The state as the module names it, for whoever reads machine ids. */
      state: (state: string) => string;
    };
    /** Named workspace layouts, from the Layout menu in the activity header. */
    layouts: {
      menu: string;
      current: string;
      saveAs: string;
      saveTitle: string;
      save: string;
      name: string;
      nameHint: string;
      manage: string;
      manageTitle: string;
      manageEmpty: string;
      nameColumn: string;
      kindColumn: string;
      actionsColumn: string;
      builtInTag: string;
      savedTag: string;
      rename: string;
      renameTitle: (name: string) => string;
      renameLabel: (name: string) => string;
      deleteLabel: (name: string) => string;
      delete: string;
      deleteTitle: string;
      deleteConfirm: (name: string) => string;
      builtIn: Record<"writing" | "reviewing" | "media", string>;
      shortcuts: string;
      shortcutsHint: string;
      shortcutKey: (n: number) => string;
      saved: (name: string) => string;
      renamed: (name: string) => string;
      deleted: (name: string) => string;
      limit: string;
      duplicate: string;
      tooLong: string;
      empty: string;
    };
    /** The right-edge rail of tools, and the panel one of them opens beside the work. */
    studioPanels: {
      rail: string;
      close: string;
      names: Record<"run" | "player" | "checks" | "conversation", string>;
      /** The divider between the work and the open panel. */
      width: string;
      expand: string;
      restore: string;
    };
    /** Loom's refs: the product's refs in the header, and one ref's name and stability. */
    studioRefs: {
      ref: string;
      /** The ref menu: the product's refs, then what can be done to this one. */
      menu: string;
      refs: string;
      option: (refNum: number, name: string | null, stable: boolean) => string;
      stable: string;
      stableHint: string;
      settings: string;
      settingsTitle: (productCode: string, refNum: number) => string;
      displayName: string;
      displayNameHint: string;
      /** Renumbering a ref from the header, and why the server refused it. */
      changeNumber: string;
      changeNumberTitle: (productCode: string, refNum: number) => string;
      newNumber: string;
      numberHint: string;
      stableBlocks: string;
      numberTaken: (refNum: number) => string;
      renumber: string;
      renumbered: (from: number, to: number) => string;
      reassemble: string;
      renumberErrors: {
        draft_conflict: string;
        run_active: string;
        pipeline_running: string;
        activity_exists: string;
      };
    };
    /** Product tags: edited in ref settings, shown on list cards, and the list's tag filter. */
    tags: {
      label: string;
      about: string;
      add: string;
      placeholder: string;
      removeTag: (tag: string) => string;
      all: string;
      filter: string;
      tooLong: string;
      tooMany: string;
      invalid: string;
    };
    /** Saved versions of the activity, listed in its History. */
    versions: {
      title: string;
      about: string;
      aboutMedia: string;
      save: string;
      saving: string;
      saveTitle: string;
      name: string;
      nameHint: string;
      nameTooLong: (max: number) => string;
      saved: (seq: number) => string;
      unchanged: (seq: number) => string;
      loading: string;
      empty: string;
      loadFailed: string;
      number: (seq: number) => string;
      unnamed: string;
      noMedia: string;
      noAuthor: string;
      current: string;
      columns: {
        version: string;
        name: string;
        created: string;
        media: string;
        actions: string;
      };
      kinds: { manual: string; auto: string; restore: string; deploy: string };
      reasons: { before_restore: string; before_proposal: string };
      compare: string;
      /** Accessible name of a row's Compare button. */
      compareVersion: (seq: number) => string;
      compareTitle: (seq: number) => string;
      compareAbout: (seq: number) => string;
      comparing: string;
      compareFailed: string;
      closeCompare: string;
      /** Accessible name of one part's line diff. */
      diffLabel: (part: string) => string;
      files: {
        description: string;
        spec: string;
        mediaPlan: string;
        configuration: string;
        assessment: string;
        definition: string;
        stateMachine: string;
        features: string;
      };
      mediaTitle: string;
      mediaColumns: { file: string; change: string; before: string; after: string };
      media: { added: string; removed: string; changed: string };
      /** A side of the media table without the file. */
      noFile: string;
      noChanges: string;
      restore: string;
      /** Accessible name of a row's Restore button, and the confirmation's title. */
      restoreVersion: (seq: number) => string;
      restoreConfirm: (seq: number) => string;
      restoreUnsaved: string;
      restoring: string;
      restored: (seq: number) => string;
      incomplete: (path: string) => string;
      incompleteRecord: string;
      /** Whether QA and PROD hold what the draft holds now, under the Versions heading. */
      status: {
        label: string;
        qa: Record<"never" | "in_sync" | "changed", string>;
        prod: Record<"never" | "in_sync" | "changed", string>;
        /** The deployed version and when it went, after the status. */
        deployed: (seq: number, when: string) => string;
      };
      /** Badges on the rows of the versions that went to QA or PROD. */
      deployedBadge: Record<"qa" | "prod", string>;
      /** The badge's accessible name: where the version went, and when. */
      deployedOn: (target: string, when: string) => string;
    };
    /** Module builds: every succeeded assembly, compared two at a time, one played in the preview. */
    moduleBuilds: {
      title: string;
      about: string;
      aboutPin: string;
      loading: string;
      loadFailed: string;
      empty: string;
      /** A build's short name, from its run. */
      label: (id: string) => string;
      columns: {
        select: string;
        build: string;
        actions: string;
      };
      files: (count: number) => string;
      noFolder: string;
      newest: string;
      playing: string;
      select: (label: string) => string;
      selectHint: string;
      compare: string;
      compareTitle: (from: string, to: string) => string;
      compareAbout: (from: string, to: string) => string;
      comparing: string;
      compareFailed: string;
      closeCompare: string;
      noChanges: string;
      unchanged: (count: number) => string;
      fileColumns: { file: string; change: string; before: string; after: string };
      changes: Record<"added" | "removed" | "changed", string>;
      noFile: string;
      textFile: string;
      text: Record<"binary" | "too_large", string>;
      diffLabel: (file: string) => string;
      play: string;
      playBuild: (label: string) => string;
      unpin: string;
      pinnedNotice: string;
      pinnedDetail: (label: string) => string;
      pinned: (label: string) => string;
      unpinned: string;
      /** The pinned build no longer exists, so the newest plays. */
      pinGone: string;
      /** Why Play this build and Unpin wait: a run is in progress. */
    };
    /** A new ref made from the product's template ref, deciding about each of its assets. */
    createRef: {
      title: string;
      about: string;
      newRef: string;
      refNum: string;
      refNumHint: string;
      name: string;
      language: string;
      voiceForAll: string;
      voiceUnchanged: string;
      keepAll: string;
      regenerateImages: string;
      columns: { asset: string; current: string; action: string; details: string };
      actions: { keep: string; regenerate: string; upload: string; library: string };
      actionsFor: (key: string) => string;
      types: {
        image: string;
        narration: string;
        sound: string;
        video: string;
        animation: string;
      };
      scenes: (ids: string) => string;
      noScene: string;
      copied: string;
      unbound: string;
      bound: string;
      script: string;
      description: string;
      chooseFile: string;
      chosenFile: (name: string) => string;
      choose: string;
      chosenUpload: (name: string) => string;
      create: string;
      creating: string;
      created: (refNum: number) => string;
      createdWithProblem: (refNum: number, reason: string) => string;
      notStable: (refNum: number) => string;
      markStable: string;
      notCanonical: string;
      assessmentShared: (refNum: number) => string;
      openAssessment: string;
      blockersTitle: string;
      blockers: {
        missingRefNum: string;
        refNumTaken: (refNum: number) => string;
        uploadMissing: (key: string) => string;
        libraryMissing: (key: string) => string;
        scriptMissing: (key: string) => string;
        descriptionMissing: (key: string) => string;
        scriptTooLong: (key: string, max: number) => string;
        descriptionTooLong: (key: string, max: number) => string;
      };
      errors: {
        not_canonical: string;
        template_not_stable: string;
        activity_exists: string;
        activity_archived: string;
      };
    };
    /** The list page's product groups: sort, per-group counts and status, and one card's status line. */
    home: {
      sortLabel: string;
      sort: { recent: string; code: string };
      refs: (count: number) => string;
      canonical: string;
      progress: (done: number, total: number) => string;
      newRefUnavailable: string;
      status: {
        running: (what: string) => string;
        stale: string;
        built: string;
        next: { spec: string; mediaPlan: string; module: string };
      };
      /** The list's lenses, by what an activity needs (activity-groups.ts). */
      lensLabel: string;
      lenses: { all: string; progress: string; attention: string; built: string };
      ref: (refNum: number) => string;
      /** The milestones, named in the status's hover and to a reader. */
      milestones: { spec: string; mediaPlan: string; module: string };
      milestone: (name: string, done: boolean) => string;
      /** A row's menu: open it, or make a new ref of its product. */
      more: (title: string) => string;
      open: string;
      newRefFrom: (productCode: string) => string;
    };
    /** The project media library: every activity's uploads, browsed and downloaded together. */
    projectMedia: {
      title: string;
      about: string;
      open: string;
      back: string;
      search: string;
      kind: string;
      kinds: { all: string; image: string; audio: string; video: string };
      product: string;
      anyProduct: string;
      sort: string;
      sorts: { name: string; newest: string; size: string; activity: string };
      view: string;
      views: { grid: string; table: string };
      selectAll: string;
      clear: string;
      selectFile: (name: string) => string;
      selectedCount: (count: number) => string;
      download: (count: number) => string;
      downloading: string;
      downloadLimit: (max: number) => string;
      columns: {
        select: string;
        name: string;
        type: string;
        size: string;
        activity: string;
        updated: string;
      };
      loading: string;
      empty: string;
      noMatches: string;
      truncated: (count: number) => string;
      details: string;
      detailsEmpty: string;
      openActivity: string;
      files: string;
      scope: { label: string; here: string; all: string };
      otherEmpty: string;
      copyHint: string;
      copying: string;
      copied: (name: string) => string;
      tooLarge: string;
    };
    /** Deleting an activity: it is archived, so it leaves the list and its files stay. */
    deleteActivity: {
      action: string;
      confirmTitle: string;
      deleteConfirm: (title: string, ref: number) => string;
      deleted: (title: string) => string;
      errors: {
        canonical_has_refs: string;
        run_active: string;
        pipeline_running: string;
      };
    };
    /** Creating a ref whose number a deleted activity still holds. */
    archivedConflict: string;
    /** The storyboard: every scene as a card, the Scenes section's first view. */
    studioBoard: {
      title: string;
      count: (n: number) => string;
      play: string;
      assemble: string;
      editMedia: string;
      back: string;
      previous: string;
      next: string;
      previousScene: (scene: string) => string;
      nextScene: (scene: string) => string;
      open: string;
      /** A scene by its number and its name: the script's title, else its id. */
      scene: (n: number, name: string) => string;
      shared: string;
      working: string;
      proposed: string;
      unbound: (n: number) => string;
      /** A scene's assets bound only to the placeholder. */
      placeholders: (n: number) => string;
      assets: (n: number) => string;
      noAssets: string;
      empty: string;
      /** The beats a card does not show. */
      more: (n: number) => string;
      /** A scene the script says nothing for. */
      noBeats: string;
      /** After a beat whose clip is bound only to the placeholder. */
      beatPlaceholder: string;
      /** The board's one notice about placeholders, its explanation and its action. */
      placeholderNotice: (n: number) => string;
      placeholderNoticeBody: string;
      reviewPlaceholders: string;
    };
    /** An asset's picture where it is listed (Storyboard, Library, the scene tree). */
    mediaPreview: {
      /** Said on the picture of a video bound only to the placeholder. */
      placeholder: string;
      /** Under the asset editor's player, for a video or animation bound to the placeholder. */
      placeholderNote: (type: "video" | "animation", others: number) => string;
    };
    /** Narration played where it is listed: one line, or a scene's lines one after another. */
    clipPlayback: {
      /** A line's play button, by its words; null when the line has none. */
      play: (line: string | null) => string;
      stop: (line: string | null) => string;
      /** A scene's button: the visible word, and the name that says which scene. */
      playSceneShort: string;
      stopSceneShort: string;
      playScene: (scene: string) => string;
      stopScene: (scene: string) => string;
      lines: (n: number) => string;
      /** A line whose file the browser could not play. */
      failed: string;
      /** Every line with a file, one after another in scene order: the word, and its full name. */
      playAllShort: string;
      stopAllShort: string;
      playAll: (n: number) => string;
      stopAll: string;
    };
    /** The Deploy section: whether a deploy of this activity could start, and what is missing. */
    deploy: {
      title: string;
      about: string;
      loading: string;
      loadFailed: (reason: string) => string;
      ready: string;
      notReady: (n: number) => string;
      /** Where an admin fills in the deploy settings. */
      settingsHint: string;
      /** The button an admin uses to jump straight to the Deploy settings page. */
      openSettings: string;
      /** The preview plays a pinned build, which a release does not ship. */
      pinnedBuild: string;
      checksLabel: string;
      columns: { check: string; state: string };
      problemsTitle: string;
      prepareClones: string;
      preparing: string;
      prepared: string;
      checkRemote: string;
      /** What Check remote does, for its tooltip and its accessible description. */
      checkRemoteHint: string;
      checkingRemote: string;
      remoteChecked: string;
      /** The long name of each setting, by its dotted path. */
      fields: Record<string, string>;
      repos: { module: string; activityData: string; media: string };
      rows: {
        ref: string;
        layout: string;
        settings: string;
        git: string;
        moduleRemote: string;
        clone: (repo: string) => string;
        branch: (name: string) => string;
      };
      states: {
        canonical: string;
        notCanonical: string;
        noModule: string;
        layout: (layout: string) => string;
        noLayout: string;
        settingsComplete: string;
        settingsMissing: (n: number) => string;
        gitAvailable: string;
        gitUnavailable: string;
        noRemote: string;
        remoteInvalid: (remote: string) => string;
      };
      clone: {
        present: (branch: string | null) => string;
        missing: string;
        dirty: string;
        ahead: (n: number) => string;
        remoteMismatch: string;
        /** Work a deploy set aside in git's stash and could not put back. */
        stashLeft: string;
        unknown: string;
        /** What git could not say about a present clone. */
        notKnown: { status: string; upstream: string; branch: string; sparse: string };
        remoteUnreachable: string;
        mediaPathMissing: (path: string) => string;
        /** A clone check that found no branch the deploy starts from: short, since the problem is said above. */
        branchMissing: (branch: string, where: "local" | "remote") => string;
      };
      branch: {
        local: string;
        notYet: string;
        unknown: string;
        onRemote: string;
        notOnRemote: string;
        remoteUnknown: string;
      };
      problems: {
        settings_missing: (field: string) => string;
        workspace_not_ready: string;
        module_remote_invalid: string;
        clone_missing: (repo: string) => string;
        clone_unknown: (repo: string, what: "status" | "upstream" | "branch" | "sparse") => string;
        remote_unreachable: (repo: string) => string;
        media_path_missing: (path: string) => string;
        clone_dirty: (repo: string) => string;
        clone_ahead: (repo: string, n: number) => string;
        clone_stash_left: (repo: string) => string;
        clone_remote_mismatch: (repo: string) => string;
        branch_missing: (repo: string, branch: string, where: "local" | "remote") => string;
        not_canonical: string;
        no_module: string;
        layout_unsupported: (layout: string) => string;
        git_unavailable: string;
      };
      /** The module release: its stages, their states and why one cannot run, the log. */
      releaseTitle: string;
      workflowTitle: string;
      /** The folded checks' summary: how many, and how many want a look. */
      checksSummary: (total: number, attention: number) => string;
      /** The checks that fail, shown open under what is missing. */
      failingChecks: string;
      /** The rest of the checks, folded beside the failing ones. */
      otherChecksPass: (count: number) => string;
      showAllChecks: (total: number) => string;
      hideChecks: string;
      /** The QA lane's menu: the module release on its own, and running one stage at a time. */
      moreActions: string;
      releaseOnly: string;
      /** The admin's way to the WAF workspace page, where the shared clones are prepared. */
      openWorkspaceSettings: string;
      /** Why Deploy to QA waits while the readiness strip lists problems. */
      waitingOnReadiness: string;
      /** A phase's stages done out of all of them. */
      phaseCount: (done: number, total: number) => string;
      /** The stage the pipeline stopped at, which cannot run now. */
      blocked: string;
      /** How many media files the media stage checked. */
      mediaFiles: (n: number) => string;
      /** How many media files the media stage re-encoded, and how much smaller they are. */
      mediaOptimised: (n: number, saved: string) => string;
      qaTitle: string;
      qaStates: { notDeployed: string; deploying: string; onQa: string; failed: string };
      /** What a QA deploy does, under the QA card's status while it has not been deployed. */
      qaExplain: string;
      phaseLabels: { module: string; data: string; qa: string };
      stageProgress: (done: number, total: number) => string;
      releaseAbout: string;
      releasing: string;
      releaseStarted: string;
      /** The confirm dialog's name and body: it pushes a branch and starts a Jenkins build. */
      releaseConfirmTitle: string;
      releaseConfirm: (branch: string) => string;
      releaseConfirmLabel: string;
      /** Running the push-and-build stage on its own asks the same. */
      triggerConfirm: (branch: string) => string;
      moduleVersion: string;
      moduleVersionHint: string;
      moduleVersionInvalid: string;
      stop: string;
      stopping: string;
      log: string;
      logEmpty: string;
      /** The release tag the build made. */
      resolvedVersion: (version: string) => string;
      openBuild: string;
      stagesLabel: string;
      advanced: string;
      /** The per-stage Run button's accessible name. */
      runStage: (stage: string) => string;
      run: string;
      stageStarted: (stage: string) => string;
      stages: {
        verify_module: string;
        prepare_deploy: string;
        trigger_module_build: string;
        await_module_build: string;
        export_activity_data: string;
        verify_activity_data: string;
        verify_media_assets: string;
        publish_activity_data: string;
        trigger_activity_deploy: string;
        await_activity_deploy: string;
        trigger_production_deploy: string;
        await_production_deploy: string;
      };
      /** What Deploy to QA does, after the release, in the section's explanation. */
      qaAbout: string;
      deployQa: string;
      deployingQa: string;
      deployQaStarted: string;
      /**
       * Once the module build or the QA deploy was started and the wait for it did not finish,
       * waiting for it comes before Deploy to QA: why, and the line said once it started. The
       * button is the wait stage's name.
       */
      waitFirst: { await_module_build: string; await_activity_deploy: string };
      waitStarted: { await_module_build: string; await_activity_deploy: string };
      /** The QA confirm dialog: what it pushes and starts, for this product code. */
      deployQaConfirmTitle: string;
      deployQaConfirm: (productCode: string) => string;
      deployQaConfirmItems: {
        release: (branch: string) => string;
        media: string;
        data: (branch: string) => string;
        deploy: string;
      };
      deployQaConfirmLabel: string;
      /** A stage run on its own that pushes or starts a Jenkins job asks first. */
      stageConfirmTitle: (stage: string) => string;
      stageConfirm: {
        verify_media_assets: string;
        publish_activity_data: (branch: string) => string;
        trigger_activity_deploy: string;
      };
      /** The link to the activity on QA once a QA deploy finished. */
      openQa: string;
      /** The released module version the activity is on QA with. */
      qaVersion: (version: string) => string;
      /** A QA deploy left the release out because it was current. */
      releaseSkipped: string;
      /** The check of the exported data: its heading and each finding. */
      preflightTitle: string;
      preflightErrors: string;
      preflightWarnings: string;
      preflight: {
        deploy_list_mismatch: (file: string) => string;
        file_missing: (file: string) => string;
        file_invalid: (file: string) => string;
        layout_module_mismatch: (expected: string, found: string | null) => string;
        no_sources: string;
        assessment_empty: (file: string) => string;
        assessment_count_mismatch: (file: string, items: number, maxItems: number) => string;
        media_path_unsafe: (file: string, reference: string) => string;
        media_preview_url: (file: string, reference: string) => string;
        media_token_left: (file: string, reference: string) => string;
        configuration_without_media: (file: string) => string;
      };
      /** The latest QA deploy's state, as the line above the stages says it. */
      qaRunStatuses: {
        running: (stage: string) => string;
        succeeded: string;
        failed: string;
        cancelled: string;
        interrupted: string;
      };
      statuses: {
        pending: string;
        running: string;
        done: string;
        failed: string;
        cancelled: string;
      };
      /** The latest run's state, as the line above the stages says it. */
      runStatuses: {
        running: (stage: string) => string;
        succeeded: string;
        failed: string;
        cancelled: string;
        interrupted: string;
      };
      /** Why a stage cannot be run now. */
      blockers: {
        previous_stage: (stage: string) => string;
        previous_rerun: (stage: string) => string;
        run_active: string;
        settings_missing: (field: string) => string;
        clone_missing: (repo: string) => string;
        clone_dirty: (repo: string) => string;
        not_ready: (problem: string) => string;
        qa_outdated: string;
      };
      /** Why a stage ended badly. */
      errors: {
        command_failed: (command: string, exitCode: number | null) => string;
        module_repository_missing: (remote: string) => string;
        sandbox_unavailable: string;
        command_timed_out: (command: string) => string;
        command_missing: (command: string) => string;
        jenkins_failed: (status: number) => string;
        build_failed: (result: string) => string;
        no_newer_tag: (before: string | null, after: string | null) => string;
        /** The build succeeded; no newer tag holds the commit it was started for. */
        tag_without_commit: (tag: string, commit: string) => string;
        /** A build with the same parameters is still going; its page when Jenkins gave one. */
        build_in_flight: (url: string | null) => string;
        build_timed_out: (minutes: number) => string;
        missing_input: (stage: string) => string;
        preflight_failed: (errors: number) => string;
        /** Media found nowhere: the first paths, and how many there are in all. */
        media_missing: (paths: string[], count: number) => string;
        /** FFmpeg could not re-encode media: the first paths, and how many there are in all. */
        media_optimise_failed: (paths: string[], count: number) => string;
        /** Media the clone has only LFS pointers of: the first paths, and how many in all. */
        media_lfs_pointer: (paths: string[], count: number) => string;
        /** Media changed while it was re-encoded: the first paths, and how many in all. */
        media_changed: (paths: string[], count: number) => string;
        /** Re-encoded media that could not be written: the first paths, how many, the error. */
        media_write_failed: (paths: string[], count: number, error: string) => string;
        /** The activity deploy had not finished in time; `target` is absent for QA's. */
        deploy_timed_out: (minutes: number, target?: "qa" | "prod") => string;
        interrupted: string;
        unexpected: string;
      };
      /** The PROD bar under the QA deploy: an admin who owns the project deploys what QA has. */
      prod: {
        title: string;
        about: string;
        /** Accessible name of the PROD stages table. */
        stagesLabel: string;
        deploy: string;
        deploying: string;
        started: string;
        /** Offered first once a PROD deploy was started and the wait for it did not finish. */
        wait: string;
        waitStarted: string;
        /** Why waiting comes first. */
        waitFirst: string;
        /** Shown in place of Deploy to PROD to an owner who is not an admin. */
        adminOnly: string;
        /** Nothing stands in the way. */
        ready: string;
        never: string;
        states: { notDeployed: string; deploying: string; onProd: string; failed: string };
        /** The last PROD deploy: when, and the framework version when known. */
        last: (when: string, frameworkVersion: string | null) => string;
        openDeploy: string;
        /** The confirm dialog: what it does, and the field the product code is typed into. */
        confirmTitle: string;
        confirm: (productCode: string) => string;
        confirmItems: { data: (branch: string) => string; jenkins: string };
        confirmLabel: (productCode: string) => string;
        confirmHint: string;
        confirmButton: string;
        /** The latest PROD deploy's state, as the bar says it. */
        runStatuses: {
          running: (stage: string) => string;
          succeeded: string;
          failed: string;
          cancelled: string;
          interrupted: string;
        };
        /** Why the server refused a start, by its error code. */
        refused: {
          confirmation_mismatch: string;
          prod_requires_admin: string;
        };
      };
    };
    /** Check quality, in the Module section: accessibility and reading level of the played activity. */
    quality: {
      title: string;
      about: string;
      check: string;
      checking: string;
      /** Why Check quality is not offered: the test browser is missing. */
      browserMissing: string;
      loadFailed: string;
      lastChecked: (when: string) => string;
      notChecked: string;
      /** The last run ended without reports. */
      lastFailed: (reason: string) => string;
      accessibility: { title: string; about: string };
      readability: {
        title: string;
        about: string;
        gradeBand: (band: string) => string;
        readingGrade: (grade: number) => string;
      };
      status: {
        passed: string;
        failed: string;
        passed_with_warnings: string;
        skipped: string;
      };
      skipped: {
        no_grade_band: string;
        unknown_grade_band: string;
        not_english: string;
        no_text: string;
      };
      severity: { must: string; should: string; minor: string; note: string };
      noFindings: string;
      /** Accessible name of a check's findings table. */
      findingsLabel: (check: string) => string;
      columns: { severity: string; rule: string; where: string; detail: string; link: string };
      /** Where a finding is when it is not tied to a scene or an element. */
      nowhere: string;
      scene: (scene: string) => string;
      learnMore: string;
      /** The link's accessible name. */
      learnMoreAbout: (rule: string) => string;
      keyboard: {
        "keyboard-focusable": string;
        "keyboard-focus-visible": string;
        "keyboard-activation": string;
      };
      readabilityRules: {
        sentence_long: string;
        word_long: string;
        word_syllables: string;
      };
      readabilityDetail: {
        sentence_long: (count: number, limit: number) => string;
        word_long: (count: number, limit: number) => string;
        word_syllables: (count: number, limit: number) => string;
      };
      waived: { vpat: string; captions: string };
    };
    /** Run tests, in the Module section: each acceptance criterion checked against the player. */
    tests: {
      title: string;
      about: string;
      run: string;
      running: string;
      /** Why Run tests is not offered: the test browser is missing. */
      browserMissing: string;
      noCriteria: string;
      /** The report tested an earlier revision of the specification. */
      stale: string;
      /** The run changed the harness, runner or input its checks rest on. */
      untrusted: string;
      noAgent: string;
      saveFirst: string;
      loadFailed: string;
      lastRun: (when: string) => string;
      notRun: string;
      lastFailed: (reason: string) => string;
      /** How many criteria passed, of how many. */
      count: (passed: number, total: number) => string;
      reused: string;
      status: Record<"passed" | "failed" | "skipped", string>;
      skipped: Record<"no_criteria", string>;
      codes: Record<"not_run", string>;
      resultsLabel: string;
      columns: {
        criterion: string;
        test: string;
        status: string;
        duration: string;
        error: string;
      };
      duration: (ms: number) => string;
      noTestName: string;
    };
    /** Running the stages: Loom's stage picker and Run, and the panel that follows a run. */
    runLog: {
      showReasoning: string;
    };
    studioRun: {
      stage: string;
      all: string;
      steps: Record<
        | "spec"
        | "mediaSpec"
        | "media"
        | "translations"
        | "speech"
        | "words"
        | "sounds"
        | "images"
        | "assessment"
        | "module"
        | "test",
        string
      >;
      narration: string;
      /** Speech, then images: what a ref made from its template generates next. */
      assets: string;
      status: Record<
        "pending" | "running" | "succeeded" | "skipped" | "failed" | "cancelled",
        string
      >;
      run: string;
      stop: string;
      idle: string;
      progress: (done: number, total: number) => string;
      notes: Record<
        | "planCurrent"
        | "allTranslated"
        | "needsWafHarnessAgent"
        | "noNarration"
        | "noImages"
        | "notDecodable"
        | "noWords"
        | "wordsMissingSounds"
        | "noSounds"
        | "soundProviderUnavailable"
        | "imageProviderUnavailable"
        | "noAssessment"
        | "notCanonical"
        | "noCriteria"
        | "noBrowser"
        | "moduleNotChecked"
        | "moduleCheckSkipped"
        | "moduleCheckUntrusted"
        | "moduleChecksFailing"
        | "moduleChecksNotRun"
        | "testsFailing"
        | "testsStillFailing"
        | "testsUntrusted",
        string
      >;
      running: (step: string) => string;
      finished: string;
      stopped: string;
      failed: (reason: string) => string;
      saveFirst: string;
      otherRun: string;
      noAgent: string;
      with: (agent: string) => string;
      skipped: (count: number) => string;
      showLog: (step: string) => string;
      waitingForSession: string;
      /** A speech, image or sound stage while it runs: no agent, so no transcript. */
      runByServer: string;
      openInChat: string;
      noRun: string;
      /** The folded list of the activity's earlier stage runs, with how many there are. */
      earlier: (count: number) => string;
      /** One earlier run in that list: what it ran and when it started. */
      earlierRun: (stages: string, when: string) => string;
      /** Above an earlier run the panel is showing. */
      viewingEarlier: (when: string) => string;
      /** Back from an earlier run to the latest one. */
      backToLatest: string;
      /** Finished stages folded into one row while a run goes on. */
      doneFold: (count: number) => string;
      /** The agent and the stages a running sequence uses, in one line. */
      runningWith: (agent: string, stages: string) => string;
      /** A sequence of every stage from the one named on, as the history names it. */
      allFrom: (stage: string) => string;
      /** On a failed or stopped sequence: run the stage it did not finish and every one after. */
      continueFrom: (stage: string) => string;
    };
    /** The specification's labels in the JSON editor. */
    specEditor: {
      title: string;
      editor: string;
      savedSide: string;
      save: string;
    };
    /** The specification read as scenes beside its JSON. */
    specScenes: {
      view: string;
      scenes: string;
      json: string;
      unreadable: string;
      openJson: string;
      runtime: string;
      engine: (value: string) => string;
      layout: (value: string) => string;
      theme: (value: string) => string;
      assessment: (on: boolean) => string;
      description: string;
      noDescription: string;
      prefixNotice: (prefix: string) => string;
      removePrefix: string;
      criteria: string;
      noCriteria: string;
      scenesHelp: string;
      noScenes: string;
      summary: (matching: number, differing: number) => string;
      videos: (n: number) => string;
      images: (n: number) => string;
      animations: (n: number) => string;
      sounds: (n: number) => string;
      narrationLines: (n: number) => string;
      noNarration: string;
      matches: string;
      differs: (n: number) => string;
      notInScript: string;
      lineNotInScript: string;
      scriptSays: (text: string) => string;
      useScript: string;
      extraInScript: (n: number) => string;
      narration: string;
      media: string;
      kinds: Record<"image" | "video" | "animation" | "sound", string>;
      bound: string;
      placeholder: string;
      needsFile: string;
      scene: (n: number, title: string) => string;
    };
    /** The JSON editor Loom shows for a document: Diff and its toolbar, and why text cannot save. */
    jsonEditor: {
      diff: string;
      diffHelp: string;
      diffHint: string;
      toolbar: string;
      base: string;
      changes: string;
      stats: (added: number, removed: number, regions: number) => string;
      previous: string;
      previousHelp: string;
      next: string;
      nextHelp: string;
      counter: (current: number, total: number) => string;
      inline: string;
      inlineHelp: string;
      sideBySide: string;
      sideBySideHelp: string;
      sideBySideLabel: string;
      revertAll: string;
      revertAllHelp: string;
      minimap: string;
      jump: (n: number) => string;
      empty: string;
      notObject: string;
      invalid: (reason: string) => string;
    };
    /** The Activity Script editor: scenes that fold, media tags, and a diff against a base. */
    studioScript: {
      label: string;
      scenes: string;
      scenesHelp: string;
      diff: string;
      diffOff: string;
      diffSaved: string;
      diffProposal: string;
      stats: (added: number, removed: number) => string;
      noChanges: string;
      changedScenes: string;
      scene: (n: number) => string;
      proposed: string;
      marks: Record<"audio" | "video" | "image" | "animation", string>;
      clipBound: string;
      clipPlaceholder: string;
      clipUnbound: string;
      openClip: (key: string) => string;
      /** A clip chip's play button, by what the line says. */
      playClip: (words: string) => string;
      stopClip: (words: string) => string;
      /** The small player a video chip opens over the script. */
      closeVideo: string;
      videoOf: (words: string) => string;
      seconds: (value: string) => string;
      minutes: (minutes: number, seconds: string) => string;
      sceneFacts: {
        heard: (n: number) => string;
        seen: (n: number) => string;
        unbound: (n: number) => string;
      };
      acceptChange: string;
      rejectChange: string;
      reviewLabel: string;
      reviewLeft: (left: number, total: number) => string;
      reviewDone: (kept: number, total: number) => string;
      reviewNoneKept: string;
      previousChange: string;
      nextChange: string;
      rejectRest: string;
      acceptRest: string;
      applyReview: string;
      closeProposal: string;
      status: {
        label: string;
        scene: (n: number, total: number, title: string) => string;
        noScene: string;
        line: (n: number) => string;
        words: (n: number) => string;
        narrationSeconds: (s: number) => string;
        narrationMinutes: (m: number, s: number) => string;
        clips: (bound: number, total: number) => string;
      };
      save: string;
      minimap: string;
      jump: (line: number) => string;
      revert: string;
      autosave: Record<"pending" | "saving" | "saved" | "failed" | "held", string>;
      /** CodeMirror's built-in labels, keyed by its English phrase. */
      editorPhrases: Record<string, string>;
    };
    /** An agent's proposed changes, reviewed in the conversation panel. */
    studioProposal: {
      title: string;
      script: string;
      spec: string;
      media: (key: string, field: "description" | "script", language: string) => string;
      missingAsset: (key: string) => string;
      nothingToApply: string;
      accept: string;
      accepted: string;
      showChange: string;
      saveFirst: string;
      unreadable: (reason: string) => string;
      applyAll: (n: number) => string;
      inDraft: (done: number, total: number) => string;
      linesChanged: (n: number) => string;
      fieldsChanged: (n: number) => string;
      inScenes: string;
      reviewed: (done: number, total: number) => string;
      reviewProgress: string;
      discard: string;
      discardConfirm: string;
      reviewInScript: string;
      reviewLeft: (left: number, total: number) => string;
      reviewDone: string;
    };
    /** The conversation panel: an agent asked about what the author has open. */
    studioConversation: {
      wholeActivity: string;
      asset: (key: string, scene: string | null) => string;
      scene: (scene: string) => string;
      placeholder: string;
      send: string;
      stop: string;
      fresh: string;
      openInChat: string;
      threads: string;
      thread: (about: string, when: string) => string;
      today: (time: string) => string;
      suggestions: Record<"script" | "spec" | "asset", readonly string[]>;
      empty: string;
      readOnly: string;
      noAgent: string;
      movedTo: (focus: string) => string;
      viewing: (focus: string) => string;
      context: (focus: string) => string;
      removeContext: (focus: string) => string;
      addContext: (focus: string) => string;
    };
    railCollapse: string;
    railExpand: string;
    railWidth: string;
    sectionNames: Record<
      | "description"
      | "specification"
      | "features"
      | "configuration"
      | "assessment"
      | "scenes"
      | "stats"
      | "speech"
      | "library"
      | "module"
      | "stateMachine"
      | "history"
      | "deploy"
      | "newRef",
      string
    >;
    /** Loom's Implementation Features: patterns the module assembly reproduces exactly. */
    implementationFeatures: {
      help: string;
      selected: (n: number, total: number) => string;
      source: (module: string) => string;
      unreadable: (reason: string) => string;
    };
    /** Loom's Activity Stats: the media plan counted and weighed. */
    activityStats: {
      reload: string;
      unreadable: (reason: string) => string;
      empty: string;
      type: string;
      language: string;
      count: string;
      bound: string;
      size: string;
      total: string;
      missing: (n: number) => string;
    };
    /** A bound audio or video file's format, size, length, bitrate and dimensions. */
    mediaDetails: {
      title: string;
      format: string;
      size: string;
      length: string;
      bitrate: string;
      dimensions: string;
      measuring: string;
      unknown: string;
      formats: Record<"wav" | "mp3" | "ogg" | "mp4" | "webm" | "other", string>;
      kbps: (n: number) => string;
      pixels: (width: number, height: number) => string;
    };
    /** Generating the assessment, and editing its items without JSON. */
    assessment: {
      generate: string;
      generating: string;
      /** What generating does; shown in the Assessment Data title's popover. */
      generateAbout: string;
      useIt: string;
      keepCurrent: string;
      candidateTitle: string;
      /** The candidate's size beside the current assessment's. */
      candidate: (n: number) => string;
      current: (n: number | null) => string;
      candidateUnreadable: string;
      failed: (reason: string) => string;
      accepted: string;
      unused: string;
      items: string;
      itemTitle: (n: number, title: string) => string;
      interaction: Record<"SIMPLE_CHOICE" | "MULTIPLE_RESPONSE_CHOICE", string>;
      question: string;
      shuffle: string;
      choice: (n: number) => string;
      correct: string;
      correctOf: (n: number) => string;
      addItem: string;
      addChoice: string;
      removeItem: string;
      removeChoice: string;
      removeChoiceOf: (n: number) => string;
      reset: string;
      save: string;
      /** The header toggle between editing the items and the JSON. */
      view: { label: string; items: string; json: string };
      unsupported: string;
      blockers: {
        noItems: string;
        fewChoices: (item: number) => string;
        correctCount: (item: number) => string;
        emptyQuestion: (item: number) => string;
        emptyChoice: (item: number) => string;
        duplicateChoiceId: (item: number) => string;
      };
    };
    assessmentRun: string;
    /** Loom's Configuration Data and Assessment Data: the module's own documents, editable in place. */
    /** The ref's `spec/state-machine.json`, edited in place as Loom's editor did. */
    stateMachineEditor: {
      title: string;
      about: string;
      field: string;
      savedSide: string;
      saveLabel: string;
      loading: string;
      unreadable: (reason: string) => string;
      missing: string;
      fromModule: (file: string) => string;
      fromProduct: (file: string) => string;
      fromDraft: (file: string) => string;
      edited: string;
      stale: string;
      book: string;
      readOnly: string;
      shared: (ref: number) => string;
      warning: string;
      noProblems: string;
      checking: string;
      checkFailed: (reason: string) => string;
      /** How many problems the saved machine has, or the unsaved text would have. */
      problems: (n: number, unsaved: boolean) => string;
      inherited: string;
      problemsLabel: string;
      /** The section's two readings of the machine: its diagram, or its JSON. */
      view: string;
      diagram: string;
      json: string;
      /** Over the diagram while the text does not parse or does not validate. */
      lastValid: string;
      /** In the diagram's place when no version of the text has been valid yet. */
      noDrawing: string;
      wholeFile: string;
      saved: string;
      discard: string;
      discardConfirm: string;
      discarded: string;
    };
    moduleDocuments: {
      /** The panel titles and save labels, by document. */
      title: Record<"configuration" | "assessment" | "definition", string>;
      saveLabel: Record<"configuration" | "assessment" | "definition", string>;
      savedSide: string;
      loading: string;
      unreadable: (reason: string) => string;
      none: string;
      missing: Record<"configuration" | "assessment" | "definition", string>;
      fromRun: (file: string) => string;
      fromCheckout: (file: string) => string;
      items: (n: number) => string;
      /** What editing does, per document; shown in the heading's popover. */
      about: Record<"configuration" | "assessment" | "definition", string>;
      field: string;
      save: string;
      saving: string;
      saved: string;
      discard: string;
      discardConfirm: string;
      discarded: string;
      edited: string;
      stale: Record<"configuration" | "assessment" | "definition", string>;
      sharedOnCanonical: (ref: number) => string;
      notJson: (reason: string) => string;
      notObject: string;
      fromDraft: string;
      /** The Module Definition's at-a-glance view, beside its JSON. */
      summary: {
        view: { label: string; summary: string; json: string };
        engine: string;
        versions: string;
        themes: string;
        counts: string;
        none: string;
        unsaved: string;
        unreadable: (reason: string) => string;
        openJson: string;
        files: string;
        filesAbout: string;
        role: string;
        file: string;
        type: string;
        presence: string;
        presenceState: Record<"checking" | "found" | "missing" | "unknown", string>;
        noFiles: string;
        noUrl: string;
        openFile: (file: string) => string;
        theme: (name: string) => string;
        noThemes: string;
        noProperties: string;
        showAll: string;
        showLess: string;
        related: string;
      };
    };
    librarySectionEmpty: string;
    sceneAssetTree: string;
    chooseSceneAsset: string;
    unassignedScene: string;
    unassignedSceneHint: string;
    sceneOccurrences: (count: number) => string;
    sceneBoundCount: (bound: number, total: number) => string;
    sharedAsset: string;
    sharedAssetScenes: (scenes: string) => string;
    generatedBinding: string;
    reuseTitle: string;
    reuseHint: string;
    reuseChoose: string;
    reuseApply: string;
    clearBinding: string;
    mediaPathProblems: Record<"empty" | "prefix" | "characters" | "segment" | "length", string>;
    noInAppPreview: string;
    uploadTitle: string;
    uploadHint: Record<"image" | "audio" | "video", string>;
    uploadFile: string;
    uploading: string;
    uploaded: string;
    uploadWrongKind: (kind: string) => string;
    libraryTitle: string;
    libraryHint: string;
    libraryOpen: string;
    librarySearch: string;
    libraryEmpty: string;
    libraryNoMatches: string;
    libraryLoading: string;
    librarySelected: string;
    libraryChoosePrompt: string;
    libraryUse: string;
    libraryFile: string;
    librarySize: string;
    libraryUploadedAt: string;
    uploadedBinding: string;
    checkoutBinding: string;
    playMedia: string;
    waveform: string;
    showWaveform: string;
    waveformLoading: string;
    waveformTrim: {
      hint: string;
      selected: (start: string, end: string) => string;
      play: string;
      remove: string;
      clear: string;
      working: string;
      failed: (reason: string) => string;
      remains: (length: string) => string;
      playRemaining: string;
      marked: (at: string) => string;
      keys: string;
      handles: string;
      savesInPlace: string;
      saveEditsFirst: string;
    };
    waveformUnavailable: string;
    bulkSpeechTitle: string;
    bulkSpeechHelp: string;
    bulkSpeechTally: (ready: number, total: number) => string;
    /** Said once in the section's summary, so no row has to say it. */
    bulkSpeechAllReady: (total: number) => string;
    bulkSpeechPending: (count: number) => string;
    bulkSpeechBlocked: (count: number) => string;
    bulkSpeechNone: string;
    bulkSpeechGenerate: (count: number) => string;
    bulkSpeechConfirm: (count: number, language: string) => string;
    bulkSpeechStarted: (count: number) => string;
    bulkSpeechQueued: (count: number) => string;
    bulkSpeechStop: string;
    bulkSpeechRetry: string;
    bulkSpeechFilters: string;
    bulkSpeechFilter: Record<
      "all" | "needs" | "translate" | "ready" | "failed" | "blocked",
      string
    >;
    /** Narration sorted into main instructions and scaffolding by its words (instruction-type.ts). */
    instructionType: {
      title: string;
      filterLabel: string;
      filter: Record<"all" | "main" | "scaffolding", string>;
      badge: Record<"main" | "scaffolding", string>;
      about: string;
    };
    speechTranslation: Record<"missing" | "outdated" | "translating", string> & {
      translate: string;
      translateAll: (n: number) => string;
      translateAndSpeak: string;
      translateAndSpeakAll: (n: number) => string;
      addLanguage: string;
      add: string;
    };
    bulkSpeechLanguages: string;
    bulkSpeechLanguage: (language: string, ready: number, total: number) => string;
    speechState: Record<
      "ready" | "generating" | "failed" | "missing" | "scriptMissing" | "scriptTooLong",
      string
    >;
    diffTitle: string;
    diffHelp: string;
    diffNone: string;
    diffStats: (added: number, removed: number, regions: number) => string;
    diffPosition: (current: number, total: number) => string;
    diffPrevious: string;
    diffNext: string;
    diffInline: string;
    diffSideBySide: string;
    diffToInline: string;
    diffToSideBySide: string;
    diffRevert: string;
    diffRevertConfirm: string;
    diffScenes: string;
    diffSceneChange: Record<"added" | "removed" | "changed", string>;
    diffFolded: (lines: number) => string;
    diffSavedSide: string;
    diffEditedSide: string;
    diffTooLarge: string;
    mediaCategories: Record<"audio" | "image" | "video" | "animation", string>;
    speechScript: string;
    speechScriptHint: string;
    voicePicker: {
      label: string;
      search: string;
      provider: string;
      model: string;
      language: string;
      anyValue: string;
      resetFilters: string;
      count: (n: number) => string;
      id: (id: string) => string;
      allLanguages: string;
      preview: (voice: string) => string;
      pause: (voice: string) => string;
      mixed: string;
      default: string;
      defaultNamed: (name: string) => string;
      applyToAll: string;
      applied: (n: number) => string;
      appliesNext: string;
      noMatches: string;
    };
    /** A decodable book's word pronunciations: the words, their sounds, and where those came from. */
    bookWords: {
      group: string;
      about: string;
      refresh: string;
      refreshed: (n: number) => string;
      count: (n: number) => string;
      missing: (n: number) => string;
      allSounded: string;
      askModel: string;
      /** More words are missing than one run takes, so it asks for the first of them. */
      askFirst: (n: number) => string;
      asking: string;
      proposal: string;
      proposalFailed: string;
      proposalStale: string;
      noneProposed: string;
      useSounds: string;
      accepted: (n: number) => string;
      word: string;
      sounds: string;
      soundsHint: string;
      sound: (n: number) => string;
      addSound: string;
      removeSound: (n: number) => string;
      saveSounds: string;
      saved: string;
      noSounds: string;
      source: Record<"espeak" | "model" | "author", string>;
      espeakMissing: string;
      notDecodable: string;
      run: string;
      /** Record every word with sounds and no recording: the words stage for this language. */
      record: (n: number) => string;
      recordAbout: string;
      recordBlocked: string;
      recordTitle: string;
      /** Asked before recording, because each word is a paid request to its provider. */
      recordConfirm: (n: number, language: string) => string;
      /** Words with sounds and no recording, and how many recorded words have no timings. */
      toRecord: (n: number) => string;
      untimed: (n: number) => string;
      recording: string;
      noRecording: string;
      script: string;
      scriptHint: string;
      scriptYours: string;
      writeScript: string;
      useSoundsScript: string;
      timeline: string;
      timelineAbout: string;
      timelineList: string;
      noTimings: string;
      /** A sound, or the whole word, and when it starts, for the timeline's accessible names. */
      soundAt: (sound: string, start: string) => string;
      wholeWordAt: (word: string, start: string) => string;
    };
    /** Who speaks a narration: Gemini or ElevenLabs, and the word timings ElevenLabs returns. */
    speechProvider: {
      label: string;
      gemini: string;
      elevenlabs: string;
      kokoro: string;
      localInfo: string;
      runtimeMissing: string;
      languageUnsupported: string;
      /** An option the chosen agent cannot use, naming the Vault key it lacks. */
      keyMissing: (key: string) => string;
      /** The accepted clip's word timings, as the highlighting preview shows them. */
      timings: string;
      timingsAbout: string;
      noTimings: string;
      timingsList: string;
      word: (word: string, start: string) => string;
      voiceId: string;
      voiceIdHint: string;
      useVoiceId: string;
      noVoice: string;
      reloadVoices: string;
      loadingVoices: string;
      libraryProblem: Record<"credential_missing" | "refused" | "unavailable", string>;
      applyToAll: string;
      mixed: string;
      applied: (n: number) => string;
    };
    audioPlayback: {
      type: string;
      kinds: Record<"speech" | "music" | "sfx", string>;
      loop: string;
      volume: string;
      percent: (n: number) => string;
      hint: Record<"music" | "sfx", (channel: string) => string>;
    };
    /** A scene audio asset's editor: one card per language, Simplified or Advanced. */
    audioEditor: {
      view: string;
      simplified: string;
      advanced: string;
      card: (language: string) => string;
      script: (language: string) => string;
      prompt: string;
      generate: string;
      regenerate: string;
      generating: string;
      translate: (from: string) => string;
      translating: string;
      needsSource: (from: string) => string;
      save: string;
      saving: string;
      saveAbout: string;
      upload: string;
      uploading: string;
      current: string;
      candidate: string;
      generatedCandidate: string;
      uploadedCandidate: (name: string) => string;
      trimmedCandidate: string;
      noAudio: (language: string) => string;
      noCandidate: string;
      cannotPlay: (path: string) => string;
      model: string;
      models: Record<"eleven_v3" | "eleven_v4" | "eleven_multilingual_v2", string>;
      sharedSound: string;
      binding: string;
      olderTakes: string;
    };
    /** Music and sound effects generated from a prompt. */
    sound: {
      prompt: string;
      promptHint: string;
      length: string;
      lengthHint: (max: number, local: boolean) => string;
      lengthInvalid: (max: number) => string;
      provider: string;
      /** The model picker shown when a provider offers several models for the kind. */
      model: string;
      generate: string;
      regenerate: string;
      generating: string;
      providers: Record<"elevenlabs" | "agenthub" | "musicgen" | "audiogen" | "audioldm", string>;
      localInfo: string;
      problems: {
        runtime_missing: string;
        credential_missing: (key: string) => string;
        kind_unsupported: string;
        provider_unknown: string;
        no_model: string;
        model_unknown: string;
      };
      unavailable: (provider: string, problem: string) => string;
      noProvider: string;
      refused: string;
      candidate: (provider: string, seconds: string | null) => string;
      candidates: string;
      player: string;
      /** The Audios section's block for music and effects, and the stage it starts. */
      bulkTitle: string;
      bulkHelp: string;
      bulkTally: (ready: number, total: number) => string;
      bulkAllReady: (total: number) => string;
      bulk: (count: number) => string;
      bulkConfirm: (count: number, provider: string, language: string) => string;
      bulkUnavailable: (provider: string) => string;
      statuses: Record<"ready" | "missing" | "failed" | "generating" | "noPrompt", string>;
    };
    /** Scene videos (experimental): an agent composes an animated scene from its storyboard. */
    video: {
      title: string;
      info: string;
      experimental: string;
      compose: string;
      /** The scene look a composition is made in, chosen beside Compose. */
      look: string;
      noLook: string;
      /** Beside a recording an agent critiqued, and the best-scoring one. */
      critiqued: (score: string) => string;
      best: string;
      recompose: string;
      composing: string;
      /** The run's name in the history and the sessions panel. */
      run: string;
      noImages: string;
      candidates: string;
      frames: string;
      /** What a read of the composition's source found, beside its frames. */
      lint: {
        title: string;
        findings: Record<
          | "nondeterministic"
          | "own_timers"
          | "endless_repeat"
          | "layout_tween"
          | "emoji"
          | "all_caps"
          | "small_font"
          | "filler",
          string
        >;
      };
      frame: (index: number, seconds: string) => string;
      seconds: (seconds: string) => string;
      preview: string;
      play: string;
      pause: string;
      restart: string;
      older: string;
      states: Record<
        "loading" | "ready" | "playing" | "paused" | "ended" | "broken" | "unavailable",
        string
      >;
      choiceWarning: string;
      /** Recording a composition to a video: the action, its run, and the comparison. */
      record: string;
      rerecord: string;
      recording: string;
      /** The recording run's name in the history and the sessions panel. */
      recordRun: string;
      recordings: string;
      /** The label of the bound recording's player. */
      recorded: string;
      useNew: string;
      keepCurrent: string;
      /** Under Record video: rendering steps through every frame, so it takes a while. */
      renderTime: string;
      olderRecording: string;
      noCurrent: string;
      recordFailed: (cause: string) => string;
      noCause: string;
      /** Beside a video run that rendered the timeline rather than recorded a composition. */
      finished: string;
      /** The captions track of a finished video, as the player lists it. */
      captionsTrack: string;
      /** Which agent made a composition or critique, beside it. */
      madeBy: (agent: string) => string;
      /** An agent's scored critique of the newest recording, with what to fix. */
      critique: {
        title: string;
        info: string;
        /** The run's name in the run history and toasts. */
        run: string;
        critique: string;
        /** Compose, record and critique again, round after round, until it scores well. */
        improve: string;
        improveInfo: string;
        critiquing: string;
        score: (score: string) => string;
        rubric: Record<"story" | "layout" | "readability" | "motion" | "learners", string>;
        fixes: string;
        noFixes: string;
        composeAgain: string;
        older: string;
        failed: (cause: string) => string;
      };
      /** A made video's final check: its outcome, and each finding, with times in seconds. */
      check: {
        pass: string;
        /** A pass whose check still found warnings. */
        warnings: string;
        revise: string;
        fail: string;
        findings: Record<
          | "unreadable"
          | "duration_off"
          | "size_off"
          | "audio_missing"
          | "silent"
          | "clipping"
          | "narration_silent"
          | "black"
          | "flashing"
          | "layout_overlap"
          | "off_stage"
          | "near_edge"
          | "crowded"
          | "small_text"
          | "low_contrast"
          | "narration_mismatch"
          | "punctuation_spoken",
          (from: string, to: string, asset: string, elements: string) => string
        >;
      };
      /** The scene video's timeline: how its finished video is put together. */
      timeline: {
        title: string;
        info: string;
        /** Badges: the timeline is saved on the video, or started from its newest recording. */
        saved: string;
        unsaved: string;
        length: (seconds: string) => string;
        cuts: string;
        cut: (index: number) => string;
        from: string;
        to: string;
        /** How a cut begins, after the first. */
        into: string;
        transitions: Record<"cut" | "fade" | "fadeblack", string>;
        fade: string;
        narration: string;
        startsAt: string;
        addNarration: string;
        noNarration: string;
        music: string;
        noMusic: string;
        volume: string;
        percent: (value: number) => string;
        duck: string;
        effects: string;
        addEffect: string;
        noEffects: string;
        captions: string;
        removeButton: string;
        /** A remove button's accessible name, naming what it removes. */
        remove: (what: string) => string;
        save: string;
        reset: string;
        render: string;
        rendering: string;
        /** An agent rewrites the timeline so the sound follows the picture. */
        refine: string;
        refining: string;
        /** The run's name in the run history and toasts. */
        run: string;
        agentReady: string;
        loadAgent: string;
        agentFailed: (cause: string) => string;
        saveFirst: string;
        /** A time field that does not hold a usable number of seconds. */
        invalid: string;
        loadFailed: (cause: string) => string;
        /** What the server reports a timeline would get wrong, by code, naming the asset. */
        issues: Record<
          | "asset_missing"
          | "asset_kind"
          | "asset_unbound"
          | "narration_length_unknown"
          | "narration_overlap"
          | "past_end"
          | "cut_past_recording"
          | "captions_untimed",
          (asset: string) => string
        >;
      };
      /** A failed recording, by the code the server reports for the causes it knows. */
      recordProblems: Record<
        | "video_not_ready"
        | "video_no_timeline"
        | "video_timeout"
        | "video_invalid"
        | "video_too_large"
        | "video_stopped",
        string
      >;
      /** A failed check of what the agent wrote, by the code the server reports. */
      problems: Record<
        | "composition_network"
        | "composition_reference"
        | "composition_timeline"
        | "composition_template"
        | "composition_random"
        | "composition_size"
        | "composition_frames",
        string
      >;
    };
    assetLibrary: {
      kind: string;
      binding: string;
      bindings: Record<"any" | "unbound" | "bound", string>;
      search: string;
      planned: string;
      uploaded: string;
      count: (shown: number, total: number) => string;
      columns: Record<"asset" | "type" | "binding" | "scenes" | "file" | "size" | "usedBy", string>;
      sources: Record<"generated" | "upload" | "checkout" | "placeholder", string>;
      unbound: string;
      unused: string;
      noPlan: string;
      noMatch: string;
      /** The Library's grid or table switch. */
      layout: string;
      layouts: { grid: string; table: string };
      /** The grid's two groups: what still needs a file, and what is ready. */
      needsAttention: string;
      ready: string;
      needsFile: string;
      facts: (parts: string[]) => string;
      scenes: (ids: string) => string;
    };
    runSettled: {
      succeeded: (what: string) => string;
      failed: (what: string) => string;
      cancelled: (what: string) => string;
      conflict: (what: string) => string;
    };
    mediaComparison: {
      title: string;
      current: string;
      next: string;
      use: string;
      keep: string;
      noPreview: (path: string) => string;
    };
    olderSpeech: string;
    imageDescription: string;
    imageDescriptionHint: string;
    acceptedImage: string;
    imageHelp: string;
    textHelp: string;
    improveImagePrompt: string;
    improveNarration: string;
    textCandidates: string;
    reviewText: string;
    originalText: string;
    suggestedText: string;
    noOriginalText: string;
    acceptText: string;
    olderText: string;
    matchingText: string;
    mediaTextChanged: string;
    invalidTextCandidate: string;
    textRun: string;
    generateImage: string;
    regenerateImage: string;
    imageCandidates: string;
    acceptImage: string;
    olderImage: string;
    advancedMedia: string;
    audioRun: string;
    imageRun: string;
    speechReady: string;
    speechHelp: string;
    invalidMediaEditor: string;
    mediaTypes: Record<"all" | "audio" | "image" | "video" | "animation", string>;
    speechStatus: Record<
      "running" | "succeeded" | "failed" | "conflict" | "cancelled" | "interrupted",
      string
    >;
    mediaTitle: string;
    previewImage: string;
    loadingImage: string;
    fullImage: string;
    imageZoomHint: string;
    reloadImage: string;
    imageDimensions: (dimensions: string) => string;
    imageUnbound: string;
    imageSaveFirst: string;
    imageUnavailable: string;
    mediaHelp: string;
    planMedia: string;
    rebuildMedia: string;
    mediaManifest: string;
    mediaPathHint: string;
    saveMedia: string;
    mediaCounts: (total: number, bound: number) => string;
    moduleRun: string;
    qualityRun: string;
    testRun: string;
    moduleReady: string;
    specRun: string;
    mediaSpecRun: string;
    assistRun: string;
    previewModule: string;
    previewTitle: string;
    sandboxBuilding: string;
    sandboxBuildAgain: string;
    sandboxLog: string;
    sandboxOpen: string;
    previewScene: string;
    previewSceneDefault: string;
    previewLanguageDefault: string;
    previewResolution: (dimensions: string) => string;
    previewResolutionLabel: string;
    previewResolutionOwn: (dimensions: string) => string;
    newActivity: string;
    openFromModules: {
      title: string;
      help: string;
      loading: string;
      empty: string;
      search: string;
      refs: (count: number) => string;
      open: string;
      opening: string;
      opened: string;
      listHeading: string;
      listHelp: string;
      notOpen: string;
    };
    search: string;
    noMatches: string;
    backToActivities: string;
    title: string;
    create: string;
    productCode: string;
    refNum: string;
    name: string;
    type: string;
    standard: string;
    book: string;
    readingMode: string;
    readingModeHint: string;
    chooseReadingMode: string;
    /** The create dialog's own words: what the learner does first, then the codes, with hints. */
    createActivity: {
      learner: string;
      learnerHint: string;
      learnerPlaceholder: string;
      productCodeHint: string;
      /** Under the ref number the dialog filled in: a new product's first, or the next free one. */
      refFirst: string;
      refNext: string;
    };
    readAlong: string;
    decodable: string;
    empty: string;
    noProject: string;
    unavailable: string;
    description: string;
    saveDescription: string;
    generate: string;
    agent: string;
    wafHarnessAgents: string;
    codingAgents: string;
    codingAgentMedia: string;
    runs: string;
    noRuns: string;
    openSession: string;
    cancel: string;
    candidate: string;
    runErrorFull: string;
    useCandidate: string;
    reload: string;
    loading: string;
    busy: string;
    saved: string;
    unsaved: string;
    discard: string;
    /** Leaving a section whose editor holds unsaved text. */
    discardSection: string;
    /** Before unsaved edits to a scene video's timeline are lost. */
    discardTimeline: string;
    /** Before an uploaded or trimmed file the asset has not saved is lost. */
    discardFile: string;
    /** Before the choices made on the new-ref page are lost. */
    discardRefPlan: string;
    discardTitle: string;
    discardConfirm: string;
    /** A field the author was editing changed in the saved draft; `parts` names them. */
    remoteChanged: (parts: string) => string;
    /** The ways out of a conflict, per thing in conflict. */
    conflict: {
      keepMine: string;
      takeTheirs: string;
      /** The buttons' accessible names, with the part they act on. */
      keepMineFor: (part: string) => string;
      takeTheirsFor: (part: string) => string;
      compareScript: string;
      /** Both versions of a timeline, by how long each plays, in seconds. */
      timelineVersions: (saved: string, mine: string) => string;
    };
    /** The parts `remoteChanged` names. */
    conflictParts: {
      script: string;
      spec: string;
      media: string;
      asset: (key: string) => string;
      timeline: (key: string) => string;
      /** Joins the parts: all but the last, then the last. */
      and: (list: string, last: string) => string;
    };
    saveFirst: string;
    readOnly: string;
    runningHelp: string;
    collection: string;
    breadcrumb: string;
    runningChip: (what: string) => string;
    /** The running chip's action: open the panel that follows the run. */
    followRun: string;
    /** A run's Session transcript, shown in place in History. */
    runTranscript: {
      show: string;
      hide: string;
      /** Accessible name for a run's Show/Hide toggle: distinguishes same-kind runs for assistive tech. */
      toggle: (action: string, run: string, time: string) => string;
    };
    /** The Checks tool: the player check from assembly, the tests and quality, together. */
    checks: {
      /** The tool's mark on the rail, in words. */
      badge: {
        running: string;
        failing: (failing: number, findings: number) => string;
        findings: (count: number) => string;
      };
      player: {
        title: string;
        about: string;
        none: string;
        noBrowser: string;
        notRun: string;
        loadFailed: string;
        /** When the check ran: during the build's assembly. */
        checkedAt: (when: string) => string;
        passed: (count: number) => string;
        failed: (failed: number, total: number) => string;
        skipped: string;
        untrusted: string;
        resultsLabel: string;
        /** The results column that names what each check exercised. */
        scenario: string;
        showAll: (count: number) => string;
      };
    };
    refresh: string;
    status: {
      running: string;
      succeeded: string;
      failed: string;
      conflict: string;
      cancelled: string;
      interrupted: string;
    };
    /**
     * The header's journey: six steps from the script to a deploy, each with its state, and the
     * readiness list behind the one next-step button.
     */
    journey: {
      label: string;
      steps: Record<"script" | "specification" | "media" | "module" | "checks" | "deploy", string>;
      states: {
        saved: string;
        unsaved: string;
        noSpec: string;
        invalid: string;
        notValidated: string;
        validated: string;
        noPlan: string;
        /** Clips with real files, of all the plan holds. */
        clips: (ready: number, total: number) => string;
        ready: (count: number) => string;
        /** How many clips are bound only to a placeholder, said beside the count of real files. */
        placeholders: (count: number) => string;
        /** Once every clip has a file, while kept scene videos failed their check. */
        videosToCheck: (count: number) => string;
        noClips: string;
        building: string;
        notBuilt: string;
        outdated: string;
        built: string;
        builtOn: (date: string) => string;
        checksUnknown: string;
        checksRunning: string;
        checksFailing: (count: number) => string;
        checksFindings: (count: number) => string;
        checksOutdated: string;
        checksNotRun: string;
        checksPartly: string;
        checksPassed: string;
        deploying: string;
        needsModule: string;
        deployUnknown: string;
        onQa: string;
        blocked: string;
        deployFailed: string;
        qaBehind: string;
        deployReady: string;
      };
      /** The next-step button. */
      next: {
        steps: (count: number) => string;
        ready: string;
        deploying: string;
        onQa: string;
        unknown: string;
        /** The same, where the header is as narrow as a phone. */
        short: {
          steps: (count: number) => string;
          ready: string;
          deploying: string;
          onQa: string;
          unknown: string;
        };
      };
      /** The list the button opens. */
      readiness: {
        title: string;
        blocker: string;
        recommendation: string;
        none: string;
        unknown: string;
        deploying: string;
        onQa: string;
        openDeploy: string;
      };
      /** Where an item is fixed, as the press that goes there. */
      go: Record<
        | "script"
        | "specification"
        | "media"
        | "module"
        | "stages"
        | "checks"
        | "deploy"
        | "deployFix",
        string
      >;
      items: {
        buildModule: string;
        moduleBuilding: string;
        buildModuleDetail: string;
        saveScript: string;
        saveSpec: string;
        saveDetail: string;
        writeSpec: string;
        writeSpecDetail: string;
        validateSpec: string;
        validateSpecDetail: string;
        fixSpec: string;
        fixSpecDetail: string;
        planMedia: string;
        planMediaDetail: string;
        bindMedia: string;
        bindMediaDetail: (missing: number, total: number) => string;
        checkVideos: string;
        checkVideosDetail: (count: number) => string;
        replacePlaceholders: (count: number) => string;
        placeholdersDetail: (count: number) => string;
        rebuild: string;
        rebuildDetail: string;
        addCriteria: string;
        addCriteriaDetail: string;
        runChecks: string;
        runBoth: string;
        testsNotRun: string;
        testsOutdated: string;
        qualityNotRun: string;
        fixFindings: string;
        /** What the checks found: failing criteria, open quality findings, failing scenarios. */
        found: (tests: number, findings: number, scenarios: number) => string;
        playerCheck: string;
        playerNoBrowser: string;
        playerNotRun: string;
        qaFailed: string;
        qaFailedDetail: string;
        qaBehind: string;
        qaBehindDetail: string;
      };
      /** A deploy problem's fix, as an instruction; the problem itself is said in its detail. */
      fixes: {
        settings: string;
        clones: string;
        workspace: string;
        remote: string;
        branch: (branch: string) => string;
        canonical: string;
        product: string;
        layout: string;
        git: string;
        moduleRemote: string;
        cloneUnknown: (repo: string) => string;
        cloneRemote: (repo: string) => string;
        cloneDirty: (repo: string) => string;
        cloneAhead: (repo: string) => string;
        cloneStash: (repo: string) => string;
      };
      proposalWaiting: string;
    };
    draftStatus: { draft: string; valid: string; invalid: string };
  };
  codingAgents: {
    agentsTitle: string;
    addAgent: string;
    removeConfirmTitle: string;
    removeConfirmBody: (name: string) => string;
    idLabel: string;
    idHint: string;
    titleLabel: string;
    commandLabel: string;
    commandHint: string;
    argsLabel: string;
    argsHint: string;
    setupRequired: string;
    save: string;
    cancel: string;
    busy: string;
    idle: string;
    loadFailed: string;
  };
  nav: {
    activities: string;
    chat: string;
    newChat: string;
    agents: string;
    models: string;
    machines: string;
    plugins: string;
    usage: string;
    traces: string;
    benchmark: string;
    "coding-agents": string;
    lastConversation: string;
    userSettings: string;
    collapseSidebar: string;
    expandSidebar: string;
    collapseGroup: string;
    expandGroup: string;
    pinGroup: string;
    unpinGroup: string;
    org: {
      overview: string;
      chart: string;
      calendar: string;
      tickets: string;
      finance: string;
      handbook: string;
    };
    unpinEntry: string;
    /** A nav entry's favourite toggle (a star): a favourite stays visible when the collapsible area folds. */
    pinEntry: string;
  };
  quickSwitcher: {
    title: string;
    placeholder: string;
    recentsSection: string;
    pagesSection: string;
    activitiesSection: string;
    loading: string;
    noMatches: string;
    navigateHint: string;
    openHint: string;
    closeHint: string;
  };
  machines: {
    pageTitle: string;
    imageVersion: (version: string) => string;
    noImage: string;
    failedAt: (step: string) => string;
    adminOnly: string;
    check: {
      title: string;
      skipped: (what: string) => string;
      name: {
        ssh: string;
        platform: string;
        tools: string;
        download: string;
        disk: string;
        port: string;
      };
      sshPass: (user: string, host: string) => string;
      ssh: {
        "host-key-unknown": (alias: string) => string;
        "host-key-changed": (alias: string) => string;
        auth: (alias: string) => string;
        "password-rejected": (alias: string) => string;
        "password-not-offered": (alias: string) => string;
        "key-file": (alias: string) => string;
        "host-not-found": (alias: string) => string;
        refused: (alias: string) => string;
        timeout: (alias: string) => string;
        closed: (alias: string) => string;
        "ssh-config": (alias: string) => string;
        other: (alias: string) => string;
      };
      platform: (os: string, arch: string) => string;
      platformWindows: string;
      platformUnsupported: string;
      platformOldGlibc: (glibc: string, need: string) => string;
      platformTerminals: (arch: string, glibc: string, need: string) => string;
      platformMusl: string;
      toolsPass: string;
      toolsNoCurl: string;
      toolsMissing: (tools: string) => string;
      downloadFrom: (version: string, source: "both" | "github" | "oss") => string;
      downloadCarried: (version: string) => string;
      downloadMissing: (version: string) => string;
      diskPass: (free: string) => string;
      diskTight: (free: string) => string;
      diskLow: (free: string, need: string) => string;
      portFree: (port: number) => string;
      portOurs: (port: number) => string;
      portTaken: (port: number) => string;
      sshSaid: (words: string) => string;
    };
    confirm: {
      deleteTitle: (alias: string) => string;
      deleteBody: (alias: string, passwordSaved: boolean) => string;
      stopTitle: (alias: string) => string;
      stopBody: string;
      uninstallTitle: (alias: string) => string;
      uninstallBody: (programDir: string) => string;
      removeData: string;
      removeDataWarning: string;
    };
    detail: {
      describeRemote: (alias: string) => string;
      describeLocal: string;
      newerAvailable: (version: string) => string;
      facts: string;
      progress: string;
      fact: {
        connection: string;
        viaSsh: (alias: string) => string;
        local: string;
        host: string;
        root: string;
        service: string;
        serviceLocal: string;
        running: (port: number) => string;
        stopped: string;
        unreachable: string;
        checked: string;
        installed: string;
        version: string;
        latest: (version: string) => string;
        behind: (version: string, latest: string) => string;
        installedAt: string;
        started: string;
        machineId: string;
      };
      copyMachineId: string;
      lastJobDone: string;
      failedAtStep: (step: string, message: string) => string;
      showLog: string;
      logLabel: string;
      copyLog: string;
      retry: string;
      checking: string;
      toolbar: {
        label: string;
        enable: string;
        update: string;
        stop: string;
        start: string;
        restart: string;
        syncConfig: string;
        configure: string;
        uninstall: string;
      };
      configSync: {
        synced: (ago: string) => string;
        failed: (detail: string) => string;
        envOnly: string;
        skippedTitle: string;
        skippedModel: (model: string, reason: string) => string;
      };
      held: { moving: string; unreachable: string; stopped: string; noImage: string };
      reconnect: {
        title: string;
        lasting: (span: string) => string;
        lastError: string;
        checked: string;
      };
    };
    card: {
      local: string;
      ssh: string;
      updateNeeded: string;
      use: string;
      settings: string;
      syncConfig: string;
      delete: string;
      localUndeletable: string;
      why: {
        stopped: string;
        notConnected: string;
        notInstalled: string;
        failed: string;
        windows: string;
      };
    };
    updateNotice: (count: number) => string;
    composer: {
      reconnecting: string;
      reconnectStopped: string;
      stopped: string;
      notConnected: string;
      missing: string;
      signInRefused: string;
      failed: (message: string) => string;
    };
    detailSocket: string;
    socket: { connected: string; dialling: string; refused: string; failed: string };
    agentsUnreachable: string;
    retry: {
      trying: (n: number, m: number) => string;
      lost: string;
      failed: (n: number, m: number) => string;
      countdown: (seconds: number) => string;
      gaveUp: (m: number) => string;
      stoppedSsh: string;
      stoppedPassword: string;
      retryNow: string;
      retry: string;
    };
    refusedUnknown: (alias: string) => string;
    refusedSelf: (alias: string) => string;
    replaceProgramConfirm: (alias: string) => string;
    replaceProgram: string;
    working: string;
    queued: string;
    stepOf: (step: number, total: number) => string;
    step: {
      build: string;
      check: string;
      install: string;
      handover: string;
      restart: string;
      connect: string;
      sync: string;
      stop: string;
      remove: string;
    };
    phase: {
      build: string;
      check: string;
      install: string;
      handover: string;
      restart: string;
      connect: string;
      sync: string;
      stop: string;
      remove: string;
    };
    state: {
      serving: string;
      queued: string;
      working: string;
      ready: string;
      reconnecting: string;
      reconnectStopped: string;
      failed: string;
      installedOnly: string;
      behind: string;
      notConnected: string;
      unreachable: string;
      stopped: string;
      notInstalled: string;
      unknown: string;
      signInRefused: string;
    };
    updateAllConfirm: (count: number) => string;
    updateAll: (count: number) => string;
    add: string;
    addDialog: {
      title: string;
      intro: string;
      tabs: { config: string; manual: string };
      search: string;
      noHosts: string;
      noMatch: (query: string) => string;
      elsewhere: (version: string) => string;
      installNow: string;
      submit: string;
      submitCount: (count: number) => string;
      added: (count: number) => string;
      addedInstalling: (count: number) => string;
    };
    host: {
      configureVerb: string;
      name: string;
      nameHint: string;
      namePlaceholder: string;
      hostName: string;
      hostNameHint: string;
      hostNamePlaceholder: string;
      user: string;
      userPlaceholder: string;
      port: string;
      portPlaceholder: string;
      identityFile: string;
      identityFileHint: string;
      identityFilePlaceholder: string;
      signIn: string;
      signInKey: string;
      signInPassword: string;
      password: string;
      passwordPlaceholder: string;
      passwordSavedPlaceholder: string;
      passwordDropped: string;
      passwordOneLine: string;
      passwordUnsupported: (ssh: string) => string;
      oneWord: string;
      portRange: string;
      exists: string;
      editTitle: string;
      saved: (alias: string) => string;
      foreign: string;
    };
    sshHint: string;
    noneInUse: string;
    localTitle: string;
    checkoutImageFailed: string;
  };
  terminal: {
    title: string;
    newShell: string;
    shellEntry: string;
    tabsLabel: string;
    killShell: string;
    createFailed: string;
    noTerminalApi: string;
    status: { connecting: string; ready: string; exited: string; error: string };
    exitedWithCode: (code: string) => string;
    touchKeys: {
      label: string;
      esc: string;
      tab: string;
      ctrl: string;
      alt: string;
      up: string;
      down: string;
      left: string;
      right: string;
      interrupt: string;
      paste: string;
      hideKeyboard: string;
      showKeyboard: string;
    };
  };
  dock: {
    addTab: string;
    closeTab: string;
    hideDock: string;
    moveToRight: string;
    moveToBottom: string;
    resize: string;
    rightDock: string;
    bottomDock: string;
    draftEmpty: string;
    killConfirmTitle: string;
    killConfirmBody: (name: string) => string;
    launcher: string;
    launcherCaption: string;
    launcherOpen: string;
    launcherClose: string;
    launcherPending: string;
    launcherPanels: string;
    launcherHide: string;
    launcherHiddenToast: string;
    panelUnavailable: string;
    exitFullscreen: string;
    fullscreen: string;
  };
  tracePanel: { empty: string; emptyHint: string; loadFailed: string };
  settings: {
    language: string;
    languageInfo: string;
    groupPersonal: string;
    groupServer: string;
    profile: string;
    generalTitle: string;
    appearanceTitle: string;
    accountTitle: string;
    importTrace: string;
    importTraceInfo: string;
    importTraceProject: string;
    importTraceAgent: string;
    importTracePick: string;
    importTraceRunning: string;
    importTraceDone: (target: string) => string;
    importTraceTooLarge: string;
    proxyTitle: string;
    proxyInfo: string;
    proxyForApp: string;
    proxyForAgent: string;
    proxyAddress: string;
    proxyAddressPlaceholder: string;
    proxyProbe: string;
    proxyProbeRun: string;
    proxyProbeRunning: string;
    proxyProbeLatency: (ms: number) => string;
    proxyProbeReachableState: string;
    proxyProbeIdle: string;
    proxyProbeFailure: {
      timeout: string;
      dns: string;
      refused: string;
      tls: string;
      network: string;
    };
    uploadLimitsTitle: string;
    attachmentMaxMb: string;
    attachmentTotalMb: string;
    attachmentMaxMbHint: (min: number, max: number) => string;
    attachmentTotalMbHint: (min: number, max: number) => string;
    uploadLimitsInfo: (count: number, imageMb: number) => string;
    theme: string;
    themeInfo: string;
    themeLight: string;
    themeDark: string;
    followSystem: string;
    terminalTheme: string;
    terminalThemeInfo: string;
    followAppTheme: string;
    langEn: string;
    fontSize: string;
    fontSizeInfo: string;
    accent: string;
    accentInfo: string;
    launcher: string;
    launcherInfo: string;
    toolAliases: string;
    toolAliasesInfo: string;
    notifications: string;
    notificationsInfo: string;
    notificationsDenied: string;
    notificationsDismissed: string;
    notificationsUnsupported: string;
    trayIcon: string;
    trayIconInfo: string;
    currencyInfo: string;
    changePasswordInfo: string;
    companyModeTitle: string;
    companyModePersonal: string;
    companyModePersonalInfo: string;
    companyModeServer: string;
    companyModeServerInfo: string;
    /** The scene-videos experiment switch (admin), on the general page. */
    videoExperiment: string;
    videoExperimentInfo: string;
    /** The deploy settings page (admin): where activities are deployed to. */
    deploy: {
      title: string;
      about: string;
      groups: {
        qa: string;
        prod: string;
        jobs: string;
        repos: string;
        git: string;
        timeouts: string;
      };
      jenkinsUrl: string;
      jenkinsUrlHint: string;
      username: string;
      token: string;
      tokenSaved: string;
      tokenForget: string;
      tokenWillClear: string;
      tier: string;
      environment: string;
      frameworkVersion: string;
      frameworkVersionHint: string;
      activityBaseUrl: string;
      activityBaseUrlHint: string;
      moduleBuildJob: string;
      activityDeployJob: string;
      jobHint: string;
      mediaPublicBase: string;
      mediaPublicBaseHint: string;
      gitUserName: string;
      gitUserEmail: string;
      buildMinutes: string;
      deployMinutes: string;
      minutesHint: string;
      invalid: string;
      /** Why the server refused a field, by the reason code it sends; `invalid` for others. */
      reasons: Record<string, string>;
      testConnection: (target: string) => string;
      testing: string;
      testOk: (status: number) => string;
      testFailed: (status: number) => string;
      testNoAnswer: string;
      testUsesSaved: string;
      targets: { qa: string; prod: string };
    };
    /** The test browser page (admin): the Chromium quality checks and tests open players in. */
    testBrowser: {
      title: string;
      about: string;
      /** `version` is the Chromium version, or null when the server could not tell. */
      installed: (version: string | null) => string;
      missing: string;
      /** This copy of WAF Harness cannot install or run it (the desktop app ships no Playwright). */
      unavailable: string;
      location: (path: string) => string;
      install: string;
      installing: string;
      failed: (reason: string) => string;
      reasons: {
        failed: string;
        timed_out: string;
        not_started: string;
        incomplete: string;
      };
      logLabel: string;
    };
    wafWorkspace: {
      title: string;
      about: string;
      confineAgents: string;
      confineAgentsInfo: string;
      confineAgentsReady: string;
      confineAgentsOff: string;
      confineAgentsUnavailable: string;
      confineAgentsSaved: (on: boolean) => string;
      confineAgentsLoadFailed: (reason: string) => string;
      runLimit: string;
      runLimitInfo: string;
      /** The pick that leaves every kind of run its own limit. */
      runLimitDefault: string;
      /** One limit the picker offers, in whole minutes. */
      runLimitMinutes: (minutes: number) => string;
      ready: string;
      notReady: string;
      preparing: string;
      prepared: string;
      external: (root: string) => string;
      externalMissing: (root: string) => string;
      failed: (reason: string) => string;
      prepare: string;
      logLabel: string;
      repos: Record<"framework" | "navbar" | "media" | "activityData", string>;
      repo: {
        missing: string;
        noRemote: string;
        otherRemote: (remote: string) => string;
        otherBranch: (branch: string) => string;
        noBranch: string;
        notInstalled: string;
        cloned: (branch: string | null, dirty: boolean) => string;
      };
      sources: string;
      remote: (name: string) => string;
      branch: string;
      moduleRemote: string;
      moduleRemoteHint: string;
      existing: string;
      externalRoot: string;
      externalRootPick: string;
      externalRootMenuHint: string;
      externalRootClear: string;
      externalRootHint: string;
      monorepo: string;
      modulesRoot: string;
      modulesRootPick: string;
      modulesRootClear: string;
      modulesRootHint: string;
      modulesReading: (dir: string) => string;
      modulesMissing: (dir: string) => string;
      invalid: string;
    };
    accentNames: Record<string, string>;
    companyModeOffBody: string;
    companyModeOff: string;
    /** Asked before the master switch goes off (turning it on does not ask). */
    companyModeOffTitle: string;
    fontSystem: string;
    fontFollowTheme: string;
    fontCjk: string;
    fontLatin: string;
    fontsInfo: string;
    fonts: string;
    textSizeNames: { xs: string; s: string; m: string; l: string; xl: string };
    colorModeInfo: string;
    colorMode: string;
    themeNames: { github: string; modern: string; geek: string };
    background: {
      title: string;
      info: string;
      choose: string;
      replace: string;
      remove: string;
      loading: string;
      preview: string;
      transparency: string;
      mode: string;
      modes: { cover: string; contain: string; tile: string; original: string };
      position: string;
      positions: {
        "left top": string;
        "center top": string;
        "right top": string;
        "left center": string;
        "center center": string;
        "right center": string;
        "left bottom": string;
        "center bottom": string;
        "right bottom": string;
      };
      fileError: string;
      readError: string;
      storageError: string;
    };
    /** Asked when the Sandbox switch is turned on and the machine has no sandbox backend. */
    sandboxBackendPrompt: {
      title: string;
      body: (machine: string, pkgs: readonly string[]) => string;
      cost: string;
      install: string;
      installing: string;
      later: string;
      dontAsk: string;
      noProject: string;
    };
    /** One line of a row's "?" that lists its values: a choice column's value, and what it does. */
    pluginTableRowValue: (column: string, value: string, does: string | undefined) => string;
    pluginTableDeleteChosen: string;
    pluginTableDelete: string;
    pluginTableChosen: string;
    /** The row menu's items: make the row the chosen one, and delete a row an administrator added. */
    pluginTableChoose: string;
    pluginTableRowMenuHint: string;
    /** A table row's "…" button: its accessible name and tooltip. */
    pluginTableRowMenu: (row: string) => string;
    /** After the chosen row's name (the sandbox's default preset): the row choice's title. */
    pluginTableChosenMarker: (title: string) => string;
    /** The add button under an extensible table that names none of its own. */
    pluginTableAdd: string;
    pluginTableMoveHint: string;
    /** A table row's drag handle: what it moves, and how. */
    pluginTableMove: (row: string) => string;
    pluginCellOff: string;
    pluginCellOn: string;
    /** A table cell its row does not let change, beside the lock mark. */
    pluginCellLocked: string;
    /** The fold holding the fields a settings group marks advanced. */
    pluginAdvanced: string;
    /** Under a number field whose box does not parse; the save is not sent. */
    pluginFieldNotNumber: string;
    /** `machine` is the picked machine's name, null for this server. */
    pluginActionConfirm: (action: string, machine: string | null) => string;
    pluginActionRun: string;
    /** A plugin group's action: it runs once on the picked machine, and only the plugin knows what it does. */
    pluginActionTitle: string;
    /** The Plugins settings page's machine picker: each server keeps its own plugin settings. */
    pluginConfigMachine: string;
    pluginSecretClear: string;
    /** A secret field with a stored value: submitting it empty keeps the stored one. */
    pluginSecretKeepHint: string;
    /** The page's own switch, above the server's cards: a display preference of this browser. */
    pluginsIncompatibleOnly: string;
    pluginsInfo: string;
    pluginPositionOff: string;
    pluginPositionOn: string;
    /** A switch one of whose positions this machine cannot honour, under the switch. */
    pluginPositionUnavailable: (position: string, reason: string) => string;
    /** An enum option this machine cannot honour, listed greyed out. */
    pluginOptionUnavailable: (title: string, reason: string) => string;
    /** Admin-only sub-page (server-global): the options loaded plugins declare. */
    pluginsTitle: string;
    /** Under the two switches while the address has unsaved edits: they act on the saved address. */
    saveProxyAddressFirst: string;
    /** The Shortcuts page's "?": what follows the platform, where bindings live, and the browser's own claims. */
    shortcutsInfo: string;
    archivedInfo: string;
    archivedTitle: string;
    shortcutsTitle: string;
    agentApiOff: string;
    agentApiOffConfirm: string;
    agentApiOffTitle: string;
    agentApiHint: string;
    agentApiToggle: string;
    agentApiTitle: string;
    chromeExtensionInfo: string;
    chromeExtensionTitle: string;
    browserTitle: string;
    /** Sidebar user-menu row opening the Settings dialog, and that dialog's title. */
    title: string;
  };
  update: {
    lastUpdated: (date: string) => string;
    newVersionBadge: string;
    badgeDownloading: string;
    badgeReady: string;
    newVersion: (v: string) => string;
    restartToUpdate: (v: string | null) => string;
    updatesAvailable: string;
    checkNow: string;
    checking: string;
    rowDownloading: (v: string | null, percent: number | null) => string;
    rowRestarting: string;
    title: string;
    checkingBody: string;
    upToDate: string;
    checkFailed: string;
    checkDisabled: string;
    releaseNotes: string;
    openReleases: string;
    availableBodyRelease: string;
    availableBodyClient: string;
    adminOnly: string;
    downloadAndInstall: string;
    downloading: (v: string | null) => string;
    downloadProgress: string;
    phaseResolving: string;
    phaseDownloading: string;
    phaseInstalling: string;
    ready: (v: string | null) => string;
    readyBodyRelease: string;
    readyBodyClient: string;
    readyBodyManual: string;
    restartNow: string;
    restarting: string;
    restartingBodyRelease: string;
    restartingBodyClient: string;
    failed: string;
    retry: string;
    unsupportedDev: string;
    unsupportedNonAppImage: string;
    unsupportedNotViaCli: string;
    unsupportedCli: string;
    noReleases: (repository: string) => string;
    foundNew: (v: string) => string;
    foundNewUnnamed: string;
    readyToast: (v: string | null) => string;
    failedToast: string;
    unsupportedToast: string;
    clientUpdateFailed: (detail: string) => string;
    requestFailed: (detail: string) => string;
    restartTimedOut: string;
    restartTimedOutClient: string;
    /** The shell was asked to restart into the downloaded build and this window is still here. */
    readyBodyManualClient: string;
    /** Nothing is known yet: no check has answered since the page loaded. */
    notChecked: string;
    unresponsiveHint: string;
  };
  todo: {
    pluginUpdates: (n: number) => string;
    presetUpdates: (n: number) => string;
    unexpectedErrors: (n: number) => string;
    pending: string;
    dismiss: string;
    markRead: string;
    changesUpgradable: (updated: number) => string;
    updateNow: string;
    willTouch: string;
    agentsConfirmTitle: (n: number) => string;
    pluginsConfirmTitle: (n: number) => string;
    pluginsConfirmBody: string;
    modelsConfirmTitle: (n: number) => string;
    bulkDone: (ok: number) => string;
    bulkPartial: (ok: number, failed: string) => string;
    listSeparator: string;
  };
  notify: {
    taskCompleteTitle: string;
    taskCompleteBody: (session: string) => string;
    enabledBody: string;
    enabledTitle: string;
  };
  common: {
    save: string;
    cancel: string;
    close: string;
    create: string;
    delete: string;
    edit: string;
    settings: string;
    confirm: string;
    gotIt: string;
    loading: string;
    saved: string;
    saving: string;
    noChangesToSave: string;
    confirmSaveTitle: string;
    confirmSaveBody: string;
    none: string;
    retry: string;
    unknownError: string;
    requiredField: string;
    copy: string;
    copied: string;
    moreInfo: string;
    moreInfoAbout: (subject: string) => string;
    name: string;
    username: string;
    role: string;
    actions: string;
    created: string;
    cost: string;
    time: string;
    nextPage: string;
    /** A pager's two steps, as their names and tooltips (the shared UI package's `Pager`). */
    previousPage: string;
    /** Read after a toast's text: pressing the toast dismisses it. */
    dismiss: string;
    /** The toast stack's name as a live region (the shared UI package's `Toaster`). */
    notifications: string;
    /** A page form's button beside Save: puts every field back to what is stored, without asking. */
    reset: string;
    keepEditing: string;
    discard: string;
    discardBody: string;
    /**
     * The one prompt every way of leaving a form with unsaved edits shows (the shared UI
     * package's UnsavedChangesHost): its accessible name, the question, the danger button that
     * discards and leaves, and the button that stays with the edits.
     */
    discardTitle: string;
  };
  semanticId: {
    generateIdLabel: string;
    generateId: string;
    idGenerateHint: string;
    idSuggest: {
      fromName: string;
      placeholder: (reason: string) => string;
      reasons: {
        no_default_model: string;
        model_failed: string;
        unusable_answer: string;
        no_ascii: string;
      };
      reasonUnknown: string;
    };
  };
  auth: {
    usernameHint: string;
    password: string;
    passwordHint: string;
    showPassword: string;
    hidePassword: string;
    login: string;
    logout: string;
    logoutConfirmTitle: string;
    logoutConfirmBody: string;
    admin: string;
    defaultAdminNote: string;
    forgotAdminNote: string;
    claimFailedTitle: string;
    claimFailedDesktop: string;
    claimFailedServer: string;
  };
  profile: {
    avatar: string;
    avatarInfo: string;
    changeAvatar: string;
    restoreDefault: string;
    restoreDefaultOf: (subject: string) => string;
    avatarTooLarge: string;
    avatarUnreadable: string;
    displayName: string;
    displayNamePlaceholder: string;
    displayNameInfo: string;
    /** Asked before the avatar's restore: the uploaded picture is deleted, unlike the nickname's. */
    avatarResetConfirm: string;
    useAvatar: string;
    cropZoom: string;
    cropAvatarHint: string;
    cropAvatar: string;
  };
  account: {
    changePassword: string;
    oldPassword: string;
    oldPasswordHint: string;
    newPassword: string;
    confirmPassword: string;
    passwordMismatch: string;
    initialPasswordBanner: string;
    changeNow: string;
  };
  admin: {
    users: string;
    roleAdmin: string;
    roleUser: string;
    createUser: string;
    initialPassword: string;
    initialPasswordFlag: string;
    defaultProjectNote: (id: string) => string;
    resetPassword: string;
    resetPasswordTitle: (u: string) => string;
    resetPasswordNote: string;
    deleteUserTitle: (u: string) => string;
    deleteUserConfirm: (u: string) => string;
    /** The Activity storage page (admin): run folders' disk, and cleaning them up by hand. */
    runCleanup: {
      title: string;
      about: string;
      storage: string;
      storageInfo: string;
      storageLine: (bytes: string, folders: number) => string;
      keepNewest: string;
      keepNewestInfo: string;
      keepNewestHint: (min: number, max: number) => string;
      orphanTakes: string;
      orphanTakesInfo: string;
      check: string;
      cleanUp: string;
      planHeading: string;
      categories: Record<"stagedCopies" | "olderRuns" | "orphanTakes", string>;
      folders: (count: number) => string;
      files: (count: number) => string;
      nothing: string;
      unread: (count: number) => string;
      takesUnavailable: string;
      confirmTitle: string;
      confirmBody: string;
      confirmNote: string;
      confirmLabel: string;
      removed: (bytes: string) => string;
      keptSincePlan: (count: number) => string;
      leftInPlace: (count: number) => string;
    };
    /** The Activity outcomes page (admin): the outcome ledger, read. */
    activityOutcomes: {
      title: string;
      about: string;
      kind: string;
      project: string;
      allProjects: string;
      groupBy: string;
      byRecipe: string;
      byRuntime: string;
      window: string;
      windows: Record<"7d" | "30d" | "90d" | "all", string>;
      columns: {
        recipe: string;
        runtime: string;
        runs: string;
        succeeded: string;
        repaired: string;
        accepted: string;
        edits: string;
        reverted: string;
        deployed: string;
        untrusted: string;
      };
      /** What the less obvious columns count, disclosed beside their headings. */
      columnInfo: { repaired: string; edits: string; untrusted: string };
      /** A recipe's parts under its runtime: WAF Harness's version, its skills, its harness. */
      recipeDetail: (wafh: string, skills: string, harness: number | null) => string;
      noSkills: string;
      /** A tally of runs whose recipes have no such part. */
      noKey: string;
      rate: (count: number, percent: number) => string;
      empty: string;
      loadFailed: (reason: string) => string;
      /** The accessible name of a row's toggle, which lists its runs. */
      showRuns: (name: string) => string;
      runsTitle: (name: string) => string;
      /** Under the runs list: only the newest are listed. */
      runsLimited: (count: number) => string;
      runsEmpty: string;
      runColumns: { started: string; project: string; activity: string; status: string };
      /** How a run ended, as the ledger records it: every status, so none shows unworded. */
      runStatus: Record<ActivityRunStatus, string>;
      history: string;
      historyTitle: (runId: string) => string;
      historyEmpty: string;
      /** The ledger's facts by name: every one, so none shows unworded. */
      facts: Record<OutcomeFactName, string>;
    };
  };
  project: {
    selectProject: string;
    switcher: string;
    create: string;
    createTitle: string;
    id: string;
    idHint: string;
    idPrefixHint: string;
    displayName: string;
    displayNameHint: string;
    settings: string;
    settingsTitle: string;
    members: string;
    addMember: string;
    removeMember: string;
    chatDefaultsTitle: string;
    chatDefaultsHint: string;
    chatDefaultsAgent: string;
    chatDefaultsNotSet: string;
    chatDefaultsApprovalNotSet: string;
    chatDefaultsThinkingNotSet: string;
    chatDefaultsModelHint: string;
    settingsTabGeneral: string;
    settingsTabMembers: string;
    settingsTabDefaults: string;
    settingsTabSecurity: string;
    projectIdLabel: string;
    deleteProjectDesc: string;
    commandPolicyInfo: string;
    commandPolicyEnable: string;
    commandPolicyEnableDesc: string;
    commandPolicyRules: string;
    commandPolicyRestore: string;
    commandPolicyAddRule: string;
    commandPolicyEditRule: string;
    commandPolicyApplyRule: string;
    commandPolicyEmpty: string;
    commandPolicyOn: string;
    commandPolicyOff: string;
    commandPolicyRuleName: string;
    commandPolicyRulePattern: string;
    commandPolicyRuleDesc: string;
    commandPolicyInvalidPattern: string;
    deleteProject: string;
    deleteConfirm: string;
    deleteDefaultForbidden: string;
    deleteLastForbidden: string;
    noCredentialTitle: string;
    noCredentialBody: string;
    goToModels: string;
    later: string;
    /** Buffered like every edit (Save writes it), but it replaces the whole list in one click. */
    commandPolicyRestoreConfirm: string;
    removeMemberConfirm: (user: string) => string;
    removeMemberTitle: string;
  };
  aiCreate: {
    withAi: string;
    manual: string;
    editInChat: string;
    copyPrompt: string;
    examplesTitle: string;
    fullPrompt: string;
    byAgent: (name: string) => string;
    chooseAgent: string;
    placeholder: string;
    promptLabel: string;
    noAgent: string;
  };
  agent: {
    savedTakesEffect: string;
    savedTakesEffectNow: string;
    takesEffectSuffix: string;
    listTitle: string;
    searchPlaceholder: string;
    searchEmpty: string;
    create: string;
    createTitle: string;
    id: string;
    idHint: string;
    idGenerateHint: string;
    nameHint: string;
    description: string;
    createPlugins: string;
    createPluginsPlaceholder: string;
    createPluginsPicked: (n: number) => string;
    createPluginsHint: string;
    createPluginsEmpty: string;
    createSkillsPlaceholder: string;
    createSkillsPicked: (n: number) => string;
    createDirSkills: string;
    createDirSkillsPick: string;
    createDirSkillsHint: string;
    createDirSkillsEmpty: string;
    createDirSkillsFound: (n: number) => string;
    createDirSkillsClear: string;
    createSnapshot: string;
    createSnapshotPick: string;
    createSnapshotHint: string;
    createSnapshotSkillsOff: string;
    createSnapshotClear: string;
    aiCreateTitle: string;
    aiCreateIntro: string;
    aiCreatePlaceholder: string;
    aiExamples: { key: string; label: string; description: string; prompt: string }[];
    aiCreateTail: string;
    firstAgentTitle: string;
    firstAgentDesc: string;
    sessionCount: (n: number) => string;
    toolCount: (n: number) => string;
    vaultKeyCount: (n: number) => string;
    scheduleCount: (n: number) => string;
    memoryCount: (n: number) => string;
    updatedAt: string;
    activity: (days: number) => string;
    settings: string;
    backToList: string;
    tabOverview: string;
    tabPrompt: string;
    tabMemory: string;
    tabRuntime: string;
    tabTools: string;
    tabSkills: string;
    tabHooks: string;
    tabVault: string;
    tabSchedules: string;
    stateDir: string;
    copyStateDir: string;
    agentsMd: string;
    systemPrompt: string;
    placeholdersTitle: string;
    insertPlaceholder: string;
    placeholders: ReadonlyArray<readonly [string, string]>;
    maxTurns: string;
    maxTokens: string;
    timeoutMs: string;
    timeoutMsHint: string;
    compaction: string;
    maxContextLength: string;
    maxContextLengthHint: string;
    maxSessionTurns: string;
    maxSessionTurnsHint: string;
    compactionMode: string;
    compactionModeOptions: ReadonlyArray<readonly [string, string]>;
    compactionPrompt: string;
    toolFieldInvalid: (name: string, field: string) => string;
    toolPermission: string;
    permissionReadLabel: string;
    permissionReadDescription: string;
    permissionReadWriteLabel: string;
    permissionReadWriteDescription: string;
    toolTimeout: string;
    toolMaxOutput: string;
    toolCallDescription: string;
    callDescriptionHint: string;
    mcpServers: string;
    mcpDesc: string;
    mcpEmpty: string;
    mcpAdd: string;
    mcpEditTitle: string;
    mcpRemove: string;
    mcpName: string;
    mcpNameHint: string;
    mcpTransport: string;
    mcpTransportStdio: string;
    mcpTransportHttp: string;
    mcpTransportSse: string;
    mcpTarget: string;
    mcpCommand: string;
    mcpArgs: string;
    mcpArgsHint: string;
    mcpEnv: string;
    mcpEnvHint: string;
    mcpCwd: string;
    mcpCwdHint: string;
    mcpUrl: string;
    mcpHeaders: string;
    mcpHeadersHint: string;
    mcpPermission: string;
    mcpPermissionAuto: string;
    mcpPermissionAutoLabel: string;
    mcpPermissionAutoDescription: string;
    mcpPermissionReadDescription: string;
    mcpPermissionReadWriteDescription: string;
    mcpPermissionHint: string;
    mcpConnectTimeout: string;
    mcpBudgetsHint: string;
    mcpNameInvalid: string;
    mcpUrlInvalid: string;
    mcpLineInvalid: (line: number) => string;
    mcpNumberInvalid: string;
    mcpDuplicateName: string;
    mcpTest: string;
    mcpTesting: string;
    mcpTestOk: (toolCount: number, latencyMs?: number) => string;
    mcpTestFail: (detail: string) => string;
    mcpTestAllConfirm: (n: number) => string;
    mcpTestAllStart: string;
    mcpTestPending: string;
    mcpTestBadge: (toolCount: number, latencyMs?: number) => string;
    mcpTestBadgeFail: string;
    mcpDeleteTitle: string;
    mcpDeleteConfirm: (name: string) => string;
    defaultValue: string;
    deleteAgent: string;
    builtinUndeletable: string;
    deleteConfirm: (name: string) => string;
    stateTitle: string;
    stateVersion: string;
    transferDesc: string;
    exportSnapshot: string;
    importSnapshot: string;
    importing: string;
    importDone: (v: number) => string;
    importConflictTitle: string;
    importConflictBody: string;
    resetConfigTitle: string;
    resetConfigAction: string;
    resetConfigConfirmBody: string;
    resetConfigDone: string;
    kernelTitle: string;
    kernelLegacy: string;
    kernelOutdatedHint: string;
    kernelUpdateNeeded: string;
    kernelUpToDate: string;
    kernelUpdateTitle: string;
    kernelCurrent: string;
    kernelLatest: string;
    kernelUpdateAction: string;
    kernelUpdateConfirmBody: string;
    kernelUpdateDone: (version: string, advanced: number) => string;
    kernelUpdateKeptIntro: string;
    kernelListSeparator: string;
    apiTryStreamBroken: string;
    apiTryElapsed: string;
    apiTryCacheWrite: string;
    apiTryCacheRead: string;
    apiTryTokens: string;
    apiTryRequests: string;
    apiTryStatus: string;
    apiTryEmpty: string;
    apiTryCopyRaw: string;
    apiTryRaw: string;
    apiTryRendered: string;
    apiTryNewSession: string;
    apiTryFollowUp: string;
    apiTryStop: string;
    apiTryRun: string;
    apiTryExample: string;
    apiTryHint: string;
    apiTry: string;
    apiOn: string;
    apiOff: string;
    apiOffBody: string;
    apiOffTitle: string;
    apiOpenConfirm: string;
    apiOpenBody: string;
    apiOpenTitle: string;
    apiExamples: string;
    apiOpenHint: string;
    apiOpen: string;
    apiDeleteKeyBody: (name: string) => string;
    apiDeleteKey: string;
    apiKeyDone: string;
    apiCopySecret: string;
    apiKeyShownOnce: string;
    apiKeyNever: string;
    apiKeyLastUsed: string;
    apiKeyCreated: string;
    apiKeyName: string;
    apiNewKey: string;
    apiKeysEmpty: string;
    apiKeys: string;
    apiCopy: (what: string) => string;
    apiAgentId: string;
    apiBaseUrlOnMachine: (machine: string) => string;
    apiBaseUrl: string;
    apiConnection: string;
    apiApprovalModeHint: string;
    apiApprovalMode: string;
    apiSessionSettingsHint: string;
    apiSessionSettings: string;
    apiAgentPrompt: (docsUrl: string, baseUrl: string, agentRef: string) => string;
    apiCopyAgentPrompt: string;
    apiReadDocs: string;
    apiConcurrencyInvalid: string;
    apiConcurrencyHint: string;
    apiConcurrency: string;
    apiRunLimits: string;
    apiAdminOff: string;
    apiOwnerOnly: string;
    apiEnableHint: string;
    apiEnable: string;
    /** Asked before every snapshot import; the server snapshots the current version first and keeps the Vault. */
    importConfirmBody: (file: string) => string;
    employeeMark: (employments: ReadonlyArray<{ orgName: string; title: string }>) => string;
    employedUndeletable: (employments: ReadonlyArray<{ orgName: string; title: string }>) => string;
    employmentLine: (orgName: string, title: string) => string;
    employeesSectionInfo: string;
    employeesSection: string;
    deleteConfirmOnMachine: (name: string, machine: string) => string;
    usageThisServerOnly: string;
    onMachineHint: (machine: string) => string;
    mcpRemoveFromPlugin: (plugin: string) => string;
    mcpFromPlugin: (plugin: string) => string;
    mcpInstalledBy: (plugin: string) => string;
    mcpTestSaveFirstBadge: string;
    mcpTestSaveFirst: string;
    mcpTestAll: string;
    deleteToolBody: (name: string) => string;
    deleteToolNamed: (name: string) => string;
    deleteTool: string;
    numberCannotClear: string;
    numberInvalid: string;
    compactionModeNames: Readonly<Record<string, string>>;
    maxTurnsHint: string;
    tabApi: string;
    tabWorkbenches: string;
    createStdioQuestion: (agent: string) => string;
    createLocationInfo: string;
    createLocationHere: string;
    createLocation: string;
  };
  models: {
    title: string;
    addCustom: string;
    addToGroup: string;
    editTitle: string;
    addTitle: string;
    addProtocolHintPinned: (protocol: string) => string;
    autoRouteNone: string;
    useCustomGroup: string;
    addGroup: string;
    addGroupTitle: string;
    addGroupDesc: string;
    groupModeCreate: string;
    groupModeImport: string;
    groupImportAll: string;
    groupImportNeedUrl: string;
    groupImportKeyHint: string;
    groupImportListing: string;
    groupImportSaving: (n: number) => string;
    groupImportUnsupported: string;
    groupImportFailed: string;
    groupImportEmpty: string;
    groupImported: (added: number, skipped: number) => string;
    groupNameLabel: string;
    groupNameHint: string;
    groupNameInvalid: string;
    groupNameExists: string;
    groupEmptyHint: string;
    deleteGroup: string;
    deleteGroupTitle: string;
    deleteGroupConfirm: (label: string, n: number) => string;
    groupDeleted: (n: number) => string;
    searchPlaceholder: string;
    noSearchResults: string;
    aiAddTitle: string;
    aiAddIntro: string;
    aiAddPlaceholder: string;
    aiAddExamples: { key: string; label: string; description: string; prompt: string }[];
    aiAddTail: (projectId: string) => string;
    homepage: string;
    speedTest: string;
    speedTestTitle: string;
    speedTestConfirm: (n: number) => string;
    speedTestStart: string;
    speedPending: string;
    speedFailed: string;
    ttftTitle: string;
    tpsTitle: string;
    modelCount: (n: number) => string;
    modelId: string;
    modelIdHint: string;
    displayName: string;
    displayNameHint: string;
    providerGroup: string;
    contextWindow: string;
    tokenUnit: string;
    contextWindowHint: string;
    maxTokens: string;
    maxTokensHint: string;
    maxTokensTitle: string;
    maxTokensInvalid: string;
    clientTypeLocked: (t: string) => string;
    protocol: string;
    protocolNames: Record<string, string | undefined>;
    protocolTriggerTitle: (name: string) => string;
    protocolUnset: string;
    detectProtocol: string;
    detectProtocolHint: string;
    detecting: string;
    detectedProtocol: (name: string) => string;
    detectedProtocolAndUrl: (protocol: string, url: string) => string;
    detectFailedBody: string;
    detectFellBack: string;
    addProtocolHintDetect: string;
    vision: string;
    detectVision: string;
    detectingVision: string;
    detectVisionHint: string;
    detectVisionNeedsId: string;
    detectVisionOk: string;
    detectVisionNo: string;
    visionOffProxyHint: string;
    fastMode: string;
    fastModeHint: string;
    fastModeUnsupported: string;
    fastModeConfirmTitle: string;
    fastModeConfirmBody: string;
    fastModeConfirmPreview: string;
    fastModeBadge: string;
    visionBadge: string;
    freeBadge: string;
    recommendedGroup: string;
    discountBadge: (pct: number) => string;
    discountTitle: (pct: number) => string;
    offPeakTitle: (pct: number, peak: PeakWindows) => string;
    visionModelBadge: string;
    usedTokens: (v: string) => string;
    usedTokensTitle: string;
    setVisionModel: string;
    visionModelHint: string;
    priceUnitShort: string;
    testConnection: string;
    testing: string;
    testOk: (ms: number) => string;
    testFailed: (msg: string) => string;
    priceCacheRead: string;
    priceCacheWrite: string;
    priceOutput: string;
    promotionPriceHint: (pct: number) => string;
    currency: string;
    currencyUsd: string;
    currencyCny: string;
    apiKey: string;
    apiKeyKeepHint: string;
    apiKeyEnvHint: (envKey: string) => string;
    keyConfigured: string;
    clearApiKey: string;
    baseUrl: string;
    baseUrlSuffixTitle: string;
    baseUrlRequired: string;
    contextWindowDefaultHint: (n: number) => string;
    confirmDeleteTitle: string;
    confirmDelete: (name: string) => string;
    getApiKey: string;
    getModelIds: string;
    oauthKey: string;
    viewLocalCli: string;
    viewBuiltin: string;
    viewApiProviders: string;
    builtinIntro: string;
    builtinCopilotAbout: string;
    builtinDownloadSize: (mb: number) => string;
    builtinTokenLabel: string;
    builtinTokenHint: string;
    builtinTokenCreate: string;
    builtinTerms: string;
    builtinTermsLink: string;
    builtinSetup: string;
    builtinDownloading: (percent: number | null) => string;
    builtinCancel: string;
    builtinReady: (version: string) => string;
    builtinUpdateAvailable: (installed: string, pinned: string) => string;
    builtinUpdate: string;
    builtinRetry: string;
    builtinReplaceToken: string;
    builtinReplaceTokenTitle: string;
    builtinToken: (masked: string) => string;
    builtinRemove: string;
    builtinRemoveTitle: string;
    builtinRemoveBody: string;
    builtinPatHint: string;
    cliEnv: string;
    cliEnvHint: string;
    cliEnvEmpty: string;
    cliEnvAdd: string;
    cliEnvAddTitle: string;
    cliEnvKey: string;
    cliEnvValue: string;
    cliEnvRemove: string;
    cliEnvSaved: string;
    cliEnvPending: string;
    cliEnvKeyInvalid: string;
    cliEnvKeyReserved: string;
    cliEnvValueRequired: string;
    cliEnvOverwriteTitle: string;
    cliEnvOverwriteBody: (key: string) => string;
    cliEnvRemoveTitle: string;
    cliEnvRemoveBody: (key: string) => string;
    localCliIntro: string;
    installedClis: (n: number) => string;
    availableClis: (n: number) => string;
    cliRescan: string;
    cliScanning: string;
    cliAddAgent: string;
    cliModel: string;
    cliEffort: string;
    cliDefault: string;
    cliReady: string;
    cliSignInRequired: string;
    cliNeedsSetup: string;
    cliWontStart: string;
    cliProbeFailed: (name: string, message: string) => string;
    cliProbeFailedPlain: (name: string) => string;
    cliReadingModels: string;
    cliNoModels: string;
    cliInstallSteps: string;
    cliInstallStepsMember: string;
    cliCopyInstall: (name: string) => string;
    cliSignInUnknown: string;
    cliSignInUnknownTitle: string;
    cliReadyCount: (ready: number, total: number) => string;
    cliSignInHint: (hint: string) => string;
    cliStartChat: string;
    cliRemove: string;
    cliInstall: string;
    cliNone: string;
    cliScanFailed: string;
    cliModelSummary: (name: string) => string;
    cliTest: string;
    cliTesting: string;
    cliRetest: string;
    cliTestOk: (name: string, ms: number, reply: string) => string;
    cliTestStart: (name: string, message: string) => string;
    cliTestTimeout: (name: string) => string;
    cliTestFailed: (name: string, message: string) => string;
    cliTestReply: (name: string, reply: string) => string;
    accessAll: string;
    accessApiKey: string;
    accessSubscription: string;
    noAccessResults: string;
    copilotConnect: string;
    chatgptConnect: string;
    chatgptDisconnect: string;
    chatgptDisconnected: string;
    chatgptDisconnectBody: string;
    chatgptIntro: string;
    chatgptCode: string;
    chatgptApplyFailed: string;
    chatgptApplied: (count: number) => string;
    copilotDisconnect: string;
    copilotDisconnectBody: string;
    copilotDisconnected: string;
    copilotIntro: string;
    copilotCode: string;
    copilotApplyFailed: string;
    copilotTimedOut: string;
    copilotApplied: (count: number) => string;
    oauthTitle: (label: string) => string;
    oauthIntro: (label: string, n: number) => string;
    oauthAuthorize: string;
    oauthWaiting: string;
    oauthAppliedBody: (provider: string, n: number) => string;
    oauthManualSwitch: string;
    oauthCallbackSwitch: string;
    oauthManualHint: string;
    oauthCodeLabel: string;
    oauthSubmitCode: string;
    oauthTimedOut: string;
    oauthRetry: string;
    oauthErrors: {
      invalid_request: string;
      code_rejected: string;
      upstream_failed: string;
      unreachable: string;
      apply_failed: string;
    };
    platformKeyIntro: (n: number) => string;
    platformKeyAppliedBody: (n: number) => string;
    platformKeyStarting: string;
    platformKeyApplying: string;
    platformKeyErrors: {
      unreachable: string;
      upstream_failed: string;
      invalid_key: string;
      expired: string;
      locked: string;
      already_delivered: string;
      apply_failed: string;
    };
    providerEnvNotes: Record<string, string | undefined>;
    envBaseUrlNote: (envBaseUrlKey: string) => string;
    confirmVisionModelTitle: string;
    confirmVisionModel: (name: string) => string;
    confirmDefaultTitle: string;
    confirmDefault: (name: string) => string;
    default: string;
    setDefault: string;
    remove: string;
    readOnlyHint: string;
    empty: string;
    noKey: string;
    readFromEnv: string;
    showModelsWithoutKey: (n: number) => string;
    modelIdExists: string;
    pricingAllOrNone: string;
    pricingInvalid: string;
    contextWindowInvalid: string;
    confirmCancelPromotion: (name: string, pct: number) => string;
    confirmCancelPromotionTitle: string;
    addAction: string;
    modelScopeKeyErrors: {
      unreachable: string;
      upstream_failed: string;
      invalid_key: string;
      expired: string;
      locked: string;
      already_delivered: string;
      apply_failed: string;
    };
    modelScopeKeyAppliedBody: (n: number) => string;
    modelScopeKeyIntro: (n: number) => string;
    /** The banner above every group: TokenDance's own connect flow, pitched as the way to skip keys. */
    tokenDanceBanner: string;
    unpinBalance: string;
    /** The balance menu's pin: keeps it beside the user name at the sidebar's bottom-left, one at a time. */
    pinBalance: string;
    /** Appended when the vendor answered with an HTTP error. */
    balanceStatus: (status: number) => string;
    /** Why no balance could be read, by the server's code: the reason after balanceFailed's prefix. */
    balanceErrors: Record<string, string | undefined>;
    /** Added to the tooltip when the vendor says the account cannot make requests (DeepSeek's is_available). */
    balanceUnavailable: string;
    balanceFailed: (reason: string) => string;
    balanceUpdatedAt: (time: string) => string;
    balanceRefresh: string;
    /**
     * A group's account balance in its header (and pinned beside the user name): the sentence
     * spoken behind the amount names the group, the vendor's own figures and the time of the
     * reading. `amounts` and `time` are already formatted.
     */
    balanceTitle: (label: string, amounts: string, time: string) => string;
    disconnected: (label: string) => string;
    disconnectConfirm: (label: string) => string;
    disconnect: string;
    reconnect: string;
    syncModels: string;
    notConnectedStatus: string;
    connectedStatus: string;
    keyFromGroup: string;
    details: string;
    keyNotReachedNote: string;
    inheritFromGroup: string;
    protocolFixedHint: (group: string, protocol: string) => string;
    protocolFollowGroup: string;
    protocolEachModel: string;
    protocolRoutedById: string;
    protocolNone: string;
    detectNeedsBaseUrl: string;
    baseUrlNone: string;
    clearGroupKey: string;
    groupSettingsTitle: (label: string) => string;
    groupSettingsEntry: string;
    sortModes: { "price-asc": string; "price-desc": string; name: string };
    sortHeading: string;
    groupMenuTitle: (sort: string) => string;
    groupSettings: string;
    modelList: string;
    baseUrlInvalid: string;
    foldedGroups: (n: number) => string;
    unpinGroup: string;
    pinGroup: string;
    /** The same icon button while its group's run is going: stops after the probe in flight. */
    speedTestStop: string;
    platformUpToDate: string;
    platformSyncAdded: (n: number) => string;
    restoredDefaults: string;
    restoreDefaultsBody: string;
    restoreDefaultsTitle: string;
    restoreDefaults: string;
    presetsNone: string;
    presetsAdded: (n: number) => string;
    syncNewPresetsHint: string;
    syncNewPresets: string;
    /** Connectivity test on a hand-added row: replaces MMSP's "No client for model" sentence, which names client types the user has no way to act on. */
    testNotRoutable: string;
    /** The way out offered beside that warning: opens the config dialog with the row already in the custom group. */
    moveToCustomGroup: string;
    /** Warning on a hand-added vendor-group row whose model id MMSP cannot route — it begins with no known vendor prefix (such a row can no longer be created, only inherited). */
    vendorRowUnroutable: string;
    addProtocolHintInherit: (protocol: string) => string;
  };
  memory: {
    desc: string;
    enable: string;
    userScope: string;
    templateMissing: string;
    insertPlaceholder: string;
    insertPlaceholderDone: string;
    promptSection: string;
    promptSectionHint: string;
    promptLabel: string;
    workspacePromptLabel: string;
    promptPlaceholders: string[][];
    insertToken: string;
    itemCount: (n: number) => string;
    emptyScope: string;
    emptyUserScope: string;
    add: string;
    addScopeLabel: (scope: string) => string;
    addTitle: string;
    addWhy: string;
    addContentLabel: string;
    addContentPlaceholder: string;
    addPromptLead: { user: string; workspace: string };
    view: string;
    edit: string;
    editTitle: string;
    editWhy: string;
    editRequirementLabel: string;
    editRequirementPlaceholder: string;
    editPromptLabel: string;
    editCopyPrompt: string;
    editOpenChat: string;
    delete: string;
    deleteTitle: string;
    deleteConfirm: (name: string) => string;
    deleteDone: string;
    editPromptLead: (title: string) => string;
    editPromptTail: string;
    exportScope: string;
    exportScopeHint: string;
    exportScopeLabel: (scope: string) => string;
    importScope: string;
    importScopeHint: string;
    importScopeLabel: (scope: string) => string;
    importTitle: string;
    importWhy: string;
    importFile: (name: string, count: number) => string;
    importModeLabel: string;
    importModeSkip: string;
    importModeSkipHint: string;
    importModeOverwrite: string;
    importModeOverwriteHint: string;
    importModeReplace: string;
    importModeReplaceHint: string;
    importAction: string;
    importInvalidFile: string;
    importEmptyFile: string;
    importConfirmTitle: string;
    importWillOverwrite: (names: string[]) => string;
    importWillRemove: (names: string[]) => string;
    importWillReplaceIndex: string;
    importIrreversible: string;
    importDone: (added: number, overwritten: number, removed: number) => string;
    importNothingNew: string;
  };
  vault: {
    desc: string;
    key: string;
    value: string;
    valueMasked: string;
    add: string;
    addTitle: string;
    remove: string;
    deleteTitle: string;
    deleteConfirm: (key: string) => string;
    overwriteTitle: string;
    overwriteConfirm: (key: string) => string;
    empty: string;
    readOnlyHint: string;
    keyHint: string;
    keyInvalid: string;
    aiAddTitle: string;
    aiAddIntro: string;
    aiAddPlaceholder: string;
    aiAddExamples: { key: string; label: string; description: string; prompt: string }[];
    aiAddTail: (agentId: string, projectId: string) => string;
    injection: {
      enable: string;
      templateMissing: string;
      legacyTemplate: string;
      insertPlaceholder: string;
      migrate: string;
      promptSection: string;
      promptSectionHint: string;
      promptLabel: string;
      promptPlaceholders: ReadonlyArray<readonly [string, string]>;
    };
  };
  schedule: {
    desc: string;
    readOnlyHint: string;
    colStatus: string;
    colPeriod: string;
    colTarget: string;
    colFireTimes: string;
    colQueued: string;
    statusNames: Record<string, string>;
    queued: string;
    once: string;
    newSession: string;
    invalidFiles: string;
    empty: string;
    enable: string;
    disable: string;
    addTitle: string;
    editTitle: (name: string) => string;
    nameHint: string;
    prompt: string;
    enabled: string;
    startAt: string;
    endAt: string;
    period: string;
    periodPlaceholder: string;
    target: string;
    targetNew: string;
    targetSession: string;
    sessionId: string;
    chooseSession: string;
    sessionSearch: string;
    sessionNoMatch: string;
    sessionEmpty: string;
    workspace: string;
    model: string;
    modelDefault: string;
    deleteTitle: string;
    deleteConfirm: (name: string) => string;
    toastSaved: string;
    toastEnabled: string;
    toastDisabled: string;
    targetThisSession: string;
    panelTitle: string;
    panelSubtitle: string;
    panelSearchPlaceholder: string;
    filterAll: string;
    filterActive: string;
    filterPaused: string;
    panelEmpty: string;
    panelNoMatch: string;
    panelDraftEmpty: string;
    rowActions: string;
    human: {
      everyDay: (time: string) => string;
      everyWeek: (weekday: string, time: string) => string;
      everyDays: (n: number, time: string) => string;
      everyHours: (n: number) => string;
      everyMinutes: (n: number) => string;
      once: (when: string) => string;
      next: (when: string) => string;
      today: (time: string) => string;
      tomorrow: (time: string) => string;
      onDate: (monthDay: string, time: string) => string;
      onDateWithYear: (year: number, monthDay: string, time: string) => string;
    };
    aiCreateTitle: string;
    aiCreateInSessionDesc: string;
    aiCreateDesc: string;
    byAgentInSession: (name: string) => string;
    editInSession: string;
    aiCreateInSessionTail: string;
    aiCreateTail: (agentId: string) => string;
    suggestionsTitle: string;
    suggestions: {
      dailyBrief: {
        name: string;
        hint: string;
        description: string;
        prompt: string;
        agentPrompt: string;
      };
      weeklyReview: {
        name: string;
        hint: string;
        description: string;
        prompt: string;
        agentPrompt: string;
      };
      followUp: {
        name: string;
        hint: string;
        description: string;
        prompt: string;
        agentPrompt: string;
      };
      monitor: {
        name: string;
        hint: string;
        description: string;
        prompt: string;
        agentPrompt: string;
      };
    };
    injection: {
      enable: string;
      templateMissing: string;
      insertPlaceholder: string;
      promptSection: string;
      promptSectionHint: string;
      promptLabel: string;
      promptPlaceholders: ReadonlyArray<readonly [string, string]>;
    };
  };
  plugins: {
    builtin: string;
    builtinHint: string;
    installedRestart: string;
    stateFailed: string;
    replacesLabel: string;
    restartPending: string;
    uninstall: string;
    install: string;
    installing: string;
    deploymentInstalledToast: (name: string) => string;
    deploymentFailedToast: (name: string, reason: string) => string;
    applyConfirmInstall: (name: string) => string;
    applyConfirmRemove: (name: string) => string;
    pageTitle: string;
    pageDesc: string;
    kindLabel: { skills: string; hooks: string; modules: string; mcp: string; workbenches: string };
    noMatch: string;
    shippedNoEntry: string;
    libraryBuiltinHint: string;
    pluginCount: (n: number) => string;
    searchPlaceholder: string;
    detailSkills: string;
    detailHooks: string;
    usedByAgents: (n: number) => string;
    installedToast: (plugin: string, agent: string) => string;
    uninstalledToast: (plugin: string, agent: string) => string;
    updateOutdated: (n: number) => string;
    updateConfirmTitle: (name: string) => string;
    updateConfirmWarning: (name: string) => string;
    updatedToast: (plugin: string, n: number) => string;
    uninstallConfirmTitle: (name: string) => string;
    uninstallConfirmBody: (plugin: string, agent: string, withMcp: boolean) => string;
    importMcpNote: string;
    updatePartReplaced: string;
    updatePartMcp: string;
    setUpHelpLink: string;
    setUpKeySetHint: string;
    setUpKeySet: string;
    setUpDesc: string;
    setUpTitle: (plugin: string, agent: string) => string;
    setUp: string;
    installStdioBody: (server: string, command: string, machine?: string) => string;
    installStdioTitle: (plugin: string, agent: string) => string;
    mcpRunsCommand: (command: string) => string;
    mcpSignIn: string;
    mcpSetUpByOwner: string;
    mcpSetUpWhere: string;
    mcpNeedsSetup: (keys: string[]) => string;
    quickStartAfterInstall: string;
    quickStartInstallTitle: (plugin: string, agent: string) => string;
    /** Quick start's tooltip: what pressing it does, and what it does not. */
    quickStartHint: string;
    replaceAction: string;
    replaceBody: (name: string, installed: string, incoming: string) => string;
    /** The confirm when the zip holds another version of a package on this server (409 plugin_exists). */
    replaceTitle: string;
    importUnchangedToast: (name: string, version: string | null) => string;
    importedToast: (name: string, version: string | null) => string;
    importExamples: { key: string; label: string; description: string }[];
    importUploadAction: string;
    importUploadDesc: string;
    importPromptTail: (projectId: string) => string;
    /** The prompt's first sentence, by what kind of source was pasted (plugin-import-prompt.ts). */
    importPromptLead: {
      link: (source: string) => string;
      localPath: (source: string) => string;
      reference: (source: string) => string;
    };
    importSourceToken: string;
    importSourcePlaceholder: string;
    importSourceLabel: string;
    importAgentWhy: string;
    /** On the npm, link and zip tabs: what installing runs, said plainly. */
    importScriptsRun: string;
    importCost: string;
    importLinkAskAgent: string;
    /** A folder or a file inside a repository on the link tab, and the action that hands it to the agent tab. */
    importLinkSubpath: string;
    importLinkInvalid: string;
    importLinkPlaceholder: string;
    importLinkLabel: string;
    /** The link tab: an https link npm fetches, from wherever the server's network reaches. */
    importLinkWhy: string;
    importNpmInvalid: string;
    importNpmPlaceholder: string;
    importNpmLabel: string;
    /** The npm tab: a package name, which the server installs from the registry itself. */
    importNpmWhy: string;
    importTabs: { npm: string; link: string; zip: string; agent: string };
    importServerWide: string;
    importPlugin: string;
    /** The import dialog (admin): a tab for each way in — npm, a link, a zip, or an Agent in a chat. */
    importDestination: string;
    deletedToast: (name: string) => string;
    deleteConfirmBody: (name: string) => string;
    deleteConfirmTitle: (name: string) => string;
    deletePlugin: string;
    exportPluginHint: string;
    /** The detail dialog's export (any member) and delete (admin, a package installed on the server). */
    exportPlugin: string;
    installedOnServerHint: string;
    /** The tag of a plugin an admin installed on this server (not shipped with the build). */
    installedOnServer: string;
    /** In place of the README of a package that is not on this server. */
    readmeAfterInstall: string;
    detailRepository: string;
    /** The detail dialog's links to the package's homepage and repository: their names and hover hints. */
    detailHomepage: string;
    detailMcpServers: string;
    uninstallWorkbenchRecords: string;
    detailWorkbenches: string;
    detailFiles: string;
    /** Sections of the plugin detail dialog: the description (and the package's README), then the files it installs. */
    detailDescription: string;
    /** In place of the description of a package that carries none. */
    noDescription: string;
    /** What a status means for this plugin, on hover over its glyph. */
    statusHint: {
      libraryInstalled: string;
      libraryAvailable: string;
      update: (n: number) => string;
      moduleInstalled: string;
      moduleAvailable: string;
      restart: string;
      failed: (reason: string) => string;
      elsewhere: (machines: string) => string;
      unsynced: string;
    };
    /** A plugin's install status: the word beside the status glyph, and the grouping's section titles. */
    status: {
      update: string;
      installed: string;
      restart: string;
      failed: string;
      "not-here": string;
      incompatible: string;
      available: string;
    };
    otherCategory: string;
    /** The category of the sandbox backends, and of a plugin whose category the page does not know. */
    sandboxCategory: string;
    groupBy: { category: string; status: string; kind: string; none: string };
    /** The grouping select: its accessible name, and its options, each a phrase that says what it does. */
    groupByLabel: string;
    /** The header button (admin only) that opens the Settings dialog on its Plugins page. */
    openSettings: string;
    machineUnreadable: (name: string, reason: string) => string;
    sharedHint: string;
    /** The tag on a row the shared table lists, and its tooltip (Remove is unavailable on it). */
    sharedTag: string;
    /** A row the Project lists for a machine that has not reported it running yet. */
    notSynced: string;
    thisServer: string;
    /** The header's machine picker: which machine's plugins the page shows and edits. */
    viewMachine: string;
    applyConfirmWarning: (install: boolean) => string;
    applyConfirmRemoveBody: (name: string) => string;
    applyConfirmInstallBody: (name: string) => string;
    /** The repair prompt written into the new chat's composer; the user reads and sends it. */
    repairPrompt: (name: string, disabled: boolean, reason: string) => string;
    repairNoAgent: string;
    repairOpen: string;
    repairBody: (name: string) => string;
    repairTitle: (name: string) => string;
    repair: string;
    /** That notice's action: turns the filter off. */
    incompatibleOnlyShowAll: string;
    /** Page notice while Settings › Plugins narrows the list to the incompatible plugins. */
    incompatibleOnlyNotice: string;
    /** The notice's action: filters the list down to those rows. */
    unsatisfiedShow: string;
    /** Page notice while this build cannot fully run a listed plugin. */
    unsatisfiedNotice: (n: number) => string;
    /** Under a running row: this build has no slot for part of what the plugin contributes. */
    runsPartly: (reason: string) => string;
    /** A module plugin the running build cannot run at all: it needs a module or interface this build lacks. */
    stateDisabled: string;
  };
  hooks: {
    agentTabDesc: string;
    agentTabEmpty: string;
    readOnlyHint: string;
    hookCount: (n: number) => string;
    exportHook: string;
    importHook: string;
    importChatTitle: string;
    importChatWhy: string;
    importSourceLabel: string;
    importSourceHint: string;
    importSourcePlaceholder: string;
    importSourceToken: string;
    importPromptLabel: string;
    importPromptLead: (s: string) => string;
    importCopyPrompt: string;
    importOpenChat: string;
    importUploadTitle: string;
    importUploadDesc: string;
    importUploadAction: string;
    importUploading: string;
    importDoneToast: string;
    importOverwriteTitle: string;
    importOverwriteBody: (name: string) => string;
    importOverwriteAction: string;
    importPromptTail: (projectId: string, agentId: string) => string;
    uninstallConfirmTitle: (name: string) => string;
    uninstallConfirmBody: (name: string, agent: string) => string;
    uninstalledToast: (name: string, agent: string) => string;
    injection: { enable: string; enableHint: string; savedToast: string };
  };
  pluginRegistry: {
    empty: string;
    specifierHint: string;
    copySpecifier: string;
    /** Shown while the server is still reading a source: the list holds what has answered so far. */
    sourcePending: (count: number) => string;
    /** Shown above the list when a source answered with nothing, so a short list is not read as a complete one. */
    sourceUnavailable: (count: number) => string;
  };
  skills: {
    quickInvoke: string;
    quickInvokeText: (name: string) => string;
    selectAll: string;
    selectNone: string;
    selectedCount: (n: number) => string;
    manageInstall: string;
    manageInstallTitle: (name: string) => string;
    install: string;
    installed: string;
    uninstall: string;
    skillCount: (n: number) => string;
    updateAction: string;
    uninstalledToast: (skill: string, agent: string) => string;
    uninstallConfirmTitle: (name: string) => string;
    uninstallConfirmBody: (skill: string, agent: string) => string;
    agentTabDesc: string;
    agentTabEmpty: string;
    exportSkill: string;
    importSkill: string;
    importChatTitle: string;
    importChatWhy: string;
    importSourceLabel: string;
    importSourceHint: string;
    importSourcePlaceholder: string;
    importSourceToken: string;
    importPromptLabel: string;
    importPromptLead: {
      webUrl: (s: string) => string;
      repoUrl: (s: string) => string;
      localPath: (s: string) => string;
      command: (s: string) => string;
      reference: (s: string) => string;
    };
    importPromptTail: string;
    importCopyPrompt: string;
    importOpenChat: string;
    importUploadTitle: string;
    importUploadDesc: string;
    importUploadAction: string;
    importUploading: string;
    importDoneToast: string;
    importOverwriteTitle: string;
    importOverwriteBody: (name: string) => string;
    importOverwriteAction: string;
    injection: {
      enable: string;
      templateMissing: string;
      legacyTemplate: string;
      insertPlaceholder: string;
      migrate: string;
      promptSection: string;
      promptSectionHint: string;
      promptLabel: string;
      promptPlaceholders: ReadonlyArray<readonly [string, string]>;
    };
  };
  chat: {
    newSessionMenu: string;
    chooseAgent: string;
    chooseModel: string;
    codingAgentTextOnly: string;
    thinkingLevel: string;
    thinkingLevelNames: Readonly<Record<string, string>>;
    thinkingLevelMenuName: (name: string, level: string) => string;
    thinkingSwitchTitle: string;
    thinkingSwitchBody: (to: string) => string;
    thinkingSwitchBusyHint: string;
    thinkingSwitchCompactFirst: string;
    thinkingSwitchConfirm: string;
    thinkingSwitchCompacting: string;
    thinkingSwitchApplied: (to: string) => string;
    thinkingSwitchCompactFailed: string;
    workspaceAuto: string;
    workspaceClear: string;
    workspaceDirInvalid: string;
    groupByWorkspace: string;
    groupByAgent: string;
    groupByTime: string;
    timeGroups: { day: string; month: string; earlier: string };
    searchSessions: string;
    searchSessionsPlaceholder: string;
    searchClear: string;
    searchNoMatches: string;
    listSettings: string;
    groupModeSection: string;
    sortModeSection: string;
    sortManual: string;
    sortRecent: string;
    newWorkspaceEntity: string;
    workspaceMenu: string;
    renameWorkspace: string;
    renameWorkspaceLabel: string;
    renameWorkspaceHint: string;
    deleteWorkspace: string;
    deleteWorkspaceConfirm: (name: string) => string;
    tempWorkspaces: string;
    newSessionInWorkspace: string;
    draftSubtitle: string;
    exampleFolders: {
      webapps: string;
      schedules: string;
      evolve: string;
      apps: string;
    };
    exampleFillHint: string;
    shortcuts: {
      folder: string;
      new: string;
      newFromComposer: string;
      createTitle: string;
      editTitle: string;
      titleLabel: string;
      titleHint: (max: number) => string;
      promptLabel: string;
      promptHint: (max: number) => string;
      promptInfo: string;
      titleTooLong: (max: number) => string;
      promptTooLong: (max: number) => string;
      deleteTitle: string;
      deleteConfirm: (title: string) => string;
    };
    exampleTasks: {
      game: { label: string; desc: string; prompt: string };
      gamecenter: { label: string; desc: string; prompt: string };
      lol: { label: string; desc: string; prompt: string };
      rhythmRunner: { label: string; desc: string; prompt: string };
      investmentCopilot: { label: string; desc: string; prompt: string };
      agentBenchmarkBuild: { label: string; desc: string; prompt: string };
      agentOptimization: { label: string; desc: string; prompt: string };
      dailyPlan: { label: string; desc: string; prompt: string };
      githubDigest: { label: string; desc: string; prompt: string };
      memoryReview: { label: string; desc: string; prompt: string };
      benchmarkImport: { label: string; desc: string; prompt: string };
      legalDesk: { label: string; desc: string; prompt: string };
      ragDocsExpert: { label: string; desc: string; prompt: string };
    };
    sessionList: string;
    defaultSessionTitle: string;
    partOfActivity: string;
    backToActivity: string;
    agent: string;
    model: string;
    workspace: string;
    approvalMode: string;
    approvalModeNames: Record<string, string>;
    approvalModes: Record<string, string>;
    statusRunning: string;
    statusCompacting: string;
    statusCompletedUnread: string;
    backgroundTasks: (n: number) => string;
    sessionScheduled: string;
    backgroundCall: string;
    sendToBackground: string;
    sendToBackgroundHint: string;
    pendingApprovals: (n: number) => string;
    jumpToLatest: string;
    loadingEarlier: string;
    loadEarlierRetry: string;
    historyBeginning: string;
    outlineTitle: string;
    outlineTickLabel: (n: number, question: string) => string;
    outlineNoText: string;
    outlineAnswering: string;
    inputPlaceholder: string;
    inputPlaceholderShort: string;
    steerPlaceholder: string;
    steerPlaceholderShort: string;
    steerSend: string;
    steerQueuedIndicator: string;
    steerQueuedItem: (content: string) => string;
    userSteering: string;
    steerModeLabel: string;
    steerModeSteer: string;
    steerModeSteerHint: string;
    steerModeFollowUp: string;
    steerModeFollowUpHint: string;
    followUpPlaceholder: string;
    followUpPlaceholderShort: string;
    followUpSend: string;
    followUpQueuedChip: (n: number) => string;
    followUpQueuedItem: (content: string) => string;
    recallQueued: string;
    recallQueuedTitle: string;
    send: string;
    stop: string;
    compact: string;
    approve: string;
    deny: string;
    decisionAllow: string;
    decisionDeny: string;
    decisionManual: string;
    decisionAuto: string;
    decisionPolicy: string;
    thinking: string;
    /** Stands in for reasoning a run log hides, while the agent is still thinking. */
    thinkingHidden: string;
    /** A run log's blank reasoning, folded into the step it led to. */
    thoughtFor: (duration: string) => string;
    copyToolOutput: string;
    showAllOutput: string;
    showLessOutput: string;
    subagent: string;
    subagentRunning: string;
    aborted: (item?: { errorCode?: string; errorMessage?: string; reason?: string }) => string;
    reconnect: (
      status: "retryable" | "failed" | "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
      secondsLeft?: number,
      errorMessage?: string,
      errorCode?: string,
    ) => string;
    llmError: (errorMessage?: string) => string;
    reconnectRetryNow: string;
    reconnectGiveUp: string;
    imageAlt: string;
    toolImageAlt: string;
    imagesAsPathHint: string;
    infoPanel: string;
    sessionStats: string;
    sessionIdLabel: string;
    copySessionId: string;
    processList: string;
    processStop: string;
    processExited: string;
    processRemove: string;
    processRemoveHint: string;
    processClearExited: string;
    processClearExitedHint: string;
    statTokens: string;
    statTotalTokens: string;
    statCacheHit: (pct: string) => string;
    statElapsed: string;
    statInput: string;
    statCached: string;
    statOutput: string;
    statTps: string;
    statParenOpen: string;
    statParenClose: string;
    noSessions: string;
    emptyStream: string;
    historyLoadFailed: string;
    machineAway: {
      reconnecting: (alias: string) => string;
      reconnectStopped: (alias: string) => string;
      signInRefused: (alias: string) => string;
      stopped: (alias: string) => string;
      notConnected: (alias: string) => string;
      missing: string;
      hint: string;
      details: string;
    };
    statsLabel: string;
    removeImage: string;
    openAgents: string;
    workspacePanel: string;
    filesInMessage: (n: number) => string;
    imagesInMessage: (n: number) => string;
    openPreview: string;
    showMoreFiles: (n: number) => string;
    showLess: string;
    memoryChangesTitle: (n: number) => string;
    memoryScopeWorkspace: (key: string) => string;
    memoryOpWrite: string;
    memoryOpEdit: string;
    memoryViewTitle: string;
    memoryChangedMark: string;
    memoryContentUnavailable: string;
    memoryRowOpen: string;
    memoryOpenList: string;
    memoryBack: string;
    memoryEmptyAll: string;
    openAgentMemory: string;
    memoryShowMore: (n: number) => string;
    prevGroupPage: string;
    nextGroupPage: string;
    groupPagePosition: (page: number, total: number) => string;
    contextUsage: string;
    contextUnknown: string;
    contextComposition: string;
    contextPartSystemPrompt: string;
    contextPartToolDefs: string;
    contextPartUserMessages: string;
    contextPartAssistantMessages: string;
    contextPartToolRequests: string;
    contextPartToolResults: string;
    contextTopTools: string;
    contextWindowIs: (n: string) => string;
    contextTopToolsHint: string;
    contextTopFiles: string;
    contextTopFilesHint: string;
    contextRankLabel: string;
    contextRankTools: string;
    contextRankFiles: string;
    contextNoFileTraffic: string;
    contextUnknownHint: string;
    contextBreakdownEmpty: string;
    contextBreakdownFailed: string;
    contextThresholdCutter: string;
    contextThresholdHover: (n: string) => string;
    contextBeyondThreshold: string;
    contextThresholdTitle: string;
    contextThresholdBody: (agentName: string, old: string) => string;
    contextThresholdField: string;
    contextThresholdInvalid: string;
    contextThresholdCapped: (n: string) => string;
    contextThresholdSaved: (n: string) => string;
    contextWindowUnderThreshold: (n: string, m: string) => string;
    contextWindowUnderThresholdAction: string;
    contextWindowUnderThresholdDismiss: string;
    slashHint: string;
    switchAgent: string;
    switchAgentTitle: string;
    agentSearchPlaceholder: string;
    agentsNoMatch: string;
    handoffTargetTitle: (agent: string) => string;
    handoffRemove: string;
    skillsSelect: string;
    skillRemove: string;
    skillsSearchPlaceholder: string;
    skillsNoMatch: string;
    skillsEmptyHint: string;
    skillsAutoMessage: (names: string[]) => string;
    handoffFrom: (agent: string) => string;
    handoffBack: (title?: string) => string;
    switchModel: string;
    switchModelTitle: string;
    modelSwitchTargetTitle: (model: string) => string;
    modelSwitchRemove: string;
    modelSwitchBusyHint: string;
    modelSwitchFrom: (prevModel?: string) => string;
    modelSwitchAutoMessage: string;
    orgTriggerKinds: Record<string, string>;
    orgTriggerBudget: (budget: string) => string;
    backgroundDone: (
      kind: "command" | "subagent",
      status: "completed" | "failed" | "stopped",
    ) => string;
    emptyGreeting: string;
    mcpConnectTitle: string;
    mcpServerList: (servers: string[]) => string;
    mcpConnectResult: (toolCount: number, failed: string[], waiting: string[]) => string;
    mcpToolsCount: (n: number) => string;
    mcpServerFailed: string;
    mcpConnectAborted: string;
    compactionTitle: (mode: string) => string;
    compactionRunning: (mode: string) => string;
    compactionDone: (mode: string) => string;
    compactionResult: string;
    compactionFailed: (status: string, errorMessage?: string) => string;
    unknownTool: string;
    toolAliases: Record<string, string>;
    workRunning: string;
    workDone: string;
    workGroupSteps: (n: number) => string;
    approvalWaiting: string;
    contextSent: string;
    workPlainRunning: string;
    workPlainDone: string;
    copyCode: string;
    copyReply: string;
    forkSession: string;
    forkSessionConfirmBody: string;
    forkSessionConfirmAction: string;
    forkSessionFailed: string;
    copyMessage: string;
    deleteSession: string;
    renameSession: string;
    renameSessionLabel: string;
    deleteSessionConfirm: (title: string) => string;
    draftGroup: string;
    draftUntitled: string;
    deleteDraft: string;
    deleteDraftConfirm: (title: string) => string;
    archiveSession: string;
    unarchiveSession: string;
    pinSession: string;
    unpinSession: string;
    pinnedSession: string;
    moreActions: string;
    loadMore: string;
    expandRestSessions: (n: number) => string;
    activityRunsFolder: (n: number) => string;
    unnamedActivity: string;
    unknownProduct: string;
    openActivity: (name: string) => string;
    folderOnlyGroup: (n: number, path?: string) => string;
    plusMenu: string;
    uploadImage: string;
    uploadImageDesc: string;
    uploadFile: string;
    uploadFileDesc: string;
    removeFile: string;
    attachmentTooLarge: (name: string, limitMb: number) => string;
    dropFilesTitle: string;
    dropFilesDesc: string;
    dropFilesGoalHint: string;
    goalMode: string;
    goalModeDesc: string;
    goalBudgetLabel: string;
    goalBudgetUnlimited: string;
    goalBudgetValue: (value: string) => string;
    goalBudgetPlaceholder: string;
    goalBudgetHint: string;
    goalBudgetInvalid: string;
    goalBudgetSave: string;
    goalRemove: string;
    goalPluginMissing: string;
    goalPluginInstall: string;
    harnessInjected: string;
    goalProgress: (rounds: number, tokens: string) => string;
    goalStatus: Record<string, string>;
    linkMenu: {
      openInBuiltinBrowser: string;
      openInChromeTab: string;
      openExternal: string;
      openInNewTab: string;
      copyLink: string;
    };
    /** The goal line's fixed phrase; the objective follows it as the line's subject. */
    goalLabel: string;
    /** A paste too long for the text box, attached as a text file instead. */
    longPasteAttached: (name: string) => string;
    /** Names listed after a note's fixed phrase (the skills). */
    nameList: (names: string[]) => string;
    /** The skills note's fixed phrase (the count picks the plural); the skill names follow it as `nameList`. */
    skillsLabel: (count: number) => string;
    archivedStub: { note: string };
    sessionSource: { user: string; api: string; schedule: string; cli: string; workbench: string };
    a2ui: {
      lang: "en";
      fill: string;
      other: string;
      recommended: string;
      note: string;
      tip: string;
      caution: string;
      warning: string;
      composing: string;
      cannotShow: (reason: string) => string;
      diagram: string;
      showSource: string;
      stepUp: string;
      stepDown: string;
      conditions: {
        clear: string;
        "partly-cloudy": string;
        cloudy: string;
        fog: string;
        drizzle: string;
        rain: string;
        "heavy-rain": string;
        thunder: string;
        snow: string;
        sleet: string;
        wind: string;
      };
      asOf: (time: string) => string;
      source: (name: string) => string;
      feelsLike: string;
      humidity: string;
      wind: string;
      precipitation: string;
      high: string;
      low: string;
      hourly: string;
      daily: string;
      today: string;
      weather: string;
      clock: string;
      countdown: string;
      metrics: string;
      localTime: string;
      countdownDone: string;
      unitDays: string;
      unitHours: string;
      unitMinutes: string;
      unitSeconds: string;
      done: string;
      deltaUp: string;
      deltaDown: string;
    };
    modelChanged: (from: string, to: string) => string;
    mcpServerSignIn: string;
    mcpServerNeedsSetup: string;
    /** `[org_trigger]` banner: what the organization scheduler sent this desk or ticket session, folded into one line — this fixed phrase, then the organization's name. */
    orgTriggerLabel: string;
    /** The scheduled-task note's fixed phrase; the task's name follows it as the note's subject. */
    scheduledLabel: string;
    modelSwitchPrev: (model: string) => string;
    /** The model-switch note: its fixed phrase, and the earlier model as its subject (`modelSwitchFrom` is its accessible name). */
    modelSwitchLabel: string;
    /** The handoff note's fixed phrase; the agent follows it as the note's subject. */
    handoffLabel: string;
    sessionNotFoundHint: string;
    sessionNotFound: string;
    sessionOfflineHint: string;
    sessionOnOfflineMachineUnknown: string;
    /** The routed conversation is on a machine with no connection held: not gone, just out of reach from here. */
    sessionOnOfflineMachine: (machine: string) => string;
    usagePartOutput: string;
    usagePartCacheWrite: string;
    usagePartCacheRead: string;
    statToolTime: string;
    statApiTime: string;
    clearTypedBody: string;
    clearTyped: string;
    /** A choice's "Other…" about to empty the composer of text the user typed. */
    clearTypedTitle: string;
    replaceTypedBody: string;
    replaceTyped: string;
    /** An example task, a saved shortcut or a schedule's prompt about to replace text typed in the composer. */
    replaceTypedTitle: string;
    processStopConfirm: string;
    processStopTitle: string;
    /** The hint on a sent image that did not load (its file was removed, or its machine is out of reach). */
    imageUnavailable: string;
    /** Toast when Retry finds nothing held: the unfinished turn's input already went out with a later message. */
    retryNothing: string;
    /** "Retry" on the line a run ended on (the error banner, a reconnect line that gave up, or the stop marker): sends the unfinished turn's input again, with no new message. */
    retryRun: string;
    /** The composer's permission button: one colored shield for the level, a menu of Fs / Network / More. */
    permission: {
      label: string;
      levels: Record<string, string>;
      fs: string;
      fsModes: Record<string, string>;
      network: string;
      networkModes: Record<string, string>;
      unsupported: string;
      localUnsupported: string;
      notInstalled: string;
      noBackend: string;
      noNetworkUnsupported: (backends?: string) => string;
      maskUnsupported: (backends?: string) => string;
      notAvailable: string;
      adminOnly: string;
      aboveCeiling: string;
      backendUnavailable: (name: string, reason: string) => string;
      more: string;
      approval: string;
      custom: string;
      advancedActive: string;
      advancedHint: string;
      blocks: string;
      allows: string;
      nothing: string;
      enforceable: string;
      needsNoBackend: string;
      effects: Record<string, string>;
    };
    sessionListByMode: { workspace: string; agent: string; time: string };
    start: {
      metrics: { agents: string; toolkits: string; benchmarks: string };
      examplesTitle: string;
    };
    machineTag: (machine: string) => string;
    onMachine: (name: string, machine: string) => string;
    /** A Workspace group's "more" menu: the dock's Files panel on that directory. */
    browseWorkspaceFiles: string;
    /** The Workspace finder: the modal the Workspace pickers open (workspace-finder.tsx). */
    finder: {
      choose: string;
      back: string;
      forward: string;
      up: string;
      refresh: string;
      address: string;
      addressPlaceholder: string;
      editPath: string;
      filter: string;
      showSidebar: string;
      hideSidebar: string;
      quickAccess: string;
      thisPc: string;
      locations: string;
      drives: { drive: string; removable: string; network: string; optical: string };
      fileSystem: string;
      switchLocation: string;
      recent: string;
      machines: string;
      places: { desktop: string; documents: string; downloads: string; pictures: string };
      documentsMac: string;
      addToQuickAccess: string;
      removeFromQuickAccess: string;
      addCurrentToQuickAccess: string;
      removeNamed: (name: string) => string;
      open: string;
      openFolder: (name: string) => string;
      chooseThis: string;
      chooseCurrent: string;
      copyPath: string;
      path: string;
      columnName: string;
      columnModified: string;
      fileNotSelectable: string;
      empty: string;
      noMatch: (q: string) => string;
      deniedTitle: string;
      denied: string;
      deniedMacServer: string;
      deniedMacAsk: string;
      deniedMacRefused: string;
      deniedMacRefusedDev: string;
      allowAccess: string;
      allowAccessWaiting: string;
      openSystemSettings: string;
      loadFailed: string;
    };
    workspaceTempRule: string;
    /** Why a listed machine cannot be picked — shown ON its row, where the question is asked. */
    workspaceMachineWhy: { "no-identity": string };
    workspaceHere: string;
    modelSwitchInSessionApplied: (to: string) => string;
    modelSwitchInSessionSwitching: (to: string) => string;
    modelSwitchInSessionStarted: (from: string, to: string) => string;
    modelSwitchInSessionCompactedBody: (to: string) => string;
    modelSwitchInSessionDirectBody: (to: string) => string;
    modelSwitchInSessionBody: (from: string, to: string) => string;
    /** Confirm label when the transcript is empty: nothing to compact, so it only switches. */
    modelSwitchInSessionDirectConfirm: string;
    modelSwitchInSessionConfirm: string;
    modelSwitchInSessionTitle: string;
  };
  feishu: {
    intro: string;
    appId: string;
    appSecret: string;
    appSecretKeepHint: string;
    clearSecret: string;
    baseDomain: string;
    baseDomainHint: string;
    invalidDomain: string;
    testMessageNoChat: string;
    setupSteps: string[];
  };
  telegram: {
    intro: string;
    botToken: string;
    botTokenKeepHint: string;
    clearToken: string;
    openBotFather: string;
    invalidToken: string;
    testMessageNoChat: string;
    setupSteps: string[];
  };
  qq: {
    intro: string;
    appId: string;
    appSecret: string;
    appSecretKeepHint: string;
    clearSecret: string;
    testMessageNoChat: string;
    repliesOnly: string;
    replyBudget: string;
    scanStart: string;
    scanStarting: string;
    scanHint: string;
    scanQrLabel: string;
    scanWaiting: string;
    scanSteps: string;
    scanRefreshed: string;
    scanPrivacy: string;
    scanDone: (appId: string) => string;
    scanFailed: (reason: string) => string;
    scanExpiredRepeatedly: string;
    scanDisableFirst: string;
    scanOrManual: string;
    setupSteps: string[];
  };
  wechat: {
    intro: string;
    clearToken: string;
    scanOnly: string;
    testMessageNoChat: string;
    directOnly: string;
    media: string;
    scanStart: string;
    scanRescan: string;
    scanStarting: string;
    scanQrLabel: string;
    scanWaiting: string;
    scanSteps: string;
    scanScanned: string;
    scanRefreshed: string;
    scanPrivacy: string;
    scanDone: (botId: string) => string;
    scanFailed: (reason: string) => string;
    scanExpiredRepeatedly: string;
    scanBlocked: string;
    scanAlreadyBound: string;
    scanDisableFirst: string;
    verifyPrompt: string;
    verifyLabel: string;
    verifySubmit: string;
    verifySubmitting: string;
    setupSteps: string[];
  };
  messaging: {
    panelTitle: string;
    bindAction: string;
    dialogTitle: string;
    channelLabel: string;
    channelName: { feishu: string; telegram: string; qq: string; wechat: string };
    tutorial: string;
    console: string;
    enabled: string;
    bindByEnableHint: string;
    saveBeforeEnable: string;
    test: string;
    testing: string;
    testOk: (ms: number) => string;
    testOkAs: (account: string, ms: number) => string;
    testFail: (reason: string) => string;
    testPrivacyOn: string;
    sendTestMessage: string;
    sendingTestMessage: string;
    testMessageSent: string;
    statusLabel: string;
    statusLastKnown: string;
    status: { disconnected: string; connecting: string; connected: string; error: string };
    otherEnabledHint: (other: string) => string;
    credentialMissingHint: { feishu: string; telegram: string; qq: string; wechat: string };
    disableBeforeClearHint: string;
    renderMarkdown: string;
    renderMarkdownHelpFeishu: string;
    renderMarkdownHelpTelegram: string;
    renderMarkdownHelpQQ: string;
    renderMarkdownHelpWeChat: string;
    linePerMessage: string;
    linePerMessageHelp: string;
    finalReplyOnly: string;
    finalReplyOnlyHelp: string;
    finalReplyOnlyQQWarning: string;
    enabledIndicator: { feishu: string; telegram: string; qq: string; wechat: string };
    inboundLastAt: (when: string) => string;
    inboundNone: string;
    deliveryFailedInbound: (when: string, detail: string) => string;
    deliveryFailedSend: (when: string, detail: string) => string;
    lastConnectionError: (when: string, detail: string) => string;
    faqSetupTitle: string;
    faqWhatTitle: string;
    faqWhatBinding: string;
    faqTroubleTitle: string;
    troubleNoChat: string;
    troubleConnError: string;
    troubleOnePoller: string;
    troubleGroupPrivacy: string;
    troubleWeChatDirect: string;
    troubleQQPassive: string;
    troubleNoGroupInbound: string;
    runsOn: (alias: string) => string;
    machineHelp: (alias: string) => string;
    machineUnreachable: (
      alias: string,
      state: "reconnecting" | "reconnectStopped" | "signInRefused" | "stopped" | "notConnected",
      asOf: string | null,
    ) => string;
    machineMissing: string;
    accountHeldOn: (where: string | null) => string;
    holdersUnchecked: (
      machines: ReadonlyArray<{
        alias: string;
        reason: "not_connected" | "older_build" | "failed";
      }>,
    ) => string;
    /** WeChat's reply budget and window — the answer to "replies arrive combined, or late". */
    troubleWeChatReplyWindow: string;
    /**
     * WeChat only, in the delivery-failure line's place: replies the platform would not take
     * yet are held for the user's next WeChat message, which is not a failure.
     */
    repliesHeld: (when: string) => string;
  };
  subagentPanel: {
    topologyLabel: string;
    mainSessionNote: string;
    empty: string;
    nodeRunning: string;
    nodeDone: string;
    openAsSession: string;
    subagentGone: string;
  };
  files: {
    title: string;
    upload: string;
    download: string;
    revealInFolder: string;
    copyPath: string;
    addToChat: string;
    addSelectionToChat: string;
    uploadHere: string;
    openInNewTab: string;
    previewNotIsolatedHint: string;
    refresh: string;
    root: string;
    empty: string;
    previewUnsupported: string;
    uploadedCount: (n: number) => string;
    uploading: (done: number, total: number) => string;
    uploadTooLarge: (names: string, mb: number) => string;
    folderDropSkipped: (names: string) => string;
    overwriteTitle: string;
    overwriteConfirm: (n: number) => string;
    loadFailed: string;
    previewTruncated: string;
    htmlRendered: string;
    htmlSource: string;
    backToList: string;
    treeLabel: string;
    showTree: string;
    hideTree: string;
    treeWidth: string;
    searchPlaceholder: string;
    searchClear: string;
    searchNoMatch: string;
    searching: string;
    searchTruncated: (n: number) => string;
    selectFile: string;
    dropToUpload: (dir: string) => string;
    editorLabel: (name: string) => string;
    wrapLines: string;
    unsaved: string;
    saveConfirmTitle: string;
    saveConfirm: (name: string) => string;
    editTooLarge: (kb: number) => string;
    saveTooLarge: (mb: number) => string;
    discardTitle: string;
    discardBody: (name: string) => string;
    discard: string;
    unsavedRestored: (name: string) => string;
    changedOnDisk: string;
    changedOnDiskHint: string;
    removeReference: string;
    renameTitle: string;
    renameLabel: string;
    renameHint: string;
    renameConfirm: string;
    renamed: (name: string) => string;
    deleteTitle: string;
    deleteBody: (name: string) => string;
    deleted: (name: string) => string;
    actionVersionReading: string;
    actionVersionFailed: string;
    changedBeforeAction: (name: string) => string;
    conflictTitle: string;
    conflictBody: (name: string) => string;
    overwriteAnyway: string;
    /** The new-chat draft's Files panel and its toggle, while the Workspace is a temporary one. */
    draftTemporary: string;
    created: (name: string) => string;
    createConfirm: string;
    /** Formatting, kept on screen while typing: where the entry goes, and what a `/` does. */
    createHint: (dir: string) => string;
    newFolderName: string;
    newFileName: string;
    newFolder: string;
    newTextFile: string;
    /** The tree header's New menu, a folder's menu and the blank space under the tree. */
    newMenu: string;
    /** A move or a New landed on a name that is taken: nothing was written. */
    targetExists: (path: string) => string;
    /** The editor's ×: back to the preview (asking first when there are unsaved changes). */
    stopEditing: string;
  };
  usage: {
    title: string;
    today: string;
    last7d: string;
    total: string;
    tokens: string;
    requests: string;
    from: string;
    to: string;
    colCacheRead: string;
    colCacheWrite: string;
    colOutput: string;
    uncostedNote: string;
    filterAllAgents: string;
    filterAllModels: string;
    rangeLabel: string;
    rangeHour: string;
    rangeDay: string;
    range7d: string;
    range30d: string;
    range90d: string;
    rangeCustom: string;
    chartRequestsByAgent: string;
    chartRequestsByModel: string;
    legendSuccessRate: string;
    chartTokenTrend: string;
    chartCostTrend: string;
    legendOther: (n: number) => string;
    bucketTotal: string;
    legendHitRate: string;
    empty: string;
    errors: string;
    errorsTotal: string;
    errorsUnexpected: string;
    errorsExpected: string;
    errorsTopCode: string;
    errorsColCode: string;
    errorsColKind: string;
    errorsColMessage: string;
    errorsEmpty: string;
    errorsNewer: string;
    errorsOlder: string;
    errorsPageOf: (page: number, pages: number, total: number) => string;
    errorsClear: string;
    errorsClearTitle: string;
    errorsClearRangePreset: (preset: "1h" | "1d" | "7d" | "30d" | "90d") => string;
    errorsClearRangeCustom: (from: string, to: string) => string;
    errorsClearScope: (count: number, range: string) => string;
    errorsClearScopeAgent: (count: number, range: string, agentId: string) => string;
    errorsClearIrreversible: string;
    errorsClearDone: (count: number) => string;
    /** Time cell tooltip on a row that folds several of a day's records: when the first one was. */
    errorsFirstAt: (time: string) => string;
  };
  traces: {
    timeline: string;
    laneLLM: string;
    kindThinking: string;
    kindModelReply: string;
    kindToolGen: string;
    legendToolExec: string;
    legendOther: string;
    toolParams: string;
    requiredParam: string;
    legendApprovalWait: string;
    task: (n: number) => string;
    globalSummary: string;
    tasksLabel: string;
    messages: string;
    zoom: string;
    zoomReset: string;
    zoomOut: string;
    zoomIn: string;
    linkHint: string;
    filesTitle: string;
    toolCalls: string;
    taskInput: string;
    taskOutput: string;
    cacheHit: string;
    hitRate: string;
    avgToolCalls: string;
    inProgress: string;
    systemPrompt: string;
    toolDefs: (n: number) => string;
    exportFile: string;
    /** Spoken by an open round's placeholder while its messages are being read. */
    roundLoading: string;
    /** The control above the drawn round cards: how many earlier rounds are not drawn yet; a click draws the next page of them. */
    earlierRounds: (n: number) => string;
  };
  benchmark: {
    title: string;
    /** The activity bench's scores, read here (admin only). */
    activityBench: {
      title: string;
      about: string;
      home: string;
      homePick: string;
      homeMenuHint: string;
      homeClear: string;
      homeHint: string;
      homeMissing: string;
      loadFailed: (reason: string) => string;
      empty: string;
      /** A board's origin under its title: the bench's Project and the Benchmark's folder. */
      origin: (project: string, id: string) => string;
      evaluationsLabel: (title: string) => string;
      colSummary: string;
    };
    guideFlow: { title: string; text: string }[];
    guideCreateMember: string;
    searchPlaceholder: string;
    noMatches: string;
    filterByAgent: (agentId: string) => string;
    clearFilter: string;
    emptyTitle: string;
    emptyDescription: string;
    caseCount: (n: number) => string;
    runsPerCase: (n: number) => string;
    notEvaluated: string;
    building: string;
    buildingHint: string;
    buildingDetail: string;
    creationFailed: string;
    creationFailedHint: string;
    creationFailedDetail: string;
    creationFailedHintMember: string;
    creationFailedDetailMember: string;
    testedAgents: string;
    lastEvaluated: (when: string) => string;
    sparklineLabel: (n: number) => string;
    latestScoreLabel: string;
    firstEvaluation: string;
    use: string;
    evaluate: string;
    optimize: string;
    view: string;
    copyPath: string;
    deleteBenchmark: string;
    deleteConfirm: (title: string) => string;
    deleted: string;
    backToList: string;
    notFound: string;
    notFoundHint: string;
    trendTitle: (metric: string) => string;
    cases: string;
    viewCase: string;
    taskMaterials: string;
    rubric: string;
    agentHidden: string;
    caseFileUnavailable: string;
    evaluations: string;
    noEvaluations: string;
    noEvaluationsHint: string;
    summaryLabel: string;
    unlabeled: string;
    agentColumn: string;
    colVersion: string;
    colModel: string;
    colThinkingLevel: string;
    colScore: string;
    colDuration: string;
    colCase: string;
    colRun: string;
    askAi: string;
    evaluationDetailTitle: (time: string) => string;
    askEvaluationTitle: string;
    askEvaluationDescription: string;
    askEvaluationDefault: string;
    askEvaluationExamples: {
      explain: { label: string; prompt: string };
      whyLow: { label: string; prompt: string };
      weakest: { label: string; prompt: string };
      againstPrevious: { label: string; prompt: string };
    };
    askEvaluationTail: (p: {
      benchmarkId: string;
      time: string;
      label: string;
      version: number;
      provider: string;
      modelId: string;
      thinkingLevel: string;
      score: string;
      cost: string;
      duration: string;
      summaryTitle: string;
      summary: string;
      cases: { id: string; score: string; cost: string; duration: string; sessionIds: string[] }[];
    }) => string;
    askCaseTitle: string;
    askCaseDescription: string;
    askCaseDefault: string;
    askCaseExamples: {
      explain: { label: string; prompt: string };
      rubricRewards: { label: string; prompt: string };
      whyRunLow: { label: string; prompt: string };
      clearerStatement: { label: string; prompt: string };
    };
    askCaseTail: (p: {
      benchmarkId: string;
      caseId: string;
      latest: { time: string; score: string; runs: { score: string; sessionId: string }[] } | null;
    }) => string;
    aiCreateTitle: string;
    aiCreateDescription: string;
    targetAgent: string;
    targetAgentHint: string;
    aiCreateExamples: {
      decisionAgent: { label: string; description: string; prompt: string };
      reportWriter: { label: string; description: string; prompt: string };
      customerService: { label: string; description: string; prompt: string };
      codeReview: { label: string; description: string; prompt: string };
    };
    aiCreateTail: (targetAgentId: string) => string;
    manualCreateTitle: string;
    manualCreateIntro: string;
    idField: string;
    idHint: string;
    idGenerateHint: string;
    idExists: string;
    titleField: string;
    descriptionField: string;
    descriptionHint: string;
    runsField: string;
    runsHint: string;
    runsInfo: string;
    casesTitle: string;
    casesInfo: string;
    rubricInfo: string;
    caseHeading: (n: number) => string;
    caseSlugField: string;
    caseSlugHint: (id: string) => string;
    caseTitleField: string;
    caseStatementField: string;
    caseStatementHint: string;
    caseRubricField: string;
    caseRubricHint: string;
    addCase: string;
    removeCase: string;
    createSubmit: string;
    created: string;
    invalidId: string;
    invalidRuns: string;
    invalidScore: string;
    useTitle: (title: string) => string;
    testedAgent: string;
    evaluateDescription: string;
    evaluateTestedAgentHint: string;
    evaluatorAgent: string;
    evaluatorAgentHint: string;
    evaluatorMissingSkill: string;
    evaluateSessionModel: string;
    evaluateSessionModelHint: string;
    evaluateRunsHint: string;
    evaluateNoteField: string;
    evaluateNotePlaceholder: string;
    evaluateTail: (p: { targetAgentId: string; benchmarkId: string; runs: number }) => string;
    optimizeDescription: string;
    optimizerAgent: string;
    optimizerAgentHint: string;
    optimizerMissingSkill: string;
    testedAgentHint: string;
    sessionModel: string;
    sessionModelHint: string;
    optimizeRunsHint: string;
    roundLimitField: string;
    roundLimitHint: string;
    targetScoreField: string;
    targetScoreHint: string;
    focusField: string;
    focusPlaceholder: string;
    noBaseline: string;
    baselineLine: (score: string, target: number) => string;
    optimizeTail: (p: {
      targetAgentId: string;
      benchmarkId: string;
      runs: number;
      roundLimit: number;
      targetScore: number;
    }) => string;
    exportBenchmark: string;
    importOverwriteAction: string;
    importOverwriteBody: (id: string) => string;
    importOverwriteTitle: string;
    importDoneToast: string;
    importUploading: string;
    importUploadAction: string;
    importUploadInfo: string;
    importUploadDesc: string;
    importUploadTitle: string;
    importOpenChat: string;
    importPromptTail: (projectId: string) => string;
    importPromptLead: {
      repoFolderUrl: (s: string) => string;
      localPath: (s: string) => string;
      reference: (s: string) => string;
    };
    importSourceToken: string;
    importExamples: { key: string; label: string; description: string }[];
    importSourcePlaceholder: string;
    importSourceHint: string;
    importSourceLabel: string;
    importChatWhy: string;
    importChatTitle: string;
    importBenchmark: string;
    rsiOptimizeTail: (p: {
      skill: string;
      targetAgentId: string;
      benchmarkId: string;
      runs: number;
      provider?: string;
      modelId?: string;
    }) => string;
    methodMissingSkill: (plugin: string, skill: string) => string;
    methodOptimizerHint: (skill: string) => string;
    methodBudgetHint: string;
    methodsNone: string;
    methodsFailed: string;
    methodsLoading: string;
    methodHint: string;
    methodField: string;
    /** Copy button beside a run recorded as a Harbor trial, which is no Session the app opens. */
    copyTrialName: string;
    runSessionUntitled: string;
    runArchivedOpen: string;
    runArchivedCopyId: string;
    runArchivedSessionId: string;
    runArchivedSessionTitle: string;
    runArchivedBody: string;
    runArchivedTitle: string;
    runOpenSession: string;
    manifestBrokenDetail: (hint: string, reason: string) => string;
    manifestBrokenHintMember: string;
    manifestBrokenHint: string;
    manifestBroken: string;
    sourceLabel: string;
    versionLabel: string;
  };
  company: {
    workMode: string;
    modeDev: string;
    modeCompany: string;
    beta: string;
    betaTitle: string;
    betaNotice: string;
    switcher: string;
    noOrganizations: string;
    createOrg: string;
    orgSettings: string;
    orgInvalid: string;
    orgPaused: string;
    switcherCurrent: string;
    inProject: (project: string, org: string) => string;
    landingTitle: string;
    landingBody: string;
    orgGoneTitle: string;
    orgGoneBody: string;
    backToOrgs: string;
    createTitle: string;
    orgId: string;
    orgIdHint: string;
    displayName: string;
    displayNameHint: string;
    mission: string;
    missionHint: string;
    missionPlaceholder: string;
    missionExamples: {
      research: { name: string; mission: string; summary: string };
      agentTuning: { name: string; mission: string; summary: string };
      cloudReseller: { name: string; mission: string; summary: string };
      mirror: { name: string; mission: string; summary: string };
    };
    createdOpeningCeo: string;
    modelField: string;
    modelInfo: string;
    modelClear: string;
    modelStale: string;
    modelProjectDefault: string;
    modelProjectDefaultNamed: (name: string) => string;
    modelsLoadFailed: string;
    workspaceField: string;
    workspaceInfo: string;
    workspaceEmpty: string;
    workspaceClear: string;
    ceoBudget: string;
    ceoBudgetHint: string;
    draftRestored: string;
    clearDraft: string;
    creating: string;
    settingsTitle: string;
    timezone: string;
    timezoneHint: string;
    language: string;
    languageInfo: string;
    languages: { zh: string; en: string };
    approvalMode: string;
    approvalModeInfo: string;
    approvalModes: Record<string, string>;
    status: string;
    statusActive: string;
    statusPaused: string;
    pause: string;
    resume: string;
    pauseInfo: string;
    settingsLoadFailed: string;
    employeeStates: Record<string, string>;
    ceo: string;
    reportsTo: (name: string) => string;
    openDesk: string;
    openingDesk: string;
    principalSystem: string;
    principalAll: string;
    spendOfBudget: (spend: string, budget: string) => string;
    noBudget: string;
    budgetUnit: (symbol: string) => string;
    budgetStoredAs: (amount: string) => string;
    sessionList: {
      desks: (n: number) => string;
      deskOf: (name: string) => string;
      running: string;
      noEmployees: string;
      untitledSession: string;
      loadFailed: string;
      agentMissing: string;
      closeAllTemporary: string;
      closeTemporary: string;
      temporaryEntry: (title: string) => string;
      temporary: (n: number) => string;
    };
    overview: {
      title: string;
      info: string;
      employees: string;
      onDesk: string;
      running: string;
      paused: string;
      board: string;
      blocked: string;
      today: string;
      todayEmpty: string;
      spend: string;
      reviewTickets: string;
      alerts: string;
      alertsEmpty: string;
      firstStep: string;
      createdBy: (user: string) => string;
      employeesCount: (n: number) => string;
      period: (period: string) => string;
      openCeoDesk: string;
      refreshFailed: string;
      mission: string;
      expand: string;
      collapse: string;
      openTickets: string;
      boardTotal: (n: number) => string;
      todayCount: (n: number) => string;
      upcoming: string;
      failed: string;
      budgetLeft: (amount: string) => string;
      overBudget: (amount: string) => string;
      openChart: string;
      openBoard: string;
      openCalendar: string;
      openFinance: string;
      openColumn: (column: string) => string;
      firstStepsTitle: string;
      firstStepsInfo: string;
      stepCeoTitle: string;
      stepCeoBody: string;
      stepHireTitle: string;
      stepHireBody: string;
      stepScheduleTitle: string;
      stepScheduleBody: string;
      stepDone: string;
      goToChart: string;
      goToCalendar: string;
      inbox: string;
      inboxInfo: string;
      inboxEmpty: string;
      inboxFilters: { all: string; mention: string; blocked: string; done: string };
      inboxCategories: { mention: string; blocked: string; done: string };
      timelineMore: (n: number) => string;
    };
    calendarOutcomes: Record<string, string>;
    chart: {
      title: string;
      info: string;
      empty: string;
      nodeMenu: string;
      hire: string;
      setBudget: string;
      changeReportsTo: string;
      renewDesk: string;
      leave: string;
      ceoCannotLeave: string;
      invalidEntry: string;
      workspaceTail: string;
      hireTitle: (manager: string) => string;
      hireSource: string;
      hireExisting: string;
      hireNew: string;
      agent: string;
      pickAgent: string;
      noAgentsLeft: string;
      agentId: string;
      agentIdHint: string;
      agentName: string;
      agentNameHint: string;
      agentDescription: string;
      plugins: string;
      pluginsHint: string;
      pluginsPlaceholder: string;
      pluginsPicked: (n: number) => string;
      pluginsEmpty: string;
      employeeTitle: string;
      employeeTitlePlaceholder: string;
      duties: string;
      dutiesHint: string;
      workspace: string;
      workspaceHint: string;
      budget: string;
      budgetHint: string;
      hired: (name: string) => string;
      budgetTitle: (name: string) => string;
      reportsToTitle: (name: string) => string;
      reportsToCycle: string;
      renewDeskTitle: (name: string) => string;
      renewDeskExplain: string;
      workspaceInvalid: string;
      renewed: string;
      leaveConfirm: (name: string) => string;
      left: (name: string) => string;
      saved: string;
      canvas: string;
      zoom: string;
      zoomIn: string;
      zoomOut: string;
      zoomFit: string;
      legend: string;
      employeeCount: (n: number) => string;
      spend: string;
      refreshFailed: (error: string) => string;
      detached: string;
      detachedNotice: (n: number) => string;
      hireAgentSection: string;
      hirePositionSection: string;
      agentHint: string;
      clearBudget: string;
      currentValue: (value: string) => string;
      manager: string;
      reportsToHint: string;
      thinkingLevelPinned: (level: string) => string;
      thinkingLevelDefault: (level: string) => string;
      thinkingLevelInfo: string;
      thinkingLevelTitle: (name: string) => string;
      hireStdioQuestion: (name: string) => string;
      ceoMissing: (ceoId: string) => string;
      agentMissing: string;
      setThinkingLevel: string;
      employeeNameHireHint: string;
      employeeNameHint: (agentId: string) => string;
      employeeName: string;
      profileTitle: (name: string) => string;
      nameAndAvatar: string;
    };
    calendar: {
      title: string;
      info: string;
      month: string;
      week: string;
      day: string;
      today: string;
      prev: string;
      next: string;
      allEmployees: string;
      filterEmployee: string;
      create: string;
      createTitle: string;
      editTitle: (name: string) => string;
      employee: string;
      name: string;
      nameHint: string;
      prompt: string;
      enabled: string;
      startAt: string;
      endAt: string;
      period: string;
      periodHint: string;
      delete: string;
      deleteConfirm: (name: string) => string;
      outcome: string;
      lastFired: string;
      nextFire: string;
      past: string;
      pausedNote: string;
      disabledNote: string;
      invalidFiles: string;
      empty: string;
      emptyHint: string;
      moreEvents: (n: number) => string;
      moreEventsExpand: (n: number) => string;
      openDay: string;
      weekdays: readonly string[];
      allDay: string;
      promptHint: string;
      monthTitle: (year: number, month: number) => string;
      cadence: {
        once: string;
        minutes: (n: number) => string;
        hours: (n: number) => string;
        daily: (time: string) => string;
        days: (n: number, time: string) => string;
        weekly: (time: string) => string;
        weeks: (n: number, time: string) => string;
        invalid: string;
      };
      legendEmpty: string;
      legendFilter: (name: string) => string;
      createAt: (label: string) => string;
      loadFailed: (error: string) => string;
      dismissHint: string;
      staggerHint: string;
      warningsPrefix: string;
    };
    tickets: {
      title: string;
      info: string;
      columns: Record<string, string>;
      blockedOnly: string;
      create: string;
      createTitle: string;
      empty: string;
      emptyHint: string;
      dismissHint: string;
      columnEmpty: string;
      ticketTitle: string;
      goal: string;
      goalHint: string;
      acceptance: string;
      acceptanceHint: string;
      result: string;
      owner: string;
      noOwner: string;
      ownerSelf: string;
      parent: string;
      noParent: string;
      notify: string;
      notifyHint: string;
      priority: string;
      due: string;
      noDue: string;
      blocked: string;
      blockedReason: string;
      blockedBy: string;
      blockedTooltip: (reason: string, by: string) => string;
      unblock: string;
      unblockConfirm: (title: string) => string;
      block: string;
      blockTitle: string;
      blockReasonHint: string;
      blockByHint: string;
      sessions: string;
      sessionsCount: (n: number) => string;
      progress: string;
      progressEmpty: string;
      addProgress: string;
      progressPlaceholder: string;
      children: string;
      childrenEmpty: string;
      cost: string;
      rolledUpCost: string;
      parentLine: (title: string) => string;
      moveTitle: string;
      moveConfirm: (title: string, column: string) => string;
      rejectReason: string;
      rejectReasonHint: string;
      moved: string;
      invalid: string;
      invalidFiles: string;
      edit: string;
      saved: string;
      created: string;
      detail: string;
      back: string;
      dragHint: string;
      searchPlaceholder: string;
      searchNoMatch: string;
      dropHere: string;
      overdue: string;
      summary: string;
      history: string;
      historyEmpty: string;
      historyActions: Record<string, string>;
      slug: string;
      slugHint: string;
      slugInvalid: string;
      noGoal: string;
      noAcceptance: string;
      noResult: string;
      moveTo: string;
      move: string;
      copyId: string;
      invalidTickets: string;
      loadFailed: (error: string) => string;
      notifyInfo: string;
    };
    finance: {
      title: string;
      info: string;
      period: string;
      thisPeriod: string;
      prevPeriod: string;
      total: string;
      unpriced: string;
      budget: string;
      editBudget: string;
      budgetPlaceholder: string;
      clearBudget: string;
      budgetSaved: string;
      own: string;
      cumulative: string;
      cumulativeBudget: string;
      ratio: string;
      warned: string;
      paused: string;
      spendTree: string;
      spendTreeInfo: string;
      ticketsTable: string;
      ticketsInfo: string;
      ticketsEmpty: string;
      rolledUp: string;
      expandChildren: string;
      collapseChildren: string;
      childCount: (n: number) => string;
      trend: string;
      alerts: string;
      alertsEmpty: string;
      alertWarned: (name: string, at: string) => string;
      alertPaused: (name: string, at: string) => string;
      alertsHint: string;
      kpiTotal: string;
      orgBudget: string;
      kpiEmployees: string;
      budgetsSet: (n: number) => string;
      thresholds: string;
      kpiAlerts: string;
      alertsSummary: (warned: number, paused: number) => string;
      cumulativeInfo: string;
      rolledUpInfo: string;
      root: string;
      budgetEmptyHint: string;
      saveBudget: string;
      cancelEdit: string;
      editBudgetOf: (name: string) => string;
      trendInfo: string;
      trendEmpty: string;
      alertsInfo: string;
      pausedGroup: string;
      warnedGroup: string;
      warnedAt: (at: string) => string;
      pausedAt: (at: string) => string;
      refreshFailed: string;
    };
    channels: {
      listTitle: string;
      drawerLabel: string;
      allHands: string;
      mine: string;
      others: string;
      archivedGroup: string;
      newChannel: string;
      noChannels: string;
      loadFailed: string;
      join: string;
      joining: string;
      joined: string;
      joinTitle: string;
      joinConfirm: string;
      mentionChip: string;
      badgeUnread: (n: number) => string;
      badgeMentions: (n: number) => string;
      streamLabel: (name: string) => string;
      purpose: string;
      purposeEmpty: string;
      memberCount: (n: number) => string;
      memberList: string;
      invite: string;
      inviteTitle: string;
      inviteSearch: string;
      inviteEmpty: string;
      invited: (name: string) => string;
      leave: string;
      leaveTitle: string;
      leaveConfirm: (name: string) => string;
      left: string;
      channelMenu: string;
      rename: string;
      renameTitle: string;
      editPurpose: string;
      purposeTitle: string;
      archive: string;
      unarchive: string;
      archiveTitle: string;
      archiveConfirm: (name: string) => string;
      archived: string;
      unarchived: string;
      archivedNotice: string;
      notMemberNotice: string;
      channelLoadFailed: string;
      allHandsInfo: string;
      channelInfo: string;
      allHandsNoArchive: string;
      createTitle: string;
      creating: string;
      created: string;
      idField: string;
      idHint: string;
      idReserved: string;
      idTaken: string;
      nameField: string;
      nameHint: string;
      purposeHint: string;
      empty: string;
      emptyHint: string;
      placeholder: string;
      send: string;
      you: string;
      mentionAll: string;
      mentionAllDesc: string;
      employees: string;
      members: string;
      earlierDays: string;
      ticketRef: (id: string) => string;
      sessionRef: string;
      replyTo: string;
      openTicketRef: string;
      replyToJump: string;
      hop: (n: number) => string;
      hopInfo: string;
      hopSummary: string;
      today: string;
      yesterday: string;
      noEarlier: string;
      unreadDivider: string;
      newMessages: (n: number) => string;
      mentionPanel: string;
      mentionsYou: string;
      systemMessage: string;
      sentAt: (time: string) => string;
      notices: {
        employee_joined: (agent: string, title: string, manager: string) => string;
        employee_left: (agent: string, manager: string) => string;
        channel_created: (by: string) => string;
        channel_archived: (by: string) => string;
        channel_unarchived: (by: string) => string;
        channel_joined: (principal: string) => string;
        channel_invited: (by: string, principal: string) => string;
        channel_left: (principal: string) => string;
        channel_removed: (by: string, principal: string) => string;
        budget_warned: (
          agent: string,
          percent: string,
          period: string,
          cost: string,
          budget: string,
        ) => string;
        budget_paused: (
          agent: string,
          percent: string,
          period: string,
          cost: string,
          budget: string,
        ) => string;
        ticket_blocked: (ticket: string, title: string) => string;
        ticket_done: (ticket: string, title: string) => string;
        ticket_rejected: (ticket: string, title: string) => string;
      };
    };
    handbook: {
      loadFailed: string;
    };
    /** A data path in a ticket drawn as a capsule: the hover names the whole path, a click copies it. */
    pathCapsule: { hint: (path: string) => string; copy: (path: string) => string };
    deleted: (orgId: string) => string;
    deleteOrgTypeId: (orgId: string) => string;
    deleteOrgConfirm: string;
    deleteOrgDesc: string;
    deleteOrg: string;
    timezoneInfo: string;
    clearDraftConfirm: string;
    clearDraftConfirmLabel: string;
    orgIdInfo: string;
    backToOverview: string;
  };
  errors: {
    networkError: string;
    modelCredentialMissing: (modelId: string) => string;
    speechCredentialMissing: (key: string) => string;
    noDefaultModel: string;
    byCode: {
      experiment_off: string;
      run_cleanup_plan_expired: string;
      module_build_removed: string;
      video_composition_missing: string;
      video_asset_changed: string;
      video_invalid: string;
      video_changed: string;
      test_browser_missing: string;
      composition_no_images: string;
      composition_asset_invalid: string;
      composition_image_too_large: string;
      composition_not_found: string;
      deploy_clones_running: string;
      deploy_running: string;
      deploy_blocked: string;
      deploy_run_not_found: string;
      deploy_unavailable: string;
      deploy_no_module: string;
      deploy_not_canonical: string;
      deploy_settings_missing: string;
      product_taken: string;
      module_not_a_clone: string;
      git_unavailable: string;
      activity_invalid: string;
      activity_exists: string;
      activity_not_found: string;
      activity_stopping: string;
      collection_not_found: string;
      draft_conflict: string;
      spec_invalid: string;
      description_required: string;
      generation_running: string;
      module_spec_required: string;
      media_invalid: string;
      media_stale: string;
      speech_credential_missing: string;
      speech_helper_missing: string;
      audio_invalid: string;
      audio_changed: string;
      media_missing: string;
      module_spec_invalid: string;
      run_not_found: string;
      project_deleting: string;
      invalid_credentials: string;
      too_many_attempts: string;
      password_mismatch: string;
      invalid_password: string;
      admin_required: string;
      desktop_single_user: string;
      not_found: string;
      internal: string;
      agent_not_found: string;
      job_running: string;
      password_refused: string;
      not_kept_connected: string;
      unknown_agent: string;
      agent_exists: string;
      agent_deleting: string;
      project_exists: string;
      project_not_found: string;
      cannot_delete_last_project: string;
      user_exists: string;
      user_not_found: string;
      cannot_delete_admin: string;
      member_not_found: string;
      already_member: string;
      already_owner: string;
      memory_import_confirm_required: string;
      schedule_exists: string;
      schedule_not_found: string;
      unknown_skill: string;
      unknown_plugin: string;
      goal_plugin_not_installed: string;
      skill_too_large: string;
      hook_too_large: string;
      file_not_found: string;
      not_pending: string;
      follow_up_started: string;
      file_too_large: string;
      too_many_files: string;
      payload_too_large: string;
      image_too_large: string;
      dir_not_absolute: string;
      dir_not_found: string;
      not_a_dir: string;
      path_not_found: string;
      reveal_failed: string;
      workspace_missing: string;
      workspace_not_found: string;
      session_not_found: string;
      session_deleting: string;
      approval_not_found: string;
      process_not_found: string;
      process_running: string;
      memory_file_not_found: string;
      memory_scope_not_found: string;
      task_in_progress: string;
      compacting: string;
      shutting_down: string;
      platform_rate_limited: string;
      compaction_not_configured: string;
      nothing_to_compact: string;
      already_compacted: string;
      version_conflict: string;
      version_media_changed: string;
      version_media_missing: string;
      invalid_title: string;
      invalid_proxy_url: string;
      invalid_attachment_limit: string;
      invalid_trace: string;
      trace_not_found: string;
      trace_session_exists: string;
      feishu_secret_required: string;
      feishu_not_bound: string;
      feishu_no_chat: string;
      feishu_send_failed: string;
      telegram_token_required: string;
      telegram_token_invalid: string;
      telegram_not_bound: string;
      telegram_no_chat: string;
      telegram_send_failed: string;
      another_channel_enabled: string;
      account_enabled_elsewhere: string;
      messaging_disable_before_clear: string;
      messaging_disable_before_scan: string;
      company_mode_off: string;
      org_not_found: string;
      org_exists: string;
      org_invalid: string;
      invalid_org_id: string;
      employee_not_found: string;
      employee_exists: string;
      calendar_event_exists: string;
      calendar_event_not_found: string;
      desk_unavailable: string;
      ticket_not_found: string;
      ticket_invalid: string;
      ticket_session_failed: string;
      handbook_file_not_found: string;
      handbook_index_required: string;
      timeout: string;
      shell_unreachable: string;
      source_not_found: string;
      browser_unavailable: string;
      agent_employed: string;
      wechat_needs_recent_message: string;
      wechat_send_failed: string;
      wechat_no_chat: string;
      model_unavailable: string;
      model_not_configured: string;
      same_model: string;
      dir_permission_denied: string;
      benchmark_busy: string;
      model_not_routable: string;
      wafh_go_protocol_fixed: string;
      model_not_addable: string;
      modelscope_refresh_failed: string;
    };
    notTheServer: {
      page: (status: number) => string;
      proxy: (status: number) => string;
      other: (status: number, type: string) => string;
    };
  };
  find: {
    placeholder: string;
    next: string;
    prev: string;
    close: string;
    caseSensitive: string;
    noResults: string;
    regionConversation: string;
    regionSubagent: string;
    regionSessions: string;
    regionFiles: string;
    scopeAll: string;
    scopeThisRegion: (region: string) => string;
    loadMore: string;
    loadMoreAction: string;
    moreRows: (count: number) => string;
    resultsLabel: string;
    outline: string;
    inDocument: string;
    documentPlaceholder: string;
  };
  /** The App info dialog, opened from the avatar menu: identity, links, update, release notes, credits. */
  appInfo: {
    title: string;
    menuEntry: string;
    homepage: string;
    repository: string;
    opensInNewTab: string;
    releaseNotes: string;
    earlierVersions: (n: number) => string;
    current: string;
    credits: string;
    copyright: string;
    licenses: string;
    creditsThemes: string;
    creditsNoTheme: string;
    creditsLicense: string;
    creditsSource: string;
    creditsLicenseText: string;
    creditsFonts: string;
    creditsIcons: string;
  };
  harnessHistory: {
    title: string;
    pageDesc: string;
    loading: string;
    empty: string;
    current: string;
    noProvenance: string;
    pushedAt: string;
    bundles: string;
    table: string;
    tableCounts: (nodes: number, interfaces: number, types: number) => string;
    noTable: string;
    noTableShort: string;
    changesSince: (previous: string) => string;
    changesFirst: string;
    noChanges: string;
    nodes: (n: number) => string;
    interfaces: (n: number) => string;
    typesSummary: (added: number, removed: number, changed: number) => string;
    change: { added: string; removed: string; changed: string };
    rollback: string;
    rollbackConfirm: string;
    rollbackYes: string;
    rollbackPushing: string;
    rollbackTimeout: string;
    notKept: string;
    viewChanges: string;
    viewTree: string;
    kind: { group: string; module: string; component: string };
    expand: string;
    collapse: string;
    extensionSlot: string;
    ownProvision: string;
    pickNode: string;
    requires: string;
    provides: string;
    contributes: string;
    children: string;
    exports: string;
    methods: string;
    fields: string;
    slots: string;
  };
  workbenches: {
    title: string;
    count: (n: number) => string;
    empty: string;
    agentTabDesc: string;
    open: string;
    noMatches: string;
    searchAgents: string;
    tabsLabel: string;
    chatTab: string;
    brokenMark: string;
    reload: string;
    reloading: string;
    history: string;
    loadError: string;
    loadingHistory: string;
    loadingPage: string;
    noHistory: string;
    current: string;
    restore: string;
    restoreTitle: string;
    restoreConfirm: (revision: string) => string;
    remove: string;
    fillApp: string;
    fillAppHint: (palette: string | null) => string;
    exitFullPage: string;
    exitFullPageButton: string;
    retryHistory: string;
    exitHint: (palette: string | null) => string;
    noSuchPage: string;
    removeConfirm: string;
    removeYes: string;
    removing: string;
    removeNo: string;
    fileCount: (n: number) => string;
  };
  modelPicker: { groups: string; hideModelsWithoutKey: string; hint: (mod: string) => string };
  commandPalette: {
    title: string;
    placeholder: string;
    noResults: string;
    hint: (toggle: string | null) => string;
    harnessHistory: string;
  };
  archivedSessions: {
    search: string;
    sourceFilter: string;
    projectFilter: string;
    allSources: string;
    allProjects: string;
    count: (n: number) => string;
    selectAll: string;
    deselectAll: string;
    select: (title: string) => string;
    selected: (n: number) => string;
    clearSelection: string;
    moreGroups: (n: number) => string;
    empty: string;
    noMatches: string;
    running: string;
    loadFailed: (reason: string) => string;
    actionFailed: (reason: string) => string;
    deleteTitle: (n: number) => string;
    deleteConfirm: (n: number) => string;
    unreachable: (machines: string[]) => string;
  };
  browserSettings: {
    backend: string;
    backendInfo: string;
    paired: string;
    pairedNone: string;
    pairedLine: (version: string, seen: string | null) => string;
    connected: string;
    notConnected: string;
    revoke: string;
    revokeTitle: string;
    revokeBody: (name: string) => string;
    revoked: (name: string) => string;
    revokeFailed: (reason: string) => string;
    connectFirst: string;
    connectAnother: string;
    loadFailed: (reason: string) => string;
    disabledNote: string;
    allow: string;
    offTitle: string;
    offBody: string;
    off: string;
  };
  builtinBrowser: {
    panelTitle: string;
    tabs: string;
    newTab: string;
    closeTab: string;
    untitled: string;
    back: string;
    forward: string;
    reload: string;
    stop: string;
    address: string;
    addressPlaceholder: string;
    suggestions: string;
    more: string;
    importAction: string;
    clearDataAction: string;
    setHomepageAction: string;
    openExternal: string;
    devTools: string;
    home: string;
    agentBusy: (action: string) => string;
    agentBusyTab: string;
    actions: {
      navigate: string;
      scan: string;
      exec: string;
      click: string;
      type: string;
      screenshot: string;
      cdp: string;
    };
    unavailableTitle: string;
    unavailableDesktop: string;
    unavailableShell: string;
    unavailableWindow: string;
    unavailablePairChrome: string;
    useChrome: string;
    startPage: {
      label: string;
      sites: {
        google: string;
        bing: string;
        baidu: string;
        github: string;
        stackoverflow: string;
        wikipedia: string;
      };
    };
    openFailed: (reason: string) => string;
    closeFailed: (reason: string) => string;
    backendBuiltin: string;
    backendChrome: string;
    chromeConnected: (name: string | null) => string;
    chromeNotConnected: string;
    chromeNotPaired: string;
    chromeDisabled: string;
    connectChrome: string;
    manageChrome: string;
    switchedToChrome: string;
    switchedToBuiltin: string;
    switchRefused: string;
    switchFailed: (reason: string) => string;
    chromeTabCard: string;
    showInChrome: string;
    chromeNoTabsTitle: string;
    chromeNoTabsBody: string;
    chromeDisconnectedTitle: string;
    chromeDisconnectedBody: (name: string | null) => string;
    reconnectHelp: string;
    reconnectOpen: string;
    reconnectResume: string;
    reconnectPair: string;
    chromeDisabledTitle: string;
    chromeDisabledBody: string;
    chromeUnpairedIntro: string;
    pairTitle: string;
    pairStepInstall: string;
    pairStore: string;
    pairStepInstallZip: string;
    pairDownload: string;
    pairStepOpen: string;
    pairStepPaste: string;
    pairServer: string;
    pairCode: string;
    pairCodeExpiry: (time: string) => string;
    pairCodeExpired: string;
    pairNewCode: string;
    pairCodeFailed: (reason: string) => string;
    pairWaiting: string;
    pairConnected: string;
    importTitle: string;
    importIntro: string;
    importLoading: string;
    importNone: string;
    importSourcesFailed: (reason: string) => string;
    importSource: string;
    importWhat: string;
    importCookies: string;
    importHistory: string;
    importDomains: string;
    importDomainsHint: string;
    importDomainsPlaceholder: string;
    importKeychainNote: string;
    importRun: string;
    importRunning: string;
    importDone: string;
    importCookiesResult: (c: {
      found: number;
      imported: number;
      skipped: number;
      failed: number;
    }) => string;
    importHistoryResult: (h: { found: number; imported: number }) => string;
    importFailed: (reason: string) => string;
    clearTitle: string;
    clearBody: string;
    clearCookies: string;
    clearCache: string;
    clearStorage: string;
    clearHistory: string;
    clearConfirm: string;
    clearDone: string;
    clearFailed: (reason: string) => string;
    homepageTitle: string;
    homepageIntro: string;
    homepageAddress: string;
    homepagePlaceholder: string;
    homepageHintEmpty: string;
    homepageHintOpens: (url: string) => string;
    homepageUseCurrent: string;
    homepageClear: string;
    homepageFailed: (reason: string) => string;
    crashedTitle: string;
    crashedOutOfMemory: string;
    crashedBody: string;
    crashedTab: string;
    load: {
      memory: (size: string, tabs: number) => string;
      lowSystemMemory: (percent: number) => string;
      manyTabs: (tabs: number) => string;
      advice: string;
      join: (sentences: string[]) => string;
      heavyTab: (size: string) => string;
    };
  };
  /** Keyboard shortcuts: the registry's command and group labels (lib/shortcuts/registry.ts). */
  shortcuts: {
    commands: {
      "palette.toggle": string;
      "sessions.search": string;
      "quickSwitcher.toggle": string;
      "chat.new": string;
      "find.open": string;
      "find.all": string;
      "sidebar.toggle": string;
      "dock.toggleRight": string;
      "dock.toggleBottom": string;
      "terminal.toggle": string;
      "terminal.new": string;
      "terminal.close": string;
      "editor.save": string;
    };
    groups: { general: string; panels: string; terminal: string; editor: string };
    scopes: { terminal: string; editor: string };
    unbound: string;
    rebind: string;
    record: string;
    recordHint: string;
    needsModifier: string;
    resetRow: string;
    resetAll: string;
    resetAllBody: (n: number) => string;
    conflictSame: (other: string) => string;
    conflictShadowed: (other: string, surface: string) => string;
    browserReserved: string;
    browserCommon: string;
    desktopMenuReserved: string;
    saveFailed: string;
  };
};
