import { defineExtensionMessaging } from '@webext-core/messaging';

export interface ScanNowResult {
  ok: boolean;
  scanned?: number;
  error?: string;
}

export interface JobsDiscoveredPayload {
  jobs: Array<Record<string, any>>;
}

export interface JobsDiscoveredResult {
  ok: boolean;
  ingested?: number;
  error?: string;
}

interface JobFoundryProtocol {
  'popup:scanNow': () => ScanNowResult;
  'content:jobsDiscovered': (data: JobsDiscoveredPayload) => JobsDiscoveredResult;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<JobFoundryProtocol>();
