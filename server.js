require('dotenv').config();
const express=require('express');const cors=require('cors');const rateLimit=require('express-rate-limit');const crypto=require('crypto');const path=require('path');
const {initDb,getPool}=require('./database/init');
const app=express();const PORT=process.env.PORT||3000;
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((req,res,next)=>{const id=crypto.randomUUID();const started=Date.now();res.setHeader('X-Request-ID',id);res.on('finish',()=>{if(req.path!=='/health')console.log(JSON.stringify({ts:new Date().toISOString(),requestId:id,method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-started}));});next();});
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','geolocation=(self), camera=(), microphone=()');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.open-meteo.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");if(req.secure||process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=15552000; includeSubDomains');next();});
const allowedOrigin=process.env.FRONTEND_URL;
app.use(cors(allowedOrigin?{origin:allowedOrigin,credentials:true}:{origin:false}));
app.get('/health',async(req,res)=>{try{await getPool().query('SELECT 1');res.json({ok:true,status:'healthy'});}catch(e){res.status(503).json({ok:false,status:'unhealthy'});}});
app.use('/api',rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas requisições. Aguarde alguns minutos.'}}));
app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use(express.json({limit:'2mb'}));app.use(express.urlencoded({extended:true,limit:'2mb'}));
app.use(express.static(path.join(__dirname,'frontend')));
app.use('/api/auth',require('./routes/auth'));app.use('/api',require('./routes/api'));
app.use('/api',(err,req,res,next)=>{console.error('API error:',err);const status=err.status||500;res.status(status).json({error:status>=500?'Erro interno do servidor.':(err.message||'Erro na requisição.')});});
app.use('/api',(req,res)=>res.status(404).json({error:'Rota da API não encontrada.'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'frontend','index.html')));
let server;
initDb().then(()=>{server=app.listen(PORT,'0.0.0.0',()=>console.log(`🖨️ Gestão 3D v3.3.2 rodando na porta ${PORT}`));}).catch(e=>{console.error('Erro ao inicializar PostgreSQL:',e);process.exit(1)});

async function shutdown(signal){console.log(`Encerrando por ${signal}...`);try{if(server)await new Promise(resolve=>server.close(resolve));await getPool().end();}catch(e){console.error('Erro no encerramento:',e.message);}finally{process.exit(0);}}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
