import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
): Promise<VerifiedGoogleIdentity> {
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: GOOGLE_ISSUERS,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Google token is missing sub');
  if (typeof payload.email !== 'string' || !payload.email || payload.email_verified !== true) {
    throw new Error('Google email is not verified');
  }
  const emailName = payload.email.split('@')[0]?.slice(0, 80);
  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim().slice(0, 80)
    : emailName?.length ? emailName : 'Google user';
  return { sub: payload.sub, email: payload.email, name };
}
