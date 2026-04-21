window.__mockSessionStore = {
  sessions: [],
  projects: [],
  callbacks: { sessionEvent: [], terminalData: [] }
};
window.vibecoding = {
  async getBootstrapState() {
    return {
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: window.__mockSessionStore.projects,
      sessions: window.__mockSessionStore.sessions
    };
  },
  async createProject(req) {
    var p = {
      id: 'p-' + Date.now(),
      name: req.name,
      path: req.path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    window.__mockSessionStore.projects.push(p);
    return p;
  },
  async createSession(req) {
    var s = {
      id: 's-' + Date.now(),
      projectId: req.projectId,
      type: req.type,
      title: req.title,
      status: 'bootstrapping',
      summary: 'Shell bootstrapping',
      recoveryMode: req.type === 'shell' ? 'fresh-shell' : 'resume-external',
      externalSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivatedAt: null
    };
    window.__mockSessionStore.sessions.push(s);
    setTimeout(function() {
      var startingEvt = { sessionId: s.id, status: 'starting', summary: 'Starting...' };
      window.__mockSessionStore.callbacks.sessionEvent.forEach(function(cb) { cb(startingEvt); });
      setTimeout(function() {
        var runningEvt = { sessionId: s.id, status: 'running', summary: 'Running' };
        window.__mockSessionStore.callbacks.sessionEvent.forEach(function(cb) { cb(runningEvt); });
        setTimeout(function() {
          if (req.type === 'shell') {
            window.__mockSessionStore.callbacks.terminalData.forEach(function(cb) {
              cb({ sessionId: s.id, data: 'PowerShell 7.4.6\r\nPS C:\\Users> ' });
            });
          } else {
            window.__mockSessionStore.callbacks.terminalData.forEach(function(cb) {
              cb({ sessionId: s.id, data: '\x1b[1mOpenCode\x1b[0m v0.1.0\r\nSession: ' + s.id + '\r\n\x1b[32mReady\x1b[0m\r\n> _' });
            });
          }
        }, 500);
      }, 600);
    }, 200);
    return s;
  },
  async setActiveProject() {},
  async setActiveSession() {},
  async sendSessionInput() {},
  async sendSessionResize() {},
  onTerminalData(cb) {
    window.__mockSessionStore.callbacks.terminalData.push(cb);
    return function() {
      var idx = window.__mockSessionStore.callbacks.terminalData.indexOf(cb);
      if (idx >= 0) window.__mockSessionStore.callbacks.terminalData.splice(idx, 1);
    };
  },
  onSessionEvent(cb) {
    window.__mockSessionStore.callbacks.sessionEvent.push(cb);
    return function() {
      var idx = window.__mockSessionStore.callbacks.sessionEvent.indexOf(cb);
      if (idx >= 0) window.__mockSessionStore.callbacks.sessionEvent.splice(idx, 1);
    };
  }
};
