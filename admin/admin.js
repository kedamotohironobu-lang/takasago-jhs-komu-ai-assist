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
    improvement:null,
    improvementActions:null,
    monthlyReport:null,
    quality:{
      cases:[],
      results:[],
      running:false,
      lastReport:null,
      lastRunAt:''
    },
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
    acceptanceManualChecks:$$('[data-acceptance-manual]'),
    qualityAuthRequired:$('#quality-auth-required'),
    qualityContent:$('#quality-content'),
    runQualitySuite:$('#run-quality-suite'),
    downloadQualityCsv:$('#download-quality-csv'),
    downloadQualityJson:$('#download-quality-json'),
    qualityBody:$('#quality-body'),
    qualityProgress:$('#quality-progress'),
    qualityProgressText:$('#quality-progress-text'),
    qualityAnalysisNote:$('#quality-analysis-note'),
    usageAuthRequired:$('#usage-auth-required'),
    usageContent:$('#usage-content'),
    refreshUsage:$('#refresh-usage'),
    usageTopDocuments:$('#usage-top-documents'),
    usageProviders:$('#usage-providers'),
    usageTools:$('#usage-tools'),
    usageFeedbackReasons:$('#usage-feedback-reasons'),
    operationsHealthBadge:$('#operations-health-badge'),
    operationsAlerts:$('#operations-alerts'),
    improvementAuthRequired:$('#improvement-auth-required'),
    improvementContent:$('#improvement-content'),
    refreshImprovement:$('#refresh-improvement'),
    downloadImprovementReport:$('#download-improvement-report'),
    improvementList:$('#improvement-list'),
    improvementSummaryBadge:$('#improvement-summary-badge'),
    improvementCycleBody:$('#improvement-cycle-body'),
    refreshImprovementActions:$('#refresh-improvement-actions'),
    monthlyAuthRequired:$('#monthly-auth-required'),
    monthlyContent:$('#monthly-content'),
    monthlyReportMonth:$('#monthly-report-month'),
    generateMonthlyReport:$('#generate-monthly-report'),
    printMonthlyReport:$('#print-monthly-report'),
    downloadMonthlyReport:$('#download-monthly-report'),
    refreshAutomationStatus:$('#refresh-automation-status'),
    automationRunBadge:$('#automation-run-badge'),
    automationRunNote:$('#automation-run-note')
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

  function versionAtLeast(value,major,minor,patch=0){
    const parts=String(value||'')
      .split('.')
      .slice(0,3)
      .map(v=>Number.parseInt(v,10)||0);
    while(parts.length<3) parts.push(0);

    if(parts[0]!==major) return parts[0]>major;
    if(parts[1]!==minor) return parts[1]>minor;
    return parts[2]>=patch;
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
    if(nodes.qualityAuthRequired) nodes.qualityAuthRequired.hidden=unlocked;
    if(nodes.qualityContent) nodes.qualityContent.hidden=!unlocked;
    if(nodes.runQualitySuite) nodes.runQualitySuite.disabled=!unlocked || state.quality.running;
    if(nodes.downloadQualityCsv) nodes.downloadQualityCsv.disabled=!unlocked || !state.quality.lastReport;
    if(nodes.downloadQualityJson) nodes.downloadQualityJson.disabled=!unlocked || !state.quality.lastReport;
    if(nodes.usageAuthRequired) nodes.usageAuthRequired.hidden=unlocked;
    if(nodes.usageContent) nodes.usageContent.hidden=!unlocked;
    if(nodes.refreshUsage) nodes.refreshUsage.disabled=!unlocked;
    if(nodes.improvementAuthRequired) nodes.improvementAuthRequired.hidden=unlocked;
    if(nodes.improvementContent) nodes.improvementContent.hidden=!unlocked;
    if(nodes.refreshImprovement) nodes.refreshImprovement.disabled=!unlocked;
    if(nodes.downloadImprovementReport) nodes.downloadImprovementReport.disabled=!unlocked || !state.improvement;
    if(nodes.monthlyAuthRequired) nodes.monthlyAuthRequired.hidden=unlocked;
    if(nodes.monthlyContent) nodes.monthlyContent.hidden=!unlocked;
    if(nodes.generateMonthlyReport) nodes.generateMonthlyReport.disabled=!unlocked;
    if(nodes.printMonthlyReport) nodes.printMonthlyReport.disabled=!unlocked || !state.monthlyReport;
    if(nodes.downloadMonthlyReport) nodes.downloadMonthlyReport.disabled=!unlocked || !state.monthlyReport;
    if(nodes.refreshAutomationStatus) nodes.refreshAutomationStatus.disabled=!unlocked;
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
        loadUsageAnalytics();
        loadImprovementCandidates();
        loadImprovementActions();
        loadAutomationStatusAdmin();
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

  function normalizeQualityText(value){
    return String(value||'')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s_\-‐‑‒–—―]+/g,'');
  }

  function clipQualityText(value,max=150){
    const text=String(value||'').replace(/\s+/g,' ').trim();
    return text.length>max ? text.slice(0,max)+'…' : text;
  }

  async function loadQualityCases(){
    if(state.quality.cases.length) return state.quality.cases;
    const res=await fetch('quality-test-cases.json',{cache:'no-store'});
    if(!res.ok) throw new Error('50問テストセットを読み込めませんでした。');
    const data=await res.json();
    const cases=Array.isArray(data?.cases)?data.cases:[];
    if(cases.length!==50) throw new Error('50問テストセットの件数が正しくありません。');
    state.quality.cases=cases;
    setText('quality-total',cases.length);
    renderQualityResults();
    return cases;
  }

  function qualityCandidateSourceMatches(testCase,candidate){
    const expected=normalizeQualityText(testCase?.expectedSourceContains||testCase?.document||'');
    const actual=normalizeQualityText(candidate?.title||candidate?.fileName||'');
    return Boolean(expected) && Boolean(actual) && actual.includes(expected);
  }

  function classifyQualityFailure(testCase,result,errorMessage=''){
    if(errorMessage){
      return {
        failureClass:'api_auth',
        failureLabel:'API・認証/通信',
        recommendation:'認証状態・Worker応答・ネットワークを確認し、品質判定は再実行してください。'
      };
    }

    const expectedMode=String(testCase?.expectedMode||'answer');
    const status=String(result?.status||'');
    const aiCalled=Boolean(result?.aiCalled);
    const sources=Array.isArray(result?.sources)?result.sources:[];
    const candidates=Array.isArray(result?.retrieval?.diagnostics?.fusedCandidates)
      ? result.retrieval.diagnostics.fusedCandidates
      : [];

    if(expectedMode==='insufficient'){
      if(status==='answer' || sources.length){
        return {
          failureClass:'negative_answered',
          failureLabel:'根拠なし誤回答',
          recommendation:'最優先確認。誤って採用された根拠候補と質問の語句重複を確認してください。'
        };
      }
      if(aiCalled){
        return {
          failureClass:'gate_overpass',
          failureLabel:'Evidence Gate',
          recommendation:'最終回答は拒否できていますがAIまで到達しています。採用候補とGate理由を確認してください。'
        };
      }
      return {failureClass:'',failureLabel:'',recommendation:''};
    }

    if(status==='answer'){
      const expected=normalizeQualityText(testCase?.expectedSourceContains||'');
      const sourceOk=Boolean(expected) && sources.some(src=>
        normalizeQualityText(src?.title||src?.fileName||'').includes(expected)
      );
      if(!sourceOk){
        return {
          failureClass:'wrong_source',
          failureLabel:'根拠資料違い',
          recommendation:'重複資料・旧版・似た表現を確認し、想定資料がcurrent/active/approvedか確認してください。'
        };
      }
      return {failureClass:'',failureLabel:'',recommendation:''};
    }

    const expectedCandidates=candidates.filter(candidate=>
      qualityCandidateSourceMatches(testCase,candidate)
    );
    const acceptedExpected=expectedCandidates.filter(candidate=>Boolean(candidate?.accepted));

    if(aiCalled || acceptedExpected.length){
      return {
        failureClass:'ai_content',
        failureLabel:'AI・資料内容',
        recommendation:'根拠は採用されています。該当見出しに質問へ直接答える具体的記述があるか確認してください。'
      };
    }

    if(expectedCandidates.length){
      return {
        failureClass:'gate',
        failureLabel:'Evidence Gate',
        recommendation:'想定資料は検索候補です。vector/FTS順位・gateReasonを確認し、Gateを緩める前に見出しと本文を改善してください。'
      };
    }

    return {
      failureClass:'retrieval',
      failureLabel:'検索未到達',
      recommendation:'想定資料が上位候補にありません。登録状態、見出し、質問語との表現差、旧版・検索対象を確認してください。'
    };
  }
  function scoreQualityCase(testCase,result,errorMessage=''){
    if(errorMessage){
      return {
        testId:testCase.id,
        status:'error',
        answer:'',
        aiCalled:false,
        provider:'',
        reason:errorMessage,
        sources:[],
        sourceNames:[],
        autoPassed:false,
        autoJudge:'FAIL',
        reviewRequired:false,
        detail:'API実行エラー',
        failureClass:'api_auth',
        failureLabel:'API・認証/通信',
        recommendation:'認証状態・Worker応答・ネットワークを確認し、品質判定は再実行してください。',
        retrievalSummary:null
      };
    }

    const sources=Array.isArray(result?.sources)?result.sources:[];
    const sourceNames=sources.map(src=>String(src?.title||src?.fileName||'')).filter(Boolean);
    const expectedMode=String(testCase?.expectedMode||'answer');
    let autoPassed=false;
    let detail='';

    if(expectedMode==='insufficient'){
      autoPassed=
        result?.status==='insufficient' &&
        result?.aiCalled===false &&
        sources.length===0;
      detail=autoPassed
        ? 'Evidence Gateで停止・AI未呼び出し'
        : '根拠なし質問への拒否挙動を確認してください';
    }else{
      const expected=normalizeQualityText(testCase?.expectedSourceContains||'');
      const sourceOk=Boolean(expected) && sourceNames.some(name=>
        normalizeQualityText(name).includes(expected)
      );
      autoPassed=
        result?.status==='answer' &&
        result?.aiCalled===true &&
        Boolean(String(result?.answer||'').trim()) &&
        sourceOk;
      detail=autoPassed
        ? '回答あり・想定資料を根拠に採用'
        : !sourceOk
          ? '想定資料が根拠カードにありません'
          : '回答状態を確認してください';
    }

    const failure=autoPassed
      ? {failureClass:'',failureLabel:'',recommendation:''}
      : classifyQualityFailure(testCase,result,'');

    const fusedCandidates=Array.isArray(result?.retrieval?.diagnostics?.fusedCandidates)
      ? result.retrieval.diagnostics.fusedCandidates
      : [];
    const retrievalSummary={
      acceptedCount:Number(result?.retrieval?.diagnostics?.gate?.acceptedCount||0),
      expectedCandidateCount:fusedCandidates.filter(candidate=>qualityCandidateSourceMatches(testCase,candidate)).length,
      expectedAcceptedCount:fusedCandidates.filter(candidate=>
        qualityCandidateSourceMatches(testCase,candidate) && candidate?.accepted
      ).length
    };

    return {
      testId:testCase.id,
      status:String(result?.status||''),
      answer:String(result?.answer||''),
      aiCalled:Boolean(result?.aiCalled),
      provider:String(result?.provider||''),
      model:String(result?.model||''),
      reason:String(result?.reason||''),
      sources,
      sourceNames,
      autoPassed,
      autoJudge:autoPassed?'PASS候補':'FAIL',
      reviewRequired:autoPassed && expectedMode==='answer',
      detail,
      failureClass:failure.failureClass,
      failureLabel:failure.failureLabel,
      recommendation:failure.recommendation,
      retrievalSummary
    };
  }

  function renderQualityResults(){
    if(!nodes.qualityBody) return;
    const cases=state.quality.cases||[];
    const results=new Map((state.quality.results||[]).map(item=>[Number(item.testId),item]));

    if(!cases.length){
      nodes.qualityBody.innerHTML='<tr><td colspan="8">テストセットを読み込んでいます。</td></tr>';
      return;
    }

    nodes.qualityBody.innerHTML=cases.map(testCase=>{
      const r=results.get(Number(testCase.id));
      const resultText=!r
        ? '未実施'
        : r.status==='error'
          ? clipQualityText(r.reason||'実行エラー',120)
          : (r.status==='insufficient'
              ? '登録資料では確認できません。'
              : clipQualityText(r.answer,150));
      const sourceText=!r
        ? '—'
        : (r.sourceNames?.length ? r.sourceNames.join(' / ') : 'なし');
      const judge=!r ? '未実施' : r.autoJudge;
      const judgeClass=!r ? '' : (r.autoPassed?'ok':'error');

      return `
        <tr>
          <td>${Number(testCase.id)}</td>
          <td><strong>${escapeHtml(testCase.documentNo+' '+testCase.document)}</strong></td>
          <td>${escapeHtml(testCase.kind)}</td>
          <td>${escapeHtml(testCase.question)}</td>
          <td>${escapeHtml(resultText)}</td>
          <td>${escapeHtml(sourceText)}</td>
          <td><span class="panel-badge ${judgeClass}">${escapeHtml(judge)}</span></td>
          <td>${r?.failureLabel ? '<span class="quality-cause-pill">'+escapeHtml(r.failureLabel)+'</span>' : '—'}</td>
        </tr>
      `;
    }).join('');

    const completed=state.quality.results.length;
    const passed=state.quality.results.filter(r=>r.autoPassed).length;
    const failed=state.quality.results.filter(r=>!r.autoPassed).length;
    const review=state.quality.results.filter(r=>r.reviewRequired).length;

    setText('quality-pass',passed);
    setText('quality-fail',failed);
    setText('quality-review',review);

    const causeCounts={retrieval:0,gate:0,ai_content:0,wrong_source:0,negative_answered:0,api_auth:0};
    for(const result of state.quality.results){
      if(result?.failureClass && Object.prototype.hasOwnProperty.call(causeCounts,result.failureClass)){
        causeCounts[result.failureClass]++;
      }
      if(result?.failureClass==='gate_overpass') causeCounts.gate++;
    }
    setText('quality-cause-retrieval',causeCounts.retrieval);
    setText('quality-cause-gate',causeCounts.gate);
    setText('quality-cause-ai',causeCounts.ai_content);
    setText('quality-cause-source',causeCounts.wrong_source);
    setText('quality-cause-negative',causeCounts.negative_answered);
    setText('quality-cause-api',causeCounts.api_auth);

    if(nodes.qualityAnalysisNote){
      if(!completed){
        nodes.qualityAnalysisNote.textContent='50問テスト完了後、FAIL原因と優先対応をここに表示します。';
      }else if(causeCounts.api_auth){
        nodes.qualityAnalysisNote.textContent='API・認証/通信エラーを先に解消してください。この実行結果は品質基準として確定しません。';
      }else if(causeCounts.negative_answered){
        nodes.qualityAnalysisNote.textContent='根拠なし質問への誤回答があります。最優先で該当行を確認してください。';
      }else if(failed){
        const pairs=[
          ['検索未到達',causeCounts.retrieval],
          ['Evidence Gate',causeCounts.gate],
          ['AI・資料内容',causeCounts.ai_content],
          ['根拠資料違い',causeCounts.wrong_source]
        ].filter(([,count])=>count>0).sort((a,b)=>b[1]-a[1]);
        nodes.qualityAnalysisNote.textContent=pairs.length
          ? '主なFAIL原因：'+pairs.map(([label,count])=>label+' '+count+'件').join(' / ')+'。件数の多い原因から直します。'
          : 'FAIL行の詳細を確認してください。';
      }else{
        nodes.qualityAnalysisNote.textContent='自動条件はすべてクリアしています。回答本文を管理者が確認してください。';
      }
    }

    if(nodes.qualityProgress && !state.quality.running){
      nodes.qualityProgress.textContent=completed===0?'未実施':(completed===cases.length?'完了':completed+'/'+cases.length);
    }
  }

  function buildQualityReport(){
    const cases=state.quality.cases||[];
    const results=state.quality.results||[];
    const byId=new Map(results.map(item=>[Number(item.testId),item]));
    const rows=cases.map(testCase=>({
      ...testCase,
      result:byId.get(Number(testCase.id))||null
    }));
    const report={
      schema:'takasago-jhs-rag-quality-report-v1',
      step:'STEP8-5',
      generatedAt:new Date().toISOString(),
      lastRunAt:state.quality.lastRunAt||'',
      summary:{
        total:cases.length,
        completed:results.length,
        autoPassCandidates:results.filter(r=>r.autoPassed).length,
        failed:results.filter(r=>!r.autoPassed).length,
        semanticReviewRequired:results.filter(r=>r.reviewRequired).length,
        retriedRequests:results.filter(r=>Number(r?.retryAttempts||0)>0).length,
        totalRetryAttempts:results.reduce((sum,r)=>sum+Number(r?.retryAttempts||0),0),
        failureBreakdown:results.reduce((acc,r)=>{
          const key=String(r?.failureClass||'');
          if(key) acc[key]=(acc[key]||0)+1;
          return acc;
        },{})
      },
      note:'自動PASS候補は構造・根拠・Evidence Gateの機械判定です。回答本文の意味的正確性は管理者確認が必要です。',
      rows
    };
    state.quality.lastReport=report;
    return report;
  }

  function isTransientQualityError(err){
    const status=Number(err?.status||0);
    const code=String(err?.code||'');
    return [408,429,500,502,503,504].includes(status) ||
      ['ALL_PROVIDERS_FAILED','RAG_ANSWER_TEST_FAILED'].includes(code);
  }

  async function runQualityAnswerTestWithRetry(testCase,maxAttempts=4){
    let lastError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      try{
        const data=await authJson('/admin/rag/answer-test',{
          method:'POST',
          body:JSON.stringify({query:testCase.question})
        });
        return {data,attempts:attempt};
      }catch(err){
        const authExpired=
          Number(err?.status||0)===401 ||
          ['FAQ_ADMIN_UNAUTHORIZED','ADMIN_AUTH_REQUIRED','ADMIN_AUTH_FAILED'].includes(String(err?.code||''));
        if(authExpired) throw err;
        lastError=err;
        if(!isTransientQualityError(err) || attempt>=maxAttempts) throw err;
        const waitMs=Math.min(12000,1800*Math.pow(2,attempt-1));
        if(nodes.qualityProgressText){
          nodes.qualityProgressText.textContent=
            'No.'+testCase.id+' は一時的なAPI混雑のため再試行します（'+attempt+'/'+maxAttempts+'）。';
        }
        await new Promise(resolve=>setTimeout(resolve,waitMs));
      }
    }
    throw lastError || new Error('品質テストの再試行に失敗しました。');
  }
  async function runQualitySuite(){
    if(!state.authenticated){
      showToast('管理者ログインが必要です。');
      return;
    }
    if(state.quality.running) return;

    const authOk=await verifyCurrentToken();
    if(!authOk){
      showToast('管理者認証の有効期限が切れています。もう一度Googleログインしてください。',5200);
      if(nodes.qualityProgress) nodes.qualityProgress.textContent='認証待ち';
      if(nodes.qualityProgressText) nodes.qualityProgressText.textContent='管理者認証を更新してから50問テストを実行してください。';
      return;
    }

    try{
      const cases=await loadQualityCases();

      // STEP8-6 preflight: 5つの想定資料が本番RAGで current / active / approved
      // になるまで50問テストは開始しない。
      await loadDocuments();
      const expectedDocuments=[...new Set(
        cases
          .filter(item=>String(item?.expectedMode||'')==='answer')
          .map(item=>String(item?.document||'').trim())
          .filter(Boolean)
      )];
      const readyDocuments=(state.documents||[]).filter(doc=>
        Boolean(doc?.isCurrent) &&
        String(doc?.status||'')==='active' &&
        String(doc?.approvalStatus||'')==='approved' &&
        !doc?.deletedAt
      );
      const missingDocuments=expectedDocuments.filter(expected=>{
        const target=normalizeQualityText(expected);
        return !readyDocuments.some(doc=>{
          const title=normalizeQualityText(doc?.title||'');
          const fileName=normalizeQualityText(doc?.fileName||'');
          return title.includes(target) || fileName.includes(target);
        });
      });

      if(missingDocuments.length){
        const message=
          '50問テストはまだ開始できません。未登録または本番有効化前の資料: '+
          missingDocuments.join(' / ');
        if(nodes.qualityProgress) nodes.qualityProgress.textContent='資料登録待ち';
        if(nodes.qualityProgressText) nodes.qualityProgressText.textContent=message;
        setText(
          'quality-note',
          '5資料すべてを current / active / approved にしてから実行してください。'
        );
        showToast('本番FAQ資料5件の登録完了後に実行してください。',5200);
        return;
      }

      state.quality.running=true;
      state.quality.results=[];
      state.quality.lastReport=null;
      state.quality.lastRunAt='';
      renderProtectedViews();
      renderQualityResults();

      if(nodes.qualityProgress) nodes.qualityProgress.textContent='実行中';
      if(nodes.qualityProgressText) nodes.qualityProgressText.textContent='50問を順番に確認しています。画面を閉じずにお待ちください。';
      setText('quality-last-run','実行中');

      for(let index=0;index<cases.length;index++){
        const testCase=cases[index];
        if(nodes.qualityProgress) nodes.qualityProgress.textContent=(index+1)+' / '+cases.length;
        if(nodes.qualityProgressText){
          nodes.qualityProgressText.textContent='No.'+testCase.id+'「'+testCase.question+'」を確認しています。';
        }

        const started=performance.now();
        let scored;
        try{
          const run=await runQualityAnswerTestWithRetry(testCase,4);
          scored=scoreQualityCase(testCase,run?.data?.result||{});
          scored.retryAttempts=Math.max(0,Number(run?.attempts||1)-1);
        }catch(err){
          const authExpired=
            Number(err?.status||0)===401 ||
            ['FAQ_ADMIN_UNAUTHORIZED','ADMIN_AUTH_REQUIRED','ADMIN_AUTH_FAILED'].includes(String(err?.code||''));
          if(authExpired){
            sessionStorage.removeItem('takasagoAdminIdToken');
            state.idToken='';
            state.authenticated=false;
            state.admin=null;
            renderAuthState();
            if(nodes.qualityProgress) nodes.qualityProgress.textContent='認証切れ';
            if(nodes.qualityProgressText){
              nodes.qualityProgressText.textContent=
                '管理者認証の有効期限が切れたため、品質テストを中断しました。再ログイン後に最初から実行してください。';
            }
            showToast('管理者認証が切れたため50問テストを中断しました。再ログインしてください。',5200);
            return;
          }
          scored=scoreQualityCase(testCase,null,err?.message||'RAG品質テスト実行エラー');
          scored.retryAttempts=0;
        }
        scored.latencyMs=Math.round(performance.now()-started);
        state.quality.results.push(scored);
        renderQualityResults();

        if(index<cases.length-1){
          await new Promise(resolve=>setTimeout(resolve,1800));
        }
      }

      state.quality.lastRunAt=new Date().toISOString();
      buildQualityReport();
      const failed=state.quality.results.filter(r=>!r.autoPassed).length;
      const passed=state.quality.results.filter(r=>r.autoPassed).length;
      if(nodes.qualityProgress) nodes.qualityProgress.textContent=failed===0?'自動条件クリア':'要確認';
      if(nodes.qualityProgressText){
        nodes.qualityProgressText.textContent=
          '実行完了：PASS候補 '+passed+' / '+cases.length+'、FAIL '+failed+'。PASS候補の回答本文を管理者が確認してください。';
      }
      setText('quality-last-run',new Date().toLocaleString('ja-JP'));
      setText(
        'quality-note',
        failed===0
          ? '構造条件はすべてクリア。回答本文の最終確認を行ってください。'
          : 'FAILはEvidence Gateを緩めず、資料・見出し・版・検索対象を確認してください。'
      );
      showToast('STEP8-5 50問品質テストが完了しました。',4200);
    }finally{
      state.quality.running=false;
      renderProtectedViews();
      renderQualityResults();
    }
  }

  function downloadQualityJson(){
    const report=state.quality.lastReport||buildQualityReport();
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='takasago-jhs-rag-quality-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('品質テスト結果JSONを保存しました。');
  }

  function qualityCsvCell(value){
    let text=String(value??'').replace(/\r?\n/g,' ');
    if(/^[=+\-@]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }

  function downloadQualityCsv(){
    const report=state.quality.lastReport||buildQualityReport();
    const header=[
      'No','資料No','資料','種別','質問','想定見出し','期待モード',
      '結果status','回答','根拠資料','AI呼出','provider','自動判定','原因分類','推奨対応','再試行回数','本文確認必要','詳細','latencyMs'
    ];
    const lines=[header.map(qualityCsvCell).join(',')];
    for(const row of report.rows){
      const r=row.result||{};
      lines.push([
        row.id,row.documentNo,row.document,row.kind,row.question,row.expectedHeading,row.expectedMode,
        r.status||'',r.answer||'',Array.isArray(r.sourceNames)?r.sourceNames.join(' / '):'',
        r.aiCalled?'yes':'no',r.provider||'',r.autoJudge||'未実施',r.failureLabel||'',r.recommendation||'',Number(r.retryAttempts||0),
        r.reviewRequired?'yes':'no',r.detail||'',r.latencyMs||''
      ].map(qualityCsvCell).join(','));
    }
    const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='takasago-jhs-rag-quality-'+new Date().toISOString().replace(/[:.]/g,'-')+'.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('品質テスト結果CSVを保存しました。');
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

  function percentText(value){
    const n=Number(value)||0;
    return (n*100).toFixed(1)+'%';
  }

  function latencyText(value){
    const ms=Number(value)||0;
    if(!ms) return '—';
    return ms<1000 ? Math.round(ms)+' ms' : (ms/1000).toFixed(1)+' 秒';
  }

  function renderUsageAnalytics(summary,operations){
    const s=summary||{};
    const totals=s.totals||{};
    const feedback=s.feedback||{};

    setText('usage-requests',Number(totals.requests||0).toLocaleString());
    setText('usage-answer-rate',percentText(totals.answerRate));
    setText('usage-insufficient-rate',percentText(totals.insufficientRate));
    setText('usage-helpful-rate',feedback.total ? percentText(feedback.helpfulRate) : '評価なし');
    setText('usage-ai-calls',Number(totals.aiCalls||0).toLocaleString());
    setText('usage-errors',Number(totals.errors||0).toLocaleString());
    setText('usage-latency',latencyText(totals.avgLatencyMs));
    setText('usage-feedback-total',Number(feedback.total||0).toLocaleString());

    if(nodes.usageTopDocuments){
      const docs=Array.isArray(s.topDocuments)?s.topDocuments:[];
      nodes.usageTopDocuments.innerHTML=docs.map(doc=>`
        <tr>
          <td>
            <strong>${escapeHtml(doc.title||'無題')}</strong>
            <small>${escapeHtml(doc.source_id||doc.sourceId||'')}</small>
          </td>
          <td>${Number(doc.use_count||doc.useCount||0).toLocaleString()}</td>
        </tr>
      `).join('') || '<tr><td colspan="2">利用データはまだありません。</td></tr>';
    }

    if(nodes.usageProviders){
      const rows=Array.isArray(s.providers)?s.providers:[];
      nodes.usageProviders.innerHTML=rows.map(row=>`
        <div class="usage-list-row">
          <span>${escapeHtml(row.provider||'unknown')}</span>
          <strong>${Number(row.count||0).toLocaleString()}回</strong>
          <small>平均 ${escapeHtml(latencyText(row.avg_latency_ms||row.avgLatencyMs))}</small>
        </div>
      `).join('') || '<p class="empty-message">利用データはまだありません。</p>';
    }

    if(nodes.usageTools){
      const rows=Array.isArray(s.tools)?s.tools:[];
      nodes.usageTools.innerHTML=rows.map(row=>`
        <div class="usage-list-row">
          <span>${escapeHtml(row.tool_id||row.toolId||'unknown')}</span>
          <strong>${Number(row.count||0).toLocaleString()}回</strong>
        </div>
      `).join('') || '<p class="empty-message">利用データはまだありません。</p>';
    }

    if(nodes.usageFeedbackReasons){
      const labels={
        wrong_source:'根拠が違う',
        answer_incomplete:'回答が足りない',
        hard_to_understand:'わかりにくい',
        outdated:'情報が古い',
        other:'その他'
      };
      const rows=Array.isArray(s.feedbackReasons)?s.feedbackReasons:[];
      nodes.usageFeedbackReasons.innerHTML=rows.map(row=>`
        <div class="usage-list-row">
          <span>${escapeHtml(labels[row.reason_code]||row.reason_code||'その他')}</span>
          <strong>${Number(row.count||0).toLocaleString()}件</strong>
        </div>
      `).join('') || '<p class="empty-message">改善フィードバックはまだありません。</p>';
    }

    const o=operations||{};
    setText('ops-requests',Number(o.requests||0).toLocaleString());
    setText('ops-error-rate',percentText(o.errorRate));
    setText('ops-latency',latencyText(o.avgLatencyMs));
    setText('ops-jobs',Number(o.failedJobs||0)+' / '+Number(o.stalledJobs||0));

    if(nodes.operationsHealthBadge){
      const health=String(o.health||'ok');
      nodes.operationsHealthBadge.textContent=
        health==='error'?'要対応':(health==='warn'?'注意':'正常');
      nodes.operationsHealthBadge.classList.toggle('accent',health==='ok');
      nodes.operationsHealthBadge.classList.toggle('is-warn',health==='warn');
      nodes.operationsHealthBadge.classList.toggle('is-error',health==='error');
    }

    if(nodes.operationsAlerts){
      const alerts=Array.isArray(o.alerts)?o.alerts:[];
      nodes.operationsAlerts.innerHTML=alerts.map(alert=>`
        <div class="operations-alert ${alert.level==='error'?'is-error':'is-warn'}">
          <strong>${alert.level==='error'?'要対応':'注意'}</strong>
          <span>${escapeHtml(alert.message||'')}</span>
        </div>
      `).join('') || '<div class="operations-ok">✓ 直近24時間に警告条件はありません。</div>';
    }
  }

  async function loadUsageAnalytics(){
    if(!state.authenticated) return;
    try{
      const [usage,operations]=await Promise.all([
        authJson('/admin/usage/summary?days=30'),
        authJson('/admin/operations/summary?hours=24')
      ]);
      renderUsageAnalytics(
        usage?.result||{},
        operations?.result||{}
      );
    }catch(err){
      console.error('usage analytics error',err);
      showToast(err?.message||'利用状況を取得できませんでした。',3800);
    }
  }

  function currentJstMonth(){
    return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  }

  function renderMonthlyReport(report){
    const r=report||{};
    const usage=r.usage||{};
    const feedback=r.feedback||{};
    const jobs=r.syncJobs||{};
    const cycle=r.improvementCycle||{};
    const snapshot=r.currentSnapshot||{};
    const improvement=snapshot.improvement||{};

    state.monthlyReport=r;

    setText('monthly-report-title',(r.month||'—')+' 月次運用レポート');
    setText(
      'monthly-report-generated',
      r.generatedAt ? '作成: '+new Date(r.generatedAt).toLocaleString('ja-JP')+' ／ Asia/Tokyo' : ''
    );
    setText('monthly-report-status','作成済み');
    setText('monthly-requests',Number(usage.requests||0).toLocaleString());
    setText('monthly-answer-rate',percentText(usage.answerRate));
    setText('monthly-insufficient-rate',percentText(usage.insufficientRate));
    setText('monthly-helpful-rate',feedback.total ? percentText(feedback.helpfulRate) : '評価なし');
    setText('monthly-ai-calls',Number(usage.aiCalls||0).toLocaleString());
    setText('monthly-errors',Number(usage.errors||0).toLocaleString());
    setText('monthly-latency',latencyText(usage.avgLatencyMs));
    setText('monthly-jobs',Number(jobs.completed||0)+' / '+Number(jobs.failed||0));
    setText('monthly-cycle-open',Number(cycle.open||0).toLocaleString());
    setText('monthly-cycle-progress',Number(cycle.inProgress||0).toLocaleString());
    setText('monthly-cycle-done',Number(cycle.done||0).toLocaleString());
    setText('monthly-cycle-completed',Number((cycle.completedThisMonth||[]).length).toLocaleString());
    setText('monthly-active-docs',Number(snapshot.activeDocuments||0).toLocaleString());
    setText('monthly-active-chunks',Number(snapshot.activeChunks||0).toLocaleString());
    setText('monthly-improvement-actions',Number(improvement.actionCount||0).toLocaleString());
    setText('monthly-improvement-watch',Number(improvement.watchCount||0).toLocaleString());

    const docs=Array.isArray(r.topDocuments)?r.topDocuments:[];
    const docsBody=$('#monthly-top-documents');
    if(docsBody){
      docsBody.innerHTML=docs.map(doc=>`
        <tr>
          <td>
            <strong>${escapeHtml(doc.title||'無題')}</strong>
            <small>${escapeHtml(doc.source_id||doc.sourceId||'')}</small>
          </td>
          <td>${Number(doc.use_count||doc.useCount||0).toLocaleString()}</td>
        </tr>
      `).join('') || '<tr><td colspan="2">対象月の根拠資料利用はありません。</td></tr>';
    }

    const providers=$('#monthly-providers');
    if(providers){
      const rows=Array.isArray(r.providers)?r.providers:[];
      providers.innerHTML=rows.map(row=>`
        <div class="usage-list-row">
          <span>${escapeHtml(row.provider||'unknown')}</span>
          <strong>${Number(row.count||0).toLocaleString()}回</strong>
          <small>平均 ${escapeHtml(latencyText(row.avg_latency_ms||row.avgLatencyMs))}</small>
        </div>
      `).join('') || '<p class="empty-message">対象月の利用はありません。</p>';
    }

    const tools=$('#monthly-tools');
    if(tools){
      const rows=Array.isArray(r.tools)?r.tools:[];
      tools.innerHTML=rows.map(row=>`
        <div class="usage-list-row">
          <span>${escapeHtml(row.tool_id||row.toolId||'unknown')}</span>
          <strong>${Number(row.count||0).toLocaleString()}回</strong>
        </div>
      `).join('') || '<p class="empty-message">対象月の利用はありません。</p>';
    }

    if(nodes.printMonthlyReport) nodes.printMonthlyReport.disabled=false;
    if(nodes.downloadMonthlyReport) nodes.downloadMonthlyReport.disabled=false;
  }

  async function loadMonthlyReport(){
    if(!state.authenticated) return;
    const month=String(nodes.monthlyReportMonth?.value||currentJstMonth());

    try{
      if(nodes.generateMonthlyReport){
        nodes.generateMonthlyReport.disabled=true;
        nodes.generateMonthlyReport.textContent='作成中…';
      }
      const data=await authJson('/admin/monthly-report?month='+encodeURIComponent(month));
      renderMonthlyReport(data?.result||{});
      showToast(month+' の月次レポートを作成しました。',3000);
    }catch(err){
      console.error('monthly report error',err);
      showToast(err?.message||'月次レポートを作成できませんでした。',4200);
    }finally{
      if(nodes.generateMonthlyReport){
        nodes.generateMonthlyReport.disabled=false;
        nodes.generateMonthlyReport.textContent='レポート作成';
      }
    }
  }

  function downloadMonthlyReport(){
    if(!state.monthlyReport){
      showToast('先に月次レポートを作成してください。');
      return;
    }
    const blob=new Blob(
      [JSON.stringify(state.monthlyReport,null,2)],
      {type:'application/json;charset=utf-8'}
    );
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='takasago-jhs-monthly-report-'+String(state.monthlyReport.month||'report')+'.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('月次レポートを保存しました。',3000);
  }

  function actionMap(){
    const actions=Array.isArray(state.improvementActions?.actions)
      ? state.improvementActions.actions
      : [];
    return new Map(actions.map(action=>[action.candidateId,action]));
  }

  function renderImprovementActions(data){
    const result=data||{};
    state.improvementActions=result;
    const summary=result.summary||{};
    const actions=Array.isArray(result.actions)?result.actions:[];

    setText('cycle-open-count',Number(summary.open||0).toLocaleString());
    setText('cycle-progress-count',Number(summary.inProgress||0).toLocaleString());
    setText('cycle-done-count',Number(summary.done||0).toLocaleString());
    setText('cycle-dismissed-count',Number(summary.dismissed||0).toLocaleString());

    if(nodes.improvementCycleBody){
      const statusLabel={
        open:'未対応',
        in_progress:'対応中',
        done:'完了',
        dismissed:'見送り'
      };
      const levelLabel={
        action:'要対応',
        watch:'要確認',
        info:'参考'
      };

      nodes.improvementCycleBody.innerHTML=actions.map(action=>`
        <tr>
          <td>
            <strong>${escapeHtml(action.title||'改善項目')}</strong>
            <small>${escapeHtml(action.candidateId||'')}</small>
          </td>
          <td>${escapeHtml(levelLabel[action.level]||action.level||'—')}</td>
          <td><span class="status-pill ${action.status==='done'?'ok':''}">${escapeHtml(statusLabel[action.status]||action.status||'—')}</span></td>
          <td>${formatDate(action.updatedAt)}</td>
          <td>
            <select class="cycle-status-select" data-action-candidate="${escapeHtml(action.candidateId)}">
              <option value="open" ${action.status==='open'?'selected':''}>未対応</option>
              <option value="in_progress" ${action.status==='in_progress'?'selected':''}>対応中</option>
              <option value="done" ${action.status==='done'?'selected':''}>完了</option>
              <option value="dismissed" ${action.status==='dismissed'?'selected':''}>見送り</option>
            </select>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="5">改善対応はまだありません。</td></tr>';
    }

    if(state.improvement) renderImprovementCandidates(state.improvement);
  }

  async function loadImprovementActions(){
    if(!state.authenticated) return;
    try{
      const data=await authJson('/admin/improvement/actions');
      renderImprovementActions(data?.result||{});
    }catch(err){
      console.error('improvement actions error',err);
      showToast(err?.message||'改善サイクルを取得できませんでした。',3800);
    }
  }

  async function saveImprovementAction(candidate,status){
    if(!candidate?.id) return;
    try{
      await authJson('/admin/improvement/action',{
        method:'POST',
        body:JSON.stringify({
          candidateId:candidate.id,
          candidateType:candidate.type,
          documentId:candidate.documentId||'',
          sourceId:candidate.sourceId||'',
          title:candidate.title||'改善候補',
          level:candidate.level||'info',
          status
        })
      });
      await loadImprovementActions();
      await loadAuditLogs();
      showToast('改善対応を更新しました。',2600);
    }catch(err){
      console.error('improvement action update error',err);
      showToast(err?.message||'改善対応を更新できませんでした。',4200);
    }
  }

  async function changeImprovementActionStatus(candidateId,status){
    const action=(state.improvementActions?.actions||[])
      .find(item=>item.candidateId===candidateId);
    if(!action) return;

    try{
      await authJson('/admin/improvement/action',{
        method:'POST',
        body:JSON.stringify({
          candidateId:action.candidateId,
          candidateType:action.candidateType,
          documentId:action.documentId||'',
          sourceId:action.sourceId||'',
          title:action.title||'改善項目',
          level:action.level||'info',
          status
        })
      });
      await Promise.allSettled([loadImprovementActions(),loadAuditLogs()]);
      showToast('改善状態を更新しました。',2600);
    }catch(err){
      console.error(err);
      showToast(err?.message||'改善状態を更新できませんでした。',4200);
    }
  }

  function renderImprovementCandidates(data){
    const result=data||{};
    const summary=result.summary||{};
    const recommendations=Array.isArray(result.recommendations)
      ? result.recommendations
      : [];

    state.improvement=result;

    setText('improvement-action-count',Number(summary.actionCount||0).toLocaleString());
    setText('improvement-watch-count',Number(summary.watchCount||0).toLocaleString());
    setText('improvement-unused-count',Number(summary.unusedDocuments||0).toLocaleString());
    setText(
      'improvement-insufficient-rate',
      Number(summary.faqRequests||0)
        ? percentText(summary.faqInsufficientRate)
        : 'データなし'
    );

    if(nodes.improvementSummaryBadge){
      const actionCount=Number(summary.actionCount||0);
      const watchCount=Number(summary.watchCount||0);
      nodes.improvementSummaryBadge.textContent=
        actionCount>0
          ? '要対応 '+actionCount+'件'
          : (watchCount>0 ? '要確認 '+watchCount+'件' : '大きな改善候補なし');
      nodes.improvementSummaryBadge.classList.toggle('accent',actionCount===0 && watchCount===0);
      nodes.improvementSummaryBadge.classList.toggle('is-warn',actionCount===0 && watchCount>0);
      nodes.improvementSummaryBadge.classList.toggle('is-error',actionCount>0);
    }

    if(nodes.improvementList){
      const levelLabel={
        action:'要対応',
        watch:'要確認',
        info:'参考'
      };
      const typeLabel={
        global_coverage:'FAQ全体',
        document_status:'資料状態',
        quality_feedback:'品質評価',
        expiring_soon:'期限',
        unused_document:'利用状況'
      };
      const targetView={
        global_coverage:'add',
        document_status:'materials',
        quality_feedback:'search',
        expiring_soon:'drive',
        unused_document:'materials'
      };
      const targetLabel={
        add:'資料を追加',
        materials:'資料管理',
        search:'RAG検索テスト',
        drive:'Drive同期'
      };

      const currentActions=actionMap();
      nodes.improvementList.innerHTML=recommendations.map(item=>{
        const level=String(item.level||'info');
        const view=targetView[item.type]||'materials';
        const meta=[
          typeLabel[item.type]||'改善候補',
          item.categoryName||''
        ].filter(Boolean).join(' ／ ');
        const tracked=currentActions.get(item.id);
        const trackedLabel={
          open:'未対応',
          in_progress:'対応中',
          done:'完了',
          dismissed:'見送り'
        }[tracked?.status] || '';

        return `
          <article class="improvement-card level-${escapeHtml(level)}">
            <div class="improvement-card-head">
              <span class="improvement-level">${escapeHtml(levelLabel[level]||'参考')}</span>
              <span class="improvement-type">${escapeHtml(meta)}</span>
              ${trackedLabel
                ? '<span class="improvement-tracked">'+escapeHtml(trackedLabel)+'</span>'
                : ''}
            </div>
            <h3>${escapeHtml(item.title||'改善候補')}</h3>
            <p>${escapeHtml(item.message||'')}</p>
            ${item.sourceId
              ? '<small>'+escapeHtml(item.sourceId)+'</small>'
              : ''}
            <div class="improvement-card-actions">
              ${!tracked || tracked.status==='open'
                ? '<button class="row-action start-improvement" type="button" data-candidate-id="'+escapeHtml(item.id)+'">対応中にする</button>'
                : ''}
              <button
                class="row-action improvement-go"
                type="button"
                data-go-view="${escapeHtml(view)}"
              >${escapeHtml(targetLabel[view]||'確認する')}へ</button>
            </div>
          </article>
        `;
      }).join('') || `
        <div class="improvement-empty">
          <strong>✓ 現在、大きな改善候補はありません。</strong>
          <p>利用が増えると、匿名利用集計と定型評価から改善候補を自動抽出します。</p>
        </div>
      `;
    }

    if(nodes.downloadImprovementReport){
      nodes.downloadImprovementReport.disabled=false;
    }
  }

  async function loadImprovementCandidates(){
    if(!state.authenticated) return;
    try{
      if(nodes.refreshImprovement){
        nodes.refreshImprovement.disabled=true;
        nodes.refreshImprovement.textContent='確認中…';
      }
      const data=await authJson('/admin/improvement/candidates?days=30');
      renderImprovementCandidates(data?.result||{});
    }catch(err){
      console.error('improvement candidates error',err);
      showToast(err?.message||'改善候補を取得できませんでした。',4200);
      if(nodes.improvementList){
        nodes.improvementList.innerHTML='<p class="empty-message">改善候補を取得できませんでした。</p>';
      }
    }finally{
      if(nodes.refreshImprovement){
        nodes.refreshImprovement.disabled=false;
        nodes.refreshImprovement.textContent='↻ 改善候補を更新';
      }
    }
  }

  function downloadImprovementReport(){
    if(!state.improvement){
      showToast('先に改善候補を更新してください。');
      return;
    }

    const report={
      schema:'takasago-jhs-faq-improvement-report-v1',
      generatedAt:new Date().toISOString(),
      step:'STEP6-5',
      containsQuestionText:false,
      containsAnswerText:false,
      containsUserEmail:false,
      days:Number(state.improvement.days||30),
      summary:state.improvement.summary||{},
      recommendations:state.improvement.recommendations||[]
    };

    const blob=new Blob(
      [JSON.stringify(report,null,2)],
      {type:'application/json;charset=utf-8'}
    );
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    a.href=url;
    a.download='takasago-jhs-faq-improvement-'+stamp+'.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('改善候補レポートを保存しました。',3200);
  }

  function renderAutomationStatusAdmin(data){
    const result=data||{};
    const last=result.last||null;

    if(!last){
      setText('automation-last-run','未実行');
      setText('automation-report-status','—');
      setText('automation-notification-status','—');
      setText('automation-improvement-counts','—');

      if(nodes.automationRunBadge){
        nodes.automationRunBadge.textContent='未実行';
        nodes.automationRunBadge.classList.remove('accent','is-warn','is-error');
      }
      if(nodes.automationRunNote){
        nodes.automationRunNote.textContent=
          'GASの日次自動処理が実行されると、ここへ最終結果が表示されます。';
      }
      return;
    }

    const notifyLabels={
      sent_initial_issue:'異常通知を送信',
      sent_changed_issue:'状態変化を通知',
      sent_recovery:'正常化を通知',
      unchanged:'変化なし・通知なし',
      baseline_ok:'正常・通知なし',
      changed_ok:'正常・通知なし',
      recipient_missing:'通知先未確認',
      mail_quota_exceeded:'メール上限',
      send_failed:'通知失敗'
    };

    setText(
      'automation-last-run',
      last.createdAt ? formatDate(last.createdAt) : '日時不明'
    );
    setText(
      'automation-report-status',
      last.reportMonth
        ? last.reportMonth+' / '+(last.reportSaved?'保存済み':'未保存')
        : '対象なし'
    );
    setText(
      'automation-notification-status',
      notifyLabels[last.notificationStatus] || last.notificationStatus || '通知なし'
    );
    setText(
      'automation-improvement-counts',
      Number(last.improvementActionCount||0)+' / '+Number(last.improvementWatchCount||0)
    );

    const status=String(last.status||'');
    const ok=status==='ok';
    const partial=status==='partial';

    if(nodes.automationRunBadge){
      nodes.automationRunBadge.textContent=
        ok?'正常':(partial?'一部要確認':'要確認');
      nodes.automationRunBadge.classList.toggle('accent',ok);
      nodes.automationRunBadge.classList.toggle('is-warn',partial);
      nodes.automationRunBadge.classList.toggle('is-error',!ok&&!partial);
    }

    if(nodes.automationRunNote){
      const parts=[
        '運用監視: '+String(last.operationsHealth||'不明'),
        'エラー '+Number(last.errorCount||0)+'件'
      ];
      nodes.automationRunNote.textContent=parts.join(' ／ ');
    }
  }

  async function loadAutomationStatusAdmin(){
    if(!state.authenticated) return;
    try{
      if(nodes.refreshAutomationStatus){
        nodes.refreshAutomationStatus.disabled=true;
        nodes.refreshAutomationStatus.textContent='確認中…';
      }
      const data=await authJson('/admin/automation/status');
      renderAutomationStatusAdmin(data?.result||{});
    }catch(err){
      console.error('automation status error',err);
      if(nodes.automationRunBadge){
        nodes.automationRunBadge.textContent='取得失敗';
        nodes.automationRunBadge.classList.add('is-error');
      }
      if(nodes.automationRunNote){
        nodes.automationRunNote.textContent=
          err?.message||'自動運用状態を取得できませんでした。';
      }
    }finally{
      if(nodes.refreshAutomationStatus){
        nodes.refreshAutomationStatus.disabled=false;
        nodes.refreshAutomationStatus.textContent='↻ 更新';
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

  async function waitForAcceptanceRetrieval(query, attempts=6, delayMs=1200){
    let last=null;
    for(let i=0;i<attempts;i++){
      if(i>0) await new Promise(resolve=>setTimeout(resolve,delayMs));
      last=await authJson('/admin/rag/retrieval-test',{
        method:'POST',
        body:JSON.stringify({query})
      });
      if(last?.result?.hasUsableEvidence===true) return last;
    }
    return last;
  }

  async function waitForAcceptanceAnswer(query, attempts=4, delayMs=1200){
    let last=null;
    for(let i=0;i<attempts;i++){
      if(i>0) await new Promise(resolve=>setTimeout(resolve,delayMs));
      last=await authJson('/admin/rag/answer-test',{
        method:'POST',
        body:JSON.stringify({query})
      });
      const result=last?.result||{};
      if(result.status==='answer' && result.aiCalled===true) return last;
      if(result.status!=='insufficient') return last;
    }
    return last;
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
        Boolean(worker?.ok && versionAtLeast(worker?.version,6,1,0)),
        'version '+String(worker?.version||'不明')+'（6.1.0以上）'
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
      const positiveSearch=await waitForAcceptanceRetrieval(
        ACCEPTANCE_POSITIVE_QUERY,
        6,
        1200
      );
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
      const answerData=await waitForAcceptanceAnswer(
        ACCEPTANCE_POSITIVE_QUERY,
        4,
        1200
      );
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
      if(state.authenticated){
        await Promise.allSettled([
          loadUsageAnalytics(),
          loadAutomationStatusAdmin()
        ]);
      }
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
  nodes.refreshUsage?.addEventListener('click',loadUsageAnalytics);
  nodes.refreshImprovement?.addEventListener('click',async()=>{
    await Promise.allSettled([loadImprovementCandidates(),loadImprovementActions()]);
  });
  nodes.downloadImprovementReport?.addEventListener('click',downloadImprovementReport);
  nodes.refreshImprovementActions?.addEventListener('click',loadImprovementActions);
  nodes.generateMonthlyReport?.addEventListener('click',loadMonthlyReport);
  nodes.printMonthlyReport?.addEventListener('click',()=>window.print());
  nodes.downloadMonthlyReport?.addEventListener('click',downloadMonthlyReport);
  nodes.refreshAutomationStatus?.addEventListener('click',loadAutomationStatusAdmin);
  nodes.improvementList?.addEventListener('click',(event)=>{
    const startButton=event.target.closest('.start-improvement');
    if(startButton){
      const candidate=(state.improvement?.recommendations||[])
        .find(item=>item.id===startButton.dataset.candidateId);
      if(candidate) saveImprovementAction(candidate,'in_progress');
      return;
    }

    const button=event.target.closest('.improvement-go');
    if(button){
      showView(button.dataset.goView||'materials');
    }
  });

  nodes.improvementCycleBody?.addEventListener('change',(event)=>{
    const select=event.target.closest('.cycle-status-select');
    if(select){
      changeImprovementActionStatus(
        select.dataset.actionCandidate,
        select.value
      );
    }
  });
  nodes.runMaintenance?.addEventListener('click',runMaintenanceNowAdmin);
  nodes.runQualitySuite?.addEventListener('click',runQualitySuite);
  nodes.downloadQualityCsv?.addEventListener('click',downloadQualityCsv);
  nodes.downloadQualityJson?.addEventListener('click',downloadQualityJson);
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
    state.improvement=null;
    state.improvementActions=null;
    state.monthlyReport=null;
    state.quality.results=[];
    state.quality.running=false;
    state.quality.lastReport=null;
    state.quality.lastRunAt='';
    renderQualityResults();
    renderAuthState();
    renderGoogleButton();
    showToast('ログアウトしました。');
  });

  if(nodes.monthlyReportMonth && !nodes.monthlyReportMonth.value){
    nodes.monthlyReportMonth.value=currentJstMonth();
  }

  loadAcceptanceManualState();
  updateAcceptanceVerdict();

  const existingTestId=sessionStorage.getItem('step58AdminTestDocumentId');
  if(existingTestId && nodes.cleanupAdminTest) nodes.cleanupAdminTest.hidden=false;

  loadQualityCases().catch(err=>{
    console.warn('quality test cases load failed',err);
    if(nodes.qualityProgressText) nodes.qualityProgressText.textContent='50問テストセットを読み込めませんでした。';
  });
  initializeAdminAuth();
  refreshAll();
})();