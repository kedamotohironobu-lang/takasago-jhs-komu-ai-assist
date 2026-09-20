(() => {
  'use strict';

  const state = {
    config:null,
    loading:false,
    documents:[],
    googleClientId:'',
    idToken:sessionStorage.getItem('takasagoAdminIdToken') || '',
    authenticated:false,
    admin:null,
    acceptance:{
      running:false,
      autoChecks:[],
      readiness:null,
      manual:{},
      lastReport:null
    }
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
    testEvidence:$('#test-evidence'),
    auditBody:$('#audit-body'),
    refreshAudit:$('#refresh-audit'),
    driveAuthRequired:$('#drive-auth-required'),
    driveContent:$('#drive-content'),
    driveSyncBody:$('#drive-sync-body'),
    refreshDriveStatus:$('#refresh-drive-status'),
    runMaintenance:$('#run-maintenance'),
    maintenanceResult:$('#maintenance-result'),
    jobsBody:$('#jobs-body'),
    refreshJobs:$('#refresh-jobs'),
    downloadBackup:$('#download-backup'),
    acceptanceAuthRequired:$('#acceptance-auth-required'),
    acceptanceContent:$('#acceptance-content'),
    runAcceptanceSuite:$('#run-acceptance-suite'),
    downloadAcceptanceReport:$('#download-acceptance-report'),
    recordAcceptanceResult:$('#record-acceptance-result'),
    acceptanceVerdict:$('#acceptance-verdict'),
    acceptanceAutoSummary:$('#acceptance-auto-summary'),
    acceptanceReadinessSummary:$('#acceptance-readiness-summary'),
    acceptanceManualSummary:$('#acceptance-manual-summary'),
    acceptanceNote:$('#acceptance-note'),
    acceptanceAutoBadge:$('#acceptance-auto-badge'),
    acceptanceReadinessBadge:$('#acceptance-readiness-badge'),
    acceptanceManualBadge:$('#acceptance-manual-badge'),
    acceptanceProgress:$('#acceptance-progress'),
    acceptanceProgressTitle:$('#acceptance-progress-title'),
    acceptanceProgressText:$('#acceptance-progress-text'),
    acceptanceAutoChecks:$('#acceptance-auto-checks'),
    acceptanceReadinessChecks:$('#acceptance-readiness-checks'),
    acceptanceManualChecks:$$('[data-acceptance-manual]')
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
    if(nodes.driveAuthRequired) nodes.driveAuthRequired.hidden=unlocked;
    if(nodes.driveContent) nodes.driveContent.hidden=!unlocked;
    if(nodes.acceptanceAuthRequired) nodes.acceptanceAuthRequired.hidden=unlocked;
    if(nodes.acceptanceContent) nodes.acceptanceContent.hidden=!unlocked;
    if(nodes.runAcceptanceSuite) nodes.runAcceptanceSuite.disabled=!unlocked || state.acceptance.running;
    if(nodes.refreshJobs) nodes.refreshJobs.disabled=!unlocked;
    if(nodes.downloadBackup) nodes.downloadBackup.disabled=!unlocked;
    if(nodes.runMaintenance) nodes.runMaintenance.disabled=!unlocked;
    if(nodes.runAcceptanceSuite) nodes.runAcceptanceSuite.disabled=!unlocked || state.acceptance.running;
    if(nodes.downloadAcceptanceReport) nodes.downloadAcceptanceReport.disabled=!unlocked || !state.acceptance.lastReport;
    if(nodes.recordAcceptanceResult) nodes.recordAcceptanceResult.disabled=!unlocked || !(
      acceptanceAutoPassed() &&
      acceptanceReadinessPassed() &&
      acceptanceManualPassed()
    );
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
      if(state.authenticated) {
        loadDocuments();
        loadAuditLogs();
        loadJobs();
      }
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

  async function loadAuditLogs(){
    if(!state.authenticated) return;
    try{
      const data=await authJson('/admin/rag/audit?limit=100');
      const logs=Array.isArray(data?.result?.logs)?data.result.logs:[];

      if(nodes.auditBody){
        nodes.auditBody.innerHTML=logs.map(log=>`
          <tr>
            <td>${formatDate(log.occurredAt)}</td>
            <td><span class="status-pill">${escapeHtml(log.action||'—')}</span></td>
            <td>
              <strong>${escapeHtml(log.summary||'')}</strong>
              <small>${escapeHtml(log.entityId||'')}</small>
            </td>
            <td>${escapeHtml(log.actorId||'—')}</td>
          </tr>
        `).join('') || '<tr><td colspan="4">監査ログはありません。</td></tr>';
      }
    }catch(err){
      console.error(err);
      if(nodes.auditBody){
        nodes.auditBody.innerHTML='<tr><td colspan="4">監査ログを取得できませんでした。</td></tr>';
      }
      showToast(err?.message||'監査ログを取得できませんでした。',3800);
    }
  }

  function renderDriveSyncStatus(documents){
    if(!nodes.driveSyncBody) return;
    const rows=(Array.isArray(documents)?documents:[])
      .filter(doc=>doc.isCurrent===true && doc.sourceType==='drive');

    nodes.driveSyncBody.innerHTML=rows.map(doc=>`
      <tr>
        <td>
          <strong>${escapeHtml(doc.title||doc.fileName||'無題')}</strong>
          <small>${escapeHtml(doc.driveFileId||doc.sourceId||'')}</small>
        </td>
        <td><span class="status-pill ${doc.status==='active'?'ok':''}">${escapeHtml(doc.status||'—')}</span></td>
        <td>${escapeHtml(doc.versionLabel||('rev '+doc.revisionNo))}</td>
        <td>${formatDate(doc.sourceModifiedAt)}</td>
        <td>${formatDate(doc.lastSyncedAt)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">Drive由来の現行資料はありません。</td></tr>';
  }

  async function completeDocumentActivation(documentId,label='資料'){
    const id=String(documentId||'');
    if(!id) throw new Error('documentIdがありません。');

    let lastIndex=null;
    for(let i=0;i<40;i++){
      lastIndex=await authJson('/admin/rag/index-next',{
        method:'POST',
        body:JSON.stringify({documentId:id,limit:20})
      });
      const r=lastIndex?.result||{};
      if(r.done===true || Number(r.remaining||0)===0) break;
      await new Promise(resolve=>setTimeout(resolve,650));
    }

    const indexResult=lastIndex?.result||{};
    if(!(indexResult.done===true || Number(indexResult.remaining||0)===0)){
      throw new Error(label+'のEmbedding処理が1回で完了しませんでした。再試行してください。');
    }

    let lastError=null;
    for(let attempt=0;attempt<7;attempt++){
      try{
        if(attempt>0) await new Promise(resolve=>setTimeout(resolve,4500));
        const finalized=await authJson('/admin/rag/finalize',{
          method:'POST',
          body:JSON.stringify({documentId:id})
        });
        return finalized?.result||finalized;
      }catch(err){
        lastError=err;
        const msg=String(err?.message||'');
        const waiting=
          msg.includes('Vectorizeへの反映待ち') ||
          msg.includes('意味検索への反映');
        if(!waiting) throw err;
      }
    }

    throw lastError||new Error(label+'のVectorize反映確認が完了しませんでした。');
  }

  async function softDeleteDocument(documentId,title){
    const typed=window.prompt(
      '「'+title+'」をFAQ検索対象から外します。\nDrive原本とD1履歴は削除しません。\n実行する場合は「削除」と入力してください。'
    );
    if(typed!=='削除') return;

    try{
      await authJson('/admin/rag/document-delete',{
        method:'POST',
        body:JSON.stringify({documentId})
      });
      showToast('資料を論理削除しました。Drive原本とD1履歴は保持されています。',4200);
      await Promise.allSettled([loadDocuments(),loadAuditLogs(),loadJobs(),refreshAll()]);
    }catch(err){
      console.error(err);
      showToast(err?.message||'資料を削除できませんでした。',4200);
    }
  }

  async function restoreDocument(documentId,title){
    if(!window.confirm(
      '「'+title+'」を復旧します。\n再EmbeddingしてFAQ検索対象へ戻します。よろしいですか？'
    )) return;

    try{
      showToast('復旧処理を開始しました。');
      const started=await authJson('/admin/rag/document-restore',{
        method:'POST',
        body:JSON.stringify({documentId})
      });
      const id=String(started?.result?.documentId||documentId);
      await completeDocumentActivation(id,'資料復旧');
      showToast('資料の復旧が完了しました。',4200);
      await Promise.allSettled([loadDocuments(),loadAuditLogs(),loadJobs(),refreshAll()]);
    }catch(err){
      console.error(err);
      showToast(err?.message||'資料を復旧できませんでした。',5000);
      await Promise.allSettled([loadDocuments(),loadJobs()]);
    }
  }

  async function loadJobs(){
    if(!state.authenticated) return;
    try{
      const data=await authJson('/admin/rag/jobs?limit=100');
      const jobs=Array.isArray(data?.result?.jobs)?data.result.jobs:[];

      if(nodes.jobsBody){
        nodes.jobsBody.innerHTML=jobs.map(job=>{
          const retryable=job.status==='failed' || job.stalled===true;
          const statusText=job.stalled && job.status!=='failed'
            ? job.status+' / 停滞'
            : job.status;
          const detail=job.errorMessage
            ? '<small>'+escapeHtml(job.errorMessage)+'</small>'
            : '<small>'+escapeHtml(job.currentStep||'')+'</small>';

          return `
            <tr>
              <td>
                <strong>${escapeHtml(job.title||job.sourceId||job.documentId||'—')}</strong>
                <small>${escapeHtml(job.jobId||'')}</small>
              </td>
              <td>${escapeHtml(job.jobType||'—')}</td>
              <td><span class="status-pill ${job.status==='completed'?'ok':''}">${escapeHtml(statusText||'—')}</span>${detail}</td>
              <td>${Number(job.progressPercent||0)}% / retry ${Number(job.retryCount||0)}</td>
              <td>
                ${retryable
                  ? '<button class="row-action retry-job" type="button" data-job-id="'+escapeHtml(job.jobId)+'">再試行</button>'
                  : '<span class="table-muted">—</span>'}
              </td>
            </tr>
          `;
        }).join('') || '<tr><td colspan="5">同期ジョブはありません。</td></tr>';
      }
    }catch(err){
      console.error(err);
      if(nodes.jobsBody){
        nodes.jobsBody.innerHTML='<tr><td colspan="5">同期ジョブを取得できませんでした。</td></tr>';
      }
      showToast(err?.message||'同期ジョブを取得できませんでした。',3800);
    }
  }

  async function retryJob(jobId){
    if(!window.confirm('この同期ジョブを再試行しますか？')) return;

    try{
      const data=await authJson('/admin/rag/job-retry',{
        method:'POST',
        body:JSON.stringify({jobId})
      });
      const documentId=String(data?.result?.documentId||'');
      if(!documentId) throw new Error('再試行対象のdocumentIdを取得できませんでした。');

      showToast('再試行を開始しました。');
      await completeDocumentActivation(documentId,'同期再試行');
      showToast('同期ジョブの再試行が完了しました。',4200);
      await Promise.allSettled([loadDocuments(),loadJobs(),loadAuditLogs(),refreshAll()]);
    }catch(err){
      console.error(err);
      showToast(err?.message||'同期ジョブを再試行できませんでした。',5000);
      await Promise.allSettled([loadJobs(),loadDocuments()]);
    }
  }

  async function downloadBackupManifest(){
    if(!state.authenticated){
      showToast('管理者ログインが必要です。');
      return;
    }
    try{
      if(nodes.downloadBackup){
        nodes.downloadBackup.disabled=true;
        nodes.downloadBackup.textContent='作成中…';
      }
      const data=await authJson('/admin/rag/backup-manifest');
      const manifest=data?.result||{};
      const blob=new Blob(
        [JSON.stringify(manifest,null,2)],
        {type:'application/json;charset=utf-8'}
      );
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
      a.href=url;
      a.download='takasago-jhs-rag-backup-manifest-'+stamp+'.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      showToast('バックアップマニフェストを作成しました。',3600);
    }catch(err){
      console.error(err);
      showToast(err?.message||'バックアップを作成できませんでした。',4200);
    }finally{
      if(nodes.downloadBackup){
        nodes.downloadBackup.disabled=false;
        nodes.downloadBackup.textContent='バックアップマニフェスト';
      }
    }
  }

  async function loadDocuments(){
    if(!state.authenticated) return;
    try{
      const data=await authJson('/admin/rag/documents');
      const docs=Array.isArray(data?.result?.documents)?data.result.documents:[];
      state.documents=docs;
      renderDriveSyncStatus(docs);
      if(nodes.documentsBody){
        nodes.documentsBody.innerHTML=docs.map(doc=>{
          const title=doc.title || doc.fileName || '無題';
          const deleted=Boolean(doc.deletedAt);
          const displayStatus=deleted?'削除済み':(doc.status||'—');

          let action='<span class="table-muted">履歴保持</span>';
          if(doc.isCurrent){
            if(deleted){
              action='<button class="row-action restore-document" type="button" data-document-id="'+
                escapeHtml(doc.documentId)+'" data-document-title="'+escapeHtml(title)+'">復旧</button>';
            }else if(String(doc.status||'')==='active'){
              action='<button class="row-action danger delete-document" type="button" data-document-id="'+
                escapeHtml(doc.documentId)+'" data-document-title="'+escapeHtml(title)+'">検索から外す</button>';
            }else{
              action='<span class="table-muted">'+
                (['expired','source_missing'].includes(String(doc.status||''))?'検索対象外':'処理・確認中')+
                '</span>';
            }
          }

          return `
            <tr class="${deleted?'is-deleted-row':''}">
              <td>
                <strong>${escapeHtml(title)}</strong>
                <small>${escapeHtml(doc.sourceId || '')}</small>
              </td>
              <td>${escapeHtml(doc.categoryName || '—')}</td>
              <td>${escapeHtml(doc.versionLabel || ('rev '+doc.revisionNo))}</td>
              <td><span class="status-pill ${!deleted&&doc.status==='active'?'ok':''}">${escapeHtml(displayStatus)}</span></td>
              <td>${escapeHtml(doc.approvalStatus || '—')}</td>
              <td>${Number(doc.activeChunkCount||0).toLocaleString()}</td>
              <td>${formatDate(doc.updatedAt)}</td>
              <td>${action}</td>
            </tr>
          `;
        }).join('');
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

  const ACCEPTANCE_SOURCE_ID='step5-test-step6-acceptance-v1';
  const ACCEPTANCE_TITLE='STEP6-1 最終受入テスト';
  const ACCEPTANCE_POSITIVE_QUERY='受入コードS61の確認日はいつですか？';
  const ACCEPTANCE_NEGATIVE_QUERY='不存在コードS61-Z999の集合場所はどこですか？';
  const ACCEPTANCE_MANUAL_KEY='takasagoStep61ManualAcceptance';
  const ACCEPTANCE_MANUAL_IDS=[
    'staff_login',
    'real_positive',
    'followup',
    'real_negative',
    'revision',
    'maintenance',
    'backup'
  ];

  function loadAcceptanceManualState(){
    let saved={};
    try{
      saved=JSON.parse(localStorage.getItem(ACCEPTANCE_MANUAL_KEY)||'{}')||{};
    }catch{}
    state.acceptance.manual={};
    for(const id of ACCEPTANCE_MANUAL_IDS){
      state.acceptance.manual[id]=Boolean(saved[id]);
    }
    (Array.isArray(nodes.acceptanceManualChecks) ? nodes.acceptanceManualChecks : [])
      .forEach(input=>{
        input.checked=Boolean(state.acceptance.manual[input.dataset.acceptanceManual]);
      });
  }

  function saveAcceptanceManualState(){
    localStorage.setItem(
      ACCEPTANCE_MANUAL_KEY,
      JSON.stringify(state.acceptance.manual)
    );
  }

  function setAcceptanceProgress(title,text,visible=true){
    if(nodes.acceptanceProgress) nodes.acceptanceProgress.hidden=!visible;
    if(nodes.acceptanceProgressTitle) nodes.acceptanceProgressTitle.textContent=title;
    if(nodes.acceptanceProgressText) nodes.acceptanceProgressText.textContent=text;
  }

  function acceptanceCheck(id,label,passed,detail='',required=true){
    const item={
      id:String(id),
      label:String(label),
      passed:Boolean(passed),
      detail:String(detail||''),
      required:Boolean(required)
    };
    const index=state.acceptance.autoChecks.findIndex(x=>x.id===item.id);
    if(index>=0) state.acceptance.autoChecks[index]=item;
    else state.acceptance.autoChecks.push(item);
    renderAcceptanceAutoChecks();
    updateAcceptanceVerdict();
    return item.passed;
  }

  function renderAcceptanceAutoChecks(){
    if(!nodes.acceptanceAutoChecks) return;
    const checks=state.acceptance.autoChecks;
    nodes.acceptanceAutoChecks.innerHTML=checks.map(check=>`
      <div class="acceptance-check ${check.passed?'is-pass':'is-fail'}">
        <span class="acceptance-check-icon">${check.passed?'✓':'!'}</span>
        <div>
          <strong>${escapeHtml(check.label)}</strong>
          <p>${escapeHtml(check.detail||'')}</p>
        </div>
        <b>${check.passed?'PASS':'FAIL'}</b>
      </div>
    `).join('') || '<p class="empty-message">まだ自動テストを実行していません。</p>';
  }

  function renderAcceptanceReadiness(readiness,jobs=[]){
    state.acceptance.readiness=readiness||null;
    if(!nodes.acceptanceReadinessChecks) return;

    const r=readiness||{};
    const checks=r.checks||{};
    const activeProblemJobs=(Array.isArray(jobs)?jobs:[])
      .filter(job=>job.status==='failed' || job.stalled===true);

    const rows=[
      {
        id:'staff_schoolwide',
        label:'一般職員認証',
        passed:Boolean(checks.staffAuthSchoolwide),
        detail:checks.staffAuthSchoolwide
          ? 'STAFF_EMAILS または STAFF_DOMAINS が設定済みです。'
          : '一般職員向けの許可設定がまだありません。'
      },
      {
        id:'real_documents',
        label:'承認済み実資料',
        passed:Boolean(checks.approvedDocuments),
        detail:checks.approvedDocuments
          ? 'テスト資料を除く承認済み有効資料があります。'
          : 'テスト資料を除く承認済み実資料がありません。'
      },
      {
        id:'real_chunks',
        label:'実資料の検索チャンク',
        passed:Boolean(checks.activeChunks),
        detail:checks.activeChunks
          ? '実資料のactive/readyチャンクがあります。'
          : '実資料のactive/readyチャンクがありません。'
      },
      {
        id:'legacy_retired',
        label:'旧KV公開経路',
        passed:Boolean(checks.legacyKvPublicRetired),
        detail:checks.legacyKvPublicRetired
          ? '旧KV FAQ公開経路は退役済みです。'
          : '旧KV FAQ公開経路を確認してください。'
      },
      {
        id:'jobs_clean',
        label:'失敗・停滞ジョブ',
        passed:activeProblemJobs.length===0,
        detail:activeProblemJobs.length===0
          ? 'failed / 24時間以上停滞のジョブはありません。'
          : activeProblemJobs.length+'件のジョブを確認してください。'
      }
    ];

    nodes.acceptanceReadinessChecks.innerHTML=rows.map(item=>`
      <div class="acceptance-check ${item.passed?'is-pass':'is-fail'}">
        <span class="acceptance-check-icon">${item.passed?'✓':'!'}</span>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <p>${escapeHtml(item.detail)}</p>
        </div>
        <b>${item.passed?'PASS':'要確認'}</b>
      </div>
    `).join('');

    const passed=Boolean(r.schoolwideReady) && activeProblemJobs.length===0;
    if(nodes.acceptanceReadinessBadge){
      nodes.acceptanceReadinessBadge.textContent=passed?'PASS':'要確認';
      nodes.acceptanceReadinessBadge.classList.toggle('accent',passed);
    }
    if(nodes.acceptanceReadinessSummary){
      nodes.acceptanceReadinessSummary.textContent=passed?'PASS':'未完了';
    }
    updateAcceptanceVerdict();
  }

  function acceptanceManualPassed(){
    return ACCEPTANCE_MANUAL_IDS.every(id=>Boolean(state.acceptance.manual[id]));
  }

  function acceptanceAutoPassed(){
    const required=state.acceptance.autoChecks.filter(x=>x.required!==false);
    return required.length>0 && required.every(x=>x.passed);
  }

  function acceptanceReadinessPassed(){
    const r=state.acceptance.readiness||{};
    return Boolean(r.schoolwideReady) &&
      Boolean(r.checks?.approvedDocuments) &&
      Boolean(r.checks?.activeChunks) &&
      Boolean(r.checks?.staffAuthSchoolwide) &&
      Boolean(r.checks?.legacyKvPublicRetired);
  }

  function buildAcceptanceReport(){
    const manual=ACCEPTANCE_MANUAL_IDS.map(id=>({
      id,
      passed:Boolean(state.acceptance.manual[id])
    }));
    const report={
      schema:'takasago-jhs-komu-ai-step6-acceptance-v1',
      generatedAt:new Date().toISOString(),
      step:'STEP6-1',
      containsSecrets:false,
      containsDocumentText:false,
      automaticPassed:acceptanceAutoPassed(),
      schoolwideReady:acceptanceReadinessPassed(),
      manualPassed:acceptanceManualPassed(),
      overallPassed:
        acceptanceAutoPassed() &&
        acceptanceReadinessPassed() &&
        acceptanceManualPassed(),
      automaticChecks:state.acceptance.autoChecks.map(x=>({
        id:x.id,
        label:x.label,
        passed:x.passed,
        detail:x.detail,
        required:x.required
      })),
      readiness:{
        schoolwideReady:Boolean(state.acceptance.readiness?.schoolwideReady),
        checks:state.acceptance.readiness?.checks||{},
        counts:state.acceptance.readiness?.counts||{},
        warnings:state.acceptance.readiness?.warnings||[]
      },
      manualChecks:manual
    };
    state.acceptance.lastReport=report;
    return report;
  }

  function updateAcceptanceVerdict(){
    const auto=acceptanceAutoPassed();
    const readiness=acceptanceReadinessPassed();
    const manual=acceptanceManualPassed();
    const manualCount=ACCEPTANCE_MANUAL_IDS.filter(id=>state.acceptance.manual[id]).length;
    const overall=auto&&readiness&&manual;

    if(nodes.acceptanceAutoSummary){
      nodes.acceptanceAutoSummary.textContent=
        state.acceptance.autoChecks.length ? (auto?'PASS':'要確認') : '未実行';
    }
    if(nodes.acceptanceAutoBadge){
      nodes.acceptanceAutoBadge.textContent=
        state.acceptance.autoChecks.length ? (auto?'PASS':'要確認') : '未実行';
      nodes.acceptanceAutoBadge.classList.toggle('accent',auto);
    }
    if(nodes.acceptanceManualSummary){
      nodes.acceptanceManualSummary.textContent=manualCount+' / '+ACCEPTANCE_MANUAL_IDS.length;
    }
    if(nodes.acceptanceManualBadge){
      nodes.acceptanceManualBadge.textContent=manualCount+' / '+ACCEPTANCE_MANUAL_IDS.length;
      nodes.acceptanceManualBadge.classList.toggle('accent',manual);
    }

    if(nodes.acceptanceVerdict){
      nodes.acceptanceVerdict.textContent=overall
        ? '本番公開条件を満たしています'
        : (auto ? '本番公開条件を確認中' : '受入テスト未完了');
      nodes.acceptanceVerdict.classList.toggle('is-pass',overall);
    }

    if(nodes.acceptanceNote){
      if(overall){
        nodes.acceptanceNote.textContent=
          '自動テスト・本番データ条件・手動確認がすべてPASSです。監査ログへ合格結果を記録できます。';
      }else if(auto && !readiness){
        nodes.acceptanceNote.textContent=
          'システム自体の受入テストはPASSです。実資料または一般職員認証など、本番データ条件を完了してください。';
      }else if(auto && readiness && !manual){
        nodes.acceptanceNote.textContent=
          '自動条件は揃っています。実職員・実資料による手動確認をすべて完了してください。';
      }else{
        nodes.acceptanceNote.textContent=
          'すべての条件が揃うまで一般職員公開の最終判定は行いません。';
      }
    }

    if(nodes.recordAcceptanceResult) nodes.recordAcceptanceResult.disabled=!overall;
    if(nodes.downloadAcceptanceReport){
      nodes.downloadAcceptanceReport.disabled=
        !state.acceptance.lastReport && state.acceptance.autoChecks.length===0;
    }
    if(state.acceptance.autoChecks.length){
      buildAcceptanceReport();
    }
  }

  async function cleanupAcceptanceSource(){
    try{
      await authJson('/admin/rag/test-source-cleanup',{
        method:'POST',
        body:JSON.stringify({sourceId:ACCEPTANCE_SOURCE_ID})
      });
      return true;
    }catch(err){
      console.warn('acceptance cleanup failed',err);
      return false;
    }
  }

  async function runFinalAcceptanceSuite(){
    if(!state.authenticated){
      showToast('管理者ログインが必要です。');
      return;
    }
    if(state.acceptance.running) return;

    state.acceptance.running=true;
    state.acceptance.autoChecks=[];
    state.acceptance.lastReport=null;
    renderAcceptanceAutoChecks();
    renderProtectedViews();

    let acceptanceDocumentId='';
    let cleanupPassed=false;

    try{
      setAcceptanceProgress('基盤確認','Worker・D1・Vectorize・Evidence Gate・認証を確認しています。',true);

      const [worker,d1,vector,gate,readiness,staffAuth,jobsData]=await Promise.all([
        getJson('/health'),
        getJson('/health/rag-db'),
        getJson('/health/rag-vector'),
        getJson('/health/rag-gate'),
        getJson('/health/production-readiness'),
        getJson('/health/staff-auth'),
        authJson('/admin/rag/jobs?limit=100')
      ]);

      acceptanceCheck(
        'worker',
        'Worker稼働',
        Boolean(worker?.ok && String(worker?.version||'').startsWith('6.1')),
        'version '+String(worker?.version||'不明')
      );
      acceptanceCheck(
        'd1',
        'D1スキーマ',
        Boolean(d1?.ragDb?.configured && d1?.ragDb?.schemaReady),
        d1?.ragDb?.schemaReady?'schema ready':'schemaを確認してください'
      );
      acceptanceCheck(
        'vector',
        'Vectorize / Embedding',
        Boolean(vector?.ragVector?.configured && vector?.ragVector?.geminiEmbedding),
        vector?.ragVector?.configured?'Vectorize接続済み':'Vectorize未設定'
      );
      acceptanceCheck(
        'gate',
        'Evidence Gate',
        Boolean(gate?.ragGate?.configured),
        gate?.ragGate?.configured?'有効':'設定を確認してください'
      );

      const adminMe=await authJson('/admin/auth/me');
      acceptanceCheck(
        'admin_auth',
        'Google管理者認証',
        Boolean(adminMe?.admin?.authenticated),
        adminMe?.admin?.authenticated?'Worker検証済み':'管理者認証に失敗'
      );

      const staffMe=await authJson('/staff/auth/me');
      acceptanceCheck(
        'staff_auth_pilot',
        '職員FAQ認証（管理者fallback）',
        Boolean(staffMe?.staff?.authenticated),
        staffMe?.staff?.authenticated?'FAQ利用者として検証済み':'職員FAQ認証に失敗'
      );

      const readinessObj=readiness?.readiness||{};
      acceptanceCheck(
        'ai_provider',
        'AIプロバイダー',
        Number(readinessObj?.counts?.aiProviders||0)>0,
        Number(readinessObj?.counts?.aiProviders||0)+' provider'
      );
      acceptanceCheck(
        'legacy_retired',
        '旧KV公開経路の退役',
        Boolean(readinessObj?.checks?.legacyKvPublicRetired),
        readinessObj?.checks?.legacyKvPublicRetired?'retired':'要確認'
      );

      const jobs=Array.isArray(jobsData?.result?.jobs)?jobsData.result.jobs:[];
      const badJobs=jobs.filter(job=>
        (job.status==='failed' || job.stalled===true) &&
        String(job.sourceId||'')!==ACCEPTANCE_SOURCE_ID
      );
      acceptanceCheck(
        'jobs_clean',
        '失敗・停滞ジョブなし',
        badJobs.length===0,
        badJobs.length===0?'問題なし':badJobs.length+'件を確認してください'
      );

      const backup=await authJson('/admin/rag/backup-manifest');
      const manifest=backup?.result||{};
      acceptanceCheck(
        'backup_safety',
        'バックアップ安全仕様',
        manifest.containsChunkText===false && manifest.containsSecrets===false,
        '本文・秘密情報を含まないマニフェスト'
      );

      renderAcceptanceReadiness(readinessObj,jobs);

      setAcceptanceProgress('前回テストの後片付け','同じ受入テスト資料が残っていない状態にします。',true);
      await cleanupAcceptanceSource();

      setAcceptanceProgress('架空資料を登録','STEP6-1専用の架空資料をD1へstagingしています。',true);
      const staged=await authJson('/admin/rag/stage',{
        method:'POST',
        body:JSON.stringify({
          sourceId:ACCEPTANCE_SOURCE_ID,
          sourceType:'upload',
          fileName:'STEP6-1_最終受入テスト.txt',
          title:ACCEPTANCE_TITLE,
          mimeType:'text/plain',
          categoryId:'cat-other',
          ownerDepartment:'STEP6-1自動受入',
          versionLabel:'acceptance-v1',
          approved:true,
          sections:[{
            headingPath:'最終受入 > 受入コードS61',
            text:[
              'これはSTEP6-1最終受入確認専用の架空資料です。',
              '受入コードS61の確認日は木曜日です。',
              '確認後は受入記録欄に「完了」と記載します。',
              '実際の校内規則ではありません。'
            ].join('\n\n')
          }]
        })
      });
      acceptanceDocumentId=String(staged?.result?.documentId||'');
      acceptanceCheck(
        'stage',
        '架空資料のstaging',
        Boolean(acceptanceDocumentId),
        acceptanceDocumentId?'document作成済み':'documentIdを取得できません'
      );
      if(!acceptanceDocumentId) throw new Error('受入テスト用documentIdを取得できませんでした。');

      setAcceptanceProgress('Embedding・Vectorize','架空資料を検索可能な状態まで処理しています。',true);
      await completeDocumentActivation(acceptanceDocumentId,'STEP6-1受入資料');
      acceptanceCheck(
        'activate',
        'Embedding・Vectorize・FTS5・有効化',
        true,
        'active/currentまで完了'
      );

      setAcceptanceProgress('検索テスト','Hybrid検索とEvidence Gateを確認しています。',true);
      const positiveSearch=await authJson('/admin/rag/retrieval-test',{
        method:'POST',
        body:JSON.stringify({query:ACCEPTANCE_POSITIVE_QUERY})
      });
      const positiveResult=positiveSearch?.result||{};
      const positiveEvidence=Array.isArray(positiveResult?.evidence)?positiveResult.evidence:[];
      const evidenceOwn=positiveEvidence.some(ev=>
        String(ev?.sourceId||'')===ACCEPTANCE_SOURCE_ID ||
        String(ev?.title||'')===ACCEPTANCE_TITLE
      );
      acceptanceCheck(
        'positive_retrieval',
        'Hybrid検索・Evidence Gate',
        Boolean(positiveResult?.hasUsableEvidence && evidenceOwn),
        positiveResult?.hasUsableEvidence?'受入資料を根拠として採用':'根拠を採用できませんでした'
      );

      setAcceptanceProgress('AI回答テスト','根拠付き回答と出典カードを確認しています。',true);
      const answerData=await authJson('/admin/rag/answer-test',{
        method:'POST',
        body:JSON.stringify({query:ACCEPTANCE_POSITIVE_QUERY})
      });
      const answer=answerData?.result||{};
      const answerSources=Array.isArray(answer?.sources)?answer.sources:[];
      const answerSourceOwn=answerSources.some(src=>
        String(src?.sourceId||'')===ACCEPTANCE_SOURCE_ID ||
        String(src?.title||'')===ACCEPTANCE_TITLE
      );
      const answerOk=
        answer.status==='answer' &&
        answer.aiCalled===true &&
        String(answer.answer||'').includes('木曜日') &&
        answerSourceOwn;
      acceptanceCheck(
        'grounded_answer',
        'AI回答・根拠資料カード',
        answerOk,
        answerOk
          ? '「木曜日」を回答し、D1由来の受入資料を出典に採用'
          : '回答内容または根拠資料を確認してください'
      );

      setAcceptanceProgress('拒否テスト','登録資料にない質問でAIを呼ばないことを確認しています。',true);
      const negativeData=await authJson('/admin/rag/answer-test',{
        method:'POST',
        body:JSON.stringify({query:ACCEPTANCE_NEGATIVE_QUERY})
      });
      const negative=negativeData?.result||{};
      const negativeOk=
        negative.status==='insufficient' &&
        negative.aiCalled===false;
      acceptanceCheck(
        'negative_gate',
        '未登録質問の拒否',
        negativeOk,
        negativeOk
          ? 'Evidence Gateで停止しAI未呼び出し'
          : '未登録質問への挙動を確認してください'
      );

      setAcceptanceProgress('論理削除テスト','検索対象から外れることを確認しています。',true);
      await authJson('/admin/rag/document-delete',{
        method:'POST',
        body:JSON.stringify({documentId:acceptanceDocumentId})
      });
      await new Promise(resolve=>setTimeout(resolve,900));
      const afterDeleteData=await authJson('/admin/rag/retrieval-test',{
        method:'POST',
        body:JSON.stringify({query:ACCEPTANCE_POSITIVE_QUERY})
      });
      const afterDelete=afterDeleteData?.result||{};
      acceptanceCheck(
        'soft_delete',
        '論理削除後の検索除外',
        afterDelete.hasUsableEvidence===false,
        afterDelete.hasUsableEvidence===false
          ? '削除済み資料は検索根拠になりません'
          : '削除後も検索されるため要確認'
      );

      setAcceptanceProgress('復旧テスト','同じrevisionを再Embeddingして戻しています。',true);
      await authJson('/admin/rag/document-restore',{
        method:'POST',
        body:JSON.stringify({documentId:acceptanceDocumentId})
      });
      await completeDocumentActivation(acceptanceDocumentId,'STEP6-1復旧資料');
      const afterRestoreData=await authJson('/admin/rag/retrieval-test',{
        method:'POST',
        body:JSON.stringify({query:ACCEPTANCE_POSITIVE_QUERY})
      });
      const afterRestore=afterRestoreData?.result||{};
      acceptanceCheck(
        'restore',
        '論理削除からの復旧',
        Boolean(afterRestore.hasUsableEvidence),
        afterRestore.hasUsableEvidence
          ? '再Embedding後に検索へ復帰'
          : '復旧後の検索を確認してください'
      );

    }catch(err){
      console.error('STEP6-1 acceptance failed',err);
      acceptanceCheck(
        'suite_runtime',
        '自動受入テスト実行',
        false,
        err?.message||'受入テスト中にエラーが発生しました。'
      );
    }finally{
      setAcceptanceProgress('後片付け','受入確認用の架空資料を削除しています。',true);
      cleanupPassed=await cleanupAcceptanceSource();
      acceptanceCheck(
        'cleanup',
        '架空受入資料の後片付け',
        cleanupPassed,
        cleanupPassed?'D1・FTS5・Vectorizeのテスト資料を削除':'テスト資料の後片付けを確認してください'
      );

      state.acceptance.running=false;
      renderProtectedViews();

      try{
        const [readiness,jobsData]=await Promise.all([
          getJson('/health/production-readiness'),
          authJson('/admin/rag/jobs?limit=100')
        ]);
        renderAcceptanceReadiness(
          readiness?.readiness||{},
          Array.isArray(jobsData?.result?.jobs)?jobsData.result.jobs:[]
        );
      }catch(err){
        console.warn('acceptance readiness refresh failed',err);
      }

      buildAcceptanceReport();
      updateAcceptanceVerdict();
      if(nodes.downloadAcceptanceReport) nodes.downloadAcceptanceReport.disabled=false;

      const passed=acceptanceAutoPassed();
      setAcceptanceProgress(
        passed?'自動受入テスト PASS':'自動受入テスト 要確認',
        passed
          ? '架空資料による登録・検索・回答・拒否・削除・復旧・後片付けまで完了しました。'
          : 'FAIL項目を確認してください。実資料には影響していません。',
        true
      );

      await Promise.allSettled([loadDocuments(),loadJobs(),loadAuditLogs(),refreshAll()]);
    }
  }

  function downloadAcceptanceReport(){
    const report=buildAcceptanceReport();
    const blob=new Blob(
      [JSON.stringify(report,null,2)],
      {type:'application/json;charset=utf-8'}
    );
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    a.href=url;
    a.download='takasago-jhs-step6-1-acceptance-'+stamp+'.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('STEP6-1受入レポートを保存しました。',3600);
  }

  async function recordAcceptanceResult(){
    const report=buildAcceptanceReport();
    if(!report.overallPassed){
      showToast('すべての本番公開条件がPASSになるまで合格記録はできません。',4200);
      return;
    }

    try{
      const checks=[
        ...report.automaticChecks.map(x=>({id:'auto:'+x.id,passed:x.passed})),
        ...Object.entries(report.readiness.checks||{}).map(([id,passed])=>({
          id:'readiness:'+id,
          passed:Boolean(passed)
        })),
        ...report.manualChecks.map(x=>({id:'manual:'+x.id,passed:x.passed}))
      ];

      await authJson('/admin/rag/acceptance-record',{
        method:'POST',
        body:JSON.stringify({
          status:'passed',
          automaticPassed:report.automaticPassed,
          manualPassed:report.manualPassed,
          schoolwideReady:report.schoolwideReady,
          checks
        })
      });
      showToast('STEP6-1合格結果を監査ログへ記録しました。',4200);
      await loadAuditLogs();
    }catch(err){
      console.error(err);
      showToast(err?.message||'受入結果を記録できませんでした。',4200);
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

  async function runMaintenanceNowAdmin(){
    if(!state.authenticated){
      showToast('管理者ログインが必要です。');
      return;
    }

    if(nodes.runMaintenance){
      nodes.runMaintenance.disabled=true;
      nodes.runMaintenance.textContent='点検中…';
    }

    try{
      const data=await authJson('/admin/rag/maintenance',{
        method:'POST',
        body:JSON.stringify({})
      });
      const r=data?.result||{};

      if(nodes.maintenanceResult){
        nodes.maintenanceResult.hidden=false;
        nodes.maintenanceResult.textContent=
          '期限切れ除外 '+Number(r.expiredCount||0)+'件 ／ '+
          '24時間以上停滞しているジョブ '+Number(r.stalledJobCount||0)+'件';
      }

      showToast('RAGメンテナンスを実行しました。');
      await Promise.allSettled([refreshAll(),loadDocuments(),loadAuditLogs()]);
    }catch(err){
      console.error(err);
      showToast(err?.message||'メンテナンスに失敗しました。',4200);
    }finally{
      if(nodes.runMaintenance){
        nodes.runMaintenance.disabled=false;
        nodes.runMaintenance.textContent='期限・状態を今すぐ点検';
      }
    }
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
  nodes.refreshAudit?.addEventListener('click',loadAuditLogs);
  nodes.refreshJobs?.addEventListener('click',loadJobs);
  nodes.downloadBackup?.addEventListener('click',downloadBackupManifest);
  nodes.runAcceptanceSuite?.addEventListener('click',runFinalAcceptanceSuite);
  nodes.downloadAcceptanceReport?.addEventListener('click',downloadAcceptanceReport);
  nodes.recordAcceptanceResult?.addEventListener('click',recordAcceptanceResult);
  (Array.isArray(nodes.acceptanceManualChecks) ? nodes.acceptanceManualChecks : [])
    .forEach(input=>{
    input.addEventListener('change',()=>{
      state.acceptance.manual[input.dataset.acceptanceManual]=Boolean(input.checked);
      saveAcceptanceManualState();
      updateAcceptanceVerdict();
    });
  });

  nodes.documentsBody?.addEventListener('click',(event)=>{
    const deleteButton=event.target.closest('.delete-document');
    if(deleteButton){
      softDeleteDocument(
        deleteButton.dataset.documentId,
        deleteButton.dataset.documentTitle||'資料'
      );
      return;
    }

    const restoreButton=event.target.closest('.restore-document');
    if(restoreButton){
      restoreDocument(
        restoreButton.dataset.documentId,
        restoreButton.dataset.documentTitle||'資料'
      );
    }
  });

  nodes.jobsBody?.addEventListener('click',(event)=>{
    const button=event.target.closest('.retry-job');
    if(button) retryJob(button.dataset.jobId);
  });
  nodes.refreshDriveStatus?.addEventListener('click',loadDocuments);
  nodes.runMaintenance?.addEventListener('click',runMaintenanceNowAdmin);
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
    if(nodes.auditBody) nodes.auditBody.innerHTML='<tr><td colspan="4">管理者ログイン後に表示します。</td></tr>';
    if(nodes.jobsBody) nodes.jobsBody.innerHTML='<tr><td colspan="5">管理者ログイン後に表示します。</td></tr>';
    if(nodes.driveSyncBody) nodes.driveSyncBody.innerHTML='<tr><td colspan="5">管理者ログイン後に表示します。</td></tr>';
    if(nodes.searchResultGrid) nodes.searchResultGrid.hidden=true;
    state.acceptance.running=false;
    renderAuthState();
    renderGoogleButton();
    showToast('ログアウトしました。');
  });

  loadAcceptanceManualState();
  updateAcceptanceVerdict();

  const existingTestId=sessionStorage.getItem('step58AdminTestDocumentId');
  if(existingTestId && nodes.cleanupAdminTest) nodes.cleanupAdminTest.hidden=false;

  initializeAdminAuth();
  refreshAll();
})();