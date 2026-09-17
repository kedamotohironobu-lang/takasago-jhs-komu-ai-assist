(() => {
  'use strict';

  const TOOLS = {
    document: {
      icon: '📝', name: '校務文書作成',
      lead: '案内文・依頼文・通知文などを、学校で使いやすい形にまとめます。',
      label: '作成したい内容（要点・日付・対象など）',
      placeholder: '例）体育大会の案内／対象：保護者／日時：10月12日 9:00／雨天時は翌日に順延／持ち物：水筒、タオル',
      title: '校務文書案',
      tip: '日時・対象・お願い事項を分けて書くと、文書を整理しやすくなります。',
      usesOptions: true
    },
    check: {
      icon: '✅', name: '文書チェック',
      lead: '入力した文章を確認し、誤字・表記揺れ・分かりにくい表現を整理します。',
      label: 'チェックしたい文章',
      placeholder: 'ここに確認したい文章を貼り付けてください。',
      title: '文書チェック結果',
      tip: '完成文をそのまま貼り付けると、修正箇所を確認しやすくなります。',
      usesOptions: false
    },
    parent: {
      icon: '📢', name: '保護者連絡文',
      lead: '保護者への連絡を、丁寧で分かりやすい文章にします。',
      label: '連絡内容（箇条書きでもOK）',
      placeholder: '例）2年生の校外学習／6月12日／8:30集合／雨天決行／弁当必要',
      title: '保護者連絡文案',
      tip: '日付・時刻・持ち物などを箇条書きにすると、伝達事項を整理しやすくなります。',
      usesOptions: true
    },
    newsletter: {
      icon: '🏫', name: '学年通信支援',
      lead: '行事や出来事をもとに、学年通信に使いやすい文章案を作ります。',
      label: '学年通信に入れたい内容',
      placeholder: '例）文化祭に向けた取組／合唱練習の様子／生活面でよかったこと／保護者へのお願い',
      title: '学年通信文章案',
      tip: '通信の中心となる出来事と、最後に伝えたいメッセージを分けて書くと整いやすくなります。',
      usesOptions: true
    },
    meeting: {
      icon: '📋', name: '会議メモ整理',
      lead: '箇条書きの会議メモから、決定事項・課題・担当を整理します。',
      label: '会議メモ（箇条書きでOK）',
      placeholder: '例）体育大会の係分担を再確認／雨天時の放送文案が必要／保護者への案内は来週配付',
      title: '会議メモ整理結果',
      tip: '1行1項目で入力すると、決定事項と課題の切り分けがしやすくなります。',
      usesOptions: false
    },
    lesson: {
      icon: '📚', name: '授業アイデア',
      lead: '教科・単元・時間・ねらいから、授業展開や発問案を考えます。',
      label: '教科・単元・時間・ねらい',
      placeholder: '例）国語 2年／単元：短歌に親しむ／50分／ねらい：情景や心情を読み取る',
      title: '授業アイデア案',
      tip: '「この時間で生徒に何を考えてほしいか」を入れると、授業案が具体的になります。',
      usesOptions: true
    },
    research: {
      icon: '🎓', name: '研修・研究支援',
      lead: '校内研修や研究テーマに合わせて、協議事項や研究案を整理します。',
      label: 'テーマ・課題・相談したいこと',
      placeholder: '例）研究テーマ：主体的に学ぶ生徒の育成／課題：話合い活動が浅くなりがち／相談：協議の柱',
      title: '研修・研究支援案',
      tip: '現在の課題と目指す姿の両方を書くと、協議の柱を整理しやすくなります。',
      usesOptions: true
    },
    mail: {
      icon: '✉️', name: 'メール作成',
      lead: '相手・目的・要点から、校務で使いやすいメール文を作成します。',
      label: '相手・目的・要点',
      placeholder: '例）相手：学年教員／目的：会議日程の連絡／来週火曜15:30、被服室、議題は文化祭準備',
      title: '校務メール案',
      tip: '相手・目的・日時・依頼事項を分けて書くと、短く分かりやすいメールになります。',
      usesOptions: true
    },
    rewrite: {
      icon: '🔄', name: '言い換え',
      lead: '元の文章を、目的に応じて丁寧・簡潔・やわらかな表現に言い換えます。',
      label: '言い換えたい文章',
      placeholder: '例）提出がまだの人は、できるだけ早く出してください。',
      title: '言い換え結果',
      tip: '誰に伝える文章なのかを入力文に添えると、より自然な表現になります。',
      usesOptions: true
    },
    faq: {
      icon: '❓', name: '校内FAQ',
      lead: '校内ルールや事務手続きについて質問する画面です。',
      label: '質問内容',
      placeholder: '例）出張後の復命書はいつまでに提出しますか？',
      title: '校内FAQ（STEP2.5デモ）',
      tip: '校内FAQは後工程で校内資料を検索し、根拠を示して答える方式にします。',
      usesOptions: false
    }
  };

  const state = { currentTool: 'parent', lastResult: '' };

  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    year: $('[data-current-year]'),
    home: $('#screen-home'), editor: $('#screen-editor'), result: $('#screen-result'),
    homeTools: document.querySelectorAll('[data-tool-id]'),
    miniToolList: $('#mini-tool-list'),
    backHome: $('[data-back-home]'), backEditor: $('[data-back-editor]'),
    homeFromResult: $('[data-home-from-result]'),
    form: $('#editor-form'), title: $('#editor-title'), icon: $('#editor-icon'), lead: $('#editor-lead'),
    inputLabel: $('#input-label'), mainInput: $('#main-input'),
    optionArea: $('#option-area'), length: $('#length-select'), tone: $('#tone-select'),
    resultTitle: $('#result-title'), resultOutput: $('#result-output'), resultTip: $('#result-tip'),
    copyButton: $('[data-copy-result]'), quickButtons: document.querySelectorAll('[data-quick-edit]'),
    helpButton: $('[data-help-button]'), settingsButton: $('[data-settings-button]'), toast: $('#app-toast')
  };

  if (nodes.year) nodes.year.textContent = new Date().getFullYear();

  function tool(id) { return TOOLS[id] || TOOLS.parent; }

  function showToast(message) {
    if (!nodes.toast) return;
    nodes.toast.textContent = message;
    nodes.toast.hidden = false;
    clearTimeout(window.__appToastTimer);
    window.__appToastTimer = setTimeout(() => { nodes.toast.hidden = true; }, 2400);
  }

  function showScreen(name) {
    const map = { home: nodes.home, editor: nodes.editor, result: nodes.result };
    Object.entries(map).forEach(([key, el]) => {
      el.hidden = key !== name;
      el.classList.toggle('is-active', key === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderMiniTools() {
    nodes.miniToolList.innerHTML = Object.entries(TOOLS).map(([id, item]) =>
      `<button class="mini-tool-button ${id === state.currentTool ? 'is-active' : ''}" type="button" data-mini-tool="${id}">${item.icon} ${item.name}</button>`
    ).join('');

    nodes.miniToolList.querySelectorAll('[data-mini-tool]').forEach((button) => {
      button.addEventListener('click', () => openEditor(button.dataset.miniTool));
    });
  }

  function openEditor(id) {
    state.currentTool = id;
    const item = tool(id);
    nodes.icon.textContent = item.icon;
    nodes.title.textContent = item.name;
    nodes.lead.textContent = item.lead;
    nodes.inputLabel.textContent = item.label;
    nodes.mainInput.placeholder = item.placeholder;
    nodes.mainInput.value = '';
    nodes.optionArea.hidden = !item.usesOptions;
    nodes.length.value = '標準';
    nodes.tone.value = '丁寧';
    renderMiniTools();
    showScreen('editor');
    setTimeout(() => nodes.mainInput.focus(), 250);
  }

  function baseHeader() {
    return '【STEP2.5 動作確認用】\n※現在はAI未接続のため、画面動作を確認するための仮出力です。\n\n';
  }

  function createDemoResult(id, input, length, tone, quickMode = '') {
    const adjust = {
      shorter: '（短めに調整した想定）',
      casual: '（やわらかい表現に調整した想定）',
      formal: '（より正式な表現に調整した想定）',
      retry: '（別の表現で再作成した想定）'
    }[quickMode] || '';

    if (id === 'check') {
      return baseHeader() + `【確認対象】\n${input}\n\n【確認結果】\n・誤字脱字：AI未接続のため、まだ確認していません。\n・表記：AI接続後、修正箇所・理由・修正案を表示します。\n・確認推奨：日付、氏名、役職、固有名詞は原文資料と照合してください。\n\n【修正例】\n入力文の内容を保ちながら、より簡潔で自然な表現に整えた文章をここに表示します。`;
    }

    if (id === 'meeting') {
      return baseHeader() + `【決定事項】\n・会議メモから決定した内容を整理して表示します。\n\n【課題・確認事項】\n・今後確認が必要な内容を抽出します。\n\n【担当・期限】\n・担当者や期限が入力されている場合に整理します。\n\n【元メモ】\n${input}`;
    }

    if (id === 'lesson') {
      return baseHeader() + `【授業のねらい】\n入力内容から、本時で大切にしたい学びを整理します。\n\n【授業展開案】\n1. 導入：既習事項や身近な経験から問いをもつ。\n2. 展開：個人で考えた後、対話を通して考えを広げる。\n3. まとめ：学んだことを自分の言葉で振り返る。\n\n【発問例】\n「どこからそう考えましたか？」\n「別の見方はできそうですか？」\n\n【入力内容】\n${input}`;
    }

    if (id === 'research') {
      return baseHeader() + `【テーマの整理】\n${input}\n\n【協議の柱（案）】\n1. 現在の課題を具体的な生徒の姿から捉える。\n2. 実践で有効だった手立てを共有する。\n3. 次の実践で試すことを明確にする。\n\n【次の一歩】\n実践→振り返り→改善がつながる形で研究を進めます。`;
    }

    if (id === 'faq') {
      return baseHeader() + `【質問】\n${input}\n\n【STEP2.5での表示】\n校内FAQはまだ校内資料と接続していません。\n後工程では、登録された校内ルール・マニュアル等を検索し、根拠を示した回答へ切り替えます。`;
    }

    if (id === 'rewrite') {
      return baseHeader() + `【元の文章】\n${input}\n\n【言い換え案】\n内容の意味を変えず、${tone}で読みやすい表現に整えた文章をここに表示します。${adjust}`;
    }

    const heading = tool(id).title;
    const lengthText = length === '短め' ? '要点を短くまとめた' : length === '詳しく' ? '必要事項を詳しく整理した' : '読みやすい長さに整えた';
    return baseHeader() + `${heading}\n\nいつも本校の教育活動にご理解とご協力をいただき、ありがとうございます。\n\n以下の内容について、${lengthText}${tone}な文章をここに作成します。\n\n【入力された内容】\n${input}\n\n内容をご確認のうえ、必要に応じて修正してご利用ください。${adjust}`;
  }

  function generateResult(quickMode = '') {
    const input = nodes.mainInput.value.trim();
    if (!input) {
      showToast('内容を入力してください。');
      nodes.mainInput.focus();
      return;
    }
    const item = tool(state.currentTool);
    state.lastResult = createDemoResult(state.currentTool, input, nodes.length.value, nodes.tone.value, quickMode);
    nodes.resultTitle.textContent = item.title;
    nodes.resultOutput.textContent = state.lastResult;
    nodes.resultTip.textContent = item.tip;
    showScreen('result');
  }

  async function copyResult() {
    if (!state.lastResult) return;
    try {
      await navigator.clipboard.writeText(state.lastResult);
      showToast('完成文章をコピーしました。');
    } catch {
      showToast('コピーできませんでした。文章を選択してコピーしてください。');
    }
  }

  nodes.homeTools.forEach((button) => {
    button.addEventListener('click', () => openEditor(button.dataset.toolId));
  });
  nodes.backHome?.addEventListener('click', () => showScreen('home'));
  nodes.backEditor?.addEventListener('click', () => showScreen('editor'));
  nodes.homeFromResult?.addEventListener('click', () => showScreen('home'));
  nodes.form?.addEventListener('submit', (event) => { event.preventDefault(); generateResult(); });
  nodes.copyButton?.addEventListener('click', copyResult);
  nodes.quickButtons.forEach((button) => {
    button.addEventListener('click', () => generateResult(button.dataset.quickEdit || ''));
  });
  nodes.helpButton?.addEventListener('click', () => showToast('機能を選ぶ → 内容を入力 →「AIで作成する」の順です。'));
  nodes.settingsButton?.addEventListener('click', () => showToast('設定機能は後のSTEPで追加します。'));
})();
