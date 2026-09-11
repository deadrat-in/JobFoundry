/**
 * Extract target role keywords from a JSON Resume object.
 */
export function extractKeywordsFromResume(resume: any): string[] {
  if (!resume || typeof resume !== 'object') return [];

  const candidates = new Set<string>();

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

  // 3. Highlighted skills matching roles
  if (Array.isArray(resume.skills)) {
    for (const skill of resume.skills) {
      if (typeof skill?.name === 'string' && skill.name.trim() && skill.name.length > 2) {
        const name = skill.name.trim();
        if (/engineer|developer|architect|lead|manager|analyst/i.test(name)) {
          candidates.add(name);
        }
      }
    }
  }

  return Array.from(candidates);
}
