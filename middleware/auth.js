const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { dbGet } = require('../database/init');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'gestao3d_dev_legacy_only');
const SESSION_COOKIE = 'g3d_session';
const CSRF_COOKIE = 'g3d_csrf';
const SESSION_DAYS = 7;

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    if (i === -1) return [pair, ''];
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    try { return [decodeURIComponent(k), decodeURIComponent(v)]; } catch { return [k, v]; }
  }));
}
function secureCookie() { return process.env.NODE_ENV === 'production' ? '; Secure' : ''; }
function setCookie(res, name, value, { httpOnly = false, maxAge = 60 * 60 * 24 * SESSION_DAYS } = {}) {
  const flags = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax', httpOnly ? 'HttpOnly' : '', secureCookie()].filter(Boolean).join('; ');
  const current = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(current) ? current : (current ? [current] : []);
  res.setHeader('Set-Cookie', [...cookies, flags]);
}
function clearCookie(res, name, { httpOnly = false } = {}) { setCookie(res, name, '', { httpOnly, maxAge: 0 }); }
async function findSessionByToken(token) {
  if (!token) return null;
  return dbGet(`
    SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
           u.id AS uid, u.name, u.email, u.role, u.active, u.customer_id
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND u.deleted_at IS NULL LIMIT 1
  `, [hashToken(token)]);
}
async function auth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[SESSION_COOKIE];
  try {
    if (cookieToken) {
      const session = await findSessionByToken(cookieToken);
      if (!session || session.revoked_at || new Date(session.expires_at) <= new Date() || !session.active) {
        clearCookie(res, SESSION_COOKIE, { httpOnly: true }); clearCookie(res, CSRF_COOKIE);
        return res.status(401).json({ error: 'Sessão expirada ou revogada' });
      }
      req.user = { id:Number(session.uid), name:session.name, email:session.email, role:session.role, customerId:session.customer_id ? Number(session.customer_id) : null };
      req.sessionId = Number(session.id); req.authType = 'cookie'; return next();
    }
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    if (!bearer || !JWT_SECRET) return res.status(401).json({ error: 'Não autenticado' });
    const payload = jwt.verify(bearer, JWT_SECRET);
    const session = await findSessionByToken(bearer);
    if (!session || session.revoked_at || new Date(session.expires_at) <= new Date() || !session.active) return res.status(401).json({ error:'Sessão expirada ou revogada' });
    req.user={id:Number(session.uid),name:session.name,email:session.email,role:session.role,customerId:session.customer_id ? Number(session.customer_id) : null};
    req.sessionId=Number(session.id); req.authType='legacy-bearer'; req.legacyPayload=payload; next();
  } catch { return res.status(401).json({ error:'Sessão inválida' }); }
}
function csrfProtection(req,res,next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method) || req.authType === 'legacy-bearer') return next();
  const cookieToken=parseCookies(req.headers.cookie||'')[CSRF_COOKIE];
  const headerToken=req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken) return res.status(403).json({error:'Proteção CSRF: token ausente ou inválido'});
  const a=Buffer.from(cookieToken), b=Buffer.from(headerToken);
  if (a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(403).json({error:'Proteção CSRF: token ausente ou inválido'});
  next();
}
function operatorOrAdmin(req,res,next){ if(!['ADMIN','OPERADOR'].includes(req.user?.role)) return res.status(403).json({error:'Acesso negado'}); next(); }
function adminOnly(req,res,next){ if(req.user?.role!=='ADMIN') return res.status(403).json({error:'Acesso negado'}); next(); }
function userPayload(user){ return {id:Number(user.id),name:user.name,email:user.email,role:user.role,customerId:user.customer_id ? Number(user.customer_id) : null}; }
module.exports={auth,csrfProtection,adminOnly,operatorOrAdmin,JWT_SECRET,hashToken,randomToken,setCookie,clearCookie,parseCookies,userPayload,SESSION_COOKIE,CSRF_COOKIE,SESSION_DAYS};
