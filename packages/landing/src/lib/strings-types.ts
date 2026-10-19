/** The landing page's dictionary contract: the English dictionary in strings-en.ts implements it. */
export type Strings = {
  siteName: string;
  announcement: {
    label: string;
    prev: string;
    next: string;
    geminiArgon: string;
    tokenDanceChallenge: string;
    penguinGo: string;
  };
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
  hero: {
    positioning: string;
    /** The badge on the positioning line's top-right corner. */
    badge: string;
    automation: string;
    downloadCta: string;
    cliInstall: string;
    stats: {
      value: string;
      label: string;
    }[];
    /**
     * The three catalogue rows under the stat tiles, each led by its count; their entries live in
     * lib/rsi-stats.ts. The model count is a claim about the catalog and is spelled here; the
     * algorithm and Benchmark counts are those lists' lengths.
     */
    supportedModelsCount: string;
    supportedModelsLabel: string;
    supportedModelsMore: string;
    algorithmsLabel: string;
    benchmarksLabel: string;
    /** One per BENCHMARKS entry, in its order (the benchmarks of Sec A to Sec E, then GDPevo): the kind of each. */
    benchmarkKinds: string[];
    /** The confirmation an outside link in the catalogue rows asks before it opens. */
    externalLink: {
      title: string;
      body: string;
      cancel: string;
      open: string;
    };
  };
  /** Install-method switcher (quick start step 1): OS tabs, online/offline methods. */
  install: {
    linux: string;
    macos: string;
    windows: string;
    online: string;
    offline: string;
    offlineNote: string;
    offlineHints: {
      linux: string;
      macos: string;
      windows: string;
    };
    offlineRelease: string;
    desktopNote: string;
    desktopPage: string;
  };
  download: {
    eyebrow: string;
    title: string;
    recommended: string;
    platforms: {
      mac: {
        name: string;
        require: string;
      };
      windows: {
        name: string;
        require: string;
      };
      linux: {
        name: string;
        require: string;
      };
    };
    speed: {
      title: string;
      subtitle: string;
      github: string;
      githubHint: string;
      oss: string;
      ossHint: string;
      testing: string;
      skipped: string;
      unreachable: string;
      belowFloor: string;
      selected: string;
      automatic: string;
      manual: string;
    };
    statusProbing: string;
    statusRefining: string;
    statusOss: (version: string) => string;
    statusGithub: string;
    altGithub: string;
    altOss: string;
    checksums: string;
    allReleases: string;
    /**
     * First-launch FAQ. The macOS builds are Developer ID signed and notarized and the
     * Windows installers are Authenticode signed, so those two platforms have nothing to
     * unblock; the Linux AppImage's execute bit is the one item left, pre-expanded for a
     * Linux visitor.
     */
    faq: {
      title: string;
      intro: string;
      linux: {
        question: string;
        answer: string;
      };
    };
    cliHint: string;
    cliHintLink: string;
  };
  copy: {
    copy: string;
    copied: string;
  };
  /** A live frame's window bar and its stand-in (components/live-app-frame.tsx). */
  live: {
    /** The link to the same screen in the component gallery, full size. */
    open: string;
    loading: string;
  };
  /** The app live under the hero, and the three rows beside it (sections/showcase.tsx). */
  showcase: {
    /** Each `frame` names its frame for assistive technology. */
    start: string;
    evolve: {
      title: string;
      text: string;
      link: string;
      frame: string;
    };
    evaluate: {
      title: string;
      text: string;
      link: string;
      frame: string;
    };
    toolkits: {
      title: string;
      /** `names`: the paper toolkits, already listed (OPRO、APE、…). */
      text: (names: string) => string;
      link: string;
      frame: string;
    };
  };
  /** The self-evolution loop and its three recorded numbers (sections/self-improve.tsx). */
  selfImprove: {
    title: string;
    subtitle: string;
    nodeOptimizer: string;
    nodeEvaluator: string;
    nodeTarget: string;
    edgeSpawn: string;
    edgeFeedback: string;
    edgeBench: string;
    edgeImprove: string;
    noteOld: string;
    noteNew: string;
    /** Index-aligned with TRENDS in sections/self-improve.tsx. */
    trends: {
      label: string;
      hint: string;
    }[];
    trendsNote: string;
    demo: {
      caption: string;
      cost: string;
    };
    diagramLabel: string;
  };
  quickstart: {
    title: string;
    subtitle: string;
    stepOne: string;
    chooseInstall: string;
    stepTwo: string;
    chooseLaunch: string;
    tabs: {
      desktop: string;
      install: string;
      web: string;
      cli: string;
    };
    desktop: {
      title: string;
      desc: string;
      cta: string;
      steps: string[];
    };
    install: {
      title: string;
      desc: string;
      osLabel: string;
      onlineTitle: string;
      offlineTitle: string;
      offlineDesc: string;
      offlineCommand: string;
    };
    web: {
      title: string;
      desc: string;
      command: string;
      steps: string[];
    };
    cli: {
      title: string;
      desc: string;
      command: string;
    };
    localNote: string;
  };
  cases: {
    title: string;
    subtitle: string;
    prompt: string;
    caption: string;
    cost: string;
  };
  /**
   * The radiating diagram and its cards (sections/pillars.tsx): each item's `concept` labels one
   * branch of the diagram and the card under it. Concept names are product names.
   */
  pillars: {
    title: string;
    subtitle: string;
    root: string;
    diagramLabel: string;
    items: {
      concept: string;
      title: string;
      desc: string;
      link: string;
    }[];
  };
  /** Building on an agent library against PenguinHarness (sections/compare.tsx). */
  compare: {
    title: string;
    subtitle: string;
    library: {
      name: string;
      mode: string;
      note: string;
    };
    penguin: {
      name: string;
      mode: string;
      note: string;
    };
  };
  scenarios: {
    title: string;
    subtitle: string;
    items: {
      title: string;
      alt: string;
      body: string;
    }[];
  };
  benchmark: {
    title: string;
    subtitle: string;
    higherBetter: string;
    lowerBetter: string;
    dimScore: string;
    dimTokens: string;
    dimCost: string;
    dataTitle: string;
    dataDesc: string;
    dataFootnote: string;
    codeTitle: string;
    codeDesc: string;
    codeFootnote: string;
    colFramework: string;
    colModel: string;
    colAccuracy: string;
    colTokens: string;
    colCost: string;
  };
  /** The latest posts on the home page (sections/updates.tsx). */
  updates: {
    title: string;
    all: string;
  };
  community: {
    title: string;
    subtitle: string;
    items: {
      discord: {
        name: string;
        desc: string;
      };
      x: {
        name: string;
        desc: string;
      };
      wechat: {
        name: string;
        desc: string;
      };
      github: {
        name: string;
        desc: string;
      };
    };
  };
  cta: {
    title: string;
    subtitle: string;
    download: string;
    quickstart: string;
    docs: string;
  };
  footer: {
    tagline: string;
    product: string;
    resources: string;
    quickstart: string;
    cases: string;
    blog: string;
    repo: string;
    docs: string;
    releases: string;
    license: string;
    copyright: string;
  };
  blog: {
    title: string;
    subtitle: string;
    all: string;
    news: string;
    practice: string;
    perspectives: string;
    changelog: string;
    pinned: string;
    copyLink: string;
    linkCopied: string;
    back: string;
    empty: string;
    notFound: string;
    backHome: string;
    toc: string;
  };
};
