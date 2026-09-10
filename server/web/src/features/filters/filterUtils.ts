import { Job, FitNotes } from '../../types/job';

export interface FilterCriteria {
  search?: string;
  status?: string;
  source?: string;
  minScore?: number;
  maxScore?: number;
}

export type ScoreCategory = 'high' | 'medium' | 'low' | 'unscored';

export function getScoreCategory(score: number | null | undefined, threshold = 75): ScoreCategory {
  if (score === null || score === undefined) return 'unscored';
  if (score >= threshold) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function filterJobs(jobs: Job[], criteria: FilterCriteria): Job[] {
  return jobs.filter((job) => {
    // 1. Search filter
    if (criteria.search && criteria.search.trim()) {
      const term = criteria.search.toLowerCase();
      const matchTitle = job.title.toLowerCase().includes(term);
      const matchCompany = job.company.toLowerCase().includes(term);
      const matchDesc = job.description ? job.description.toLowerCase().includes(term) : false;
      const matchLoc = job.location ? job.location.toLowerCase().includes(term) : false;

      if (!matchTitle && !matchCompany && !matchDesc && !matchLoc) {
        return false;
      }
    }

    // 2. Status filter
    if (criteria.status && criteria.status !== 'all') {
      if (job.status !== criteria.status) return false;
    }

    // 3. Source filter
    if (criteria.source && criteria.source !== 'all') {
      if (job.source !== criteria.source) return false;
    }

    // 4. Score range filters
    if (criteria.minScore !== undefined) {
      if (
        job.fit_score === null ||
        job.fit_score === undefined ||
        job.fit_score < criteria.minScore
      ) {
        return false;
      }
    }

    if (criteria.maxScore !== undefined) {
      if (
        job.fit_score !== null &&
        job.fit_score !== undefined &&
        job.fit_score > criteria.maxScore
      ) {
        return false;
      }
    }

    return true;
  });
}

export function parseFitNotes(raw?: string | null): FitNotes {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const reasoningValid = parsed.reasoning === undefined || typeof parsed.reasoning === 'string';
      const errorValid = parsed.error === undefined || typeof parsed.error === 'string';
      const matchingValid =
        parsed.matching_skills === undefined || Array.isArray(parsed.matching_skills);
      const missingValid =
        parsed.missing_skills === undefined || Array.isArray(parsed.missing_skills);

      if (reasoningValid && errorValid && matchingValid && missingValid) {
        return parsed as FitNotes;
      }
    }
    return { reasoning: raw };
  } catch {
    return { reasoning: raw };
  }
}
