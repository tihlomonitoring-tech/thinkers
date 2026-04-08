/** Client IP behind reverse proxy (trust proxy must be set on Express). */
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff[0]) return String(xff[0]).trim();
  return req.ip || req.socket?.remoteAddress || '';
}
