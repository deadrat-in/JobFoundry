// tests/providers/_profile-keywords.test.mjs (browser port).
//
// Lifted from career-ops (MIT, vendored; see scripts/vendor.mjs). Deviation:
// the upstream test asserted resolveProfileKeywords() reads config/profile.yml
// from disk via fs + js-yaml. The browser port cannot read files, so
// resolveProfileKeywords() is a documented no-op that always fails open with
// [] — the file-reading assertions are replaced by assertions on that browser
// contract. profileTargetKeywords() is pure and tested unchanged.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider helper — _profile-keywords (browser port)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/_profile-keywords.mjs')).href);
  const { profileTargetKeywords, resolveProfileKeywords } = mod;

  const profile = {
    target_roles: {
      primary: ['Data Engineer', '  Frontend Developer  '],
      archetypes: [
        { name: 'Site Reliability Engineer' },
        { name: '' },
        { name: 'Data Engineer' }, // dup of primary[0]
      ],
    },
  };
  const keywords = profileTargetKeywords(profile);
  if (
    keywords.length === 3
    && keywords[0] === 'Data Engineer'
    && keywords[1] === 'Frontend Developer'
    && keywords[2] === 'Site Reliability Engineer'
  ) {
    pass('profileTargetKeywords extracts primary roles and archetype names, trims, and dedups');
  } else {
    fail(`profileTargetKeywords = ${JSON.stringify(keywords)}`);
  }

  if (profileTargetKeywords({}).length === 0 && profileTargetKeywords(null).length === 0) {
    pass('profileTargetKeywords returns [] when target_roles is absent/missing');
  } else {
    fail('profileTargetKeywords should return [] for a profile with no target_roles');
  }

  // Browser port: there is no config/profile.yml on disk (no fs, no js-yaml),
  // so resolveProfileKeywords always fails open with []. Any keyword-required
  // provider must get its keywords from its own portal config instead.
  if (resolveProfileKeywords().length === 0
      && resolveProfileKeywords('/some/on-disk/path.yml').length === 0) {
    pass('resolveProfileKeywords returns [] in the browser port (no fs fallback, fails open)');
  } else {
    fail(`resolveProfileKeywords (browser) = ${JSON.stringify(resolveProfileKeywords())}`);
  }
} catch (e) {
  fail(`_profile-keywords tests crashed: ${e.message}`);
}