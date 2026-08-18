export const SCAN_ALARM_NAME = 'scan';

export async function ensureScanAlarm({ scanIntervalHours, alarms }) {
  if (!alarms) throw new Error('alarms API unavailable');
  const periodInMinutes = scanIntervalHours * 60;
  await alarms.clear(SCAN_ALARM_NAME);
  await alarms.create(SCAN_ALARM_NAME, { periodInMinutes });
  return { name: SCAN_ALARM_NAME, periodInMinutes };
}
