const express=require('express');const multer=require('multer');const crypto=require('crypto');const cloudinary=require('cloudinary').v2;
const {dbRun,dbGet,dbAll,withTransaction,getPool}=require('../database/init');
const {calculateQuoteCosts, calculateOrderTotal}=require('../utils/business');const{auth,adminOnly,csrfProtection}=require('../middleware/auth');const{auditMutations}=require('../middleware/audit');
const router=express.Router();router.use(auth,csrfProtection,auditMutations);const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024}});const projectFileUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024}});const backupUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024}});
const today=()=>new Date().toISOString().slice(0,10);const n=v=>Number(v)||0;const bool=v=>v===true||v===1||v==='1'||v==='true';
router.use((req,res,next)=>{if(req.user?.role==='CLIENTE'){const ok=(req.method==='GET' && (req.path==='/orders'||req.path.startsWith('/orders/')))||(req.method==='GET' && req.path==='/production');if(!ok)return res.status(403).json({error:'Perfil CLIENTE não possui acesso a este recurso.'});}next();});
function cloudReady(){return !!(process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET)}
if(cloudReady()) cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});
function uploadBuffer(buffer,folder){return new Promise((resolve,reject)=>{const s=cloudinary.uploader.upload_stream({folder,resource_type:'image'},(e,r)=>e?reject(e):resolve(r));s.end(buffer)})}
function uploadRawBuffer(buffer,folder){return new Promise((resolve,reject)=>{const s=cloudinary.uploader.upload_stream({folder,resource_type:'raw',type:'authenticated',use_filename:false,unique_filename:true,overwrite:false},(e,r)=>e?reject(e):resolve(r));s.end(buffer)})}
function safeFileName(name='arquivo'){return String(name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-160)||'arquivo'}
const ALLOWED_3D_EXT=new Set(['.stl','.3mf','.step','.stp','.gcode','.obj']);
async function consumeItem(tx,{table,id,qty,quantityField='current_qty',movementTable,type,reason,referenceId,notes,userId}){
 const item=await tx.get(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id]);if(!item)throw Object.assign(new Error('Item não encontrado'),{status:404});const q=n(qty);if(q<=0)throw Object.assign(new Error('Quantidade inválida'),{status:400});if(n(item[quantityField])<q)throw Object.assign(new Error('Estoque insuficiente'),{status:400});const nw=n(item[quantityField])-q;await tx.run(`UPDATE ${table} SET ${quantityField}=$1 WHERE id=$2`,[nw,id]);await tx.run(`INSERT INTO ${movementTable} (${table==='small_parts'?'part_id':'consumable_id'},type,quantity,reason,reference_id,reference_type,notes,created_by) VALUES($1,'CONSUMO',$2,$3,$4,$5,$6,$7)`,[id,q,reason,referenceId,type,notes||null,userId]);return{item,newQty:nw}}

// Customers
router.get('/customers',async(req,res,next)=>{try{res.json(await dbAll(`SELECT c.*,COUNT(o.id)::int total_orders,COALESCE(SUM(o.total),0) total_spent FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.deleted_at IS NULL WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.name`))}catch(e){next(e)}});
router.post('/customers',adminOnly,async(req,res,next)=>{try{const{name,phone,email,city,notes}=req.body;if(!name)return res.status(400).json({error:'Nome obrigatório'});const r=await dbGet('INSERT INTO customers(name,phone,email,city,notes) VALUES($1,$2,$3,$4,$5) RETURNING id',[name,phone||null,email||null,city||null,notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/customers/:id',adminOnly,async(req,res,next)=>{try{const{name,phone,email,city,notes}=req.body;await dbRun('UPDATE customers SET name=$1,phone=$2,email=$3,city=$4,notes=$5 WHERE id=$6',[name,phone||null,email||null,city||null,notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/customers/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE customers SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

// Printers + maintenance
async function refreshProjectProductCosts(tx, projectId){
 const products=await tx.all('SELECT * FROM products WHERE project_id=$1 AND deleted_at IS NULL',[projectId]);
 const pc=await tx.get('SELECT COALESCE(SUM(total_cost),0) total FROM project_parts WHERE project_id=$1 AND deleted_at IS NULL',[projectId]);
 const projectPartsCost=n(pc?.total);
 for(const p of products){
   const componentCost=n((await tx.get('SELECT COALESCE(SUM(total_cost),0) total FROM product_components WHERE product_id=$1',[p.id]))?.total);
   const base=n(p.cost_total)-n(p.cost_parts)-n(p.cost_project_parts);
   const total=base+componentCost+projectPartsCost; const price=n(p.price); const margin=price>0?(price-total)/price*100:0; const markup=total>0?(price-total)/total*100:0;
   await tx.run('UPDATE products SET cost_parts=$1,cost_project_parts=$2,cost_total=$3,margin=$4,markup=$5 WHERE id=$6',[componentCost,projectPartsCost,total,margin,markup,p.id]);
 }
}
router.get('/printers',async(req,res,next)=>{try{res.json(await dbAll(`SELECT p.*,COALESCE(t.test_prints,0)::int test_prints,COALESCE(t.test_failures,0)::int test_failures,COALESCE(t.test_hours,0) test_hours,COALESCE(t.test_filament,0) test_filament FROM printers p LEFT JOIN (SELECT printer_id,COUNT(*) FILTER (WHERE real_time_min > 0 AND result <> 'CANCELADO') test_prints,COUNT(*) FILTER (WHERE result = 'REPROVADO') test_failures,COALESCE(SUM(CASE WHEN real_time_min > 0 AND result <> 'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 test_hours,COALESCE(SUM(CASE WHEN real_time_min > 0 AND result <> 'CANCELADO' THEN COALESCE(real_weight_g,0)+COALESCE(waste_g,0) ELSE 0 END),0) test_filament FROM tests WHERE deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id WHERE p.deleted_at IS NULL ORDER BY p.name`))}catch(e){next(e)}});
router.post('/printers',adminOnly,async(req,res,next)=>{try{const b=req.body;if(!b.name)return res.status(400).json({error:'Nome obrigatório'});const r=await dbGet('INSERT INTO printers(name,brand,model,serial,purchase_date,purchase_price,location,power_watts,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[b.name,b.brand||null,b.model||null,b.serial||null,b.purchase_date||null,n(b.purchase_price),b.location||null,n(b.power_watts),b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/printers/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;await dbRun('UPDATE printers SET name=$1,brand=$2,model=$3,serial=$4,purchase_date=$5,purchase_price=$6,location=$7,power_watts=$8,status=$9,notes=$10 WHERE id=$11',[b.name,b.brand||null,b.model||null,b.serial||null,b.purchase_date||null,n(b.purchase_price),b.location||null,n(b.power_watts),b.status||'DISPONIVEL',b.notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/printers/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE printers SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.get('/printers/:id/maintenance',async(req,res,next)=>{try{res.json(await dbAll(`SELECT pm.*,mp.task as plan_task FROM printer_maintenance pm LEFT JOIN maintenance_plans mp ON mp.id=pm.plan_id WHERE pm.printer_id=$1 ORDER BY pm.created_at DESC`,[req.params.id]))}catch(e){next(e)}});
router.post('/printers/:id/maintenance',async(req,res,next)=>{try{const b=req.body||{};const result=await withTransaction(async tx=>{
 const printer=await tx.get(`SELECT COALESCE(p.total_hours,0) + COALESCE(t.test_hours,0) AS current_hours,p.status FROM printers p LEFT JOIN (SELECT printer_id,COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 AS test_hours FROM tests WHERE deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id WHERE p.id=$1 AND p.deleted_at IS NULL`,[req.params.id]);
 if(!printer)throw Object.assign(new Error('Impressora não encontrada'),{status:404});
 const plan=b.plan_id?await tx.get('SELECT * FROM maintenance_plans WHERE id=$1 AND printer_id=$2 AND active=true',[b.plan_id,req.params.id]):null;
 if(b.plan_id&&!plan)throw Object.assign(new Error('Plano de manutenção não encontrado ou inativo'),{status:404});
 const completedHours=b.hours_at!==undefined&&b.hours_at!==''?n(b.hours_at):n(printer.current_hours);
 const task=String(b.task||plan?.task||'').trim(); if(!task)throw Object.assign(new Error('Tarefa é obrigatória'),{status:400});
 const doneAt=b.done_at||null,scheduledAt=b.scheduled_at||null; if(doneAt && !/^\d{4}-\d{2}-\d{2}$/.test(String(doneAt)))throw Object.assign(new Error('Data de conclusão inválida'),{status:400}); if(scheduledAt && !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduledAt)))throw Object.assign(new Error('Data programada inválida'),{status:400});
 const r=await tx.get('INSERT INTO printer_maintenance(printer_id,plan_id,task,scheduled_at,done_at,hours_at,cost,parts_used,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[req.params.id,b.plan_id||null,task,scheduledAt,doneAt,completedHours,n(b.cost),String(b.parts_used||'').trim()||null,b.notes||null]);
 const maintenanceId=r.id;
 if(doneAt&&plan){await tx.run(`UPDATE maintenance_plans SET last_completed_at=$1,last_completed_hours=$2,next_due_date=CASE WHEN interval_days IS NOT NULL THEN ($1::date + interval_days * INTERVAL '1 day') ELSE NULL END,next_due_hours=CASE WHEN interval_hours IS NOT NULL THEN $2 + interval_hours ELSE NULL END WHERE id=$3`,[doneAt,completedHours,b.plan_id]);}
 for(const item of (Array.isArray(b.consumables)?b.consumables:[])){const q=n(item.quantity);if(q>0)await consumeItem(tx,{table:'tool_consumables',id:item.id,qty:q,movementTable:'consumable_movements',reason:'MANUTENCAO',referenceId:maintenanceId,notes:b.notes,userId:req.user.id});}
 for(const item of (Array.isArray(b.parts)?b.parts:[])){const q=n(item.quantity);if(q>0)await consumeItem(tx,{table:'small_parts',id:item.id,qty:q,movementTable:'part_movements',reason:'MANUTENCAO',referenceId:maintenanceId,notes:b.notes,userId:req.user.id});}
 if(doneAt){await tx.run("UPDATE printers SET status='DISPONIVEL' WHERE id=$1 AND deleted_at IS NULL",[req.params.id]);}
 return r;});res.json({id:Number(result.id),maintenance_completed:Boolean(b.done_at)});}catch(e){next(e)}});

const MAINT_WARNING_HOURS=20;
router.get('/maintenance/plans',async(req,res,next)=>{try{res.json(await dbAll(`SELECT mp.*,p.name printer_name,
  COALESCE(p.total_hours,0) + COALESCE(t.test_hours,0) AS current_hours,
  CASE
    WHEN mp.next_due_hours IS NOT NULL AND COALESCE(p.total_hours,0) + COALESCE(t.test_hours,0) >= mp.next_due_hours THEN 'ATRASADA'
    WHEN mp.next_due_date IS NOT NULL AND CURRENT_DATE >= mp.next_due_date THEN 'ATRASADA'
    WHEN mp.next_due_hours IS NOT NULL AND mp.next_due_hours-(COALESCE(p.total_hours,0) + COALESCE(t.test_hours,0)) <= ${MAINT_WARNING_HOURS} THEN 'PROXIMA'
    WHEN mp.next_due_date IS NOT NULL AND mp.next_due_date-CURRENT_DATE <= 7 THEN 'PROXIMA'
    ELSE 'EM_DIA'
  END AS status,
  CASE WHEN mp.next_due_hours IS NOT NULL THEN GREATEST(mp.next_due_hours-(COALESCE(p.total_hours,0) + COALESCE(t.test_hours,0)),0) END AS hours_remaining
  FROM maintenance_plans mp JOIN printers p ON p.id=mp.printer_id
  LEFT JOIN (SELECT printer_id,COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 AS test_hours FROM tests WHERE deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id
  WHERE p.deleted_at IS NULL AND mp.active=true ORDER BY CASE WHEN mp.next_due_hours IS NOT NULL AND COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)>=mp.next_due_hours THEN 0 WHEN mp.next_due_date IS NOT NULL AND CURRENT_DATE>=mp.next_due_date THEN 0 ELSE 1 END,p.name,mp.task`))}catch(e){next(e)}});
router.post('/maintenance/plans',async(req,res,next)=>{try{
  const b=req.body||{};
  const printerId=Number(b.printer_id);
  const task=String(b.task||'').trim();
  if(!Number.isInteger(printerId)||printerId<=0)return res.status(400).json({error:'Impressora inválida'});
  if(!task)return res.status(400).json({error:'Informe a tarefa'});
  const ih=(b.interval_hours!==''&&b.interval_hours!=null)?n(b.interval_hours):null;
  const idays=(b.interval_days!==''&&b.interval_days!=null)?Number(b.interval_days):null;
  const nextHoursInput=(b.next_due_hours!==''&&b.next_due_hours!=null)?n(b.next_due_hours):null;
  let dueDate=b.next_due_date?String(b.next_due_date):null;
  if(ih!=null&&(!Number.isFinite(ih)||ih<=0))return res.status(400).json({error:'Intervalo em horas inválido'});
  if(idays!=null&&(!Number.isFinite(idays)||idays<=0))return res.status(400).json({error:'Intervalo em dias inválido'});
  if(nextHoursInput!=null&&(!Number.isFinite(nextHoursInput)||nextHoursInput<0))return res.status(400).json({error:'Próximas horas inválidas'});
  if(ih==null&&idays==null)return res.status(400).json({error:'Informe intervalo em horas ou dias'});
  if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return res.status(400).json({error:'Próxima data inválida'});
  const printer=await dbGet(`SELECT COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0) current_hours FROM printers p LEFT JOIN (SELECT printer_id,COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 test_hours FROM tests WHERE deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id WHERE p.id=$1 AND p.deleted_at IS NULL`,[printerId]);
  if(!printer)return res.status(404).json({error:'Impressora não encontrada'});
  const currentHours=n(printer.current_hours);
  const dueHours=nextHoursInput!=null?nextHoursInput:(ih!=null?currentHours+ih:null);
  if(!dueDate&&idays!=null){
    const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+Math.trunc(idays)); dueDate=d.toISOString().slice(0,10);
  }
  const r=await dbGet(`INSERT INTO maintenance_plans(printer_id,task,interval_hours,interval_days,active,next_due_date,next_due_hours,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[printerId,task,ih,idays==null?null:Math.trunc(idays),b.active!==false,dueDate,dueHours,b.notes?String(b.notes).trim():null]);
  res.json({id:Number(r.id),next_due_hours:dueHours,next_due_date:dueDate});
}catch(e){next(e)}});
router.put('/maintenance/plans/:id',async(req,res,next)=>{try{const b=req.body;const plan=await dbGet('SELECT * FROM maintenance_plans WHERE id=$1',[req.params.id]);if(!plan)return res.status(404).json({error:'Plano não encontrado'});const ih=b.interval_hours!==''&&b.interval_hours!=null?n(b.interval_hours):null,id=b.interval_days!==''&&b.interval_days!=null?parseInt(b.interval_days):null;await dbRun('UPDATE maintenance_plans SET task=$1,interval_hours=$2,interval_days=$3,active=$4,next_due_date=$5,next_due_hours=$6,notes=$7 WHERE id=$8',[b.task,ih,id,b.active!==false,b.next_due_date||null,b.next_due_hours!==''&&b.next_due_hours!=null?n(b.next_due_hours):null,b.notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/maintenance/plans/:id',async(req,res,next)=>{try{await dbRun('UPDATE maintenance_plans SET active=false WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

// Materials/filament
router.get('/materials',async(req,res,next)=>{try{res.json(await dbAll('SELECT * FROM materials ORDER BY type,brand'))}catch(e){next(e)}});
router.post('/materials',adminOnly,async(req,res,next)=>{try{const b=req.body;const r=await dbGet('INSERT INTO materials(type,brand,color,color_code,diameter,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.type,b.brand||null,b.color||null,b.color_code||null,n(b.diameter)||1.75,b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.delete('/rolls/:id',adminOnly,async(req,res,next)=>{try{
  const roll=await dbGet('SELECT id,deleted_at FROM material_rolls WHERE id=$1',[req.params.id]);
  if(!roll)return res.status(404).json({error:'Filamento/rolo não encontrado'});
  if(roll.deleted_at)return res.status(404).json({error:'Filamento/rolo já está excluído'});
  const refs=await dbGet(`SELECT
    (SELECT COUNT(*) FROM tests WHERE roll_id=$1 AND deleted_at IS NULL)::int tests,
    (SELECT COUNT(*) FROM orders WHERE roll_id=$1 AND deleted_at IS NULL)::int orders,
    (SELECT COUNT(*) FROM quotes WHERE roll_id=$1 AND deleted_at IS NULL)::int quotes,
    (SELECT COUNT(*) FROM stock_movements WHERE roll_id=$1)::int movements,
    (SELECT COUNT(*) FROM products WHERE material_roll_id=$1 AND deleted_at IS NULL)::int products`,[req.params.id]);
  await dbRun('UPDATE material_rolls SET deleted_at=NOW() WHERE id=$1',[req.params.id]);
  res.json({ok:true,historyPreserved:true,dependencies:refs});
}catch(e){next(e)}});
router.get('/rolls',async(req,res,next)=>{try{res.json(await dbAll('SELECT r.*,m.type,m.brand,m.color FROM material_rolls r JOIN materials m ON m.id=r.material_id WHERE r.deleted_at IS NULL ORDER BY r.status,m.type'))}catch(e){next(e)}});
router.post('/rolls',adminOnly,async(req,res,next)=>{try{const b=req.body;if(!b.material_id||!b.initial_weight_g)return res.status(400).json({error:'Material e peso obrigatórios'});const w=n(b.initial_weight_g),price=n(b.purchase_price),minStock=b.min_stock_g!=null?n(b.min_stock_g):50,r=await dbGet('INSERT INTO material_rolls(material_id,code,initial_weight_g,current_weight_g,purchase_price,cost_per_gram,supplier,purchase_date,min_stock_g) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING id',[b.material_id,b.code||null,w,price,w?price/w:0,b.supplier||null,b.purchase_date||null,minStock]);await dbRun(`INSERT INTO stock_movements(roll_id,type,reason,quantity_g,notes,created_by) VALUES($1,'ENTRADA','COMPRA',$2,$3,$4)`,[r.id,w,'Entrada inicial',req.user.id]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/rolls/:id',adminOnly,async(req,res,next)=>{try{const b=req.body||{};const result=await withTransaction(async tx=>{
 const roll=await tx.get('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);
 if(!roll)throw Object.assign(new Error('Filamento/rolo não encontrado'),{status:404});
 const materialId=Number(b.material_id||roll.material_id);
 const material=await tx.get('SELECT id FROM materials WHERE id=$1',[materialId]);
 if(!material)throw Object.assign(new Error('Material não encontrado'),{status:404});
 const initial=b.initial_weight_g!==''&&b.initial_weight_g!=null?n(b.initial_weight_g):n(roll.initial_weight_g);
 const current=b.current_weight_g!==''&&b.current_weight_g!=null?n(b.current_weight_g):n(roll.current_weight_g);
 const price=b.purchase_price!==''&&b.purchase_price!=null?n(b.purchase_price):n(roll.purchase_price);
 const minStock=b.min_stock_g!==''&&b.min_stock_g!=null?n(b.min_stock_g):n(roll.min_stock_g);
 if(initial<=0||current<0||minStock<0)throw Object.assign(new Error('Valores de estoque inválidos'),{status:400});
 if(current>initial)throw Object.assign(new Error('Estoque atual não pode ser maior que o peso inicial'),{status:400});
 const costPerGram=initial>0?price/initial:0;
 const status=current<=0?'ESGOTADO':current<=minStock?'EM_USO':'DISPONIVEL';
 await tx.run('UPDATE material_rolls SET material_id=$1,code=$2,initial_weight_g=$3,current_weight_g=$4,purchase_price=$5,cost_per_gram=$6,supplier=$7,purchase_date=$8,min_stock_g=$9,status=$10 WHERE id=$11',[materialId,b.code!==undefined?String(b.code).trim()||null:roll.code,initial,current,price,costPerGram,b.supplier!==undefined?String(b.supplier).trim()||null:roll.supplier,b.purchase_date||null,minStock,status,req.params.id]);
 if(Math.abs(current-n(roll.current_weight_g))>0.0001){const delta=current-n(roll.current_weight_g);await tx.run(`INSERT INTO stock_movements(roll_id,type,reason,quantity_g,notes,created_by) VALUES($1,'AJUSTE','AJUSTE_MANUAL',$2,$3,$4)`,[req.params.id,Math.abs(delta),'Edição manual de estoque',req.user.id]);}
 return {id:Number(req.params.id),current_weight_g:current,cost_per_gram:costPerGram,status};
 });res.json(result);}catch(e){next(e)}});
router.post('/rolls/:id/movement',adminOnly,async(req,res,next)=>{try{const b=req.body,q=n(b.quantity_g);if(q<=0)return res.status(400).json({error:'Quantidade inválida'});const result=await withTransaction(async tx=>{const roll=await tx.get('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);if(!roll)throw Object.assign(new Error('Rolo não encontrado'),{status:404});const delta=['ENTRADA','DEVOLUCAO','AJUSTE'].includes(b.type)?q:-q,nw=n(roll.current_weight_g)+delta;if(nw<0)throw Object.assign(new Error('Estoque insuficiente'),{status:400});await tx.run('UPDATE material_rolls SET current_weight_g=$1,status=$2 WHERE id=$3',[nw,nw<=0?'ESGOTADO':nw<=n(roll.min_stock_g)?'EM_USO':'DISPONIVEL',req.params.id]);await tx.run('INSERT INTO stock_movements(roll_id,type,reason,quantity_g,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,b.type,b.reason||'AJUSTE',q,b.notes||null,req.user.id]);return nw});res.json({ok:true,new_weight:result});}catch(e){next(e)}});
router.get('/stock/movements',async(req,res,next)=>{try{res.json(await dbAll(`SELECT sm.*,r.code roll_code,m.type material_type,m.color FROM stock_movements sm LEFT JOIN material_rolls r ON r.id=sm.roll_id LEFT JOIN materials m ON m.id=r.material_id ORDER BY sm.created_at DESC LIMIT 200`))}catch(e){next(e)}});

// Consumables/tools
router.get('/consumables',async(req,res,next)=>{try{res.json(await dbAll('SELECT * FROM tool_consumables WHERE deleted_at IS NULL ORDER BY name'))}catch(e){next(e)}});
router.post('/consumables',adminOnly,async(req,res,next)=>{try{const b=req.body;const r=await dbGet('INSERT INTO tool_consumables(name,category,unit,current_qty,min_qty,unit_cost,supplier,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[b.name,b.category||null,b.unit||'un',n(b.current_qty),n(b.min_qty),n(b.unit_cost),b.supplier||null,b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/consumables/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;await dbRun('UPDATE tool_consumables SET name=$1,category=$2,unit=$3,current_qty=$4,min_qty=$5,unit_cost=$6,supplier=$7,notes=$8 WHERE id=$9',[b.name,b.category||null,b.unit||'un',n(b.current_qty),n(b.min_qty),n(b.unit_cost),b.supplier||null,b.notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/consumables/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE tool_consumables SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.post('/consumables/:id/movement',adminOnly,async(req,res,next)=>{try{const b=req.body,q=n(b.quantity);if(q<=0)return res.status(400).json({error:'Quantidade inválida'});const result=await withTransaction(async tx=>{const c=await tx.get('SELECT * FROM tool_consumables WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);if(!c)throw Object.assign(new Error('Consumível não encontrado'),{status:404});let nw=n(c.current_qty);if(['ENTRADA','DEVOLUCAO'].includes(b.type))nw+=q;else nw-=q;if(nw<0)throw Object.assign(new Error('Estoque insuficiente'),{status:400});await tx.run('UPDATE tool_consumables SET current_qty=$1 WHERE id=$2',[nw,req.params.id]);await tx.run('INSERT INTO consumable_movements(consumable_id,type,quantity,reason,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,b.type,q,b.reason||'AJUSTE',b.notes||null,req.user.id]);return nw});res.json({ok:true,current_qty:result});}catch(e){next(e)}});
router.get('/consumables/movements',async(req,res,next)=>{try{res.json(await dbAll(`SELECT cm.*,tc.name,tc.unit FROM consumable_movements cm JOIN tool_consumables tc ON tc.id=cm.consumable_id ORDER BY cm.created_at DESC LIMIT 200`))}catch(e){next(e)}});

// Small parts
router.get('/parts',async(req,res,next)=>{try{res.json(await dbAll('SELECT * FROM small_parts WHERE deleted_at IS NULL ORDER BY category,name,type,size'))}catch(e){next(e)}});
router.post('/parts',adminOnly,async(req,res,next)=>{try{const b=req.body;const r=await dbGet('INSERT INTO small_parts(category,name,type,size,material,current_qty,min_qty,unit_cost,supplier,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[b.category||null,b.name,b.type||null,b.size||null,b.material||null,n(b.current_qty),n(b.min_qty),n(b.unit_cost),b.supplier||null,b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/parts/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;await dbRun('UPDATE small_parts SET category=$1,name=$2,type=$3,size=$4,material=$5,current_qty=$6,min_qty=$7,unit_cost=$8,supplier=$9,notes=$10 WHERE id=$11',[b.category||null,b.name,b.type||null,b.size||null,b.material||null,n(b.current_qty),n(b.min_qty),n(b.unit_cost),b.supplier||null,b.notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/parts/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE small_parts SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.post('/parts/:id/movement',adminOnly,async(req,res,next)=>{try{const b=req.body,q=n(b.quantity);if(q<=0)return res.status(400).json({error:'Quantidade inválida'});const result=await withTransaction(async tx=>{const part=await tx.get('SELECT * FROM small_parts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);if(!part)throw Object.assign(new Error('Peça não encontrada'),{status:404});let nw=n(part.current_qty);if(['ENTRADA','DEVOLUCAO'].includes(b.type))nw+=q;else nw-=q;if(nw<0)throw Object.assign(new Error('Estoque insuficiente'),{status:400});await tx.run('UPDATE small_parts SET current_qty=$1 WHERE id=$2',[nw,req.params.id]);await tx.run('INSERT INTO part_movements(part_id,type,quantity,reason,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,b.type,q,b.reason||'AJUSTE',b.notes||null,req.user.id]);return nw});res.json({ok:true,current_qty:result});}catch(e){next(e)}});
router.get('/parts/movements',async(req,res,next)=>{try{res.json(await dbAll(`SELECT pm.*,sp.name,sp.size,sp.type part_type FROM part_movements pm JOIN small_parts sp ON sp.id=pm.part_id ORDER BY pm.created_at DESC LIMIT 200`))}catch(e){next(e)}});

// Projects + parts
router.get('/projects',async(req,res,next)=>{try{res.json(await dbAll(`SELECT p.*,c.name customer_name,(SELECT COUNT(*) FROM project_versions WHERE project_id=p.id)::int versions_count,(SELECT COUNT(*) FROM tests WHERE project_id=p.id AND deleted_at IS NULL)::int tests_count,(SELECT COALESCE(SUM(pp.total_cost),0) FROM project_parts pp WHERE pp.project_id=p.id) parts_cost FROM projects p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`))}catch(e){next(e)}});
router.post('/projects',adminOnly,async(req,res,next)=>{try{const b=req.body;if(!b.name)return res.status(400).json({error:'Nome obrigatório'});const r=await dbGet('INSERT INTO projects(name,description,type,responsible,customer_id,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.name,b.description||null,b.type||'COMERCIAL',b.responsible||null,b.customer_id||null,b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/projects/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;await dbRun('UPDATE projects SET name=$1,description=$2,type=$3,status=$4,responsible=$5,customer_id=$6,notes=$7 WHERE id=$8',[b.name,b.description||null,b.type,b.status||'EM_DESENVOLVIMENTO',b.responsible||null,b.customer_id||null,b.notes||null,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/projects/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE projects SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.get('/projects/:id/versions',async(req,res,next)=>{try{res.json(await dbAll('SELECT * FROM project_versions WHERE project_id=$1 ORDER BY created_at DESC',[req.params.id]))}catch(e){next(e)}});
router.post('/projects/:id/versions',adminOnly,async(req,res,next)=>{try{const b=req.body;const r=await dbGet('INSERT INTO project_versions(project_id,version,filename,changes,reason,result,author) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[req.params.id,b.version,b.filename||null,b.changes||null,b.reason||null,b.result||null,b.author||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.post('/projects/:projectId/versions/:versionId/file',adminOnly,projectFileUpload.single('file'),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({error:'Arquivo não enviado'});const projectId=Number(req.params.projectId),versionId=Number(req.params.versionId);if(!Number.isFinite(projectId)||!Number.isFinite(versionId))return res.status(400).json({error:'Identificadores inválidos'});const version=await dbGet('SELECT * FROM project_versions WHERE id=$1 AND project_id=$2',[versionId,projectId]);if(!version)return res.status(404).json({error:'Versão não encontrada'});const ext=(safeFileName(req.file.originalname).match(/\.[^.]+$/)||[''])[0].toLowerCase();if(!ALLOWED_3D_EXT.has(ext))return res.status(400).json({error:'Formato 3D não permitido. Use STL, 3MF, STEP, STP, GCODE ou OBJ.'});if(!cloudReady())return res.status(503).json({error:'Cloudinary não configurado para arquivos 3D'});const hash=crypto.createHash('sha256').update(req.file.buffer).digest('hex');const r=await uploadRawBuffer(req.file.buffer,`gestao3d/projects/${projectId}/versions`);if(version.file_storage_key){try{await cloudinary.uploader.destroy(version.file_storage_key,{resource_type:'raw',type:'authenticated'})}catch{}}await dbRun('UPDATE project_versions SET filename=$1,file_storage_key=$2,file_size=$3,file_mime=$4,file_hash=$5,file_storage_provider=$6 WHERE id=$7',[safeFileName(req.file.originalname),r.public_id,req.file.size,req.file.mimetype||'application/octet-stream',hash,'cloudinary',versionId]);res.json({ok:true,filename:safeFileName(req.file.originalname),size:req.file.size,hash,provider:'cloudinary'});}catch(e){next(e)}});
router.get('/projects/:projectId/versions/:versionId/file',auth,async(req,res,next)=>{try{const projectId=Number(req.params.projectId),versionId=Number(req.params.versionId);const version=await dbGet('SELECT * FROM project_versions WHERE id=$1 AND project_id=$2',[versionId,projectId]);if(!version||!version.file_storage_key)return res.status(404).json({error:'Arquivo não encontrado'});if(!cloudReady()||version.file_storage_provider!=='cloudinary')return res.status(503).json({error:'Storage do arquivo indisponível'});const parts=String(version.filename||'arquivo').split('.');const format=parts.length>1?parts.pop():undefined;const url=cloudinary.utils.private_download_url(version.file_storage_key,format,{resource_type:'raw',type:'authenticated',attachment:false,expires_at:Math.floor(Date.now()/1000)+300});res.redirect(url);}catch(e){next(e)}});
router.get('/projects/:id/parts',async(req,res,next)=>{try{res.json(await dbAll(`SELECT pp.*,sp.name,sp.type,sp.size,sp.material,sp.current_qty FROM project_parts pp JOIN small_parts sp ON sp.id=pp.part_id WHERE pp.project_id=$1 AND pp.deleted_at IS NULL ORDER BY pp.created_at DESC`,[req.params.id]))}catch(e){next(e)}});
router.post('/projects/:id/parts',async(req,res,next)=>{try{const b=req.body,q=n(b.quantity);if(!b.part_id||q<=0)return res.status(400).json({error:'Peça e quantidade são obrigatórias'});const result=await withTransaction(async tx=>{const part=await tx.get('SELECT * FROM small_parts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[b.part_id]);if(!part)return Object.assign(new Error('Peça não encontrada'),{status:404});if(n(part.current_qty)<q)throw Object.assign(new Error('Estoque insuficiente'),{status:400});const total=n(part.unit_cost)*q;await tx.run('UPDATE small_parts SET current_qty=current_qty-$1 WHERE id=$2',[q,b.part_id]);const pp=await tx.get('INSERT INTO project_parts(project_id,part_id,quantity,unit_cost,total_cost) VALUES($1,$2,$3,$4,$5) RETURNING id',[req.params.id,b.part_id,q,n(part.unit_cost),total]);await tx.run(`INSERT INTO part_movements(part_id,type,quantity,reason,reference_id,reference_type,created_by) VALUES($1,'CONSUMO',$2,'PROJETO',$3,'project',$4)`,[b.part_id,q,pp.id,req.user.id]);await refreshProjectProductCosts(tx,req.params.id);return pp});res.json({id:Number(result.id)})}catch(e){next(e)}});
router.delete('/projects/:projectId/parts/:id',async(req,res,next)=>{try{await withTransaction(async tx=>{const pp=await tx.get('SELECT * FROM project_parts WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE',[req.params.id,req.params.projectId]);if(!pp)throw Object.assign(new Error('Vinculo não encontrado'),{status:404});await tx.run('UPDATE small_parts SET current_qty=current_qty+$1 WHERE id=$2',[n(pp.quantity),pp.part_id]);await tx.run("INSERT INTO part_movements(part_id,type,quantity,reason,reference_id,reference_type,created_by) VALUES($1,'DEVOLUCAO',$2,'REMOCAO_PROJETO',$3,'project',$4)",[pp.part_id,n(pp.quantity),pp.id,req.user.id]);await tx.run('UPDATE project_parts SET deleted_at=NOW() WHERE id=$1',[pp.id]);await refreshProjectProductCosts(tx,req.params.projectId)});res.json({ok:true})}catch(e){next(e)}});

// Tests
router.get('/tests',async(req,res,next)=>{try{res.json(await dbAll(`SELECT t.*,COALESCE(t.test_date,t.created_at::date) test_date,
  p.name project_name,COALESCE(c.name,pc.name) customer_name,pr.name printer_name,pv.version
  FROM tests t
  LEFT JOIN projects p ON p.id=t.project_id
  LEFT JOIN customers c ON c.id=t.customer_id
  LEFT JOIN customers pc ON pc.id=p.customer_id
  LEFT JOIN printers pr ON pr.id=t.printer_id
  LEFT JOIN project_versions pv ON pv.id=t.version_id
  WHERE t.deleted_at IS NULL
  ORDER BY COALESCE(t.test_date,t.created_at::date) DESC,t.created_at DESC`))}catch(e){next(e)}});
router.post('/tests',async(req,res,next)=>{try{const b=req.body;const result=await withTransaction(async tx=>{
  let projectId=b.project_id||null, customerId=b.customer_id||null;
  if(projectId){const project=await tx.get('SELECT id,customer_id FROM projects WHERE id=$1 AND deleted_at IS NULL',[projectId]);if(!project)throw Object.assign(new Error('Projeto não encontrado'),{status:404});if(!customerId)customerId=project.customer_id||null;}
  if(customerId){const customer=await tx.get('SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL',[customerId]);if(!customer)throw Object.assign(new Error('Cliente/negócio não encontrado'),{status:404});}
  if(b.version_id && !projectId)throw Object.assign(new Error('A versão depende de um projeto'),{status:400});
  if(b.version_id){const version=await tx.get('SELECT id FROM project_versions WHERE id=$1 AND project_id=$2',[b.version_id,projectId]);if(!version)throw Object.assign(new Error('Versão não pertence ao projeto selecionado'),{status:400});}
  const r=await tx.get(`INSERT INTO tests(name,customer_id,project_id,version_id,printer_id,roll_id,est_time_min,real_time_min,est_weight_g,real_weight_g,waste_g,temp_nozzle,temp_bed,layer_height,infill,walls,speed,supports,result,failure_type,failure_cause,notes,test_date)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [b.name||null,customerId,projectId,b.version_id||null,b.printer_id||null,b.roll_id||null,n(b.real_time_min),n(b.real_weight_g),n(b.waste_g),b.temp_nozzle||null,b.temp_bed||null,b.layer_height||null,b.infill||null,b.walls||null,b.speed||null,bool(b.supports),b.result||null,b.failure_type||null,b.failure_cause||null,b.notes||null,(b.test_date||today())]);
  if(b.roll_id&&n(b.real_weight_g)+n(b.waste_g)>0&&b.result!=='CANCELADO'){const roll=await tx.get('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[b.roll_id]);const consume=n(b.real_weight_g)+n(b.waste_g);if(!roll)throw Object.assign(new Error('Rolo não encontrado'),{status:404});if(n(roll.current_weight_g)<consume)throw Object.assign(new Error('Estoque de filamento insuficiente'),{status:400});const nw=n(roll.current_weight_g)-consume;await tx.run('UPDATE material_rolls SET current_weight_g=$1,status=$2 WHERE id=$3',[nw,nw<=0?'ESGOTADO':nw<=n(roll.min_stock_g)?'EM_USO':'DISPONIVEL',b.roll_id]);await tx.run(`INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by) VALUES($1,'CONSUMO','TESTE',$2,$3,'test',$4)`,[b.roll_id,consume,r.id,req.user.id])}
  return r
});res.json({id:Number(result.id)})}catch(e){next(e)}});
router.put('/tests/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const result = await withTransaction(async tx => {
      const old = await tx.get('SELECT * FROM tests WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
      if (!old) throw Object.assign(new Error('Teste não encontrado'), { status: 404 });
      const oldMoves = await tx.all("SELECT * FROM stock_movements WHERE reference_type='test' AND reference_id=$1 AND type='CONSUMO' ORDER BY id DESC", [req.params.id]);
      for (const mv of oldMoves) {
        await tx.run("UPDATE material_rolls SET current_weight_g=current_weight_g+$1,status=CASE WHEN current_weight_g+$1<=0 THEN 'ESGOTADO' WHEN current_weight_g+$1<=min_stock_g THEN 'EM_USO' ELSE 'DISPONIVEL' END WHERE id=$2", [n(mv.quantity_g), mv.roll_id]);
        await tx.run("INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by) VALUES($1,'DEVOLUCAO','CORRECAO_TESTE',$2,$3,'test',$4)", [mv.roll_id, n(mv.quantity_g), req.params.id, req.user.id]);
      }
      let nextProjectId=b.project_id||null, nextCustomerId=b.customer_id||null;
      if(nextProjectId){const project=await tx.get('SELECT id,customer_id FROM projects WHERE id=$1 AND deleted_at IS NULL',[nextProjectId]);if(!project)throw Object.assign(new Error('Projeto não encontrado'),{status:404});if(!nextCustomerId)nextCustomerId=project.customer_id||null;}
      if(nextCustomerId){const customer=await tx.get('SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL',[nextCustomerId]);if(!customer)throw Object.assign(new Error('Cliente/negócio não encontrado'),{status:404});}
      if(b.version_id && !nextProjectId)throw Object.assign(new Error('A versão depende de um projeto'),{status:400});
      if(b.version_id){const version=await tx.get('SELECT id FROM project_versions WHERE id=$1 AND project_id=$2',[b.version_id,nextProjectId]);if(!version)throw Object.assign(new Error('Versão não pertence ao projeto selecionado'),{status:400});}
      await tx.run(`UPDATE tests SET name=$1,customer_id=$2,project_id=$3,version_id=$4,printer_id=$5,roll_id=$6,est_time_min=0,real_time_min=$7,est_weight_g=0,real_weight_g=$8,waste_g=$9,temp_nozzle=$10,temp_bed=$11,layer_height=$12,infill=$13,walls=$14,speed=$15,supports=$16,result=$17,failure_type=$18,failure_cause=$19,notes=$20,test_date=$21 WHERE id=$22`, [
        b.name||null,nextCustomerId,nextProjectId,b.version_id||null,b.printer_id||null,b.roll_id||null,
        n(b.real_time_min),n(b.real_weight_g),n(b.waste_g),
        b.temp_nozzle ?? null,b.temp_bed ?? null,b.layer_height ?? null,b.infill ?? null,b.walls ?? null,
        b.speed ?? null,bool(b.supports),b.result||null,b.failure_type||null,b.failure_cause||null,b.notes||null,
        (b.test_date||today()),req.params.id
      ]);
      const consume=Math.max(0,n(b.real_weight_g)+n(b.waste_g));
      if(b.roll_id&&consume>0&&b.result!=='CANCELADO'){
        const roll=await tx.get('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[b.roll_id]);
        if(!roll)throw Object.assign(new Error('Rolo não encontrado'),{status:404});
        if(n(roll.current_weight_g)<consume)throw Object.assign(new Error('Estoque de filamento insuficiente'),{status:400});
        const nw=n(roll.current_weight_g)-consume;
        await tx.run('UPDATE material_rolls SET current_weight_g=$1,status=$2 WHERE id=$3',[nw,nw<=0?'ESGOTADO':nw<=n(roll.min_stock_g)?'EM_USO':'DISPONIVEL',b.roll_id]);
        await tx.run("INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by) VALUES($1,'CONSUMO','TESTE',$2,$3,'test',$4)",[b.roll_id,consume,req.params.id,req.user.id]);
      }
      return true;
    });
    res.json({ ok: result });
  } catch (e) { next(e); }
});
router.delete('/tests/:id', adminOnly, async (req,res,next)=>{try{
  await withTransaction(async tx=>{
    const old=await tx.get('SELECT * FROM tests WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);
    if(!old)throw Object.assign(new Error('Teste não encontrado'),{status:404});
    const moves=await tx.all("SELECT * FROM stock_movements WHERE reference_type='test' AND reference_id=$1 AND type='CONSUMO'",[req.params.id]);
    for(const mv of moves){
      if(mv.roll_id)await tx.run("UPDATE material_rolls SET current_weight_g=current_weight_g+$1,status=CASE WHEN current_weight_g+$1<=0 THEN 'ESGOTADO' WHEN current_weight_g+$1<=min_stock_g THEN 'EM_USO' ELSE 'DISPONIVEL' END WHERE id=$2",[n(mv.quantity_g),mv.roll_id]);
      if(mv.roll_id)await tx.run("INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by,notes) VALUES($1,'DEVOLUCAO','EXCLUSAO_TESTE',$2,$3,'test',$4,'Estorno automático da exclusão do teste')",[mv.roll_id,n(mv.quantity_g),req.params.id,req.user.id]);
    }
    await tx.run('UPDATE tests SET deleted_at=NOW() WHERE id=$1',[req.params.id]);
  });
  res.json({ok:true});
}catch(e){next(e)}});

// Quotes

router.get('/quotes',async(req,res,next)=>{try{res.json(await dbAll(`SELECT q.*,c.name customer_name,pj.name project_name,p.name product_name,pr.name printer_name,r.code roll_code,m.type material_type,m.color material_color FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN projects pj ON pj.id=q.project_id LEFT JOIN products p ON p.id=q.product_id LEFT JOIN printers pr ON pr.id=q.printer_id LEFT JOIN material_rolls r ON r.id=q.roll_id LEFT JOIN materials m ON m.id=r.material_id WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC`))}catch(e){next(e)}});
router.get('/quotes/:id',async(req,res,next)=>{try{const q=await dbGet(`SELECT q.*,c.name customer_name,pj.name project_name,p.name product_name,pr.name printer_name,r.code roll_code,m.type material_type,m.color material_color FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN projects pj ON pj.id=q.project_id LEFT JOIN products p ON p.id=q.product_id LEFT JOIN printers pr ON pr.id=q.printer_id LEFT JOIN material_rolls r ON r.id=q.roll_id LEFT JOIN materials m ON m.id=r.material_id WHERE q.id=$1 AND q.deleted_at IS NULL`,[req.params.id]);if(!q)return res.status(404).json({error:'Orçamento não encontrado'});res.json(q)}catch(e){next(e)}});
async function buildQuoteCalculation(b) {
  const settingsRows = await dbAll('SELECT key,value FROM settings');
  const settings = Object.fromEntries(settingsRows.map(x => [x.key, x.value]));
  let costPerGram = 0;
  if (b.roll_id) {
    const roll = await dbGet('SELECT cost_per_gram FROM material_rolls WHERE id=$1 AND deleted_at IS NULL',[b.roll_id]);
    if (!roll) throw Object.assign(new Error('Rolo não encontrado'),{status:404});
    costPerGram = n(roll.cost_per_gram);
  }
  const printer = b.printer_id ? await dbGet('SELECT power_watts FROM printers WHERE id=$1 AND deleted_at IS NULL',[b.printer_id]) : null;
  if (b.customer_id) { const c=await dbGet('SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL',[b.customer_id]); if(!c) throw Object.assign(new Error('Cliente não encontrado'),{status:404}); }
  if (b.project_id) { const pj=await dbGet('SELECT id FROM projects WHERE id=$1 AND deleted_at IS NULL',[b.project_id]); if(!pj) throw Object.assign(new Error('Projeto não encontrado'),{status:404}); }
  if (b.product_id) { const pr=await dbGet('SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL',[b.product_id]); if(!pr) throw Object.assign(new Error('Produto não encontrado'),{status:404}); }
  if (b.printer_id && !printer) throw Object.assign(new Error('Impressora não encontrada'),{status:404});
  const projectLabor=(Math.max(0,n(b.project_time_min))/60)*n(settings.labor_cost_hour);
  const laborExtra=b.labor_extra!==undefined ? n(b.labor_extra) : Math.max(0,n(b.labor_cost)-projectLabor);
  const d=calculateQuoteCosts({
    quantity:b.quantity, weight_g:b.weight_g, print_time_min:b.print_time_min, project_time_min:b.project_time_min,
    labor_extra:laborExtra, other_costs:b.other_costs, cost_per_gram:costPerGram,
    power_watts:printer?.power_watts, energy_cost_kwh:settings.energy_cost_kwh,
    machine_cost_hour:settings.machine_cost_hour, maintenance_cost_hour:settings.maintenance_cost_hour,
    labor_cost_hour:settings.labor_cost_hour, price_mode:b.price_mode, markup_percent:b.markup_percent, price_total:b.price_total
  });
  return d;
}

router.post('/quotes',adminOnly,async(req,res,next)=>{try{const b=req.body;const d=await buildQuoteCalculation(b);const r=await dbGet(`INSERT INTO quotes(customer_id,project_id,product_id,printer_id,roll_id,product_description,quantity,project_time_min,weight_g,print_time_min,labor_cost,other_costs,cost_material,cost_energy,cost_machine,cost_maintenance,cost_total,markup_percent,profit,price_total,real_margin_percent,status,notes,price_mode,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW()) RETURNING id`,[b.customer_id||null,b.project_id||null,b.product_id||null,b.printer_id||null,b.roll_id||null,(b.product_description||'Orçamento personalizado').trim(),d.qty,d.projectTime,d.weight,d.printTime,d.labor,d.other,d.material,d.energy,d.machine,d.maintenance,d.total,d.markup,d.profit,d.price,d.realMargin,b.status||'ORCAMENTO',b.notes||null,d.priceMode]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/quotes/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;const exists=await dbGet('SELECT id FROM quotes WHERE id=$1 AND deleted_at IS NULL',[req.params.id]);if(!exists)return res.status(404).json({error:'Orçamento não encontrado'});const d=await buildQuoteCalculation(b);await dbRun(`UPDATE quotes SET customer_id=$1,project_id=$2,product_id=$3,printer_id=$4,roll_id=$5,product_description=$6,quantity=$7,project_time_min=$8,weight_g=$9,print_time_min=$10,labor_cost=$11,other_costs=$12,cost_material=$13,cost_energy=$14,cost_machine=$15,cost_maintenance=$16,cost_total=$17,markup_percent=$18,profit=$19,price_total=$20,real_margin_percent=$21,status=$22,notes=$23,price_mode=$24,updated_at=NOW() WHERE id=$25`,[b.customer_id||null,b.project_id||null,b.product_id||null,b.printer_id||null,b.roll_id||null,(b.product_description||'Orçamento personalizado').trim(),d.qty,d.projectTime,d.weight,d.printTime,d.labor,d.other,d.material,d.energy,d.machine,d.maintenance,d.total,d.markup,d.profit,d.price,d.realMargin,b.status||'ORCAMENTO',b.notes||null,d.priceMode,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/quotes/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE quotes SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

// Products/orders/production
async function getProductSettings(){const rows=await dbAll('SELECT key,value FROM settings');return Object.fromEntries(rows.map(x=>[x.key,x.value]));}
async function normalizeProductComponents(components){
 const merged=new Map();
 for(const raw of(Array.isArray(components)?components:[])){
  const quantity=n(raw.quantity); if(quantity<=0) continue;
  const kind=raw.kind==='consumable'?'consumable':'part';
  const itemId=Number(raw.item_id);
  if(!Number.isInteger(itemId)||itemId<=0) continue;
  const key=`${kind}:${itemId}`;
  const current=merged.get(key);
  if(current){ current.quantity+=quantity; continue; }
  if(kind==='part'){
    const item=await dbGet('SELECT id,name,unit_cost FROM small_parts WHERE id=$1 AND deleted_at IS NULL',[itemId]);
    if(!item)throw Object.assign(new Error('Peça não encontrada'),{status:404});
    merged.set(key,{kind,item_id:Number(item.id),quantity,unit_cost:n(item.unit_cost)});
  } else {
    const item=await dbGet('SELECT id,name,unit,unit_cost FROM tool_consumables WHERE id=$1 AND deleted_at IS NULL',[itemId]);
    if(!item)throw Object.assign(new Error('Consumível não encontrado'),{status:404});
    merged.set(key,{kind,item_id:Number(item.id),quantity,unit_cost:n(item.unit_cost)});
  }
 }
 return [...merged.values()].map(x=>({...x,total_cost:x.quantity*x.unit_cost}));
}
async function calculateProductData(b,components){
 const settings=await getProductSettings();
 const roll=b.material_roll_id?await dbGet('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL',[b.material_roll_id]):null;
 if(b.material_roll_id&&!roll)throw Object.assign(new Error('Rolo de filamento não encontrado'),{status:404});
 const printer=b.printer_id?await dbGet('SELECT * FROM printers WHERE id=$1 AND deleted_at IS NULL',[b.printer_id]):null;
 if(b.printer_id&&!printer)throw Object.assign(new Error('Impressora não encontrada'),{status:404});
 const weight=n(b.weight_g),minutes=n(b.print_time_min),development=n(b.development_time_min!==undefined?b.development_time_min:settings.default_development_time_min);
 const hours=minutes/60;
 const material=roll?weight*n(roll.cost_per_gram):n(b.cost_material);
 const energy=printer?(n(printer.power_watts)/1000)*hours*n(settings.energy_cost_kwh):n(b.cost_energy);
 const machine=hours*n(settings.machine_cost_hour);
 const maintenanceAuto=hours*n(settings.maintenance_cost_hour);
 const labor=development/60*n(settings.labor_cost_hour);
 const packaging=n(b.cost_packaging!==undefined?b.cost_packaging:settings.default_packaging_cost);
 const finishing=n(b.cost_finishing!==undefined?b.cost_finishing:settings.default_finishing_cost);
 const parts=components.reduce((a,x)=>a+x.total_cost,0);
 const total=material+energy+machine+maintenanceAuto+labor+packaging+finishing+parts;
 const manual=bool(b.costs_manual);
 const costMaterial=manual?n(b.cost_material):material; const costEnergy=manual?n(b.cost_energy):energy; const costMachine=manual?n(b.cost_machine):machine;
 const costLabor=manual?n(b.cost_labor):labor; const costMaintenance=manual?n(b.cost_maintenance):maintenanceAuto; const costPackaging=packaging; const costFinishing=finishing;
 const finalParts=parts; const finalTotal=costMaterial+costEnergy+costMachine+costMaintenance+costLabor+costPackaging+costFinishing+finalParts;
 const price=n(b.price); const margin=price>0?(price-finalTotal)/price*100:0; const markup=finalTotal>0?(price-finalTotal)/finalTotal*100:0;
 return {roll,printer,material_type:roll?roll.type:(b.material_type||null),material:costMaterial,energy:costEnergy,machine:costMachine,maintenance:costMaintenance,labor:costLabor,packaging:costPackaging,finishing:costFinishing,parts:finalParts,total:finalTotal,price,margin,markup,development_time_min:development};
}
async function replaceProductComponents(tx,productId,components){await tx.run('DELETE FROM product_components WHERE product_id=$1',[productId]);for(const c of components){await tx.run('INSERT INTO product_components(product_id,part_id,consumable_id,quantity,unit_cost,total_cost) VALUES($1,$2,$3,$4,$5,$6)',[productId,c.kind==='part'?c.item_id:null,c.kind==='consumable'?c.item_id:null,c.quantity,c.unit_cost,c.total_cost]);}}
async function saveProduct(b,id){return withTransaction(async tx=>{
 const productId=id?Number(id):null;
 const code=String(b.code??'').trim()||null;
 const name=String(b.name??'').trim();
 if(!name)throw Object.assign(new Error('Nome é obrigatório'),{status:400});
 if(productId&&(!Number.isInteger(productId)||productId<=0))throw Object.assign(new Error('Produto inválido'),{status:400});
 if(code){const duplicate=await tx.get('SELECT id FROM products WHERE code=$1 AND deleted_at IS NULL AND ($2::bigint IS NULL OR id<>$2) LIMIT 1',[code,productId]);if(duplicate)throw Object.assign(new Error(`Código de produto já utilizado pelo produto #${duplicate.id}`),{status:409});}
 const old=productId?await tx.get('SELECT id,project_id FROM products WHERE id=$1 AND deleted_at IS NULL',[productId]):null;
 if(productId&&!old)throw Object.assign(new Error('Produto não encontrado'),{status:404});
 const normalized=await normalizeProductComponents(b.components);
 const d=await calculateProductData(b,normalized);
 if(!productId){
   const r=await tx.get('INSERT INTO products(code,name,project_id,version_id,material_type,weight_g,print_time_min,cost_material,cost_energy,cost_machine,cost_labor,cost_packaging,cost_finishing,cost_parts,cost_project_parts,cost_maintenance,cost_total,price,markup,margin,printer_id,material_roll_id,development_time_min,costs_manual,notes,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,TRUE) RETURNING id',[code,name,b.project_id||null,b.version_id||null,d.material_type,d.weight||n(b.weight_g),n(b.print_time_min),d.material,d.energy,d.machine,d.labor,d.packaging,d.finishing,d.parts,0,d.maintenance,d.total,d.price,d.markup,d.margin,b.printer_id||null,b.material_roll_id||null,d.development_time_min,bool(b.costs_manual),b.notes||null]);
   await replaceProductComponents(tx,r.id,normalized);
   if(b.project_id)await refreshProjectProductCosts(tx,b.project_id);
   return Number(r.id);
 }
 await tx.run('UPDATE products SET code=$1,name=$2,project_id=$3,version_id=$4,material_type=$5,weight_g=$6,print_time_min=$7,cost_material=$8,cost_energy=$9,cost_machine=$10,cost_labor=$11,cost_packaging=$12,cost_finishing=$13,cost_parts=$14,cost_project_parts=$15,cost_maintenance=$16,cost_total=$17,price=$18,markup=$19,margin=$20,printer_id=$21,material_roll_id=$22,development_time_min=$23,costs_manual=$24,notes=$25,active=$26 WHERE id=$27',[code,name,b.project_id||null,b.version_id||null,d.material_type,d.weight||n(b.weight_g),n(b.print_time_min),d.material,d.energy,d.machine,d.labor,d.packaging,d.finishing,d.parts,0,d.maintenance,d.total,d.price,d.markup,d.margin,b.printer_id||null,b.material_roll_id||null,d.development_time_min,bool(b.costs_manual),b.notes||null,b.active!==false,productId]);
 await replaceProductComponents(tx,productId,normalized);
 if(old.project_id&&Number(old.project_id)!==Number(b.project_id||0))await refreshProjectProductCosts(tx,old.project_id);
 if(b.project_id)await refreshProjectProductCosts(tx,b.project_id);
 return productId;
 });}
router.get('/products',async(req,res,next)=>{try{res.json(await dbAll(`SELECT pr.*,p.name project_name,prn.name printer_name,r.code roll_code,r.current_weight_g roll_current_weight,r.cost_per_gram roll_cost_per_gram,COALESCE((SELECT SUM(pc.total_cost) FROM product_components pc WHERE pc.product_id=pr.id),0) component_cost FROM products pr LEFT JOIN projects p ON p.id=pr.project_id LEFT JOIN printers prn ON prn.id=pr.printer_id LEFT JOIN material_rolls r ON r.id=pr.material_roll_id WHERE pr.deleted_at IS NULL ORDER BY pr.name`))}catch(e){next(e)}});
router.get('/products/:id/components',async(req,res,next)=>{try{res.json(await dbAll(`SELECT pc.*,sp.name part_name,sp.type part_type,sp.size part_size,sp.unit_cost part_unit_cost,tc.name consumable_name,tc.unit consumable_unit,tc.unit_cost consumable_unit_cost,CASE WHEN pc.part_id IS NOT NULL THEN 'part' ELSE 'consumable' END kind FROM product_components pc LEFT JOIN small_parts sp ON sp.id=pc.part_id LEFT JOIN tool_consumables tc ON tc.id=pc.consumable_id WHERE pc.product_id=$1 ORDER BY pc.id`,[req.params.id]))}catch(e){next(e)}});
router.post('/products',adminOnly,async(req,res,next)=>{try{const b=req.body||{};if(!b.name)return res.status(400).json({error:'Nome obrigatório'});res.json({id:await saveProduct(b,null)})}catch(e){next(e)}});
router.put('/products/:id',adminOnly,async(req,res,next)=>{try{res.json({ok:true,id:await saveProduct(req.body||{},Number(req.params.id))})}catch(e){next(e)}});
router.delete('/products/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE products SET deleted_at=NOW(),active=false WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

router.get('/orders',async(req,res,next)=>{try{const params=[];let where='o.deleted_at IS NULL';if(req.user.role==='CLIENTE'){if(!req.user.customerId)return res.json([]);params.push(req.user.customerId);where+=` AND o.customer_id=$${params.length}`;}res.json(await dbAll(`SELECT o.*,c.name customer_name,p.name product_name,r.code roll_code,m.type roll_material_type,m.brand roll_brand,m.color roll_color,(SELECT s.status FROM shipments s WHERE s.order_id=o.id AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 1) shipment_status,(SELECT s.id FROM shipments s WHERE s.order_id=o.id AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 1) shipment_id FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN products p ON p.id=o.product_id LEFT JOIN material_rolls r ON r.id=o.roll_id LEFT JOIN materials m ON m.id=r.material_id WHERE ${where} ORDER BY o.created_at DESC`,params))}catch(e){next(e)}});
router.post('/orders',adminOnly,async(req,res,next)=>{try{const b=req.body||{};if(!b.customer_id||!b.product_id)return res.status(400).json({error:'Cliente e produto obrigatórios'});const qty=Math.max(1,parseInt(b.quantity)||1),up=Math.max(0,n(b.unit_price)),disc=Math.max(0,n(b.discount));let freight=null;if(b.freight!==''&&b.freight!=null){freight=Number(b.freight);if(!Number.isFinite(freight)||freight<0)return res.status(400).json({error:'Frete inválido'});}const total=calculateOrderTotal(qty,up,disc,freight||0);let material=b.material||null;let rollId=b.roll_id||null;if(rollId){const roll=await dbGet('SELECT m.type,m.brand,m.color FROM material_rolls r JOIN materials m ON m.id=r.material_id WHERE r.id=$1 AND r.deleted_at IS NULL',[rollId]);if(!roll)return res.status(404).json({error:'Rolo de filamento não encontrado'});material=[roll.type,roll.brand,roll.color].filter(Boolean).join(' ')||material;}const r=await dbGet('INSERT INTO orders(customer_id,product_id,quantity,material,roll_id,unit_price,discount,freight,total,payment_method,due_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[b.customer_id,b.product_id,qty,material,rollId||null,up,disc,freight,total,b.payment_method||null,b.due_date||null,b.notes||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/orders/:id', adminOnly, async (req, res, next) => {
  try {
    const b=req.body||{}, qty=Math.max(1,parseInt(b.quantity)||1), up=Math.max(0,n(b.unit_price)), disc=Math.max(0,n(b.discount));
    let freight=null;if(b.freight!==''&&b.freight!=null){freight=Number(b.freight);if(!Number.isFinite(freight)||freight<0)return res.status(400).json({error:'Frete inválido'});} const total=calculateOrderTotal(qty,up,disc,freight||0);
    let material=b.material||null, rollId=b.roll_id||null;
    if(rollId){const roll=await dbGet('SELECT m.type,m.brand,m.color FROM material_rolls r JOIN materials m ON m.id=r.material_id WHERE r.id=$1 AND r.deleted_at IS NULL',[rollId]);if(!roll)throw Object.assign(new Error('Rolo de filamento não encontrado'),{status:404});material=[roll.type,roll.brand,roll.color].filter(Boolean).join(' ')||material;}
    const result=await withTransaction(async tx=>{
      const old=await tx.get('SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);
      if(!old)throw Object.assign(new Error('Pedido não encontrado'),{status:404});
      const nextStatus=b.status||old.status||'ORCAMENTO';
      if(old.status==='CANCELADO' && nextStatus!=='CANCELADO') throw Object.assign(new Error('Pedido cancelado não pode ser reativado automaticamente.'),{status:400});
      const nextCustomer=b.customer_id||old.customer_id, nextProduct=b.product_id||old.product_id;
      await tx.run('UPDATE orders SET customer_id=$1,product_id=$2,quantity=$3,material=$4,roll_id=$5,unit_price=$6,discount=$7,freight=$8,total=$9,payment_method=$10,due_date=$11,notes=$12,status=$13 WHERE id=$14',[nextCustomer,nextProduct,qty,material,rollId||null,up,disc,freight,total,b.payment_method||null,b.due_date||null,b.notes||null,nextStatus,req.params.id]);
      const receipt=await tx.get("SELECT id,amount,paid FROM transactions WHERE reference_type='order' AND reference_id=$1 AND type='RECEITA' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1",[req.params.id]);
      const refund=await tx.get("SELECT id FROM transactions WHERE reference_type='order_refund' AND reference_id=$1 AND type='RECEITA' AND deleted_at IS NULL LIMIT 1",[req.params.id]);
      const wasPaid=Boolean(receipt?.paid)||old.status==='CONFIRMADO';
      if(nextStatus==='CONFIRMADO' && !refund){
        if(!receipt) await tx.run(`INSERT INTO transactions(type,category,description,amount,date,reference_id,reference_type,paid,paid_at) VALUES('RECEITA','Venda',$1,$2,$3,$4,'order',true,NOW())`,[`Pedido #${req.params.id}`,total,today(),req.params.id]);
        else await tx.run(`UPDATE transactions SET amount=$1,paid=true,paid_at=COALESCE(paid_at,NOW()) WHERE id=$2`,[total,receipt.id]);
      } else if(nextStatus==='CANCELADO' && wasPaid && !refund){
        await tx.run(`INSERT INTO transactions(type,category,description,amount,date,reference_id,reference_type,paid,paid_at,notes) VALUES('RECEITA','Estorno',$1,$2,$3,$4,'order_refund',true,NOW(),$5)`,[`Estorno do pedido #${req.params.id}`,-Math.abs(n(receipt?.amount||old.total)),today(),req.params.id,'Cancelamento do pedido']);
      } else if(wasPaid && nextStatus!=='CANCELADO' && receipt && !refund){
        await tx.run('UPDATE transactions SET amount=$1 WHERE id=$2 AND paid=true',[total,receipt.id]);
      }
      if(nextStatus==='CONFIRMADO'&&old.status!=='CONFIRMADO'){
        const prodExists=await tx.get("SELECT id FROM production_jobs WHERE order_id=$1 AND status<>'CANCELADO' LIMIT 1",[req.params.id]);
        if(!prodExists){const prod=await tx.get('SELECT * FROM products WHERE id=$1 AND deleted_at IS NULL',[nextProduct]);if(!prod)throw Object.assign(new Error('Produto não encontrado'),{status:404});await tx.run('INSERT INTO production_jobs(order_id,project_id,version_id,product_id,roll_id,status,est_weight_g,est_time_min) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[req.params.id,prod.project_id||null,prod.version_id||null,nextProduct,rollId||prod.material_roll_id||null,'AGUARDANDO',n(prod.weight_g)*qty,n(prod.print_time_min)*qty]);}
      }
      return {ok:true};
    });
    res.json(result);
  } catch(e){next(e);}
});
router.delete('/orders/:id',adminOnly,async(req,res,next)=>{try{const result=await withTransaction(async tx=>{const old=await tx.get('SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);if(!old)throw Object.assign(new Error('Pedido não encontrado'),{status:404});await tx.run("UPDATE orders SET deleted_at=NOW(),status='CANCELADO' WHERE id=$1",[req.params.id]);const receipt=await tx.get("SELECT amount,paid FROM transactions WHERE reference_type='order' AND reference_id=$1 AND type='RECEITA' AND deleted_at IS NULL LIMIT 1",[req.params.id]);const refund=await tx.get("SELECT id FROM transactions WHERE reference_type='order_refund' AND reference_id=$1 AND type='RECEITA' AND deleted_at IS NULL LIMIT 1",[req.params.id]);if(receipt?.paid&&!refund)await tx.run(`INSERT INTO transactions(type,category,description,amount,date,reference_id,reference_type,paid,paid_at,notes) VALUES('RECEITA','Estorno',$1,$2,$3,$4,'order_refund',true,NOW(),$5)`,[`Estorno do pedido #${req.params.id}`,-Math.abs(n(receipt.amount)),today(),req.params.id,'Cancelamento do pedido']);return{ok:true};});res.json(result)}catch(e){next(e)}});

// Shipments
const SHIPMENT_STATUSES=['PENDENTE','PREPARANDO','ENVIADO','EM_TRANSITO','ENTREGUE','CANCELADO'];
const SHIPPING_METHODS=['CORREIOS','JADLOG','MELHOR_ENVIO','TRANSPORTADORA','RETIRADA','MOTOBOY','OUTRO'];
router.get('/shipments',async(req,res,next)=>{try{const params=[];let where='s.deleted_at IS NULL';if(req.query.status&&SHIPMENT_STATUSES.includes(String(req.query.status))){params.push(req.query.status);where+=` AND s.status=$${params.length}`;}res.json(await dbAll(`SELECT s.*,c.name customer_name,o.total order_total,o.freight order_freight,p.name product_name FROM shipments s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN products p ON p.id=o.product_id WHERE ${where} ORDER BY s.created_at DESC`,params))}catch(e){next(e)}});
router.get('/shipments/:id',async(req,res,next)=>{try{const row=await dbGet(`SELECT s.*,c.name customer_name,c.phone customer_phone,c.email customer_email,o.total order_total,o.freight order_freight,o.customer_id,p.name product_name,p.price product_price FROM shipments s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN products p ON p.id=o.product_id WHERE s.id=$1 AND s.deleted_at IS NULL`,[req.params.id]);if(!row)return res.status(404).json({error:'Envio não encontrado'});res.json(row)}catch(e){next(e)}});
router.get('/shipments/orders-available',adminOnly,async(req,res,next)=>{try{const params=[];let sql=`SELECT o.id,o.customer_id,c.name customer_name,p.name product_name,o.total,o.freight,o.due_date,o.status,c.city FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN products p ON p.id=o.product_id LEFT JOIN shipments s ON s.order_id=o.id AND s.deleted_at IS NULL AND s.status<>'CANCELADO' WHERE o.deleted_at IS NULL AND o.status<>'CANCELADO' AND s.id IS NULL`;if(req.query.customer_id){params.push(req.query.customer_id);sql+=` AND o.customer_id=$${params.length}`;}sql+=' ORDER BY o.created_at DESC';res.json(await dbAll(sql,params))}catch(e){next(e)}});
router.post('/shipments',adminOnly,async(req,res,next)=>{try{const b=req.body||{};const orderId=Number(b.order_id),customerId=Number(b.customer_id);if(!Number.isInteger(orderId)||orderId<=0)return res.status(400).json({error:'Pedido inválido'});const result=await withTransaction(async tx=>{const order=await tx.get(`SELECT o.*,c.name customer_name,c.city FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 AND o.deleted_at IS NULL FOR UPDATE`,[orderId]);if(!order)throw Object.assign(new Error('Pedido não encontrado'),{status:404});if(customerId&&Number(order.customer_id)!==customerId)throw Object.assign(new Error('Pedido não pertence ao cliente selecionado'),{status:400});const exists=await tx.get("SELECT id FROM shipments WHERE order_id=$1 AND deleted_at IS NULL AND status<>'CANCELADO' LIMIT 1",[orderId]);if(exists)throw Object.assign(new Error('Este pedido já possui um envio ativo'),{status:409});const method=SHIPPING_METHODS.includes(String(b.shipping_method))?String(b.shipping_method):'OUTRO';const freight=b.freight===''||b.freight==null?order.freight:n(b.freight);if(n(freight)<0)throw Object.assign(new Error('Frete inválido'),{status:400});if(b.estimated_delivery&&!/^\d{4}-\d{2}-\d{2}$/.test(String(b.estimated_delivery)))throw Object.assign(new Error('Data prevista inválida'),{status:400});const status=SHIPMENT_STATUSES.includes(String(b.status))?String(b.status):'PENDENTE';const r=await tx.get(`INSERT INTO shipments(order_id,customer_id,street,number,complement,neighborhood,city,state,postal_code,shipping_method,freight,estimated_delivery,status,tracking_code,tracking_url,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[orderId,order.customer_id,b.street||null,b.number||null,b.complement||null,b.neighborhood||null,b.city||order.city||null,b.state||null,b.postal_code||null,method,freight,b.estimated_delivery||null,status,b.tracking_code||null,b.tracking_url||null,b.notes||null]);return r;});res.json({id:Number(result.id)})}catch(e){next(e)}});
router.put('/shipments/:id',adminOnly,async(req,res,next)=>{try{const b=req.body||{};const result=await withTransaction(async tx=>{const old=await tx.get('SELECT * FROM shipments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id]);if(!old)throw Object.assign(new Error('Envio não encontrado'),{status:404});const order=await tx.get('SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL',[old.order_id]);if(!order)throw Object.assign(new Error('Pedido relacionado não encontrado'),{status:404});const status=SHIPMENT_STATUSES.includes(String(b.status))?String(b.status):old.status;const method=SHIPPING_METHODS.includes(String(b.shipping_method))?String(b.shipping_method):old.shipping_method;const freight=b.freight===''||b.freight==null?(old.freight??order.freight):Number(b.freight);if(!Number.isFinite(freight)||freight<0)throw Object.assign(new Error('Frete inválido'),{status:400});const deliveredAt=status==='ENTREGUE'?(b.delivered_at||old.delivered_at||today()):null;if(b.estimated_delivery&&!/^\d{4}-\d{2}-\d{2}$/.test(String(b.estimated_delivery)))throw Object.assign(new Error('Data prevista inválida'),{status:400});if(deliveredAt&&!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveredAt)))throw Object.assign(new Error('Data de entrega inválida'),{status:400});await tx.run(`UPDATE shipments SET street=$1,number=$2,complement=$3,neighborhood=$4,city=$5,state=$6,postal_code=$7,shipping_method=$8,freight=$9,estimated_delivery=$10,delivered_at=$11,status=$12,tracking_code=$13,tracking_url=$14,notes=$15,updated_at=NOW() WHERE id=$16`,[b.street??old.street,b.number??old.number,b.complement??old.complement,b.neighborhood??old.neighborhood,b.city??old.city,b.state??old.state,b.postal_code??old.postal_code,method,freight,b.estimated_delivery??old.estimated_delivery,deliveredAt,status,b.tracking_code??old.tracking_code,b.tracking_url??old.tracking_url,b.notes??old.notes,req.params.id]);return{ok:true};});res.json(result)}catch(e){next(e)}});
router.delete('/shipments/:id',adminOnly,async(req,res,next)=>{try{const r=await dbGet("UPDATE shipments SET status='CANCELADO',deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id",[req.params.id]);if(!r)return res.status(404).json({error:'Envio não encontrado'});res.json({ok:true})}catch(e){next(e)}});

router.get('/production',async(req,res,next)=>{try{const params=[];let where='1=1';if(req.user.role==='CLIENTE'){if(!req.user.customerId)return res.json([]);params.push(req.user.customerId);where+=` AND o.customer_id=$${params.length}`;}res.json(await dbAll(`SELECT pj.*,o.customer_id,c.name customer_name,pr.name product_name,prn.name printer_name FROM production_jobs pj LEFT JOIN orders o ON o.id=pj.order_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN products pr ON pr.id=pj.product_id LEFT JOIN printers prn ON prn.id=pj.printer_id WHERE ${where} ORDER BY pj.created_at DESC`,params))}catch(e){next(e)}});
router.put('/production/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const result = await withTransaction(async tx => {
      const old = await tx.get('SELECT * FROM production_jobs WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!old) throw Object.assign(new Error('Produção não encontrada'), { status: 404 });
      const nextPrinter = b.printer_id || null;
      const nextRoll = b.roll_id || null;
      const consume = Math.max(0, n(b.real_weight_g) + n(b.waste_g));
      const isCounted = Boolean(b.result && b.result !== 'CANCELADO');

      const oldMoves = await tx.all("SELECT * FROM stock_movements WHERE reference_type='production' AND reference_id=$1 AND type='CONSUMO' ORDER BY id DESC", [req.params.id]);
      for (const mv of oldMoves) {
        await tx.run("UPDATE material_rolls SET current_weight_g=current_weight_g+$1,status=CASE WHEN current_weight_g+$1<=0 THEN 'ESGOTADO' WHEN current_weight_g+$1<=min_stock_g THEN 'EM_USO' ELSE 'DISPONIVEL' END WHERE id=$2", [n(mv.quantity_g), mv.roll_id]);
        await tx.run("INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by) VALUES($1,'DEVOLUCAO','CORRECAO_PRODUCAO',$2,$3,'production',$4)", [mv.roll_id, n(mv.quantity_g), req.params.id, req.user.id]);
      }

      await tx.run('UPDATE production_jobs SET printer_id=$1,roll_id=$2,est_weight_g=$3,real_weight_g=$4,est_time_min=$5,real_time_min=$6,waste_g=$7,started_at=$8,finished_at=$9,result=$10,failure_type=$11,failure_cause=$12,status=$13,notes=$14 WHERE id=$15', [
        nextPrinter, nextRoll, n(b.est_weight_g), n(b.real_weight_g), n(b.est_time_min), n(b.real_time_min), n(b.waste_g),
        b.started_at || null, b.finished_at || null, b.result || null, b.failure_type || null, b.failure_cause || null,
        b.status || old.status, b.notes || null, (b.test_date || today()), req.params.id
      ]);

      if (old.order_id) {
        const os = { AGUARDANDO:'CONFIRMADO', PREPARANDO:'EM_PRODUCAO', IMPRIMINDO:'EM_PRODUCAO', ACABAMENTO:'ACABAMENTO', PRONTO:'PRONTO', ENTREGUE:'ENTREGUE', CANCELADO:'CANCELADO' }[b.status || old.status];
        if (os) await tx.run('UPDATE orders SET status=$1 WHERE id=$2', [os, old.order_id]);
      }

      if (nextRoll && consume > 0 && isCounted) {
        const roll = await tx.get('SELECT * FROM material_rolls WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [nextRoll]);
        if (!roll) throw Object.assign(new Error('Rolo não encontrado'), { status: 404 });
        if (n(roll.current_weight_g) < consume) throw Object.assign(new Error('Estoque de filamento insuficiente'), { status: 400 });
        const nw = n(roll.current_weight_g) - consume;
        await tx.run('UPDATE material_rolls SET current_weight_g=$1,status=$2 WHERE id=$3', [nw, nw <= 0 ? 'ESGOTADO' : nw <= n(roll.min_stock_g) ? 'EM_USO' : 'DISPONIVEL', nextRoll]);
        await tx.run("INSERT INTO stock_movements(roll_id,type,reason,quantity_g,reference_id,reference_type,created_by) VALUES($1,'CONSUMO','PRODUCAO',$2,$3,'production',$4)", [nextRoll, consume, req.params.id, req.user.id]);
      }
      if (isCounted && ['PRONTO','ENTREGUE'].includes(b.status || old.status) && old.product_id) { const order = old.order_id ? await tx.get('SELECT quantity FROM orders WHERE id=$1',[old.order_id]) : null; await consumeProductComponents(tx, req.params.id, old.product_id, Number(order?.quantity)||1, req.user.id); }

      const affected = new Set([old.printer_id, nextPrinter].filter(Boolean).map(Number));
      for (const pid of affected) {
        const agg = await tx.get(`SELECT COALESCE(SUM(CASE WHEN status<>'CANCELADO' THEN COALESCE(real_time_min,0) ELSE 0 END),0)/60 hours,COALESCE(COUNT(*) FILTER (WHERE status<>'CANCELADO'),0)::int prints,COALESCE(COUNT(*) FILTER (WHERE result='FALHA'),0)::int failures,COALESCE(SUM(CASE WHEN status<>'CANCELADO' THEN COALESCE(real_weight_g,0)+COALESCE(waste_g,0) ELSE 0 END),0) filament FROM production_jobs WHERE printer_id=$1`, [pid]);
        await tx.run('UPDATE printers SET total_hours=$1,total_prints=$2,filament_used_g=$3,total_failures=$4 WHERE id=$5', [n(agg.hours), Number(agg.prints), n(agg.filament), Number(agg.failures), pid]);
      }
      return true;
    });
    res.json({ ok: result });
  } catch (e) { next(e); }
});

// Finance/settings

router.get('/finance',async(req,res,next)=>{try{let sql='SELECT *, CASE WHEN paid=false AND due_date<CURRENT_DATE THEN true ELSE false END AS overdue FROM transactions WHERE deleted_at IS NULL',p=[];if(req.query.start){p.push(req.query.start);sql+=` AND date >= $${p.length}`}if(req.query.end){p.push(req.query.end);sql+=` AND date <= $${p.length}`}if(req.query.type&&['RECEITA','DESPESA','INVESTIMENTO'].includes(req.query.type)){p.push(req.query.type);sql+=` AND type = $${p.length}`}if(req.query.paid==='true'||req.query.paid==='false'){p.push(req.query.paid==='true');sql+=` AND paid = $${p.length}`}sql+=' ORDER BY date DESC,id DESC';res.json(await dbAll(sql,p))}catch(e){next(e)}});
router.post('/finance',adminOnly,async(req,res,next)=>{try{const b=req.body;if(!b.type||!b.description||!n(b.amount))return res.status(400).json({error:'Tipo, descrição e valor obrigatórios'});const r=await dbGet('INSERT INTO transactions(type,category,description,amount,date,notes,due_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[b.type,b.category||null,b.description,n(b.amount),b.date||today(),b.notes||null,b.due_date||null]);res.json({id:Number(r.id)})}catch(e){next(e)}});
router.put('/finance/:id',adminOnly,async(req,res,next)=>{try{const b=req.body;await dbRun("UPDATE transactions SET type=$1,category=$2,description=$3,amount=$4,date=$5,notes=$6,due_date=$7,paid=$8,paid_at=CASE WHEN $8::boolean THEN COALESCE(paid_at,NOW()) ELSE NULL END WHERE id=$9",[b.type,b.category||null,b.description,n(b.amount),b.date,b.notes||null,b.due_date||null,bool(b.paid),req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.delete('/finance/:id',adminOnly,async(req,res,next)=>{try{await dbRun('UPDATE transactions SET deleted_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){next(e)}});
router.get('/settings',async(req,res,next)=>{try{const o={};(await dbAll('SELECT * FROM settings')).forEach(r=>o[r.key]=r.value);res.json(o)}catch(e){next(e)}});
router.post('/settings',adminOnly,async(req,res,next)=>{try{for(const[k,v]of Object.entries(req.body))await dbRun('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[k,String(v)]);res.json({ok:true})}catch(e){next(e)}});

// Image upload
router.post('/uploads/:entity/:id',upload.single('image'),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({error:'Imagem não enviada'});if(!/^image\/(png|jpe?g|webp|gif)$/.test(req.file.mimetype||''))return res.status(400).json({error:'Tipo de imagem não permitido'});if(!cloudReady())return res.status(503).json({error:'Cloudinary não configurado'});const entity=req.params.entity,id=req.params.id,folder=`gestao3d/${entity}`;const r=await uploadBuffer(req.file.buffer,folder);const tables={printers:'printers',parts:'small_parts',consumables:'tool_consumables'};const table=tables[entity];if(!table)return res.status(400).json({error:'Tipo de imagem inválido'});const old=await dbGet(`SELECT cloudinary_public_id FROM ${table} WHERE id=$1`,[id]);await dbRun(`UPDATE ${table} SET photo_url=$1,cloudinary_public_id=$2 WHERE id=$3`,[r.secure_url,r.public_id,id]);if(old?.cloudinary_public_id){try{await cloudinary.uploader.destroy(old.cloudinary_public_id)}catch{}}res.json({url:r.secure_url,public_id:r.public_id})}catch(e){next(e)}});

// Backup administrativo (exportação lógica em JSON e restauração transacional)
const BACKUP_TABLES=['users','settings','customers','printers','maintenance_plans','printer_maintenance','materials','material_rolls','stock_movements','tool_consumables','small_parts','consumable_movements','part_movements','projects','project_versions','project_parts','tests','products','product_components','orders','shipments','production_jobs','production_component_usages','transactions','quotes','audit_logs'];
router.get('/backup/export',adminOnly,async(req,res,next)=>{try{const data={version:2,generated_at:new Date().toISOString(),tables:{}};for(const table of BACKUP_TABLES){data.tables[table]=await dbAll(`SELECT * FROM ${table}`);}delete data.tables.settings?.dummy;const payload=Buffer.from(JSON.stringify(data));res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition',`attachment; filename=gestao3d-backup-${today()}.json`);res.send(payload)}catch(e){next(e)}});
router.post('/backup/restore',adminOnly,backupUpload.single('backup'),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({error:'Arquivo de backup não enviado'});const data=JSON.parse(req.file.buffer.toString('utf8'));if(!data?.tables||typeof data.tables!=='object')return res.status(400).json({error:'Backup inválido'});const required=BACKUP_TABLES.filter(t=>!['audit_logs','shipments'].includes(t));const missing=required.filter(t=>!Array.isArray(data.tables[t]));if(missing.length)return res.status(400).json({error:`Backup incompleto: ${missing.join(', ')}`});const client=await getPool().connect();try{await client.query('BEGIN');for(const table of [...BACKUP_TABLES,'sessions'].reverse())await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);for(const table of BACKUP_TABLES){const rows=Array.isArray(data.tables[table])?data.tables[table]:[];for(const row of rows){if(!row||typeof row!=='object')continue;const keys=Object.keys(row);if(!keys.length)continue;const cols=keys.map(k=>`"${k.replaceAll('"','""')}"`).join(',');const vals=keys.map((_,i)=>`$${i+1}`).join(',');await client.query(`INSERT INTO "${table}" (${cols}) VALUES (${vals})`,keys.map(k=>row[k]));}}for(const table of BACKUP_TABLES){const hasId=await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id' LIMIT 1",[table]);if(hasId.rowCount){await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),COALESCE(MAX(id),0)+1,false) FROM "${table}"`);}}await client.query('COMMIT');res.json({ok:true,message:'Backup restaurado com sucesso. Sessões foram encerradas.'})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});

// Global search, notifications and auditing
router.get('/search',async(req,res,next)=>{try{const q=String(req.query.q||'').trim().slice(0,80);if(q.length<2)return res.json([]);const like=`%${q.replace(/[%_]/g,m=>'\\'+m)}%`;const rows=[
  ...(await dbAll("SELECT 'Projeto' kind,id,name title,description subtitle,created_at FROM projects WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(description,'') ILIKE $1) ORDER BY created_at DESC LIMIT 8",[like])).map(x=>({...x,route:'projetos'})),
  ...(await dbAll("SELECT 'Cliente' kind,id,name title,city subtitle,created_at FROM customers WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(email,'') ILIKE $1 OR COALESCE(phone,'') ILIKE $1) ORDER BY created_at DESC LIMIT 8",[like])).map(x=>({...x,route:'clientes'})),
  ...(await dbAll("SELECT 'Produto' kind,id,name title,code subtitle,created_at FROM products WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(code,'') ILIKE $1) ORDER BY created_at DESC LIMIT 8",[like])).map(x=>({...x,route:'produtos'})),
  ...(await dbAll("SELECT 'Impressora' kind,id,name title,model subtitle,created_at FROM printers WHERE deleted_at IS NULL AND (name ILIKE $1 OR COALESCE(model,'') ILIKE $1 OR COALESCE(serial,'') ILIKE $1) ORDER BY created_at DESC LIMIT 8",[like])).map(x=>({...x,route:'impressoras'})),
];res.json(rows.slice(0,20));}catch(e){next(e)}});
router.get('/notifications',async(req,res,next)=>{try{const [stock,orders,payments,maintenance,failed]=await Promise.all([
 dbAll("SELECT 'ESTOQUE' type, (m.type || COALESCE(' — '||m.brand,'') || COALESCE(' — '||m.color,'')) title, r.current_weight_g detail FROM material_rolls r JOIN materials m ON m.id=r.material_id WHERE r.deleted_at IS NULL AND r.current_weight_g<=r.min_stock_g ORDER BY r.current_weight_g ASC LIMIT 10"),
 dbAll("SELECT 'PEDIDO_ATRASADO' type,'Pedido #'||id title,COALESCE(due_date::text,'') detail FROM orders WHERE deleted_at IS NULL AND due_date<CURRENT_DATE AND status NOT IN ('ENTREGUE','CANCELADO') ORDER BY due_date LIMIT 10"),
 dbAll("SELECT 'PAGAMENTO_ATRASADO' type,description title,COALESCE(due_date::text,'') detail FROM transactions WHERE deleted_at IS NULL AND paid=false AND due_date<CURRENT_DATE ORDER BY due_date LIMIT 10"),
 dbAll("SELECT 'MANUTENCAO' type,p.name||' — '||mp.task title,COALESCE(mp.next_due_date::text,CASE WHEN mp.next_due_hours IS NOT NULL THEN ROUND(mp.next_due_hours-(COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)),1)::text||'h' END,'') detail FROM maintenance_plans mp JOIN printers p ON p.id=mp.printer_id LEFT JOIN (SELECT printer_id,COALESCE(SUM(real_time_min)/60,0) test_hours FROM tests WHERE result<>'CANCELADO' AND deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id WHERE mp.active=true AND ((mp.next_due_date IS NOT NULL AND mp.next_due_date<=CURRENT_DATE+7) OR (mp.next_due_hours IS NOT NULL AND COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)>=mp.next_due_hours-20)) LIMIT 10"),
 dbAll("SELECT 'IMPRESSAO_FALHOU' type,'Impressão #'||id title,COALESCE(failure_type,'Falha') detail FROM production_jobs WHERE result='FALHA' ORDER BY created_at DESC LIMIT 10")
]);res.json([...stock,...orders,...payments,...maintenance,...failed]);}catch(e){next(e)}});
router.get('/audit-logs',adminOnly,async(req,res,next)=>{try{const limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));const offset=Math.max(0,Number(req.query.offset)||0);res.json(await dbAll(`SELECT a.id,a.action,a.entity,a.entity_id,a.result,a.ip,a.created_at,u.name user_name,u.email user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,[limit,offset]));}catch(e){next(e)}});

// Dashboard/reports
router.get('/dashboard',async(req,res,next)=>{try{
 const from=req.query.start||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=req.query.end||today();
 const revenue=await dbGet(`SELECT COALESCE(SUM(amount),0) total FROM transactions WHERE type='RECEITA' AND date BETWEEN $1 AND $2 AND deleted_at IS NULL`,[from,to]);
 const expenses=await dbGet(`SELECT COALESCE(SUM(amount),0) total FROM transactions WHERE type='DESPESA' AND date BETWEEN $1 AND $2 AND deleted_at IS NULL`,[from,to]);
 const ao=await dbGet("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('ENTREGUE','CANCELADO') AND deleted_at IS NULL");
 const lo=await dbGet("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('ENTREGUE','CANCELADO') AND due_date < $1 AND deleted_at IS NULL",[today()]);
 const ip=await dbGet("SELECT COUNT(*) c FROM production_jobs WHERE status IN ('IMPRIMINDO','PREPARANDO')");
 const ls=await dbGet('SELECT COUNT(*) c FROM material_rolls WHERE current_weight_g<=min_stock_g AND deleted_at IS NULL');
 const ts=await dbGet('SELECT COUNT(*) c FROM tool_consumables WHERE current_qty<=min_qty AND deleted_at IS NULL');
 const ps=await dbGet('SELECT COUNT(*) c FROM small_parts WHERE current_qty<=min_qty AND deleted_at IS NULL');
 const lp=await dbGet('SELECT COUNT(*) c FROM transactions WHERE paid=false AND due_date<$1 AND deleted_at IS NULL',[today()]);
 const printerTotals=await dbGet(`
   SELECT
     COALESCE(SUM(time_min),0) / 60 hours,
     COALESCE(SUM(filament_g),0) filament
   FROM (
     SELECT COALESCE(SUM(t.real_time_min),0) time_min,
            COALESCE(SUM(COALESCE(t.real_weight_g,0)+COALESCE(t.waste_g,0)),0) filament_g
     FROM tests t
     WHERE t.deleted_at IS NULL AND t.result IN ('APROVADO','REPROVADO') AND COALESCE(t.test_date,t.created_at::date) BETWEEN $1 AND $2
     UNION ALL
     SELECT COALESCE(SUM(pj.real_time_min),0) time_min,
            COALESCE(SUM(COALESCE(pj.real_weight_g,0)+COALESCE(pj.waste_g,0)),0) filament_g
     FROM production_jobs pj
     WHERE pj.result IN ('SUCESSO','FALHA') AND pj.created_at::date BETWEEN $1 AND $2
   ) x`,[from,to]);
 const mn=await dbAll(`SELECT mp.id,mp.task,mp.printer_id,p.name printer_name,
   COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0) current_hours,mp.next_due_hours,mp.next_due_date,
   CASE WHEN mp.next_due_hours IS NOT NULL AND COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)>=mp.next_due_hours THEN 'ATRASADA'
        WHEN mp.next_due_date IS NOT NULL AND CURRENT_DATE>=mp.next_due_date THEN 'ATRASADA'
        WHEN mp.next_due_hours IS NOT NULL AND mp.next_due_hours-(COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0))<=${MAINT_WARNING_HOURS} THEN 'PROXIMA'
        WHEN mp.next_due_date IS NOT NULL AND mp.next_due_date-CURRENT_DATE<=7 THEN 'PROXIMA'
        ELSE 'EM_DIA' END status,
   CASE WHEN mp.next_due_hours IS NOT NULL THEN GREATEST(mp.next_due_hours-(COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)),0) END hours_remaining
   FROM maintenance_plans mp JOIN printers p ON p.id=mp.printer_id
   LEFT JOIN (SELECT printer_id,COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 test_hours FROM tests WHERE deleted_at IS NULL GROUP BY printer_id) t ON t.printer_id=p.id
   WHERE mp.active=true AND p.deleted_at IS NULL
   AND ((mp.next_due_hours IS NOT NULL AND COALESCE(p.total_hours,0)+COALESCE(t.test_hours,0)>=mp.next_due_hours-${MAINT_WARNING_HOURS})
     OR (mp.next_due_date IS NOT NULL AND CURRENT_DATE>=mp.next_due_date-INTERVAL '7 days'))
   ORDER BY CASE WHEN status='ATRASADA' THEN 0 ELSE 1 END,p.name,mp.task`);
 const ti=n((await dbGet("SELECT value FROM settings WHERE key='printer_investment'"))?.value);
 const commercialProfit=await dbGet(`SELECT COALESCE(SUM(o.total-(COALESCE(p.cost_total,0)*o.quantity)),0) total FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status NOT IN ('ORCAMENTO','CANCELADO') AND o.deleted_at IS NULL`);
 const recovered=Math.max(0,n(commercialProfit.total)), roi=ti>0?Math.min(100,recovered/ti*100).toFixed(1):0, investmentRemaining=Math.max(0,ti-recovered);
 const impressionStats=await dbGet(`
   SELECT
     COALESCE(SUM(total_count),0) total_count,
     COALESCE(SUM(success_count),0) success_count
   FROM (
     SELECT COUNT(*)::numeric total_count,
            COUNT(*) FILTER (WHERE result='APROVADO')::numeric success_count
     FROM tests
     WHERE deleted_at IS NULL AND result IN ('APROVADO','REPROVADO') AND created_at::date BETWEEN $1 AND $2
     UNION ALL
     SELECT COUNT(*)::numeric total_count,
            COUNT(*) FILTER (WHERE result='SUCESSO')::numeric success_count
     FROM production_jobs
     WHERE result IN ('SUCESSO','FALHA') AND created_at::date BETWEEN $1 AND $2
   ) stats`,[from,to]);
 const totalP=n(impressionStats?.total_count),successP=n(impressionStats?.success_count);
 const successRate=totalP>0?(successP/totalP*100).toFixed(1):'0.0';
 res.json({revenue:n(revenue.total),expenses:n(expenses.total),profit:n(revenue.total)-n(expenses.total),commercial_profit:recovered,investment:ti,investment_remaining:investmentRemaining,active_orders:Number(ao.c),late_orders:Number(lo.c),in_production:Number(ip.c),low_stock:Number(ls.c)+Number(ts.c)+Number(ps.c),late_payments:Number(lp.c),maint_needed:mn.length,maintenance:mn,roi,print_hours:n(printerTotals.hours).toFixed(1),filament_used:n(printerTotals.filament).toFixed(0),success_rate:successRate,impressions_total:totalP,impressions_success:successP})
 }catch(e){next(e)}});
router.get('/reports/finance',async(req,res,next)=>{try{const from=req.query.start||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=req.query.end||today();res.json({by_category:await dbAll(`SELECT category,type,SUM(amount) total FROM transactions WHERE date BETWEEN $1 AND $2 AND deleted_at IS NULL GROUP BY category,type ORDER BY total DESC`,[from,to])})}catch(e){next(e)}});
router.get('/reports/production',async(req,res,next)=>{try{const from=req.query.start||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=req.query.end||today();res.json({summary:await dbAll('SELECT result,COUNT(*) count,SUM(real_time_min) time_min,SUM(real_weight_g) weight FROM production_jobs WHERE created_at::date BETWEEN $1 AND $2 GROUP BY result',[from,to]),by_printer:await dbAll('SELECT prn.name,COUNT(*) jobs,SUM(pj.real_time_min)/60 hours,SUM(COALESCE(pj.real_weight_g,0)+COALESCE(pj.waste_g,0)) filament FROM production_jobs pj JOIN printers prn ON prn.id=pj.printer_id WHERE pj.created_at::date BETWEEN $1 AND $2 GROUP BY prn.id,prn.name',[from,to])})}catch(e){next(e)}});
router.get('/reports/products',async(req,res,next)=>{try{const from=req.query.start||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=req.query.end||today();res.json(await dbAll(`SELECT p.name,COUNT(o.id)::int orders,SUM(o.quantity)::int qty,SUM(o.total) revenue,p.cost_total,SUM(o.total-(p.cost_total*o.quantity)) profit FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status NOT IN ('CANCELADO','ORCAMENTO') AND o.deleted_at IS NULL AND o.created_at::date BETWEEN $1 AND $2 GROUP BY p.id,p.name,p.cost_total ORDER BY revenue DESC`,[from,to]))}catch(e){next(e)}});
router.get('/reports/stock',async(req,res,next)=>{try{const from=req.query.start||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=req.query.end||today();const [moves,low]=await Promise.all([dbAll(`SELECT type,SUM(quantity_g) total FROM stock_movements WHERE created_at::date BETWEEN $1 AND $2 GROUP BY type ORDER BY total DESC`,[from,to]),dbAll(`SELECT r.id,r.code,m.type,m.color,r.current_weight_g,r.min_stock_g FROM material_rolls r JOIN materials m ON m.id=r.material_id WHERE r.deleted_at IS NULL AND r.current_weight_g<=r.min_stock_g ORDER BY r.current_weight_g ASC`)]);res.json({moves,low_stock:low})}catch(e){next(e)}});
module.exports=router;
