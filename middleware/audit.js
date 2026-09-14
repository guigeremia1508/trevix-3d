const { dbRun } = require('../database/init');
function inferAction(req) {
  if (req.path.includes('/logout')) return 'LOGOUT';
  if (req.path.includes('/password')) return 'PASSWORD_CHANGE';
  if (req.path.includes('/backup')) return req.method==='GET' ? 'BACKUP_EXPORT' : 'BACKUP_RESTORE';
  if (req.path.includes('/users/')) return req.method==='DELETE' ? 'ROLE_CHANGE' : 'USER_CHANGE';
  if (req.path.includes('/movement')) return 'STOCK_ADJUSTMENT';
  if (req.path.includes('/orders/')) return req.method==='DELETE' ? 'DELETE' : 'ORDER_STATUS_CHANGE';
  if (req.method==='POST') return 'CREATE';
  if (req.method==='PUT' || req.method==='PATCH') return 'UPDATE';
  if (req.method==='DELETE') return 'DELETE';
  return null;
}
function auditMutations(req,res,next){
  res.on('finish', async()=>{
    if(!req.user || ['GET','HEAD','OPTIONS'].includes(req.method)) return;
    const action=inferAction(req); if(!action) return;
    const match=req.path.match(/\/(\d+)(?:\/|$)/);
    const entity=req.path.split('/').filter(Boolean)[1] || req.path;
    try{ await dbRun(`INSERT INTO audit_logs(user_id,action,entity,entity_id,ip,result) VALUES($1,$2,$3,$4,$5,$6)`,[
      req.user.id,action,entity,match?Number(match[1]):null,req.ip||null,res.statusCode<400?'SUCCESS':'FAILURE']); }catch(err){ console.error('Audit log error:',err.message); }
  }); next();
}
module.exports={auditMutations};
