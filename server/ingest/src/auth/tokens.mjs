import { createHmac, randomBytes } from 'node:crypto';

function base64UrlEncode(obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function createToken(payload, secret = 'jobfoundry-jwt-default-secret', expiresInHours = 72) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body = { ...payload, exp };

  const encodedHeader = base64UrlEncode(header);
  const encodedBody = base64UrlEncode(body);
  const message = `${encodedHeader}.${encodedBody}`;

  const signature = createHmac('sha256', secret).update(message).digest('base64url');

  return `${message}.${signature}`;
}

export function verifyToken(token, secret = 'jobfoundry-jwt-default-secret') {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedBody, signature] = parts;
  const message = `${encodedHeader}.${encodedBody}`;
  const expectedSig = createHmac('sha256', secret).update(message).digest('base64url');

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedBody));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

export function generateApiKey() {
  return `jf_${randomBytes(24).toString('hex')}`;
}
