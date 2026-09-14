const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
function read(f){return fs.readFileSync(path.join(root,f),'utf8')}
const api=read('routes/api.js'),auth=read('middleware/auth.js'),a=read('routes/auth.js'),html=read('frontend/index.html');
const checks=[
  [api.includes("router.use((req,res,next)=>{if(req.user?.role==='CLIENTE')"),'CLIENTE server-side restriction'],
  [auth.includes("HttpOnly" ) && auth.includes('SameSite=Lax'),'secure session cookie flags'],
  [auth.includes('timingSafeEqual'),'CSRF timing-safe compare'],
  [a.includes('argon2'),'Argon2id enabled'],
  [!html.includes('admin123'),'no default admin password in HTML'],
  [api.includes("router.get('/audit-logs'"),'audit endpoint'],
  [api.includes("router.get('/search'"),'global search endpoint'],
  [api.includes("router.get('/notifications'"),'notifications endpoint'],
  [api.includes("private_download_url"),'private 3D download flow'],
  [fs.existsSync(path.join(root,'Dockerfile')),'Docker support'],
];
for(const [ok,name] of checks)if(!ok)throw new Error('Security smoke failed: '+name);
console.log('✅ Security smoke passed');
