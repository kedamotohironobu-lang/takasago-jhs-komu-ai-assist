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
    signoutButton:$('#signout-button'),
    materialsAuthRequired:$('#materials-auth-required'),
    materialsContent:$('#materials-content'),
    documentsBody:$('#documents-body'),
    documentsEmpty:$('#documents-empty'),
    refreshDocuments:$('#refresh-documents'),
    searchAuthRequired:$('#search-auth-required'),
    searchContent:$('#search-content'),
    addAuthRequired:$('#add-auth-required'),
    addContent:$('#add-content'),
    registerAdminTest:$('#register-admin-test'),
    cleanupAdminTest:$('#cleanup-admin-test'),
    adminRegisterProgress:$('#admin-register-progress'),
    adminRegisterTitle:$('#admin-register-title'),
    adminRegisterText:$('#admin-register-text'),
    ragTestQuery:$('#rag-test-query'),
    runRagTest:$('#run-rag-test'),
    searchResultGrid:$('#search-result-grid'),
    testCandidates:$('#test-candidates'),
    testEvidence:$('#test-evidence')
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

  function renderProtectedViews(){
    const unlocked=Boolean(state.authenticated);
    if(nodes.materialsAuthRequired) nodes.materialsAuthRequired.hidden=unlocked;
    if(nodes.materialsContent) nodes.materialsContent.hidden=!unlocked;
    if(nodes.searchAuthRequired) nodes.searchAuthRequired.hidden=unlocked;
    if(nodes.searchContent) nodes.searchContent.hidden=!unlocked;
    if(nodes.addAuthRequired) nodes.addAuthRequired.hidden=unlocked;
    if(nodes.addContent) nodes.addContent.hidden=!unlocked;
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
      renderProtectedViews();
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
    renderProtectedViews();
  }

  async function verifyCurrentToken(){
    if(!state.idToken) return false;
    try{
      const data=await authJson('/admin/auth/me');
      state.authenticated=Boolean(data?.admin?.authenticated);
      state.admin=data?.admin||null;
      renderAuthState();
      if(state.authenticated) loadDocuments();
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

  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function formatDate(value){
    if(!value) return '—';
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleString('ja-JP');
  }

  async function loadDocuments(){
    if(!state.authenticated) return;
    try{
      const data=await authJson('/admin/rag/documents');
      const docs=Array.isArray(data?.result?.documents)?data.result.documents:[];
      if(nodes.documentsBody){
        nodes.documentsBody.innerHTML=docs.map(doc=>`
          <tr>
            <td>
              <strong>${escapeHtml(doc.title || doc.fileName || '無題')}</strong>
              <small>${escapeHtml(doc.sourceId || '')}</small>
            </td>
            <td>${escapeHtml(doc.categoryName || '—')}</td>
            <td>${escapeHtml(doc.versionLabel || ('rev '+doc.revisionNo))}</td>
            <td><span class="status-pill ${doc.status==='active'?'ok':''}">${escapeHtml(doc.status || '—')}</span></td>
            <td>${escapeHtml(doc.approvalStatus || '—')}</td>
            <td>${Number(doc.activeChunkCount||0).toLocaleString()}</td>
            <td>${formatDate(doc.updatedAt)}</td>
          </tr>
        `).join('');
      }
      if(nodes.documentsEmpty) nodes.documentsEmpty.hidden=docs.length>0;
    }catch(err){
      console.error(err);
      showToast(err?.message||'資料一覧を取得できませんでした。',3800);
    }
  }

  function renderRagTest(result){
    const diagnostics=result?.diagnostics||{};
    const candidates=Array.isArray(diagnostics.fusedCandidates)?diagnostics.fusedCandidates:[];
    const evidence=Array.isArray(result?.evidence)?result.evidence:[];

    setText('test-has-evidence',result?.hasUsableEvidence?'あり':'なし');
    setText('test-accepted-count',String(diagnostics?.gate?.acceptedCount??0));
    setText('test-fts-error',diagnostics?.ftsError||'なし');

    if(nodes.testCandidates){
      nodes.testCandidates.innerHTML=candidates.slice(0,10).map(c=>`
        <div class="candidate-card ${c.accepted?'is-accepted':''}">
          <div class="candidate-top">
            <strong>#${c.fusedRank} ${escapeHtml(c.title||c.chunkId)}</strong>
            <span>${c.accepted?'採用':'除外'}</span>
          </div>
          <div class="candidate-meta">
            Vector #${c.vectorRank ?? '—'} / ${c.vectorScore!=null?Number(c.vectorScore).toFixed(4):'—'}
            ・ FTS #${c.ftsRank ?? '—'}
            ・ RRF ${c.rrfScore!=null?Number(c.rrfScore).toFixed(5):'—'}
          </div>
          <div class="candidate-reason">${escapeHtml(c.gateReason||c.exclusionReason||'')}</div>
        </div>
      `).join('') || '<p class="empty-message">候補はありません。</p>';
    }

    if(nodes.testEvidence){
      nodes.testEvidence.innerHTML=evidence.map(ev=>`
        <div class="evidence-card">
          <strong>${escapeHtml(ev.title||'資料')}</strong>
          <span>${escapeHtml(ev.headingPath||'')}</span>
          <p>${escapeHtml(ev.text||'')}</p>
        </div>
      `).join('') || '<p class="empty-message">採用された根拠はありません。</p>';
    }

    if(nodes.searchResultGrid) nodes.searchResultGrid.hidden=false;
  }

  function setAdminRegisterProgress(title,text,visible=true){
    if(nodes.adminRegisterProgress) nodes.adminRegisterProgress.hidden=!visible;
    if(nodes.adminRegisterTitle) nodes.adminRegisterTitle.textContent=title;
    if(nodes.adminRegisterText) nodes.adminRegisterText.textContent=text;
  }

  async function registerAdminSyntheticTest(){
    if(!state.authenticated) return;

    if(nodes.registerAdminTest){
      nodes.registerAdminTest.disabled=true;
      nodes.registerAdminTest.textContent='登録中…';
    }
    setAdminRegisterProgress('D1へ登録中','架空資料をstagingしています。',true);

    try{
      const staged=await authJson('/admin/rag/stage',{
        method:'POST',
        body:JSON.stringify({
          sourceId:'step5-test-admin-v1',
          sourceType:'upload',
          fileName:'STEP5-8_管理画面登録テスト.txt',
          title:'STEP5-8 管理画面登録テスト',
          mimeType:'text/plain',
          categoryId:'cat-other',
          ownerDepartment:'STEP5-8動作確認',
          versionLabel:'test-v1',
          approved:true,
          sections:[{
            headingPath:'動作確認 > 備品C',
            text:[
              'これは登録確認用の架空資料です。',
              'テスト備品Cの確認日は水曜日です。',
              '確認後はテスト記録欄に「確認済み」と記載します。',
              '実際の校内規則ではありません。'
            ].join('\n\n')
          }]
        })
      });

      const documentId=String(staged?.result?.documentId||'');
      if(!documentId) throw new Error('documentIdを取得できませんでした。');
      sessionStorage.setItem('step58AdminTestDocumentId',documentId);

      setAdminRegisterProgress('Embedding・Vectorize処理中','チャンクを意味ベクトルへ変換しています。',true);

      for(let i=0;i<10;i++){
        const indexed=await authJson('/admin/rag/index-next',{
          method:'POST',
          body:JSON.stringify({documentId,limit:20})
        });
        const r=indexed?.result||{};
        if(r.done===true || Number(r.remaining||0)===0) break;
        await new Promise(resolve=>setTimeout(resolve,900));
      }

      let finalized=null;
      let lastError=null;
      for(let i=0;i<6;i++){
        try{
          if(i>0) await new Promise(resolve=>setTimeout(resolve,4500));
          finalized=await authJson('/admin/rag/finalize',{
            method:'POST',
            body:JSON.stringify({documentId})
          });
          lastError=null;
          break;
        }catch(err){
          lastError=err;
          const msg=String(err?.message||'');
          if(!msg.includes('Vectorizeへの反映待ち') && !msg.includes('意味検索への反映')){
            throw err;
          }
        }
      }

      if(!finalized){
        throw lastError||new Error('Vectorize反映待ちです。少し待って再試行してください。');
      }

      setAdminRegisterProgress(
        '登録完了',
        'D1・Vectorize・FTS5への登録が完了しました。RAG検索テストで「テスト備品Cの確認日はいつですか？」を検索できます。',
        true
      );
      if(nodes.cleanupAdminTest) nodes.cleanupAdminTest.hidden=false;
      showToast('STEP5-8テスト資料を登録しました。',3200);
      await Promise.allSettled([loadDocuments(),refreshAll()]);
    }catch(err){
      console.error(err);
      setAdminRegisterProgress('登録エラー',err?.message||'登録に失敗しました。',true);
      showToast(err?.message||'登録に失敗しました。',4200);
    }finally{
      if(nodes.registerAdminTest){
        nodes.registerAdminTest.disabled=false;
        nodes.registerAdminTest.textContent='テスト資料を新RAGへ登録';
      }
    }
  }

  async function cleanupAdminSyntheticTest(){
    if(!state.authenticated) return;

    if(nodes.cleanupAdminTest) nodes.cleanupAdminTest.disabled=true;
    try{
      const data=await authJson('/admin/rag/test-source-cleanup',{
        method:'POST',
        body:JSON.stringify({sourceId:'step5-test-admin-v1'})
      });
      sessionStorage.removeItem('step58AdminTestDocumentId');
      if(nodes.cleanupAdminTest) nodes.cleanupAdminTest.hidden=true;
      const r=data?.result||{};
      setAdminRegisterProgress(
        '削除完了',
        '接続確認用テストsourceの全revisionを削除しました。資料 '+(r.deletedDocuments||0)+'件 / Vector '+(r.deletedVectors||0)+'件。',
        true
      );
      showToast('テスト資料の全revisionを削除しました。');
      await Promise.allSettled([loadDocuments(),refreshAll()]);
    }catch(err){
      console.error(err);
      showToast(err?.message||'テスト資料を削除できませんでした。',4200);
    }finally{
      if(nodes.cleanupAdminTest) nodes.cleanupAdminTest.disabled=false;
    }
  }

  async function runRagTest(){
    if(!state.authenticated) return;
    const query=String(nodes.ragTestQuery?.value||'').trim();
    if(!query){
      showToast('質問を入力してください。');
      nodes.ragTestQuery?.focus();
      return;
    }

    if(nodes.runRagTest){
      nodes.runRagTest.disabled=true;
      nodes.runRagTest.textContent='検索中…';
    }

    try{
      const data=await authJson('/admin/rag/retrieval-test',{
        method:'POST',
        body:JSON.stringify({query,evidenceLimit:4})
      });
      renderRagTest(data?.result||{});
    }catch(err){
      console.error(err);
      showToast(err?.message||'RAG検索テストに失敗しました。',4000);
    }finally{
      if(nodes.runRagTest){
        nodes.runRagTest.disabled=false;
        nodes.runRagTest.textContent='検索する';
      }
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

  function renderReadiness(data){
    const r=data?.readiness||{};
    setText('readiness-pilot',r.pilotReady?'利用可':'未完了');
    setText('readiness-schoolwide',r.schoolwideReady?'利用可':'未完了');

    const badge=$('#readiness-badge');
    if(badge){
      badge.textContent=r.schoolwideReady?'一般公開可':(r.pilotReady?'管理者試験可':'要設定');
      badge.classList.toggle('accent',Boolean(r.schoolwideReady));
    }

    const labels={
      ragDatabase:'D1スキーマ',
      vectorize:'Vectorize',
      evidenceGate:'Evidence Gate',
      aiProvider:'AIプロバイダー',
      adminAuth:'管理者認証',
      staffAuthPilot:'管理者によるFAQ試験',
      staffAuthSchoolwide:'一般職員認証設定',
      approvedDocuments:'承認済み有効資料',
      activeChunks:'検索対象チャンク',
      legacyKvPublicRetired:'旧KV公開経路の退役'
    };

    const checksEl=$('#readiness-checks');
    if(checksEl){
      const checks=r.checks||{};
      checksEl.innerHTML=Object.keys(labels).map(key=>{
        const ok=Boolean(checks[key]);
        return '<div class="readiness-item '+(ok?'is-ok':'is-warn')+'">'+
          '<span>'+labels[key]+'</span>'+
          '<strong>'+(ok?'✓ OK':'要確認')+'</strong>'+
        '</div>';
      }).join('');
    }

    const warnings=$('#readiness-warnings');
    const list=Array.isArray(r.warnings)?r.warnings:[];
    if(warnings){
      warnings.hidden=!list.length;
      warnings.innerHTML=list.length
        ? '<strong>確認事項</strong><ul>'+list.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>'
        : '';
    }
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
      const [worker,d1,vector,gate,summary,readiness]=await Promise.all([
        getJson('/health'),
        getJson('/health/rag-db'),
        getJson('/health/rag-vector'),
        getJson('/health/rag-gate'),
        getJson('/health/rag-dashboard'),
        getJson('/health/production-readiness')
      ]);
      renderHealth(worker,d1,vector,gate);
      renderSummary(summary);
      renderReadiness(readiness);
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
  nodes.refreshDocuments?.addEventListener('click',loadDocuments);
  nodes.runRagTest?.addEventListener('click',runRagTest);
  nodes.registerAdminTest?.addEventListener('click',registerAdminSyntheticTest);
  nodes.cleanupAdminTest?.addEventListener('click',cleanupAdminSyntheticTest);
  nodes.ragTestQuery?.addEventListener('keydown',(event)=>{
    if(event.key==='Enter'){
      event.preventDefault();
      runRagTest();
    }
  });
  nodes.signoutButton?.addEventListener('click',()=>{
    sessionStorage.removeItem('takasagoAdminIdToken');
    state.idToken='';
    state.authenticated=false;
    state.admin=null;
    try{ window.google?.accounts?.id?.disableAutoSelect(); }catch{}
    if(nodes.documentsBody) nodes.documentsBody.innerHTML='';
    if(nodes.searchResultGrid) nodes.searchResultGrid.hidden=true;
    renderAuthState();
    renderGoogleButton();
    showToast('ログアウトしました。');
  });

  const existingTestId=sessionStorage.getItem('step58AdminTestDocumentId');
  if(existingTestId && nodes.cleanupAdminTest) nodes.cleanupAdminTest.hidden=false;

  initializeAdminAuth();
  refreshAll();
})();