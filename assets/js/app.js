(() => {
  'use strict';

  const TOOLS = {
    document: { icon:'📝', name:'校務文書作成', lead:'案内文・依頼文・通知文などを、学校で使いやすい形にまとめます。', label:'作成したい内容（要点・日付・対象など）', placeholder:'例）体育大会の案内／対象：保護者／日時：10月12日 9:00／雨天時は翌日に順延／持ち物：水筒、タオル', title:'校務文書案', tip:'日時・対象・お願い事項を分けて書くと、文書を整理しやすくなります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    check: { icon:'✅', name:'文書チェック', lead:'入力した文章を確認し、誤字・表記揺れ・分かりにくい表現を整理します。', label:'チェックしたい文章', placeholder:'ここに確認したい文章を貼り付けてください。', title:'文書チェック結果', tip:'完成文をそのまま貼り付けると、修正箇所を確認しやすくなります。', usesOptions:false, quick:['retry'] },
    parent: { icon:'📢', name:'保護者連絡文', lead:'保護者への連絡を、丁寧で分かりやすい文章にします。', label:'連絡内容（箇条書きでもOK）', placeholder:'例）2年生の校外学習／6月12日／8:30集合／雨天決行／弁当必要', title:'保護者連絡文案', tip:'日付・時刻・持ち物などを箇条書きにすると、伝達事項を整理しやすくなります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    newsletter: { icon:'🏫', name:'学年通信支援', lead:'行事や出来事をもとに、学年通信に使いやすい文章案を作ります。', label:'学年通信に入れたい内容', placeholder:'例）文化祭に向けた取組／合唱練習の様子／生活面でよかったこと／保護者へのお願い', title:'学年通信文章案', tip:'通信の中心となる出来事と、最後に伝えたいメッセージを分けて書くと整いやすくなります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    meeting: { icon:'📋', name:'会議メモ整理', lead:'箇条書きの会議メモから、決定事項・課題・担当を整理します。', label:'会議メモ（箇条書きでOK）', placeholder:'例）体育大会の係分担を再確認／雨天時の放送文案が必要／保護者への案内は来週配付', title:'会議メモ整理結果', tip:'1行1項目で入力すると、決定事項と課題の切り分けがしやすくなります。', usesOptions:false, quick:['retry'] },
    lesson: { icon:'📚', name:'授業アイデア', lead:'教科・単元・時間・ねらいから、授業展開や発問案を考えます。', label:'教科・単元・時間・ねらい', placeholder:'例）国語 2年／単元：短歌に親しむ／50分／ねらい：情景や心情を読み取る', title:'授業アイデア案', tip:'「この時間で生徒に何を考えてほしいか」を入れると、授業案が具体的になります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    research: { icon:'🎓', name:'研修・研究支援', lead:'校内研修や研究テーマに合わせて、協議事項や研究案を整理します。', label:'テーマ・課題・相談したいこと', placeholder:'例）研究テーマ：主体的に学ぶ生徒の育成／課題：話合い活動が浅くなりがち／相談：協議の柱', title:'研修・研究支援案', tip:'現在の課題と目指す姿の両方を書くと、協議の柱を整理しやすくなります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    mail: { icon:'✉️', name:'メール作成', lead:'相手・目的・要点から、校務で使いやすいメール文を作成します。', label:'相手・目的・要点', placeholder:'例）相手：学年教員／目的：会議日程の連絡／来週火曜15:30、被服室、議題は文化祭準備', title:'校務メール案', tip:'相手・目的・日時・依頼事項を分けて書くと、短く分かりやすいメールになります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    rewrite: { icon:'🔄', name:'言い換え', lead:'元の文章を、目的に応じて丁寧・簡潔・やわらかな表現に言い換えます。', label:'言い換えたい文章', placeholder:'例）提出がまだの人は、できるだけ早く出してください。', title:'言い換え結果', tip:'誰に伝える文章なのかを入力文に添えると、より自然な表現になります。', usesOptions:true, quick:['shorter','casual','formal','retry'] },
    faq: { icon:'❓', name:'校内FAQ', lead:'承認済みの校内資料を検索し、根拠が確認できる範囲だけで回答します。', label:'校内ルール・手続きについての質問', placeholder:'例）出張後の復命書はいつまでに提出しますか？', title:'校内FAQ回答', tip:'回答は登録済みの承認資料だけを根拠にします。根拠が見つからない場合は推測せず、その旨を表示します。', usesOptions:false, quick:['shorter','retry'] }
  };

  const state = {
    currentTool:'parent',
    lastResult:'',
    lastInput:'',
    lastProvider:'',
    drafts:{},
    requestController:null,
    config:null,
    configPromise:null,
    staffAuthInitialized:false,
    staffGoogleClientId:'',
    staffIdToken:
      sessionStorage.getItem('takasagoStaffIdToken') ||
      sessionStorage.getItem('takasagoAdminIdToken') ||
      '',
    staffAuthenticated:false,
    staffUser:null
  };

  const $ = (s) => document.querySelector(s);
  const nodes = {
    year:$('[data-current-year]'), home:$('#screen-home'), editor:$('#screen-editor'), result:$('#screen-result'),
    homeTools:document.querySelectorAll('[data-tool-id]'), miniToolList:$('#mini-tool-list'),
    backHome:$('[data-back-home]'), backEditor:$('[data-back-editor]'), homeFromResult:$('[data-home-from-result]'),
    form:$('#editor-form'), title:$('#editor-title'), icon:$('#editor-icon'), lead:$('#editor-lead'), inputLabel:$('#input-label'), mainInput:$('#main-input'),
    optionArea:$('#option-area'), length:$('#length-select'), tone:$('#tone-select'),
    resultTitle:$('#result-title'), resultOutput:$('#result-output'), resultTip:$('#result-tip'),
    copyButton:$('[data-copy-result]'), quickButtons:document.querySelectorAll('[data-quick-edit]'),
    helpButton:$('[data-help-button]'), adminButton:$('[data-admin-button]'), toast:$('#app-toast'),
    submitButton:$('#editor-form .primary-action'),
    faqAuthPanel:$('#faq-auth-panel'),
    faqAuthTitle:$('#faq-auth-title'),
    faqAuthDescription:$('#faq-auth-description'),
    faqAuthBadge:$('#faq-auth-badge'),
    faqGoogleSignin:$('#faq-google-signin'),
    faqSignedUser:$('#faq-signed-user'),
    faqUserName:$('#faq-user-name'),
    faqSignoutButton:$('#faq-signout-button'),
    faqResultSources:$('#faq-result-sources'),
    faqResultSourceList:$('#faq-result-source-list')
  };

  if (nodes.year) nodes.year.textContent = new Date().getFullYear();

  const stageStrong = document.querySelector('.stage-card strong');
  const stageText = document.querySelector('.stage-card p');
  const footerStage = document.querySelector('.site-footer p');
  if (stageStrong) stageStrong.textContent = '現在：STEP 5-9 新RAG FAQ本番切替';
  if (stageText) stageText.textContent = '校内FAQはGoogle職員認証後、D1・Vectorize・FTS5・RRF・Evidence Gateを通った根拠だけで回答します。';
  if (footerStage) footerStage.textContent = '高砂市立高砂中学校　校務AIアシスト — STEP 5-9 新RAG FAQ版';

  const tool = (id) => TOOLS[id] || TOOLS.parent;

  function showToast(message, ms=2800) {
    if (!nodes.toast) return;
    nodes.toast.textContent = message;
    nodes.toast.hidden = false;
    clearTimeout(window.__appToastTimer);
    window.__appToastTimer = setTimeout(() => { nodes.toast.hidden = true; }, ms);
  }

  function showScreen(name) {
    const map = { home:nodes.home, editor:nodes.editor, result:nodes.result };
    Object.entries(map).forEach(([key,el]) => { if (!el) return; el.hidden = key !== name; el.classList.toggle('is-active', key === name); });
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function saveDraft() {
    if (!nodes.mainInput) return;
    state.drafts[state.currentTool] = {
      input:nodes.mainInput.value, length:nodes.length?.value || '標準', tone:nodes.tone?.value || '丁寧'
    };
  }

  function renderMiniTools() {
    if (!nodes.miniToolList) return;
    nodes.miniToolList.innerHTML = Object.entries(TOOLS).map(([id,item]) =>
      `<button class="mini-tool-button ${id===state.currentTool?'is-active':''}" type="button" data-mini-tool="${id}">${item.icon} ${item.name}</button>`
    ).join('');
    nodes.miniToolList.querySelectorAll('[data-mini-tool]').forEach((button) => button.addEventListener('click', () => { saveDraft(); openEditor(button.dataset.miniTool); }));
  }

  function openEditor(id) {
    saveDraft();
    state.currentTool = id;
    const item = tool(id), draft = state.drafts[id] || {};
    nodes.icon.textContent = item.icon; nodes.title.textContent = item.name; nodes.lead.textContent = item.lead;
    nodes.inputLabel.textContent = item.label; nodes.mainInput.placeholder = item.placeholder;
    nodes.mainInput.value = draft.input || ''; nodes.optionArea.hidden = !item.usesOptions;
    nodes.length.value = draft.length || '標準'; nodes.tone.value = draft.tone || '丁寧';
    renderMiniTools();
    updateFaqAuthUi();
    showScreen('editor');
    if (id === 'faq') initializeStaffAuth();
    setTimeout(() => nodes.mainInput.focus(), 150);
  }


  async function workerBaseUrl() {
    const cfg = await loadConfig();
    return String(cfg.workerBaseUrl || '').trim().replace(/\/+$/, '');
  }

  async function staffGet(path, token='') {
    const base = await workerBaseUrl();
    if (!base) throw new Error('WORKER_NOT_CONFIGURED');
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + path, { headers, cache:'no-store' });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error?.message || '職員認証に失敗しました。');
      err.code = data?.error?.code || ('HTTP_' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function updateFaqAuthUi() {
    const isFaq = state.currentTool === 'faq';
    if (nodes.faqAuthPanel) nodes.faqAuthPanel.hidden = !isFaq;
    if (!isFaq) return;

    const authenticated = Boolean(state.staffAuthenticated && state.staffUser);
    if (nodes.faqSignedUser) nodes.faqSignedUser.hidden = !authenticated;
    if (nodes.faqGoogleSignin) nodes.faqGoogleSignin.hidden = authenticated || !state.staffGoogleClientId;

    if (authenticated) {
      if (nodes.faqAuthTitle) nodes.faqAuthTitle.textContent = '職員認証済み';
      if (nodes.faqAuthDescription) nodes.faqAuthDescription.textContent =
        '承認済みの校内資料を新RAGで検索できます。';
      if (nodes.faqAuthBadge) nodes.faqAuthBadge.textContent = '✓ 認証済み';
      if (nodes.faqAuthBadge) nodes.faqAuthBadge.classList.add('is-authenticated');
      if (nodes.faqUserName) {
        nodes.faqUserName.textContent =
          state.staffUser.name || state.staffUser.email || '職員';
      }
    } else {
      if (nodes.faqAuthTitle) nodes.faqAuthTitle.textContent = '校内FAQは職員ログインが必要です';
      if (nodes.faqAuthDescription) {
        nodes.faqAuthDescription.textContent = state.staffGoogleClientId
          ? '許可されたGoogleアカウントでログインしてください。'
          : '職員認証の設定を確認しています。';
      }
      if (nodes.faqAuthBadge) {
        nodes.faqAuthBadge.textContent = state.staffGoogleClientId ? '🔒 未ログイン' : '⏳ 確認中';
        nodes.faqAuthBadge.classList.remove('is-authenticated');
      }
    }

    if (nodes.submitButton && isFaq) {
      nodes.submitButton.disabled = !authenticated;
      if (!authenticated) nodes.submitButton.textContent = '🔒 職員ログイン後に利用できます';
      else nodes.submitButton.textContent = '✨ AIで作成する';
    }
  }

  async function verifyStaffToken(token) {
    if (!token) return false;
    try {
      const data = await staffGet('/staff/auth/me', token);
      state.staffAuthenticated = Boolean(data?.staff?.authenticated);
      state.staffUser = data?.staff || null;
      if (state.staffAuthenticated) {
        state.staffIdToken = token;
        sessionStorage.setItem('takasagoStaffIdToken', token);
      }
      updateFaqAuthUi();
      return state.staffAuthenticated;
    } catch (err) {
      console.warn('staff token verification failed', err);
      sessionStorage.removeItem('takasagoStaffIdToken');
      if (sessionStorage.getItem('takasagoAdminIdToken') === token) {
        sessionStorage.removeItem('takasagoAdminIdToken');
      }
      state.staffIdToken = '';
      state.staffAuthenticated = false;
      state.staffUser = null;
      updateFaqAuthUi();
      return false;
    }
  }

  async function handleStaffCredential(response) {
    const token = String(response?.credential || '');
    if (!token) return;
    const ok = await verifyStaffToken(token);
    showToast(ok ? '職員としてログインしました。' : 'このGoogleアカウントでは校内FAQを利用できません。', 3600);
  }

  function renderStaffGoogleButton() {
    if (!state.staffGoogleClientId || !window.google?.accounts?.id || !nodes.faqGoogleSignin) {
      return false;
    }
    nodes.faqGoogleSignin.innerHTML = '';
    window.google.accounts.id.initialize({
      client_id:state.staffGoogleClientId,
      callback:handleStaffCredential,
      auto_select:false
    });
    window.google.accounts.id.renderButton(nodes.faqGoogleSignin, {
      theme:'outline',
      size:'large',
      shape:'pill',
      text:'signin_with',
      locale:'ja',
      width:240
    });
    nodes.faqGoogleSignin.hidden = state.staffAuthenticated;
    return true;
  }

  async function initializeStaffAuth() {
    if (state.staffAuthInitialized) {
      updateFaqAuthUi();
      renderStaffGoogleButton();
      return;
    }
    state.staffAuthInitialized = true;

    try {
      const data = await staffGet('/health/staff-auth');
      state.staffGoogleClientId = String(data?.staffAuth?.googleClientId || '');
      updateFaqAuthUi();

      if (state.staffIdToken) {
        await verifyStaffToken(state.staffIdToken);
      }

      if (!data?.staffAuth?.configured || !state.staffGoogleClientId) {
        updateFaqAuthUi();
        return;
      }

      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (renderStaffGoogleButton() || tries >= 30) clearInterval(timer);
      }, 200);
    } catch (err) {
      console.error('staff auth initialization failed', err);
      state.staffAuthInitialized = false;
      updateFaqAuthUi();
    }
  }

  function renderFaqSources(sources) {
    if (!nodes.faqResultSources || !nodes.faqResultSourceList) return;
    const list = Array.isArray(sources) ? sources : [];

    if (state.currentTool !== 'faq' || !list.length) {
      nodes.faqResultSources.hidden = true;
      nodes.faqResultSourceList.replaceChildren();
      return;
    }

    nodes.faqResultSourceList.replaceChildren();
    for (const source of list) {
      const card = document.createElement('article');
      card.className = 'faq-source-card';

      const title = document.createElement('strong');
      title.textContent = source.title || source.fileName || '根拠資料';
      card.appendChild(title);

      const metaParts = [];
      if (source.versionLabel) metaParts.push('版: ' + source.versionLabel);
      if (source.categoryName) metaParts.push('分類: ' + source.categoryName);
      if (source.headingPath) metaParts.push('見出し: ' + source.headingPath);
      if (source.pageFrom) {
        metaParts.push('ページ: ' + source.pageFrom + (source.pageTo && source.pageTo !== source.pageFrom ? '–' + source.pageTo : ''));
      }
      if (source.sheetName) metaParts.push('シート: ' + source.sheetName);
      if (source.slideNo) metaParts.push('スライド: ' + source.slideNo);

      const meta = document.createElement('p');
      meta.textContent = metaParts.join(' ／ ') || 'D1登録資料';
      card.appendChild(meta);

      nodes.faqResultSourceList.appendChild(card);
    }
    nodes.faqResultSources.hidden = false;
  }
  async function loadConfig() {
    if (state.config) return state.config;
    if (state.configPromise) return state.configPromise;
    state.configPromise = (async () => {
      const defaults = { workerBaseUrl:'', allowDemoFallback:true, requestTimeoutMs:65000 };
      try {
        const res = await fetch('assets/js/config.json', { cache:'no-store' });
        if (!res.ok) return defaults;
        const cfg = await res.json();
        return { ...defaults, ...cfg };
      } catch { return defaults; }
    })();
    state.config = await state.configPromise;
    return state.config;
  }

  function demoResult(input) {
    if (state.currentTool === 'faq') return '【校内FAQ】\n校内FAQは新RAG基盤への接続が必要です。';
    return `【STEP 3 接続待ち】\nCloudflare Worker のURLがまだ設定されていないため、AI通信は行っていません。\n\n【入力内容】\n${input}\n\n※ assets/js/config.json の workerBaseUrl を設定するとAI生成へ切り替わります。`;
  }

  function setBusy(busy, label='AIが作成中…') {
    if (nodes.submitButton) {
      const faqLocked = state.currentTool === 'faq' && !state.staffAuthenticated;
      nodes.submitButton.disabled = busy || faqLocked;
      nodes.submitButton.textContent = busy
        ? `⏳ ${label}`
        : (faqLocked ? '🔒 職員ログイン後に利用できます' : '✨ AIで作成する');
    }
    nodes.quickButtons.forEach((b) => { b.disabled = busy; });
  }

  function renderQuickButtons() {
    const allowed = new Set(tool(state.currentTool).quick || []);
    nodes.quickButtons.forEach((b) => { b.hidden = !allowed.has(b.dataset.quickEdit || ''); });
  }

  async function callWorker(payload) {
    const cfg = await loadConfig();
    const base = String(cfg.workerBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) {
      if (cfg.allowDemoFallback) return { ok:true, text:demoResult(payload.input), provider:'demo', model:'none' };
      throw new Error('WORKER_NOT_CONFIGURED');
    }

    if (state.requestController) state.requestController.abort();
    const controller = new AbortController(); state.requestController = controller;
    const timeout = setTimeout(() => controller.abort(), Number(cfg.requestTimeoutMs) || 65000);
    try {
      const headers = {'Content-Type':'application/json'};
      if (payload.toolId === 'faq' && state.staffIdToken) {
        headers.Authorization = 'Bearer ' + state.staffIdToken;
      }
      const res = await fetch(`${base}/api/generate`, {
        method:'POST', headers, signal:controller.signal,
        body:JSON.stringify(payload)
      });
      let data = null;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || !data?.ok) {
        const code = data?.error?.code || `HTTP_${res.status}`;
        const message = data?.error?.message || 'AI生成に失敗しました。';
        const err = new Error(message); err.code = code; err.status = res.status; throw err;
      }
      return data;
    } finally {
      clearTimeout(timeout);
      if (state.requestController === controller) state.requestController = null;
    }
  }

  function errorMessage(err) {
    if (err?.name === 'AbortError') return 'AI通信がタイムアウトしました。もう一度お試しください。';
    if (err?.code === 'WORKER_NOT_CONFIGURED') return 'Cloudflare Worker のURLが未設定です。';
    if (err?.code === 'STAFF_AUTH_REQUIRED') return '校内FAQを利用するには職員ログインが必要です。';
    if (err?.code === 'STAFF_EMAIL_NOT_ALLOWED') return 'このGoogleアカウントには校内FAQの利用権限がありません。';
    if (err?.code === 'GOOGLE_ID_TOKEN_EXPIRED') return 'Googleログインの有効期限が切れました。もう一度ログインしてください。';
    if (err?.code === 'FAQ_RAG_NOT_CONFIGURED') return '校内FAQの新RAG基盤がまだ設定されていません。';
    if (err?.status === 429 || err?.code === 'RATE_LIMITED') return 'AIの利用上限に達しました。少し時間をおいて再度お試しください。';
    if (err?.status >= 500 || err?.code === 'ALL_PROVIDERS_FAILED') return 'AIサービスへ接続できませんでした。しばらくしてから再度お試しください。';
    return err?.message || 'AI生成中にエラーが発生しました。';
  }

  async function generateResult(quickEdit='') {
    if (state.currentTool === 'faq' && !state.staffAuthenticated) {
      showToast('校内FAQは職員ログイン後に利用できます。', 3800);
      await initializeStaffAuth();
      return;
    }
    const input = nodes.mainInput.value.trim();
    if (!input) { showToast('内容を入力してください。'); nodes.mainInput.focus(); return; }
    if (input.length > 12000) { showToast('入力が長すぎます。12,000文字以内にしてください。', 4200); nodes.mainInput.focus(); return; }
    const allowed = tool(state.currentTool).quick || [];
    if (quickEdit && !allowed.includes(quickEdit)) return;

    saveDraft(); setBusy(true, quickEdit ? '文章を調整中…' : 'AIが作成中…');
    try {
      const payload = {
        toolId:state.currentTool, input,
        options:{ length:nodes.length.value, tone:nodes.tone.value },
        quickEdit:quickEdit || null,
        previousOutput:quickEdit ? state.lastResult : null
      };
      const data = await callWorker(payload);
      state.lastResult = String(data.text || '').trim(); state.lastInput = input; state.lastProvider = data.provider || '';
      nodes.resultTitle.textContent = tool(state.currentTool).title;
      nodes.resultOutput.textContent = state.lastResult;
      nodes.resultTip.textContent = tool(state.currentTool).tip;
      renderFaqSources(data.sources || []);
      renderQuickButtons(); showScreen('result');
      if (data.provider === 'demo') showToast('STEP3コード準備済み：Worker URL設定後にAI通信へ切り替わります。', 4200);
    } catch (err) {
      console.error('AI generate error', err); showToast(errorMessage(err), 4600);
    } finally {
      setBusy(false);
      if (state.currentTool === 'faq') updateFaqAuthUi();
    }
  }

  async function copyResult() {
    if (!state.lastResult) return;
    try { await navigator.clipboard.writeText(state.lastResult); showToast('完成文章をコピーしました。'); }
    catch { showToast('コピーできませんでした。文章を選択してコピーしてください。'); }
  }

  nodes.homeTools.forEach((button) => button.addEventListener('click', () => openEditor(button.dataset.toolId)));
  nodes.backHome?.addEventListener('click', () => { saveDraft(); showScreen('home'); });
  nodes.backEditor?.addEventListener('click', () => showScreen('editor'));
  nodes.homeFromResult?.addEventListener('click', () => showScreen('home'));
  nodes.form?.addEventListener('submit', (event) => { event.preventDefault(); generateResult(); });
  nodes.copyButton?.addEventListener('click', copyResult);
  nodes.quickButtons.forEach((button) => button.addEventListener('click', () => generateResult(button.dataset.quickEdit || '')));
  nodes.helpButton?.addEventListener('click', () => showToast('機能を選ぶ → 内容を入力 →「AIで作成する」の順です。'));
  nodes.faqSignoutButton?.addEventListener('click', () => {
    sessionStorage.removeItem('takasagoStaffIdToken');
    state.staffIdToken = '';
    state.staffAuthenticated = false;
    state.staffUser = null;
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
    updateFaqAuthUi();
    renderStaffGoogleButton();
    showToast('校内FAQからログアウトしました。');
  });
  nodes.adminButton?.addEventListener('click', () => {
    window.location.href = 'admin/';
  });
})();
