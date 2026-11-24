const crypto = require('crypto');
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters');
const b64 = (x) => Buffer.from(x).toString('base64url');
const mac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [s, h] = stored.split(':');
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
}
function sign(uid, ttl = 7 * 86400) {
  const body = b64(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttl }));
  return body + '.' + mac(body);
}
function verify(tok) {
  const [body, sig] = String(tok).split('.');
  if (!body || !sig) return null;
  const good = mac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p.uid : null;
}
function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  let uid = null;
  try { uid = m && verify(m[1]); } catch { /* malformed token */ }
  if (!uid) return res.status(401).json({ error: 'Authentication required' });
  req.userId = uid;
  next();
}
module.exports = { hashPassword, verifyPassword, sign, verify, requireAuth };
