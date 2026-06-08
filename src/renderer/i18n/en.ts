export default {
  settings: {
    eyebrow: 'Workspace settings',
    title: 'Settings',
    lede: 'Manage shell, provider, and application details for the current workspace.',
    heroLabel: 'Current section',
    searchLabel: 'Search settings',
    searchPlaceholder: 'Search settings',
    navLabel: 'Sections',
    navText: 'Core preferences and reference information.',
    noResultsTitle: 'No matching settings',
    noResultsDescription: 'Try a broader term or clear the current search query.',
    tabs: {
      general: { label: 'General', summary: 'Shell path and terminal font size.' },
      terminal: { label: 'Terminal', summary: 'Typography, cursor, scroll, and behavior.' },
      providers: { label: 'Providers', summary: 'Local provider executable paths.' },
      advanced: { label: 'Advanced', summary: 'CLI and experimental features.' },
      about: { label: 'About', summary: 'Version, stack, and project links.' }
    },
    stoactlToggle: {
      title: 'stoa-ctl command-line control',
      description: 'Expose stoa-ctl in PATH and allow external scripts to control sessions via HTTP. Disabled by default.',
      enabledLabel: 'Enabled',
      disabledLabel: 'Disabled',
      warningOnEnable: 'Enabling stoa-ctl will register it in your user PATH and start the /ctl HTTP control plane. Restart required to take effect on new sessions.'
    }
  },

  general: {
    eyebrow: 'General',
    title: 'Shell and terminal defaults',
    description: 'Configure the default shell path and the monospace scale used by terminal surfaces.',
    shellSection: {
      title: 'Shell executable',
      description: 'Use the detected shell when available, or point Stoa at a custom binary.',
      badge: 'Path',
      label: 'Shell path',
      placeholder: 'Auto-detected',
      browse: 'Browse',
      detecting: 'Detecting...',
      autoDetected: 'Auto-detected',
      autoDetectedWith: 'Auto-detected: {path}',
      customPath: 'Custom path'
    },
    workspaceIdeSection: {
      title: 'Workspace quick access',
      description: 'Choose the IDE used by active session shortcuts and optionally pin its executable path.',
      badge: 'IDE',
      ideLabel: 'Workspace IDE',
      pathLabel: 'VS Code executable',
      pathPlaceholder: 'Use system PATH',
      browse: 'Browse',
      selectExecutable: 'VS Code executable',
      detecting: 'Searching for VS Code\u2026',
      autoDetected: 'VS Code detected automatically',
      autoDetectedWith: 'Auto-detected: {path}',
      customPath: 'Using custom path',
      autoDetect: 'Auto-detect'
    },
    typographySection: {
      title: 'Typography',
      description: 'Font family and size for both the terminal and interface.',
      badge: 'Font',
      fontFamily: 'Font family',
      fontFamilyCJK: 'CJK font family',
      fontSize: 'Font size'
    },
    themeSection: {
      title: 'App theme',
      description: 'Select how Stoa should render its theme. Mica and Acrylic styles are supported.',
      badge: 'Theme',
      themeLabel: 'App theme',
      options: {
        light: 'Light',
        dark: 'Dark',
        system: 'System Default'
      }
    },
    languageSection: {
      title: 'Display language',
      description: 'Choose the interface language. Changes take effect immediately.',
      badge: 'Locale'
    }
  },

  language: {
    en: 'English',
    'zh-CN': '简体中文'
  },

  terminalSettings: {
    eyebrow: 'Terminal',
    title: 'Terminal appearance and behavior',
    description: 'Fine-tune how terminal surfaces render text, cursors, and respond to input.',
    typography: {
      title: 'Typography',
      description: 'Font face, size, weight, and spacing for terminal content.',
      badge: 'Text',
      fontFamily: 'Font family',
      fontFamilyCJK: 'CJK font family',
      fontSize: 'Font size',
      fontWeight: 'Font weight',
      fontWeightBold: 'Bold font weight',
      lineHeight: 'Line height',
      letterSpacing: 'Letter spacing'
    },
    cursor: {
      title: 'Cursor',
      description: 'Cursor shape, blink, and inactive-state appearance.',
      badge: 'Cursor',
      cursorBlink: 'Cursor blink',
      cursorStyle: 'Cursor style',
      cursorInactiveStyle: 'Inactive cursor style'
    },
    display: {
      title: 'Scrolling and display',
      description: 'Scroll buffer size, contrast, and GPU rendering.',
      badge: 'Display',
      scrollback: 'Scrollback lines',
      minimumContrastRatio: 'Minimum contrast ratio',
      gpuAcceleration: 'GPU acceleration'
    },
    behavior: {
      title: 'Behavior',
      description: 'Selection, right-click, and navigation preferences.',
      badge: 'Input',
      copyOnSelection: 'Copy on selection',
      rightClickBehavior: 'Right-click behavior',
      altClickMovesCursor: 'Alt+click moves cursor',
      wordSeparators: 'Word separators'
    }
  },

  providers: {
    eyebrow: 'Providers',
    title: 'Provider runtime paths',
    description: 'Keep executable discovery predictable so provider-backed sessions can start without extra repair work.',
    cardDescription: 'Set an explicit executable path or let Stoa use the local detected runtime.',
    executablePath: 'Executable path',
    browse: 'Browse',
    detecting: 'Detecting...',
    autoDetected: 'Auto-detected',
    customPath: 'Custom path',
    notFound: 'Not found \u2014 click Browse to locate',
    placeholderMissing: 'not found',
    selectExecutable: 'Select {provider} executable',
    evolverInference: {
      ariaLabel: 'Evolver inference provider',
      title: 'Evolver inference provider',
      description: 'Stoa uses that provider when Evolver requests LLM work such as distill or optional review.',
      badge: 'Host-owned',
      label: 'Evolver inference provider',
      hint: 'This does not start Evolver work by itself. It only persists which inference capability Stoa should use when requested.',
      options: {
        api: 'OpenAI API'
      }
    },
    titleGeneration: {
      ariaLabel: 'Session title generation',
      title: 'Session title generation',
      description: 'Generate a host-owned session title after the first valid turn completes, and allow manual overwrite from the session menu.',
      badge: 'Host-owned',
      enabled: 'Auto-generate after first valid turn',
      enabledHint: 'If generation fails or is disabled, Stoa keeps the existing host title.',
      modelLabel: 'Title model',
      baseUrlLabel: 'Base URL',
      baseUrlPlaceholder: 'https://api.openai.com/v1',
      apiKeyLabel: 'API key',
      apiKeyPlaceholder: 'sk-...',
      hint: 'Manual regenerate from the session context menu always overwrites the current title when a new result is returned.',
      customModelLabel: 'Custom Model Name',
      customModelPlaceholder: 'Enter custom model name...',
      fetchModels: 'Get Models',
      fetchingModels: 'Fetching...',
      fetchModelsSuccess: 'Models fetched successfully.',
      optionCustom: 'Custom...',
      missingCredentials: 'Base URL and API Key are required to fetch models.'
    },
    sessionProviders: 'Session providers',
    sessionProvidersRadial: 'Session providers (radial)',
    createSession: 'Create {provider} session',
    claude: {
      skipPermissions: 'Skip Claude permission prompts',
      skipPermissionsDescription: 'Append `--dangerously-skip-permissions` when starting or resuming Claude sessions.'
    }
  },

  about: {
    eyebrow: 'About',
    title: 'Project details',
    description: 'Reference information for the current build, the stack it runs on, and related links.',
    summary: 'Multi-session workspace console for local provider-driven development.',
    stack: 'Electron \xB7 Vue 3 \xB7 node-pty',
    links: {
      title: 'Project links',
      description: 'Quick links to the project repository, docs, and issue reporting.',
      badge: 'Resources',
      github: 'GitHub',
      documentation: 'Documentation',
      reportIssue: 'Report Issue'
    },
    updates: {
      title: 'Updates',
      description: 'Current build and release state for this installation.',
      currentVersion: 'Current version',
      latestVersion: 'Latest version',
      status: 'Status',
      lastChecked: 'Last checked',
      neverChecked: 'Never checked',
      checkForUpdates: 'Check for updates',
      checking: 'Checking...',
      noActivity: 'No recent update activity.',
      statusAvailable: 'Update available',
      statusDownloaded: 'Ready to install',
      statusChecking: 'Checking for updates',
      statusDownloading: 'Downloading update',
      statusUpToDate: 'Up to date',
      statusDisabled: 'Updates unavailable',
      statusError: 'Update error',
      statusIdle: 'Idle',
      downloading: 'Downloading...',
      downloadNow: 'Download now',
      installNow: 'Install now'
    }
  },

  updatePrompt: {
    titleDownloaded: 'Ready to install',
    titleAvailable: 'Update available',
    defaultMessage: 'A new build is ready for this installation.',
    version: 'Version {version}',
    warning: 'Installing will close active sessions.',
    dismiss: 'Not now',
    install: 'Install now',
    download: 'Download now'
  },

  titleGenerationToast: {
    pendingTitle: 'Generating session title',
    pendingMessage: 'Summarizing the latest turn for "{title}".',
    manualSuccessTitle: 'Session title updated',
    automaticSuccessTitle: 'Session title generated',
    successMessage: 'Sidebar title updated to "{title}".',
    errorTitle: 'Session title generation failed',
    errorFallbackMessage: 'The title generator did not return a usable result.',
    untitledFallback: 'Untitled session'
  },

  newProject: {
    title: 'New project',
    nameLabel: 'Project name',
    pathLabel: 'Project path',
    pathPlaceholder: 'Click Browse to select folder',
    browse: 'Browse',
    selectFolder: 'Select project folder',
    cancel: 'Cancel',
    create: 'Create'
  },

  workspace: {
    eyebrow: 'Projects',
    title: 'Stoa',
    description: 'Project \u2192 Session hierarchy with canonical state from the main process.',
    projectName: 'Project name',
    projectPath: 'Project path',
    newProject: 'New project',
    sessionTitle: 'Session title',
    sessionType: 'Session type',
    projectDetails: 'Project details',
    deleteProject: 'Delete {name}',
    deleteProjectTitle: 'Delete project',
    addSessionTo: 'Add session to {name}',
    addSessionTitle: 'Add session \u00B7 long-press for radial',
    archiveSession: 'Archive {title}',
    archiveSessionTitle: 'Archive session',
    regenerateSessionTitle: 'Regenerate title',
    restartSession: 'Restart session',
    sessionActions: 'Session actions for {title}'
  },

  archive: {
    eyebrow: 'Session Archive',
    title: 'Archived sessions',
    subtitle: 'Restore historical sessions from a central location. The command palette retains only the archive action.',
    empty: 'No archived sessions found.',
    restore: 'Restore'
  },

  terminal: {
    details: 'Session details',
    project: 'Project',
    path: 'Path',
    recovery: 'Recovery',
    externalSession: 'External Session',
    notBound: 'not bound',
    emptyTitle: 'No session to display',
    emptyHint: 'Create a project first, then create a session under it.',
    activeSession: 'Active session',
    quickActions: {
      openIdeAria: 'Open workspace in VS Code',
      openFileManagerAria: 'Reveal workspace in file browser',
      copySelectionAria: 'Copy selection to clipboard'
    }
  },

  activityBar: {
    command: 'Command panel',
    metaSession: 'Meta Session',
    archive: 'Archive',
    settings: 'Settings',
    openSidebar: 'Toggle Sidebar',
    closeSidebar: 'Toggle Sidebar'
  },

  windowControls: {
    minimize: 'Minimize',
    restore: 'Restore',
    maximize: 'Maximize',
    close: 'Close'
  }
}
