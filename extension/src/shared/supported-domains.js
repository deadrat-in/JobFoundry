const INDEED_COUNTRY_DOMAINS = [
  'indeed.co.uk',
  'indeed.co.in',
  'indeed.ca',
  'indeed.com.au',
  'indeed.de',
  'indeed.fr',
  'indeed.it',
  'indeed.es',
  'indeed.nl',
  'indeed.sg',
  'indeed.com.br',
  'indeed.com.mx',
  'indeed.co.za',
  'indeed.com.tr',
  'indeed.hk',
  'indeed.jp',
];

const GLASSDOOR_COUNTRY_DOMAINS = [
  'glassdoor.co.uk',
  'glassdoor.ca',
  'glassdoor.com.au',
  'glassdoor.de',
  'glassdoor.fr',
  'glassdoor.ie',
  'glassdoor.it',
  'glassdoor.es',
  'glassdoor.nl',
  'glassdoor.co.in',
];

function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isSupportedIndeedHost(host) {
  return (
    matchesDomain(host, 'indeed.com') ||
    INDEED_COUNTRY_DOMAINS.some((domain) => matchesDomain(host, domain))
  );
}

export function isSupportedGlassdoorHost(host) {
  return (
    matchesDomain(host, 'glassdoor.com') ||
    GLASSDOOR_COUNTRY_DOMAINS.some((domain) => matchesDomain(host, domain))
  );
}
