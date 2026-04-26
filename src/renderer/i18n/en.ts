export default {
  settings: {
    eyebrow: 'Workspace settings',
    title: 'Settings',
    lede: 'Manage shell, provider, and application details for the current workspace.',
    heroLabel: 'Current section',
    navLabel: 'Sections',
    navText: 'Core preferences and reference information.',
    tabs: {
      general: { label: 'General', summary: 'Shell path and terminal font size.' },
      providers: { label: 'Providers', summary: 'Local provider executable paths.' },
      about: { label: 'About', summary: 'Version, stack, and project links.' }
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
      title: 'Terminal typography',
      description: 'Keep command output legible while preserving the tighter console density.',
      badge: 'Mono UI',
      fontSize: 'Font Size'
    },
    languageSection: {
      title: 'Display language',
      description: 'Choose the interface language. Changes take effect immediately.',
      badge: 'Locale'
    }
  },

  language: {
    en: 'English',
    'zh-CN': '\u7B80\u4F53\u4E2D\u6587'
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
      statusIdle: 'Idle'
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
    archiveSessionTitle: 'Archive session'
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
      openFileManagerAria: 'Reveal workspace in file browser'
    }
  },

  activityBar: {
    command: 'Command panel',
    archive: 'Archive',
    settings: 'Settings'
  },

  windowControls: {
    minimize: 'Minimize',
    restore: 'Restore',
    maximize: 'Maximize',
    close: 'Close'
  }
}
