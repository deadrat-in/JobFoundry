/**
 * resume-keywords.js — Extract candidate job titles from a JSON Resume.
 */

/**
 * Extract target role keywords from a JSON Resume object.
 * @param {any} resume
 * @returns {string[]}
 */
export function extractKeywordsFromResume(resume) {
  if (!resume || typeof resume !== 'object') return [];

  const candidates = new Set();

  // 1. Target Headline / Label in basics
  if (typeof resume.basics?.label === 'string' && resume.basics.label.trim()) {
    candidates.add(resume.basics.label.trim());
  }

  // 2. Job titles / positions in work experience
  if (Array.isArray(resume.work)) {
    for (const item of resume.work) {
      if (typeof item?.position === 'string' && item.position.trim()) {
        candidates.add(item.position.trim());
      }
    }
  }

  // 3. Highlighted skills
  if (Array.isArray(resume.skills)) {
    for (const skill of resume.skills) {
      if (typeof skill?.name === 'string' && skill.name.trim() && skill.name.length > 2) {
        // Only include major software roles or primary skill names
        const name = skill.name.trim();
        if (/engineer|developer|architect|lead|manager|analyst/i.test(name)) {
          candidates.add(name);
        }
      }
    }
  }

  return Array.from(candidates);
}
