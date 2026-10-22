/**
 * The gallery chrome's dictionary contract: the English dictionary in strings-en.ts implements it.
 * These strings are the gallery's own and never reach the product; theme ids, token names, accent
 * preset ids and font names are not copy and stay as they are.
 *
 * `surfaces` names the app's surfaces the gallery frames (src/app/surfaces.ts) and `library`
 * the component library's topics (src/library/topics.ts); a test checks each covers every id.
 */
import type {
  HookName,
  StreamReveal,
  TextVariant,
  ThemeId,
  ToneName,
} from "@prismshadow/penguin-ui";
import type { TextSize } from "@prismshadow/penguin-ui/boot";
import type { A2uiSpec } from "@prismshadow/penguin-core/a2ui";
import type { SurfaceGroupId, SurfaceId } from "./app/surfaces";
import type { ChartToken } from "./library/chart-tokens";
import type { TopicGroupId, TopicId } from "./library/topics";
/** A block of the A2UI sample reply: the sentence that introduces it, and the block itself. */
export interface A2uiSample {
  lead: string;
  spec: A2uiSpec;
}
/** What a surface page says: its title, one line on what the frame shows, and how the app reaches it. */
export interface SurfaceCopy {
  title: string;
  description: string;
  /** Where the surface sits in the app, for a reader who wants to find it themselves. */
  how: string;
}
export interface GalleryStrings {
  /**
   * The site navbar's copy (site/nav.tsx), the landing page's own words: its dictionary's `nav`,
   * `theme` and `siteName`, under one key here.
   */
  sitebar: {
    siteName: string;
    nav: {
      home: string;
      blog: string;
      download: string;
      docs: string;
      gallery: string;
      github: string;
      openMenu: string;
      closeMenu: string;
    };
    theme: {
      label: string;
      light: string;
      dark: string;
      system: string;
    };
  };
  /** The gallery bar's page links and settings button, the left nav and the "on this page" list. */
  site: {
    home: string;
    surfaces: string;
    foundations: string;
    fonts: string;
    pages: string;
    search: string;
    searchShortcut: string;
    noMatches: string;
    nav: string;
    onThisPage: string;
    settings: string;
    notFound: (id: string) => string;
    allSurfaces: string;
    feedbackTitle: string;
    feedbackBody: string;
    feedbackExample: string;
  };
  /** The surface groups (src/app/surfaces.ts): the index's headings, the nav's eyebrows, a page's eyebrow. */
  surfaceGroups: Record<SurfaceGroupId, string>;
  surfaces: Record<SurfaceId, SurfaceCopy>;
  home: {
    eyebrow: string;
    title: string;
    lead: string;
    app: string;
    appLead: string;
    index: string;
    indexLead: string;
    library: string;
    libraryLead: string;
    fonts: string;
    fontsLead: string;
  };
  /**
   * The view controls' copy, in the gallery bar; the key keeps the name of the rail that held
   * them, which the Foundations boards read (`S.rail.scriptNames`).
   */
  rail: {
    theme: string;
    themeNames: Record<ThemeId, string>;
    accent: string;
    accentTheme: string;
    size: string;
    sizeNames: Record<TextSize, string>;
    sizeTitle: (name: string, px: number) => string;
    fontLatin: string;
    fontCjk: string;
    fontTheme: string;
    fontSystem: string;
    viewport: string;
    viewports: {
      desktop: string;
      phone: string;
    };
    scriptNames: {
      latin: string;
      cjk: string;
    };
  };
  /** The current fonts, read from the framed app: the role labels before each family. */
  readout: {
    label: string;
    latin: string;
    cjk: string;
    mono: string;
    system: string;
    pending: string;
  };
  /** The breadcrumb's own words; everything else in it is a name from elsewhere. */
  crumb: {
    modes: {
      light: string;
      dark: string;
    };
    phone: string;
  };
  intro: {
    resolving: string;
  };
  /** A framed app's toolbar and captions. */
  frame: {
    open: string;
    reload: string;
    frameOf: (theme: string) => string;
    how: string;
    route: string;
    signedOut: string;
  };
  section: {
    copyLink: string;
    copyBreadcrumb: string;
    unset: string;
  };
  foundations: {
    surfaces: string;
    inks: string;
    lines: string;
    inkWords: readonly string[];
    accent: string;
    presetsHint: string;
    themeAccent: string;
    sampleSend: string;
    selectedRow: string;
    sampleLink: string;
    linkHover: string;
    tones: string;
    toneWords: Record<ToneName, string>;
    charts: string;
    tokenSeries: string;
    code: string;
    codeLines: {
      before: string;
      removed: string;
      added: string;
      after: string;
      selected: string;
    };
    typeNote: string;
    scene: {
      pageTier: string;
      cardTitle: string;
      cardMeta: string;
      nested: string;
      primary: string;
      secondary: string;
      input: string;
      badge: string;
      menuTier: string;
      menuItems: readonly string[];
      backdropTier: string;
      dialogTitle: string;
      dialogBody: string;
      cancel: string;
      confirm: string;
      toastTier: string;
      toast: string;
    };
    radius: string;
    shadows: string;
    spacingPage: {
      title: string;
      appearance: string;
      theme: string;
      themeOptions: readonly string[];
      fontSize: string;
      sizeOptions: readonly string[];
      general: string;
      notifications: string;
    };
    stack0Note: string;
    controlHeights: string;
    iconSizes: string;
    iconRegistry: (icons: number, files: number) => string;
    duplicateNames: string;
    iconMarks: string;
    durations: string;
    reducedNote: string;
    liveSignal: string;
    loading: string;
    focusRing: string;
    inputFocus: string;
    selection: string;
    scrollbar: string;
    spaceUnit: string;
    spaceUnitNote: string;
    shell: string;
    shellNote: string;
    presence: string;
    presenceNote: string;
    reveal: string;
    revealNote: string;
    layout: string;
    layoutNote: string;
    replay: string;
    replayAll: string;
    motionSpecimens: {
      menu: string;
      dialog: string;
      toast: string;
      trigger: string;
      sidebarRows: readonly string[];
      revealRows: readonly {
        name: string;
        detail: string;
      }[];
    };
    hookJobs: Record<HookName, string>;
    hookSamples: {
      menu: readonly string[];
      group: string;
      rows: readonly string[];
      copy: string;
      tabs: readonly string[];
      streaming: string;
      tree: {
        root: string;
        dir: string;
        files: readonly string[];
        last: string;
      };
      field: {
        name: string;
        value: string;
        hint: string;
        notify: string;
        notifyHint: string;
      };
    };
  };
  fonts: {
    title: string;
    pages: {
      defaults: string;
      specimens: string;
      licences: string;
    };
    defaultsTitle: string;
    defaultsHint: string;
    system: string;
    current: string;
    currentHint: string;
    followsTheme: (theme: string) => string;
    specimensTitle: string;
    licencesTitle: string;
    specimens: string;
    specimensHint: string;
    declared: string;
    declaredHint: string;
    noFaces: string;
    family: string;
    weight: string;
    slicesColumn: string;
    loadStatus: string;
    licences: string;
    noLicences: string;
    status: {
      loaded: string;
      unloaded: string;
      loading: string;
      error: string;
    };
  };
  /** The component library: its topics, and the words each board prints. */
  library: {
    title: string;
    groups: Record<TopicGroupId, string>;
    topics: Record<
      TopicId,
      {
        title: string;
        description: string;
      }
    >;
    buttons: {
      variants: string;
      primary: string;
      secondary: string;
      danger: string;
      ghost: string;
      link: string;
      sizes: string;
      md: string;
      sm: string;
      xs: string;
      leading: string;
      icon: string;
      iconHint: string;
      add: string;
      edit: string;
      states: string;
      disabled: string;
      busy: string;
      links: string;
      linksHint: string;
      inlineBefore: string;
      inlineLink: string;
      inlineAfter: string;
      external: string;
      keys: string;
      shortcuts: readonly (readonly string[])[];
    };
    inputs: {
      basics: string;
      name: string;
      namePlaceholder: string;
      nameHint: string;
      email: string;
      emailValue: string;
      emailError: string;
      required: string;
      info: string;
      infoText: string;
      sizes: string;
      base: string;
      small: string;
      textarea: string;
      textareaPlaceholder: string;
      mono: string;
      monoValue: string;
      password: string;
      passwordHint: string;
      affix: string;
      affixContext: string;
      affixToken: string;
      affixPrice: string;
      affixCurrency: string;
      affixUnit: string;
      search: string;
      searchField: string;
      searchIcon: string;
      searchPanel: string;
      searchMenu: string;
      checkboxes: string;
      checkboxLabel: string;
      checkboxHint: string;
      checkboxAll: string;
      checkboxDisabled: string;
      radios: string;
      radioLabel: string;
      radioSkip: string;
      radioSkipHint: string;
      radioOverwrite: string;
      radioOverwriteHint: string;
      radioReplace: string;
      radioReplaceHint: string;
      radioInline: string;
    };
    pickers: {
      select: string;
      selectLabel: string;
      sizes: string;
      sizeRow: (size: string) => string;
      sizeSearch: string;
      sizeButton: string;
      options: readonly string[];
      segmented: string;
      segments: readonly string[];
      switches: string;
      switchLabel: string;
      switchHint: string;
      switchOff: string;
      toggleRows: string;
      toggleRowLabel: string;
      toggleRowInfo: string;
      togglePlainLabel: string;
      togglePlainHint: string;
      toggleCardLabel: string;
      swatches: string;
      optionMenu: string;
      optionLabel: string;
      choices: readonly {
        value: string;
        trigger: string;
        label: string;
        description: string;
      }[];
      dropdown: string;
      menu: string;
      menuPin: string;
      menuRename: string;
      menuMove: string;
      menuDelete: string;
      menuRows: string;
      menuRowsHint: string;
      menuSettings: string;
      menuAppInfo: string;
      menuVersion: string;
      menuSignOut: string;
      menuGroupBy: string;
      menuByWorkspace: string;
      menuByAgent: string;
      menuSortBy: string;
      menuRecent: string;
      menuManual: string;
    };
    toasts: {
      fire: string;
      hint: string;
      success: string;
      info: string;
      attention: string;
      error: string;
      successText: string;
      infoText: string;
      attentionText: string;
      errorText: string;
    };
    notices: {
      plain: string;
      dotted: string;
      withActions: string;
      texts: {
        info: string;
        success: string;
        attention: string;
        danger: string;
        neutral: string;
      };
      action: string;
      dismiss: string;
      variants: string;
      variantNames: {
        strip: string;
        callout: string;
        inline: string;
        banner: string;
      };
      bannerText: string;
      bannerAction: string;
      closable: string;
      reopen: string;
      closableHint: string;
      closableText: string;
      retry: string;
      calloutTitle: string;
      calloutBody: string;
      todo: string;
      todoText: string;
      todoAction: string;
      todoDismiss: string;
    };
    dialogs: {
      modal: string;
      openModal: string;
      modalTitle: string;
      modalBody: string;
      save: string;
      cancel: string;
      confirm: string;
      openConfirm: string;
      confirmTitle: string;
      confirmBody: string;
      confirmLabel: string;
      openSaveConfirm: string;
      saveConfirmTitle: string;
      saveConfirmBody: string;
      paged: string;
      openPaged: string;
      pagedTitle: string;
      pagedGroups: {
        app: string;
        you: string;
      };
      pages: {
        general: string;
        appearance: string;
        account: string;
      };
      pageBody: string;
      appearanceInfo: string;
      drawer: string;
      openDrawer: string;
      drawerTitle: string;
      drawerBody: string;
      sheet: string;
      openSheet: string;
      sheetTitle: string;
      sheetBody: string;
      lightbox: string;
      lightboxHint: string;
      lightboxAlt: string;
      palette: string;
      paletteAside: string;
      openPalette: string;
      palettePlaceholder: string;
      paletteEmpty: string;
      paletteHint: string;
    };
    tooltips: {
      attribute: string;
      attributeHint: string;
      component: string;
      componentHint: string;
      truncated: string;
      truncatedHint: string;
      edit: string;
      copy: string;
      settings: string;
      besideTip: string;
      belowTip: string;
      command: string;
    };
    tabs: {
      basic: string;
      badged: string;
      items: readonly string[];
      badgeText: string;
      body: (tab: string) => string;
    };
    badges: {
      pills: string;
      pillsHint: string;
      pillRow: {
        thisServer: string;
        running: string;
        update: string;
        caption: string;
      };
      badges: string;
      tones: {
        neutral: string;
        success: string;
        attention: string;
        danger: string;
        done: string;
        info: string;
      };
      variants: {
        soft: string;
        outline: string;
        solid: string;
      };
      count: string;
      dots: string;
      dotsHint: string;
      live: string;
      status: string;
      states: {
        running: string;
        waiting: string;
        done: string;
        failed: string;
        stopped: string;
      };
      activity: string;
      activities: {
        running: string;
        compacting: string;
        completedUnread: string;
      };
      marks: string;
      background: string;
      schedule: string;
      dot: string;
      dotAnchor: string;
      pill: string;
      pillText: string;
      statTile: string;
      spend: string;
      spendDetail: string;
      alerts: string;
      alertsDetail: string;
      statChip: string;
      input: string;
      output: string;
      elapsed: string;
    };
    empty: {
      page: string;
      title: string;
      description: string;
      action: string;
      settings: string;
      settingsText: string;
    };
    loading: {
      spinner: string;
      sizes: string;
      skeleton: string;
      list: string;
      card: string;
      progress: string;
      progressHint: string;
      progressLabel: string;
      progressOver: string;
      progressIndeterminate: string;
    };
    streaming: {
      reply: string;
      output: string;
      receiving: string;
      received: string;
      modes: Record<StreamReveal, string>;
      unset: string;
      rate: (perSecond: number) => string;
      reduced: string;
    };
    charts: {
      parts: {
        primitives: string;
        primitivesHint: string;
        tokens: string;
        tokensHint: string;
        charts: string;
        chartsHint: string;
      };
      primitives: {
        bar: string;
        barHint: string;
        line: string;
        lineHint: string;
        curves: {
          linear: string;
          smooth: string;
          step: string;
        };
        area: string;
        areaHint: string;
        point: string;
        pointHint: string;
        arc: string;
        arcHint: string;
        grid: string;
        gridHint: string;
        timeline: string;
        timelineHint: string;
        kinds: {
          thinking: string;
          text: string;
          tool_call: string;
          approval: string;
          tool: string;
        };
      };
      palette: string;
      geometry: string;
      tokenMeaning: Record<ChartToken, string>;
      donut: string;
      donutHint: string;
      donutLabels: {
        usage: string;
        cacheRead: string;
        cacheWrite: string;
        output: string;
      };
      ring: string;
      ringHint: string;
      ringSpend: (percent: number) => string;
      ringNoBudget: string;
      ringShares: string;
      ringContext: string;
      ringContextAt: (percent: number) => string;
      legend: string;
      legendHint: string;
      legendHitRate: string;
      legendParts: readonly string[];
      trend: string;
      trendHint: string;
      tokens: string;
      tokensHint: string;
      requests: string;
      requestsHint: string;
      agents: readonly string[];
      activity: string;
      activityHint: string;
      sparkline: string;
      sparklineHint: string;
      timeline: string;
      timelineHint: string;
    };
    avatars: {
      user: string;
      agent: string;
      stack: string;
      stackShown: (shown: number, total: number) => string;
      userNames: readonly string[];
      agents: readonly {
        id: string;
        name: string;
      }[];
    };
    site: {
      footer: string;
      footerHint: string;
      tagline: string;
      columns: readonly {
        title: string;
        links: readonly string[];
      }[];
      lineLinks: readonly string[];
      copyright: string;
      code: string;
      codeHint: string;
      copy: string;
      copiedAnnouncement: string;
      copyMarkdown: string;
      copyLink: string;
      pills: string;
      pillsHint: string;
      pillTones: {
        brand: string;
        "brand-outline": string;
        teal: string;
        neutral: string;
      };
      article: string;
      articleHint: string;
      articleBody: string;
      toc: string;
      sidebar: string;
      sidebarHint: string;
      sidebarSections: readonly {
        title: string;
        pages: readonly string[];
        children: readonly string[];
      }[];
      search: string;
      searchHint: string;
      searchLabels: {
        open: string;
        label: string;
        placeholder: string;
        start: string;
        noResults: string;
        noResultsHint: string;
        results: string;
        close: string;
        keyboardHint: string;
      };
      searchResults: readonly {
        title: string;
        context: string;
        snippet: string;
      }[];
      leave: string;
      leaveHint: string;
      leaveLink: string;
      leaveLabels: {
        title: string;
        body: string;
        cancel: string;
        open: string;
      };
    };
    files: {
      tree: string;
      treeLabel: string;
      browser: string;
      header: string;
      emptyPreview: string;
      emptyDir: string;
      root: string;
      readme: string;
      truncated: string;
      unsupported: string;
      download: string;
      panel: string;
      panelHint: string;
      search: string;
      treeWidth: string;
      selectFile: string;
      wrap: string;
      crumbs: string;
      crumbsHint: string;
      menu: string;
      menuFile: string;
      menuFolder: string;
      copyPath: string;
      addToChat: string;
      addSelection: string;
      uploadHere: string;
      rename: string;
      delete: string;
      newTextFile: string;
      newFolder: string;
      editor: string;
      editorLabel: (name: string) => string;
      drop: string;
      dropAttach: string;
      dropAttachHint: string;
      dropUpload: (dir: string) => string;
    };
    content: {
      headings: string;
      headingsHint: string;
      display: string;
      heading: (level: number) => string;
      text: string;
      samples: Record<TextVariant, string>;
      inline: {
        before: string;
        code: string;
        after: string;
      };
      prose: string;
      proseSample: string;
      reader: string;
      readerHint: string;
      readerNarrow: string;
      readerSample: string;
      compact: string;
      compactSample: string;
      tables: string;
      tablesHint: string;
      tableWide: string;
      tableWideSample: string;
      tableShort: string;
      tableShortSample: string;
      code: string;
      surface: string;
      diff: string;
      unified: string;
      split: string;
      patch: string;
      diffLabel: string;
      patchLabel: string;
      a2ui: string;
      a2uiHint: string;
      a2uiReply: A2uiSample[];
      a2uiDiagramLead: string;
      a2uiDiagram: string;
      a2uiInvalidLead: string;
    };
    layout: {
      page: string;
      pageHint: string;
      pageTitle: string;
      pageInfo: string;
      pageDescription: string;
      pageBody: string;
      back: string;
      search: string;
      create: string;
      cards: string;
      padded: string;
      cardTitle: string;
      cardInfo: string;
      cardAction: string;
      cardValue: string;
      cardBody: string;
      flush: string;
      flushTitle: string;
      flushDescription: string;
      flushRows: string[];
      ruled: string;
      ruledTitle: string;
      ruledInfo: string;
      ruledAction: string;
      ruledBody: string;
      collapsible: string;
      collapsibleHint: string;
      providerName: string;
      modelCount: (n: number) => string;
      addModel: string;
      foldedTitle: string;
      foldedBody: string;
      entity: string;
      entityName: string;
      entityDescription: string;
      copyId: string;
      entityAction: string;
      entityTags: string[];
      nav: string;
      navHint: string;
      navLabel: string;
      navRail: string;
      navDense: string;
      navRows: {
        overview: string;
        models: string;
        schedules: string;
        vault: string;
        billing: string;
      };
    };
    data: {
      table: string;
      tableHint: string;
      caption: string;
      columns: {
        name: string;
        status: string;
        period: string;
        cost: string;
        employee: string;
      };
      enabled: string;
      paused: string;
      pause: string;
      enable: string;
      bare: string;
      spendTitle: string;
      employees: string[];
      rows: string;
      rowsHint: string;
      skillDescriptions: string[];
      skillMeta: string;
      exportSkill: (name: string) => string;
      clickable: string;
      cases: string[];
      longRows: string;
      longRowsHint: string;
      memoryTitle: string;
      memoryCount: (n: number) => string;
      memoryDescriptions: string[];
      viewMemory: (name: string) => string;
      editMemory: (name: string) => string;
      deleteMemory: (name: string) => string;
      keyValue: string;
      labels: {
        version: string;
        started: string;
        root: string;
        machineId: string;
      };
      log: string;
      logHint: string;
      logLabel: string;
    };
    machines: {
      pills: string;
      pillsHint: string;
      states: {
        serving: string;
        ready: string;
        queued: string;
        working: string;
        reconnecting: string;
        reconnectStopped: string;
        failed: string;
        signInRefused: string;
        installedOnly: string;
        behind: string;
        notConnected: string;
        unreachable: string;
        stopped: string;
        notInstalled: string;
        unknown: string;
      };
      reasons: {
        failed: string;
        unreachable: string;
        working: string;
        reconnecting: string;
        reconnectStopped: string;
        behind: string;
      };
      cards: string;
      cardsHint: string;
      card: {
        thisServer: string;
        undeletable: string;
        local: string;
        checked: string;
        use: string;
        settings: string;
        remove: string;
        sync: string;
        update: string;
        installing: string;
      };
      waits: {
        stopped: string;
        notConnected: string;
        failed: string;
        notInstalled: string;
        windows: string;
      };
      loading: string;
      toolbar: string;
      toolbarHint: string;
      toolbarLabel: string;
      held: string;
      verbs: {
        update: string;
        stop: string;
        restart: string;
        configure: string;
        uninstall: string;
      };
      add: string;
      addHint: string;
      addIntro: string;
      tabs: {
        config: string;
        manual: string;
      };
      search: string;
      elsewhere: (version: string) => string;
      addError: string;
      installNow: string;
      cancel: string;
      submit: string;
      submitCount: (count: number) => string;
      exhaustedCaption: string;
      noHosts: string;
    };
    retry: {
      phases: string;
      phasesHint: string;
      blocks: string;
      blocksHint: string;
      inCard: string;
      inCardHint: string;
      inChat: string;
      inChatHint: string;
      narrow: string;
      narrowHint: string;
      trying: (n: number, m: number) => string;
      failed: (n: number, m: number) => string;
      countdown: (s: number) => string;
      gaveUp: (m: number) => string;
      stoppedSsh: string;
      stoppedPassword: string;
      retryNow: string;
      retry: string;
      lasting: string;
      refused: (alias: string) => string;
      hostKey: string;
      password: string;
      states: { ready: string; reconnecting: string; reconnectStopped: string };
      card: { checked: string; use: string; settings: string; remove: string };
      chatRetryNow: string;
      chatGiveUp: string;
      chatLine: (n: number) => string;
    };
    attachments: {
      composer: string;
      composerHint: string;
      sent: string;
      sentHint: string;
      steer: string;
      steerHint: string;
      narrow: string;
      narrowHint: string;
      shapes: string;
      shapesHint: string;
      failed: string;
      failedHint: string;
      reset: string;
      imageAlt: string;
      removeImage: string;
      removeFile: string;
      unavailable: string;
      prompt: string;
      steerText: string;
      steerLabel: string;
      time: string;
      copy: string;
      placeholder: string;
    };
  };
}
