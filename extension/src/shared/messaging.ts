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

export interface AutoConnectResult {
  ok: boolean;
  serverUrl?: string;
  apiKey?: string;
  email?: string;
  name?: string;
  error?: string;
}

export interface JobsDiscoveredResult {
  ok: boolean;
  ingested?: number;
  error?: string;
}

interface JobFoundryProtocol {
  'popup:scanNow': () => ScanNowResult;
  'popup:captureActiveTab': () => CaptureActiveTabResult;
  'popup:autoConnect': () => AutoConnectResult;
  'content:jobsDiscovered': (data: JobsDiscoveredPayload) => JobsDiscoveredResult;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<JobFoundryProtocol>();
