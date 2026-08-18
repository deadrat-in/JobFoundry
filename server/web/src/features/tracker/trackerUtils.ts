import { JobStatus } from '../../types/job';

export interface KanbanColumn {
  id: JobStatus;
  title: string;
  badgeClass: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'new', title: 'New', badgeClass: 'badge-blue' },
  { id: 'saved', title: 'Saved', badgeClass: 'badge-indigo' },
  { id: 'tailored', title: 'Tailored', badgeClass: 'badge-purple' },
  { id: 'applied', title: 'Applied', badgeClass: 'badge-cyan' },
  { id: 'interview', title: 'Interview', badgeClass: 'badge-amber' },
  { id: 'offer', title: 'Offer', badgeClass: 'badge-green' },
  { id: 'rejected', title: 'Rejected', badgeClass: 'badge-red' },
];

export function isMoveAllowed(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  // Any status can be rejected or archived to saved
  if (to === 'rejected' || to === 'saved') return true;
  return true; // Allow user flexibility in dragging across stages
}
