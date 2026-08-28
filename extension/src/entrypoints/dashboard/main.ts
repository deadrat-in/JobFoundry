import { getConfig } from '../../shared/config.ts';

export async function initDashboard() {
  const config = await getConfig();
  const iframe = document.querySelector<HTMLIFrameElement>('#dashboard-iframe');
  const btnOpenTab = document.querySelector<HTMLButtonElement>('#btn-open-tab');
  const btnOpenOptions = document.querySelector<HTMLButtonElement>('#btn-open-options');

  const serverUrl = config.serverUrl ? 'http://localhost:5173' : 'http://localhost:5173';

  if (iframe) {
    iframe.src = serverUrl;
  }

  btnOpenTab?.addEventListener('click', () => {
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    if (api?.tabs?.create) {
      api.tabs.create({ url: serverUrl });
    } else {
      window.open(serverUrl, '_blank');
    }
  });

  btnOpenOptions?.addEventListener('click', () => {
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    const optUrl = api?.runtime?.getURL ? api.runtime.getURL('options.html') : 'options.html';
    if (api?.tabs?.create) {
      api.tabs.create({ url: optUrl });
    } else {
      window.location.href = optUrl;
    }
  });
}

const inNode = typeof process !== 'undefined' && process.versions?.node;
if (typeof document !== 'undefined' && !inNode) {
  document.addEventListener('DOMContentLoaded', () => initDashboard());
}
