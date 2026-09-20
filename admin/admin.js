(() => {
  'use strict';

  const state = {
    config:null,
    loading:false,
    googleClientId:'',
    idToken:sessionStorage.getItem('takasagoAdminIdToken') || '',
    authenticated:false,
    admin:null
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const nodes = {
    nav:$$('[data-admin-view]'),
    panels:$$('[data-view-panel]'),
    refresh:$$('[data-refresh]'),
    toast:$('#admin-toast'),
    overallDot:$('#overall-dot'),
    overallLabel:$('#overall-label'),
    authTitle:$('#auth-title'),
    authDescription:$('#auth-description'),
    authBadge:$('#auth-badge'),
    googleSignin:$('#google-signin'),
    signedUser:$('#signed-user'),
    signedUserName:$('#signed-user-name'),
    signoutButton:$('#signout-button')
  };

  function showToast(message, ms=2600){
    if(!nodes.toast) return;
    nodes.toast.textContent=message;
    nodes.toast.hidden=false;
    clearTimeout(window.__adminToast);
    window.__adminToast=setTimeout(()=>nodes.toast.hidden=true,ms);
  }

  function setText(id,value){
    const el=document.getElementById(id);
    if(el) el.textContent=value;
  }

  function bytes(value){
    const n=Number(value)||0;
    if(n<1024) return n+' B';
    if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
    if(n<1024*1024*1024) return (n/1024/1024).toFixed(1)+' MB';
    return (n/1024/1024/1024).toFixed(2)+' GB';
  }

  function pct(value){
    return Math.max(0,Math.min(100,Number(value)||0));
  }

  async function loadConfig(){
    if(state.config) return state.config;
    try{
      const res=await fetch('config.json',{cache:'no-store'});
      if(!res.ok) throw new Error('config');
      state.config=await res.json();
    }catch{
      state.config={workerBaseUrl:''};
    }
    return state.config;
  }

  async function getJson(path){
    const cfg=await loadConfig();
    const base=String(cfg.workerBaseUrl||'').replace(/\/+$/,'');
    if(!base) throw new Error('Worker URLが未設定です。');
    const res=await fetch(base+path,{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok || data?.ok===false) throw new Error(data?.error?.message||('HTTP '+res.status));
    return data;
  }

  async function getAuthConfig(){
    const data=await getJson('/health/admin-auth');
    const auth=data?.adminAuth||{};
    state.googleClientId=String(auth.googleClientId||'');
    return auth;
  }

  async function authJson(path,options={}){
    const cfg=await loadConfig();
    const base=String(cfg.workerBaseUrl||'').replace(/\/+$/,'');
    if(!base) throw new Error('Worker URLが未設定です。');
    if(!state.idToken) throw new Error('管理者ログインが必要です。');

    const headers={
      ...(options.headers||{}),
      'Authorization':'Bearer '+state.idToken
    };
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';

    const res=await fetch(base+path,{...options,headers,cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok || data?.ok===false){
      const err=new Error(data?.error?.message||('HTTP '+res.status));
      err.code=data?.error?.code||'ADMIN_API_ERROR';
      err.status=res.status;
      throw err;
    }
    return data;
  }

  function renderAuthState(){
    if(state.authenticated && state.admin){
      if(nodes.authTitle) nodes.authTitle.textContent='管理者認証済み';
      if(nodes.authDescription) nodes.authDescription.textContent='GoogleアカウントをWorker側で検証し、管理者許可リストと照合しています。';
      if(nodes.authBadge) nodes.authBadge.textContent='✓ 認証済み';
      if(nodes.authBadge) nodes.authBadge.classList.add('is-authenticated');
      if(nodes.googleSignin) nodes.googleSignin.hidden=true;
      if(nodes.signedUser) nodes.signedUser.hidden=false;
      if(nodes.signedUserName) nodes.signedUserName.textContent=state.admin.name || state.admin.email || '管理者';
      return;
    }

    if(nodes.authBadge) nodes.authBadge.classList.remove('is-authenticated');
    if(nodes.signedUser) nodes.signedUser.hidden=true;

    if(state.googleClientId){
      if(nodes.authTitle) nodes.authTitle.textContent='管理者ログイン';
      if(nodes.authDescription) nodes.authDescription.textContent='許可されたGoogleアカウントでログインしてください。IDトークンはWorker側で検証します。';
      if(nodes.authBadge) nodes.authBadge.textContent='🔒 未ログイン';
      if(nodes.googleSignin) nodes.googleSignin.hidden=false;
    }else{
      if(nodes.authTitle) nodes.authTitle.textContent='管理操作は現在ロックしています';
      if(nodes.authDescription) nodes.authDescription.textContent='Google OAuth Client IDと管理者メール許可リストをCloudflareへ設定するとログインを有効化できます。';
      if(nodes.authBadge) nodes.authBadge.textContent='🔒 認証設定待ち';
      if(nodes.googleSignin) nodes.googleSignin.hidden=true;
    }
  }

  async function verifyCurrentToken(){
    if(!state.idToken) return false;
    try{
      const data=await authJson('/admin/auth/me');
      state.authenticated=Boolean(data?.admin?.authenticated);
      state.admin=data?.admin||null;
      renderAuthState();
      return state.authenticated;
    }catch(err){
      console.warn('admin token verification failed',err);
      sessionStorage.removeItem('takasagoAdminIdToken');
      state.idToken='';
      state.authenticated=false;
      state.admin=null;
      renderAuthState();
      return false;
    }
  }

  async function handleGoogleCredential(response){
    const credential=String(response?.credential||'');
    if(!credential) return;
    state.idToken=credential;
    sessionStorage.setItem('takasagoAdminIdToken',credential);
    const ok=await verifyCurrentToken();
    showToast(ok?'管理者としてログインしました。':'このアカウントでは管理できません。',3200);
  }

  function renderGoogleButton(){
    if(!state.googleClientId || !window.google?.accounts?.id || !nodes.googleSignin) return false;
    nodes.googleSignin.innerHTML='';
    window.google.accounts.id.initialize({
      client_id:state.googleClientId,
      callback:handleGoogleCredential,
      auto_select:false
    });
    window.google.accounts.id.renderButton(nodes.googleSignin,{
      theme:'outline',
      size:'large',
      shape:'pill',
      text:'signin_with',
      locale:'ja',
      width:240
    });
    return true;
  }

  async function initializeAdminAuth(){
    try{
      const auth=await getAuthConfig();
      renderAuthState();

      if(state.idToken){
        await verifyCurrentToken();
      }

      if(!auth?.configured || !state.googleClientId){
        renderAuthState();
        return;
      }

      let tries=0;
      const timer=setInterval(()=>{
        tries++;
        if(renderGoogleButton() || tries>=30) clearInterval(timer);
      },200);
    }catch(err){
      console.warn('admin auth config failed',err);
      renderAuthState();
    }
  }

  function renderSummary(data){
    const s=data?.ragDashboard||{};
    setText('metric-docs',String(s.activeDocuments??'—'));
    setText('metric-chunks',String(s.activeChunks??'—'));
    setText('metric-jobs',`${s.runningJobs??0} / ${s.failedJobs??0}`);

    setText('usage-docs',String(s.activeDocuments??'—'));
    setText('usage-chunks',String(s.activeChunks??'—'));

    const vector=s.capacity?.vector||{};
    const vectorRatio=Number(vector.ratio||0)*100;
    setText('metric-vector',vector.usedDimensions!=null?vectorRatio.toFixed(3)+'%':'—');
    setText('vector-dims',vector.usedDimensions!=null?`${Number(vector.usedDimensions).toLocaleString()} / ${Number(vector.limitDimensions).toLocaleString()}`:'—');
    setText('usage-vector',vector.usedDimensions!=null?`${Number(vector.usedDimensions).toLocaleString()} / ${Number(vector.limitDimensions).toLocaleString()}`:'—');
    const vb=$('#vector-bar'); if(vb) vb.style.width=pct(vectorRatio)+'%';

    const d1=s.capacity?.d1||{};
    const d1Ratio=d1.hardLimitBytes?Number(d1.estimatedWorkingSetBytes||0)/Number(d1.hardLimitBytes)*100:0;
    setText('d1-bytes',d1.estimatedWorkingSetBytes!=null?`${bytes(d1.estimatedWorkingSetBytes)} / 500 MB`:'—');
    setText('usage-d1',d1.estimatedWorkingSetBytes!=null?bytes(d1.estimatedWorkingSetBytes):'—');
    const db=$('#d1-bar'); if(db) db.style.width=pct(d1Ratio)+'%';
  }

  function renderHealth(worker,d1,vector,gate){
    const workerOk=Boolean(worker?.ok);
    const d1Ok=Boolean(d1?.ragDb?.configured && d1?.ragDb?.schemaReady);
    const vectorOk=Boolean(vector?.ragVector?.configured);
    const gateOk=Boolean(gate?.ragGate?.configured);

    setText('health-worker',workerOk?`正常 v${worker?.version||''}`:'要確認');
    setText('health-d1',d1Ok?'正常':'要確認');
    setText('health-vector',vectorOk?'正常':'要確認');
    setText('health-gate',gateOk?'正常':'要確認');

    setText('status-d1',d1Ok?'接続済み':'要確認');
    setText('status-vector',vectorOk?'接続済み':'要確認');
    setText('status-gate',gateOk?'有効':'要確認');
    setText('status-embedding',vector?.ragVector?.geminiEmbedding?'Gemini 384次元':'要確認');

    const all=workerOk&&d1Ok&&vectorOk&&gateOk;
    const badge=$('#rag-ready-badge');
    if(badge) badge.textContent=all?'正常':'要確認';

    if(nodes.overallDot){
      nodes.overallDot.classList.remove('ok','warn','error');
      nodes.overallDot.classList.add(all?'ok':'warn');
    }
    if(nodes.overallLabel) nodes.overallLabel.textContent=all?'基盤正常':'要確認';
  }

  async function refreshAll(){
    if(state.loading) return;
    state.loading=true;
    showToast('システム状態を更新しています…',1200);
    try{
      const [worker,d1,vector,gate,summary]=await Promise.all([
        getJson('/health'),
        getJson('/health/rag-db'),
        getJson('/health/rag-vector'),
        getJson('/health/rag-gate'),
        getJson('/health/rag-dashboard')
      ]);
      renderHealth(worker,d1,vector,gate);
      renderSummary(summary);
      setText('last-updated',new Date().toLocaleString('ja-JP'));
    }catch(err){
      console.error(err);
      if(nodes.overallDot){
        nodes.overallDot.classList.remove('ok','warn');
        nodes.overallDot.classList.add('error');
      }
      if(nodes.overallLabel) nodes.overallLabel.textContent='接続エラー';
      showToast(err?.message||'状態確認に失敗しました。',3800);
    }finally{
      state.loading=false;
    }
  }

  function showView(name){
    nodes.nav.forEach(btn=>btn.classList.toggle('is-active',btn.dataset.adminView===name));
    nodes.panels.forEach(panel=>{
      const active=panel.dataset.viewPanel===name;
      panel.hidden=!active;
      panel.classList.toggle('is-active',active);
    });
    window.scrollTo({top:0,behavior:'smooth'});
  }

  nodes.nav.forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.adminView)));
  nodes.refresh.forEach(btn=>btn.addEventListener('click',refreshAll));
  nodes.signoutButton?.addEventListener('click',()=>{
    sessionStorage.removeItem('takasagoAdminIdToken');
    state.idToken='';
    state.authenticated=false;
    state.admin=null;
    try{ window.google?.accounts?.id?.disableAutoSelect(); }catch{}
    renderAuthState();
    renderGoogleButton();
    showToast('ログアウトしました。');
  });

  initializeAdminAuth();
  refreshAll();
})();