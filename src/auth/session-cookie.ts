import { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'sl_session';
export function cookieOptions(): CookieOptions {
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('Invalid SESSION_COOKIE_SAMESITE');
  const secure = process.env.NODE_ENV === 'production';
  if (sameSite === 'none' && !secure) throw new Error('SameSite=None requires NODE_ENV=production and HTTPS');
  return { httpOnly: true, secure, sameSite: sameSite as 'lax' | 'strict' | 'none', path: '/api' };
}
export function setSessionCookie(res: Response, session: { accessToken: string; expiresAt: Date }) {
  res.cookie(SESSION_COOKIE, session.accessToken, { ...cookieOptions(), expires: session.expiresAt });
}
export function clearSessionCookie(res: Response) { res.clearCookie(SESSION_COOKIE, cookieOptions()); }
