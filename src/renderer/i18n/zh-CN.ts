export default {
  settings: {
    eyebrow: '\u5DE5\u4F5C\u533A\u8BBE\u7F6E',
    title: '\u8BBE\u7F6E',
    lede: '\u7BA1\u7406\u5F53\u524D\u5DE5\u4F5C\u533A\u7684 Shell\u3001\u63D0\u4F9B\u5546\u548C\u5E94\u7528\u7A0B\u5E8F\u8BE6\u60C5\u3002',
    heroLabel: '\u5F53\u524D\u5206\u533A',
    navLabel: '\u5206\u533A',
    navText: '\u6838\u5FC3\u504F\u597D\u8BBE\u7F6E\u548C\u53C2\u8003\u4FE1\u606F\u3002',
    tabs: {
      general: { label: '\u901A\u7528', summary: 'Shell \u8DEF\u5F84\u548C\u7EC8\u7AEF\u5B57\u4F53\u5927\u5C0F\u3002' },
      terminal: { label: '\u7EC8\u7AEF', summary: '\u5B57\u4F53\u3001\u5149\u6807\u3001\u6EDA\u52A8\u548C\u884C\u4E3A\u8BBE\u7F6E\u3002' },
      providers: { label: '\u63D0\u4F9B\u5546', summary: '\u672C\u5730\u63D0\u4F9B\u5546\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\u3002' },
      advanced: { label: '\u9AD8\u7EA7', summary: 'CLI \u548C\u5B9E\u9A8C\u6027\u529F\u80FD\u3002' },
      about: { label: '\u5173\u4E8E', summary: '\u7248\u672C\u3001\u6280\u672F\u6808\u548C\u9879\u76EE\u94FE\u63A5\u3002' }
    },
    stoactlToggle: {
      title: 'stoa-ctl \u547D\u4EE4\u884C\u63A7\u5236',
      description: '\u5C06 stoa-ctl \u6CE8\u518C\u5230 PATH,\u5141\u8BB8\u5916\u90E8\u811A\u672C\u901A\u8FC7 HTTP \u63A7\u5236\u4F1A\u8BDD\u3002\u9ED8\u8BA4\u5173\u95ED\u3002',
      enabledLabel: '\u5DF2\u542F\u7528',
      disabledLabel: '\u5DF2\u7981\u7528',
      warningOnEnable: '\u542F\u7528 stoa-ctl \u5C06\u628A\u5B83\u6CE8\u518C\u5230\u4F60\u7684\u7528\u6237 PATH,\u5E76\u542F\u52A8 /ctl HTTP \u63A7\u5236\u5E73\u9762\u3002\u65B0\u4F1A\u8BDD\u9700\u8981\u91CD\u542F\u540E\u751F\u6548\u3002'
    }
  },

  general: {
    eyebrow: '\u901A\u7528',
    title: 'Shell \u548C\u7EC8\u7AEF\u9ED8\u8BA4\u8BBE\u7F6E',
    description: '\u914D\u7F6E\u9ED8\u8BA4 Shell \u8DEF\u5F84\u548C\u7EC8\u7AEF\u4F7F\u7528\u7684\u7B49\u5BBD\u5B57\u4F53\u7F29\u653E\u3002',
    shellSection: {
      title: 'Shell \u53EF\u6267\u884C\u6587\u4EF6',
      description: '\u4F18\u5148\u4F7F\u7528\u81EA\u52A8\u68C0\u6D4B\u5230\u7684 Shell\uFF0C\u6216\u6307\u5B9A\u81EA\u5B9A\u4E49\u8DEF\u5F84\u3002',
      badge: '\u8DEF\u5F84',
      label: 'Shell \u8DEF\u5F84',
      placeholder: '\u81EA\u52A8\u68C0\u6D4B',
      browse: '\u6D4F\u89C8',
      detecting: '\u68C0\u6D4B\u4E2D...',
      autoDetected: '\u5DF2\u81EA\u52A8\u68C0\u6D4B',
      autoDetectedWith: '\u5DF2\u81EA\u52A8\u68C0\u6D4B: {path}',
      customPath: '\u81EA\u5B9A\u4E49\u8DEF\u5F84'
    },
    workspaceIdeSection: {
      title: '\u5DE5\u4F5C\u533A\u5FEB\u6377\u8BBF\u95EE',
      description: '\u9009\u62E9\u5F53\u524D\u4F1A\u8BDD\u5FEB\u6377\u64CD\u4F5C\u4F7F\u7528\u7684 IDE\uFF0C\u5E76\u53EF\u6307\u5B9A\u5176\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\u3002',
      badge: 'IDE',
      ideLabel: '\u5DE5\u4F5C\u533A IDE',
      pathLabel: 'VS Code \u53EF\u6267\u884C\u6587\u4EF6',
      pathPlaceholder: '\u4F7F\u7528\u7CFB\u7EDF PATH',
      browse: '\u6D4F\u89C8',
      selectExecutable: 'VS Code \u53EF\u6267\u884C\u6587\u4EF6',
      detecting: '\u6B63\u5728\u641C\u7D22 VS Code\u2026',
      autoDetected: '\u5DF2\u81EA\u52A8\u68C0\u6D4B\u5230 VS Code',
      autoDetectedWith: '\u81EA\u52A8\u68C0\u6D4B\uFF1A{path}',
      customPath: '\u4F7F\u7528\u81EA\u5B9A\u4E49\u8DEF\u5F84',
      autoDetect: '\u81EA\u52A8\u68C0\u6D4B'
    },
    typographySection: {
      title: '\u5B57\u4F53',
      description: '\u7EC8\u7AEF\u548C\u754C\u9762\u7684\u5B57\u4F53\u65CF\u4E0E\u5927\u5C0F\u3002',
      badge: '\u5B57\u4F53',
      fontFamily: '\u5B57\u4F53\u65CF',
      fontFamilyCJK: '\u4E2D\u6587\u5B57\u4F53',
      fontSize: '\u5B57\u4F53\u5927\u5C0F'
    },
    themeSection: {
      title: '应用主题',
      description: '选择 Stoa 的视觉主题模式。支持现代 Windows 11 云母 (Mica) 与亚克力 (Acrylic) 材质。',
      badge: '主题',
      themeLabel: '应用主题',
      options: {
        light: '浅色',
        dark: '深色',
        system: '跟随系统'
      }
    },
    languageSection: {
      title: '\u663E\u793A\u8BED\u8A00',
      description: '\u9009\u62E9\u754C\u9762\u8BED\u8A00\u3002\u66F4\u6539\u540E\u7ACB\u5373\u751F\u6548\u3002',
      badge: '\u8BED\u8A00'
    }
  },

  language: {
    en: 'English',
    'zh-CN': '\u7B80\u4F53\u4E2D\u6587'
  },

  terminalSettings: {
    eyebrow: '\u7EC8\u7AEF',
    title: '\u7EC8\u7AEF\u5916\u89C2\u548C\u884C\u4E3A',
    description: '\u5FAE\u8C03\u7EC8\u7AEF\u754C\u9762\u7684\u6587\u5B57\u6E32\u67D3\u3001\u5149\u6807\u663E\u793A\u548C\u8F93\u5165\u54CD\u5E94\u3002',
    typography: {
      title: '\u5B57\u4F53\u6392\u7248',
      description: '\u7EC8\u7AEF\u5185\u5BB9\u7684\u5B57\u4F53\u3001\u5B57\u53F7\u3001\u5B57\u91CD\u548C\u95F4\u8DDD\u3002',
      badge: '\u6587\u5B57',
      fontFamily: '\u5B57\u4F53\u65CF',
      fontFamilyCJK: '\u4E2D\u6587\u5B57\u4F53',
      fontSize: '\u5B57\u4F53\u5927\u5C0F',
      fontWeight: '\u5B57\u4F53\u7C97\u7EC6',
      fontWeightBold: '\u7C97\u4F53\u5B57\u91CD',
      lineHeight: '\u884C\u9AD8',
      letterSpacing: '\u5B57\u7B26\u95F4\u8DDD'
    },
    cursor: {
      title: '\u5149\u6807',
      description: '\u5149\u6807\u5F62\u72B6\u3001\u95EA\u70C1\u548C\u975E\u6D3B\u52A8\u72B6\u6001\u5916\u89C2\u3002',
      badge: '\u5149\u6807',
      cursorBlink: '\u5149\u6807\u95EA\u70C1',
      cursorStyle: '\u5149\u6807\u6837\u5F0F',
      cursorInactiveStyle: '\u975E\u6D3B\u52A8\u5149\u6807\u6837\u5F0F'
    },
    display: {
      title: '\u6EDA\u52A8\u548C\u663E\u793A',
      description: '\u6EDA\u52A8\u7F13\u51B2\u3001\u5BF9\u6BD4\u5EA6\u548C GPU \u6E32\u67D3\u3002',
      badge: '\u663E\u793A',
      scrollback: '\u6EDA\u52A8\u7F13\u51B2\u884C\u6570',
      minimumContrastRatio: '\u6700\u5C0F\u5BF9\u6BD4\u5EA6',
      gpuAcceleration: 'GPU \u52A0\u901F'
    },
    behavior: {
      title: '\u884C\u4E3A',
      description: '\u9009\u4E2D\u3001\u53F3\u952E\u548C\u5BFC\u822A\u504F\u597D\u8BBE\u7F6E\u3002',
      badge: '\u8F93\u5165',
      copyOnSelection: '\u9009\u4E2D\u65F6\u590D\u5236',
      rightClickBehavior: '\u53F3\u952E\u884C\u4E3A',
      altClickMovesCursor: 'Alt+\u70B9\u51FB\u79FB\u52A8\u5149\u6807',
      wordSeparators: '\u5355\u8BCD\u5206\u9694\u7B26'
    }
  },

  providers: {
    eyebrow: '\u63D0\u4F9B\u5546',
    title: '\u63D0\u4F9B\u5546\u8FD0\u884C\u65F6\u8DEF\u5F84',
    description: '\u4FDD\u6301\u53EF\u6267\u884C\u6587\u4EF6\u7684\u81EA\u52A8\u53D1\u73B0\u7A33\u5B9A\u53EF\u9760\uFF0C\u8BA9\u63D0\u4F9B\u5546\u9A71\u52A8\u7684\u4F1A\u8BDD\u65E0\u9700\u989D\u5916\u4FEE\u590D\u5373\u53EF\u542F\u52A8\u3002',
    cardDescription: '\u8BBE\u7F6E\u663E\u5F0F\u7684\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF0C\u6216\u8BA9 Stoa \u4F7F\u7528\u672C\u5730\u81EA\u52A8\u68C0\u6D4B\u5230\u7684\u8FD0\u884C\u65F6\u3002',
    executablePath: '\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84',
    browse: '\u6D4F\u89C8',
    detecting: '\u68C0\u6D4B\u4E2D...',
    autoDetected: '\u5DF2\u81EA\u52A8\u68C0\u6D4B',
    customPath: '\u81EA\u5B9A\u4E49\u8DEF\u5F84',
    notFound: '\u672A\u627E\u5230 \u2014 \u70B9\u51FB\u6D4F\u89C8\u4EE5\u5B9A\u4F4D',
    placeholderMissing: '\u672A\u627E\u5230',
    selectExecutable: '\u9009\u62E9 {provider} \u53EF\u6267\u884C\u6587\u4EF6',
    evolverInference: {
      ariaLabel: 'Evolver 推理提供商',
      title: 'Evolver \u63A8\u7406\u63D0\u4F9B\u5546',
      description: 'Evolver \u8BF7\u6C42 distill \u6216\u53EF\u9009 review \u7B49 LLM \u5DE5\u4F5C\u65F6\uFF0CStoa \u4F1A\u4F7F\u7528\u8BE5\u63D0\u4F9B\u5546\u3002',
      badge: 'Stoa \u6240\u6709',
      label: 'Evolver \u63A8\u7406\u63D0\u4F9B\u5546',
      hint: '\u8FD9\u4E0D\u4F1A\u76F4\u63A5\u542F\u52A8 Evolver \u5DE5\u4F5C\u3002\u5B83\u53EA\u4F1A\u6301\u4E45\u5316 Stoa \u5728\u88AB\u8BF7\u6C42\u65F6\u5E94\u4F7F\u7528\u7684\u63A8\u7406\u80FD\u529B\u63D0\u4F9B\u5546\u3002',
      options: {
        api: 'OpenAI API'
      }
    },
    titleGeneration: {
      ariaLabel: '\u4F1A\u8BDD\u6807\u9898\u751F\u6210',
      title: '\u4F1A\u8BDD\u6807\u9898\u751F\u6210',
      description: '\u5728\u9996\u4E2A\u6709\u6548 turn \u5B8C\u6210\u540E\u751F\u6210 Stoa \u81EA\u6709\u6807\u9898\uFF0C\u5E76\u5141\u8BB8\u4ECE\u4F1A\u8BDD\u53F3\u952E\u83DC\u5355\u624B\u52A8\u8986\u76D6\u91CD\u751F\u3002',
      badge: 'Stoa \u6240\u6709',
      enabled: '\u9996\u4E2A\u6709\u6548 turn \u540E\u81EA\u52A8\u751F\u6210',
      enabledHint: '\u5982\u679C\u751F\u6210\u5931\u8D25\u6216\u529F\u80FD\u5173\u95ED\uFF0CStoa \u4F1A\u4FDD\u7559\u5F53\u524D\u4E3B\u673A\u4FA7\u6807\u9898\u3002',
      modelLabel: '\u6807\u9898\u6A21\u578B',
      baseUrlLabel: 'Base URL',
      baseUrlPlaceholder: 'https://api.openai.com/v1',
      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'sk-...',
      hint: '\u5F53\u53F3\u952E\u83DC\u5355\u624B\u52A8\u89E6\u53D1\u91CD\u65B0\u751F\u6210\u4E14\u8FD4\u56DE\u65B0\u7ED3\u679C\u65F6\uFF0C\u4F1A\u76F4\u63A5\u8986\u76D6\u5F53\u524D\u6807\u9898\u3002',
      customModelLabel: '自定义模型名称',
      customModelPlaceholder: '输入自定义模型名称...',
      fetchModels: '获取模型',
      fetchingModels: '获取中...',
      fetchModelsSuccess: '模型获取成功。',
      optionCustom: '自定义...',
      missingCredentials: '需要 Base URL 和 API Key 才能获取模型。'
    },
    sessionProviders: '\u4F1A\u8BDD\u63D0\u4F9B\u5546',
    sessionProvidersRadial: '\u4F1A\u8BDD\u63D0\u4F9B\u5546\uFF08\u73AF\u5F62\uFF09',
    createSession: '\u521B\u5EFA {provider} \u4F1A\u8BDD',
    claude: {
      skipPermissions: '\u8DF3\u8FC7 Claude \u6743\u9650\u63D0\u793A',
      skipPermissionsDescription: '\u5728\u542F\u52A8\u6216\u6062\u590D Claude \u4F1A\u8BDD\u65F6\u8FFD\u52A0 `--dangerously-skip-permissions`\u3002'
    }
  },

  about: {
    eyebrow: '\u5173\u4E8E',
    title: '\u9879\u76EE\u8BE6\u60C5',
    description: '\u5F53\u524D\u6784\u5EFA\u7248\u672C\u3001\u8FD0\u884C\u6280\u672F\u6808\u548C\u76F8\u5173\u94FE\u63A5\u7684\u53C2\u8003\u4FE1\u606F\u3002',
    summary: '\u9762\u5411\u672C\u5730\u63D0\u4F9B\u5546\u9A71\u52A8\u5F00\u53D1\u7684\u591A\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u63A7\u5236\u53F0\u3002',
    stack: 'Electron \xB7 Vue 3 \xB7 node-pty',
    links: {
      title: '\u9879\u76EE\u94FE\u63A5',
      description: '\u9879\u76EE\u4ED3\u5E93\u3001\u6587\u6863\u548C\u95EE\u9898\u53CD\u9988\u7684\u5FEB\u901F\u94FE\u63A5\u3002',
      badge: '\u8D44\u6E90',
      github: 'GitHub',
      documentation: '\u6587\u6863',
      reportIssue: '\u62A5\u544A\u95EE\u9898'
    },
    updates: {
      title: '\u66F4\u65B0',
      description: '\u5F53\u524D\u5B89\u88C5\u7684\u6784\u5EFA\u548C\u53D1\u5E03\u72B6\u6001\u3002',
      currentVersion: '\u5F53\u524D\u7248\u672C',
      latestVersion: '\u6700\u65B0\u7248\u672C',
      status: '\u72B6\u6001',
      lastChecked: '\u4E0A\u6B21\u68C0\u67E5',
      neverChecked: '\u4ECE\u672A\u68C0\u67E5',
      checkForUpdates: '\u68C0\u67E5\u66F4\u65B0',
      checking: '\u68C0\u67E5\u4E2D...',
      noActivity: '\u6CA1\u6709\u6700\u8FD1\u7684\u66F4\u65B0\u6D3B\u52A8\u3002',
      statusAvailable: '\u6709\u53EF\u7528\u66F4\u65B0',
      statusDownloaded: '\u5DF2\u51C6\u5907\u597D\u5B89\u88C5',
      statusChecking: '\u6B63\u5728\u68C0\u67E5\u66F4\u65B0',
      statusDownloading: '\u6B63\u5728\u4E0B\u8F7D\u66F4\u65B0',
      statusUpToDate: '\u5DF2\u662F\u6700\u65B0\u7248\u672C',
      statusDisabled: '\u66F4\u65B0\u4E0D\u53EF\u7528',
      statusError: '\u66F4\u65B0\u51FA\u9519',
      statusIdle: '\u7A7A\u95F2'
    }
  },

  updatePrompt: {
    titleDownloaded: '\u5DF2\u51C6\u5907\u597D\u5B89\u88C5',
    titleAvailable: '\u6709\u53EF\u7528\u66F4\u65B0',
    defaultMessage: '\u65B0\u7248\u672C\u5DF2\u51C6\u5907\u597D\u5B89\u88C5\u3002',
    version: '\u7248\u672C {version}',
    warning: '\u5B89\u88C5\u5C06\u5173\u95ED\u6D3B\u52A8\u4F1A\u8BDD\u3002',
    dismiss: '\u4EE5\u540E\u518D\u8BF4',
    install: '\u7ACB\u5373\u5B89\u88C5',
    download: '\u7ACB\u5373\u4E0B\u8F7D'
  },

  titleGenerationToast: {
    pendingTitle: '\u6B63\u5728\u751F\u6210\u4F1A\u8BDD\u6807\u9898',
    pendingMessage: '\u6B63\u5728\u4E3A\u300C{title}\u300D\u603B\u7ED3\u6700\u65B0 turn\u3002',
    manualSuccessTitle: '\u4F1A\u8BDD\u6807\u9898\u5DF2\u66F4\u65B0',
    automaticSuccessTitle: '\u5DF2\u81EA\u52A8\u751F\u6210\u4F1A\u8BDD\u6807\u9898',
    successMessage: '\u4FA7\u8FB9\u680F\u6807\u9898\u5DF2\u66F4\u65B0\u4E3A\u300C{title}\u300D\u3002',
    errorTitle: '\u4F1A\u8BDD\u6807\u9898\u751F\u6210\u5931\u8D25',
    errorFallbackMessage: '\u6807\u9898\u751F\u6210\u5668\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u7ED3\u679C\u3002',
    untitledFallback: '\u672A\u547D\u540D\u4F1A\u8BDD'
  },

  newProject: {
    title: '\u65B0\u5EFA\u9879\u76EE',
    nameLabel: '\u9879\u76EE\u540D\u79F0',
    pathLabel: '\u9879\u76EE\u8DEF\u5F84',
    pathPlaceholder: '\u70B9\u51FB\u6D4F\u89C8\u9009\u62E9\u6587\u4EF6\u5939',
    browse: '\u6D4F\u89C8',
    selectFolder: '\u9009\u62E9\u9879\u76EE\u76EE\u5F55',
    cancel: '\u53D6\u6D88',
    create: '\u521B\u5EFA'
  },

  workspace: {
    eyebrow: '\u9879\u76EE',
    title: 'Stoa',
    description: '\u9879\u76EE \u2192 \u4F1A\u8BDD\u5C42\u7EA7\u7ED3\u6784\uFF0C\u72B6\u6001\u6765\u81EA\u4E3B\u8FDB\u7A0B\u7684\u89C4\u8303\u6570\u636E\u3002',
    projectName: '\u9879\u76EE\u540D\u79F0',
    projectPath: '\u9879\u76EE\u8DEF\u5F84',
    newProject: '\u65B0\u5EFA\u9879\u76EE',
    sessionTitle: '\u4F1A\u8BDD\u6807\u9898',
    sessionType: '\u4F1A\u8BDD\u7C7B\u578B',
    projectDetails: '\u9879\u76EE\u8BE6\u60C5',
    deleteProject: '\u5220\u9664 {name}',
    deleteProjectTitle: '\u5220\u9664\u9879\u76EE',
    addSessionTo: '\u5411 {name} \u6DFB\u52A0\u4F1A\u8BDD',
    addSessionTitle: '\u6DFB\u52A0\u4F1A\u8BDD \u00B7 \u957F\u6309\u663E\u793A\u73AF\u5F62\u83DC\u5355',
    archiveSession: '\u5F52\u6863 {title}',
    archiveSessionTitle: '\u5F52\u6863\u4F1A\u8BDD',
    regenerateSessionTitle: '\u91CD\u65B0\u751F\u6210\u6807\u9898',
    restartSession: '\u91CD\u542F\u4F1A\u8BDD',
    sessionActions: '{title} \u7684\u4F1A\u8BDD\u64CD\u4F5C'
  },

  archive: {
    eyebrow: '\u4F1A\u8BDD\u5F52\u6863',
    title: '\u5DF2\u5F52\u6863\u4F1A\u8BDD',
    subtitle: '\u96C6\u4E2D\u6062\u590D\u5386\u53F2\u4F1A\u8BDD\uFF0C\u547D\u4EE4\u9762\u677F\u53EA\u4FDD\u7559\u5F52\u6863\u52A8\u4F5C\u3002',
    empty: '\u5F53\u524D\u6CA1\u6709\u5DF2\u5F52\u6863\u7684\u4F1A\u8BDD\u3002',
    restore: '\u6062\u590D'
  },

  terminal: {
    details: '\u4F1A\u8BDD\u8BE6\u60C5',
    project: '\u9879\u76EE',
    path: '\u8DEF\u5F84',
    recovery: '\u6062\u590D\u6A21\u5F0F',
    externalSession: '\u5916\u90E8\u4F1A\u8BDD',
    notBound: '\u672A\u7ED1\u5B9A',
    emptyTitle: '\u6CA1\u6709\u53EF\u663E\u793A\u7684\u4F1A\u8BDD',
    emptyHint: '\u5148\u521B\u5EFA\u9879\u76EE\uFF0C\u518D\u5728\u9879\u76EE\u4E0B\u521B\u5EFA\u4F1A\u8BDD\u3002',
    activeSession: '\u6D3B\u52A8\u4F1A\u8BDD',
    quickActions: {
      openIdeAria: '\u5728 VS Code \u4E2D\u6253\u5F00\u5DE5\u4F5C\u533A',
      openFileManagerAria: '\u5728\u6587\u4EF6\u6D4F\u89C8\u5668\u4E2D\u663E\u793A\u5DE5\u4F5C\u533A',
      copySelectionAria: '\u590D\u5236\u9009\u4E2D\u5185\u5BB9\u5230\u526A\u8D34\u677F'
    }
  },

  activityBar: {
    command: '\u547D\u4EE4\u9762\u677F',
    metaSession: '\u5143\u4F1A\u8BDD',
    archive: '\u5F52\u6863',
    settings: '\u8BBE\u7F6E',
    openSidebar: '\u5207\u6362\u4FA7\u8FB9\u680F',
    closeSidebar: '\u5207\u6362\u4FA7\u8FB9\u680F'
  },

  windowControls: {
    minimize: '\u6700\u5C0F\u5316',
    restore: '\u8FD8\u539F',
    maximize: '\u6700\u5927\u5316',
    close: '\u5173\u95ED'
  }
}
