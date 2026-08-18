export function createBrowserMock(initial = {}) {
  const store = { ...initial };
  const sessionStore = {};
  const storageChangeListeners = new Set();
  const installedListeners = new Set();
  const alarmListeners = new Set();
  const messageListeners = new Set();

  const createdAlarms = [];
  const clearedAlarms = [];
  const sentMessages = [];

  const browser = {
    storage: {
      sync: makeArea(store, (items) => {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          const oldValue = store[k];
          store[k] = v;
          changes[k] = { oldValue, newValue: v };
        }
        for (const fn of storageChangeListeners) fn(changes, 'sync');
      }),
      session: makeArea(sessionStore),
      onChanged: {
        addListener(fn) {
          storageChangeListeners.add(fn);
        },
        removeListener(fn) {
          storageChangeListeners.delete(fn);
        },
      },
    },
    alarms: {
      async create(name, alarmInfo) {
        createdAlarms.push({ name, alarmInfo });
      },
      async clear(name) {
        clearedAlarms.push(name);
      },
      onAlarm: {
        addListener(fn) {
          alarmListeners.add(fn);
        },
        removeListener(fn) {
          alarmListeners.delete(fn);
        },
      },
    },
    runtime: {
      onInstalled: {
        addListener(fn) {
          installedListeners.add(fn);
        },
        removeListener(fn) {
          installedListeners.delete(fn);
        },
      },
      onMessage: {
        addListener(fn) {
          messageListeners.add(fn);
        },
        removeListener(fn) {
          messageListeners.delete(fn);
        },
      },
      async sendMessage(message) {
        sentMessages.push(message);
        for (const fn of messageListeners) {
          const response = fn(message, {}, () => {});
          if (response && typeof response.then === 'function') {
            return await response;
          }
        }
        return undefined;
      },
    },
  };

  function makeArea(target, onSet) {
    return {
      async get(keys) {
        if (keys == null) return { ...target };
        if (typeof keys === 'string') return { [keys]: target[keys] };
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) out[k] = target[k];
          return out;
        }
        const out = {};
        for (const [k, def] of Object.entries(keys)) {
          out[k] = k in target ? target[k] : def;
        }
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) target[k] = v;
        onSet?.(items);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete target[k];
      },
    };
  }

  function snapshot() {
    return {
      store: { ...store },
      sessionStore: { ...sessionStore },
      createdAlarms: [...createdAlarms],
      clearedAlarms: [...clearedAlarms],
      sentMessages: [...sentMessages],
      installedListeners,
      alarmListeners,
      messageListeners,
      storageChangeListeners,
    };
  }

  return { browser, snapshot };
}

export async function withBrowser(browser, fn) {
  const hadBrowser = 'browser' in globalThis;
  const hadChrome = 'chrome' in globalThis;
  const prevBrowser = globalThis.browser;
  const prevChrome = globalThis.chrome;
  globalThis.browser = browser;
  try {
    return await fn();
  } finally {
    if (hadBrowser) globalThis.browser = prevBrowser;
    else delete globalThis.browser;
    if (hadChrome) globalThis.chrome = prevChrome;
    else delete globalThis.chrome;
  }
}
