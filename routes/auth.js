const express=require('express');
const bcrypt=require('bcryptjs');
const argon2=require('argon2');
const crypto=require('crypto');
const rateLimit=require('express-rate-limit');
const {dbGet,dbRun,dbAll}=require('../database/init');
const {auth,adminOnly,csrfProtection,hashToken,randomToken,setCookie,clearCookie,userPayload,SESSION_COOKIE,CSRF_COOKIE,SESSION_DAYS}=require('../middleware/auth');
const {auditMutations}=require('../middleware/audit');
const router=express.Router();
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde alguns minutos.'}});
const registerLimiter=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas de cadastro. Aguarde.'}});
const passwordLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas de alteração de senha.'}});
function newCsrf(){return crypto.randomBytes(24).toString('hex');}
function setSession(res,token){const csrf=newCsrf();setCookie(res,SESSION_COOKIE,token,{httpOnly:true});setCookie(res,CSRF_COOKIE,csrf,{httpOnly:false});return csrf;}
function isArgon2Hash(hash){return typeof hash==='string'&&hash.startsWith('$argon2');}
async function hashPassword(password){return argon2.hash(password,{type:argon2.argon2id});}
async function verifyAndUpgradePassword(user,password){
  if(!user?.password)return false;
  if(isArgon2Hash(user.password))return argon2.verify(user.password,password);
  const ok=bcrypt.compareSync(password,user.password);
  if(ok)await dbRun('UPDATE users SET password=$1 WHERE id=$2',[await hashPassword(password),user.id]);
  return ok;
}
async function createSession(u){const token=randomToken(32),expires=new Date(Date.now()+SESSION_DAYS*86400000);await dbRun('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[Number(u.id),hashToken(token),expires]);return token;}
router.get('/csrf',(req,res)=>{const csrf=newCsrf();setCookie(res,CSRF_COOKIE,csrf,{httpOnly:false});res.json({csrfToken:csrf});});
router.post('/login',loginLimiter,async(req,res,next)=>{try{
  const {email,password}=req.body||{}; if(!email||!password)return res.status(400).json({error:'E-mail e senha são obrigatórios'});
  const u=await dbGet('SELECT * FROM users WHERE lower(email)=lower($1) AND active=true AND deleted_at IS NULL',[String(email).trim()]);
  if(!u||!(await verifyAndUpgradePassword(u,password)))return res.status(401).json({error:'Credenciais inválidas'});
  await dbRun('DELETE FROM sessions WHERE expires_at<NOW() OR revoked_at IS NOT NULL');
  const csrfToken=setSession(res,await createSession(u)); res.json({user:userPayload(u),csrfToken});
}catch(e){next(e)}});
router.post('/register',registerLimiter,async(req,res,next)=>{try{
  const {name,email,password,invite}=req.body||{}; if(!name||!email||!password)return res.status(400).json({error:'Nome, e-mail e senha são obrigatórios'});
  if(String(password).length<8)return res.status(400).json({error:'A senha deve ter pelo menos 8 caracteres'});
  const admin=await dbGet("SELECT id FROM users WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1");
  const code=process.env.INVITE_CODE; if(admin && (!code || invite!==code))return res.status(403).json({error:'Cadastro protegido. Código de convite inválido.'});
  const ex=await dbGet('SELECT id FROM users WHERE lower(email)=lower($1)',[String(email).trim()]); if(ex)return res.status(400).json({error:'E-mail já cadastrado'});
  const role=admin?'OPERADOR':'ADMIN'; const u=await dbGet('INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,$4) RETURNING *',[String(name).trim(),String(email).trim().toLowerCase(),await hashPassword(password),role]);
  const csrfToken=setSession(res,await createSession(u)); res.json({user:userPayload(u),csrfToken});
}catch(e){next(e)}});
router.get('/me',auth,(req,res)=>res.json(req.user));
router.post('/logout',auth,csrfProtection,auditMutations,async(req,res,next)=>{try{if(req.sessionId)await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE id=$1',[req.sessionId]);clearCookie(res,SESSION_COOKIE,{httpOnly:true});clearCookie(res,CSRF_COOKIE);res.json({ok:true});}catch(e){next(e)}});
router.post('/logout-all',auth,csrfProtection,auditMutations,async(req,res,next)=>{try{await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.user.id]);clearCookie(res,SESSION_COOKIE,{httpOnly:true});clearCookie(res,CSRF_COOKIE);res.json({ok:true});}catch(e){next(e)}});
router.put('/password',auth,csrfProtection,auditMutations,passwordLimiter,async(req,res,next)=>{try{
  const {current,newPass}=req.body||{};const u=await dbGet('SELECT * FROM users WHERE id=$1',[req.user.id]);
  if(!u||!(await verifyAndUpgradePassword(u,current)))return res.status(400).json({error:'Senha atual incorreta'});
  if(!newPass||String(newPass).length<8)return res.status(400).json({error:'Nova senha inválida'});
  await dbRun('UPDATE users SET password=$1 WHERE id=$2',[await hashPassword(newPass),req.user.id]);await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1',[req.user.id]);clearCookie(res,SESSION_COOKIE,{httpOnly:true});clearCookie(res,CSRF_COOKIE);res.json({ok:true});
}catch(e){next(e)}});
router.get('/sessions',auth,async(req,res,next)=>{try{res.json(await dbAll('SELECT id,created_at,expires_at,revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]));}catch(e){next(e)}});
router.delete('/sessions/:id',auth,csrfProtection,async(req,res,next)=>{try{const target=Number(req.params.id);if(!Number.isFinite(target))return res.status(400).json({error:'Sessão inválida'});await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',[target,req.user.id]);res.json({ok:true});}catch(e){next(e)}});
router.get('/users',auth,adminOnly,async(req,res,next)=>{try{res.json(await dbAll('SELECT u.id,u.name,u.email,u.role,u.active,u.customer_id,u.created_at,c.name customer_name FROM users u LEFT JOIN customers c ON c.id=u.customer_id WHERE u.deleted_at IS NULL ORDER BY u.name'));}catch(e){next(e)}});
router.post('/users',auth,csrfProtection,adminOnly,auditMutations,async(req,res,next)=>{try{const {name,email,password,role,customer_id}=req.body||{};if(!name||!email||!password)return res.status(400).json({error:'Nome, e-mail e senha são obrigatórios'});if(String(password).length<8)return res.status(400).json({error:'A senha deve ter pelo menos 8 caracteres'});if(!['ADMIN','OPERADOR','CLIENTE'].includes(role||'OPERADOR'))return res.status(400).json({error:'Perfil inválido'});const ex=await dbGet('SELECT id FROM users WHERE lower(email)=lower($1)',[email]);if(ex)return res.status(400).json({error:'E-mail já cadastrado'});const u=await dbGet('INSERT INTO users(name,email,password,role,customer_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[String(name).trim(),String(email).trim().toLowerCase(),await hashPassword(password),role||'OPERADOR',role==='CLIENTE'&&customer_id?Number(customer_id):null]);res.json({id:Number(u.id)});}catch(e){next(e)}});
router.put('/users/:id',auth,csrfProtection,adminOnly,auditMutations,async(req,res,next)=>{try{const {name,email,role,active,customer_id}=req.body||{};if(!['ADMIN','OPERADOR','CLIENTE'].includes(role))return res.status(400).json({error:'Perfil inválido'});if(Number(req.params.id)===req.user.id&&(role!=='ADMIN'||!active))return res.status(400).json({error:'Você não pode remover seu próprio acesso de administrador'});await dbRun('UPDATE users SET name=$1,email=$2,role=$3,active=$4,customer_id=$5 WHERE id=$6',[String(name).trim(),String(email).trim().toLowerCase(),role,!!active,req.params.id]);await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND id<>COALESCE($2,0)',[req.params.id,req.sessionId||0]);res.json({ok:true});}catch(e){next(e)}});
router.delete('/users/:id',auth,csrfProtection,adminOnly,auditMutations,async(req,res,next)=>{try{if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Você não pode excluir a si mesmo'});await dbRun('UPDATE users SET deleted_at=NOW(),active=false WHERE id=$1',[req.params.id]);await dbRun('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1',[req.params.id]);res.json({ok:true});}catch(e){next(e)}});
module.exports=router;
