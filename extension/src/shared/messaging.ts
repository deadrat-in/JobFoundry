import { defineExtensionMessaging } from '@webext-core/messaging';

export interface ScanNowResult {
  ok: boolean;
  scanned?: number;
  error?: string;
}

export interface JobsDiscoveredPayload {
  jobs: Array<Record<string, any>>;
}

export interface CaptureActiveTabResult {
  ok: boolean;
  job?: any;
  count?: number;
  error?: string;
}

interface JobFoundryProtocol {
  'popup:scanNow': () => ScanNowResult;
  'popup:captureActiveTab': () => CaptureActiveTabResult;
  'content:jobsDiscovered': (data: JobsDiscoveredPayload) => JobsDiscoveredResult;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<JobFoundryProtocol>();
