const API = {
  base:'/api', csrfToken:null,
  async ensureCsrf(){if(this.csrfToken)return this.csrfToken;const r=await fetch('/api/auth/csrf',{credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Falha ao preparar sessão');this.csrfToken=d.csrfToken||null;return this.csrfToken;},
  async request(method,path,body){const headers={};if(body instanceof FormData){}else if(body!==undefined){headers['Content-Type']='application/json';}
    const mut=!['GET','HEAD','OPTIONS'].includes(method);if(mut)headers['X-CSRF-Token']=await this.ensureCsrf();
    const res=await fetch(this.base+path,{method,headers,credentials:'same-origin',body:body instanceof FormData?body:(body!==undefined?JSON.stringify(body):undefined)});
    if(res.status===401 && !path.startsWith('/auth/me') && !path.startsWith('/auth/logout')){doLogout();return null;}
    if(res.status===403 && mut && body instanceof FormData) { this.csrfToken=null; } const raw=await res.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error('Resposta inválida do servidor');} if(!res.ok)throw new Error(data.error||'Erro desconhecido');return data;},
  get:p=>API.request('GET',p),post:(p,b)=>API.request('POST',p,b),put:(p,b)=>API.request('PUT',p,b),del:p=>API.request('DELETE',p),
  async upload(path,file){const fd=new FormData();fd.append('image',file);const headers={'X-CSRF-Token':await this.ensureCsrf()};const res=await fetch(this.base+path,{method:'POST',headers,credentials:'same-origin',body:fd});if(res.status===401){doLogout();return;}const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Erro ao enviar imagem');return data;}
};
