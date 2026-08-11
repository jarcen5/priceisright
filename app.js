(() => {
  'use strict';

  const STORAGE_KEY = 'priceChallenge.settings.v1';
  const DB_NAME = 'priceChallengeDB';
  const DB_STORE = 'games';
  const DB_VERSION = 1;

  const defaultColors = ['#ef4444', '#2563eb', '#16a34a', '#9333ea'];

  const state = {
    screen: 'setup',
    game: {
      title: 'Price Challenge',
      timerSeconds: 30,
      sound: true,
      teams: [
        { id: uid(), name: 'Team 1', color: defaultColors[0], score: 0 },
        { id: uid(), name: 'Team 2', color: defaultColors[1], score: 0 }
      ],
      items: []
    },
    roundIndex: 0,
    turnIndex: 0,
    turnStatus: 'ready', // ready | bidding | complete | revealed
    bids: {},
    remaining: 30,
    timerId: null,
    editItemId: null,
    scoredRound: false,
    savedGames: [],
    hostControlsOpen: false,
    revealTimerId: null
  };

  const app = document.getElementById('app');
  let dbPromise = null;
  let toastTimer = null;

  init();

  async function init() {
    loadSettings();
    await refreshSavedGames();
    render();
  }

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  }

  function beep(kind = 'normal') {
    if (!state.game.sound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.055;
      master.connect(ctx.destination);

      const tones = {
        normal: [[520, 0, .08]],
        start: [[480, 0, .08], [620, .09, .09]],
        lock: [[620, 0, .07], [820, .08, .1]],
        urgent: [[760, 0, .07]],
        timeup: [[320, 0, .12], [240, .14, .18]],
        reveal: [[440, 0, .09], [560, .1, .09], [700, .2, .16]],
        win: [[660, 0, .11], [820, .12, .11], [990, .24, .24]]
      };
      const sequence = tones[kind] || tones.normal;
      let endAt = 0;
      sequence.forEach(([frequency, delay, duration]) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(1, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(.01, ctx.currentTime + delay + duration);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(ctx.currentTime + delay);
        oscillator.stop(ctx.currentTime + delay + duration);
        endAt = Math.max(endAt, delay + duration);
      });
      setTimeout(() => ctx.close(), Math.ceil((endAt + .1) * 1000));
    } catch (_) {}
  }

  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function saveSettings() {
    const safe = {
      title: state.game.title,
      timerSeconds: state.game.timerSeconds,
      sound: state.game.sound,
      teams: state.game.teams.map(({ id, name, color }) => ({ id, name, color }))
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safe)); }
    catch (_) {}
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;
      state.game.title = saved.title || state.game.title;
      state.game.timerSeconds = Number(saved.timerSeconds) || 30;
      state.game.sound = saved.sound !== false;
      if (Array.isArray(saved.teams) && saved.teams.length >= 2) {
        state.game.teams = saved.teams.slice(0,4).map((t, i) => ({
          id: t.id || uid(),
          name: t.name || `Team ${i+1}`,
          color: t.color || defaultColors[i],
          score: 0
        }));
      }
      state.remaining = state.game.timerSeconds;
    } catch (_) {}
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function dbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function refreshSavedGames() {
    try {
      state.savedGames = (await dbGetAll()).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (_) {
      state.savedGames = [];
    }
  }

  function serializeGame() {
    return {
      id: uid(),
      version: 1,
      title: state.game.title.trim() || 'Price Challenge',
      timerSeconds: Number(state.game.timerSeconds),
      sound: state.game.sound,
      teams: state.game.teams.map(({ name, color }) => ({ name, color })),
      items: state.game.items.map(({ name, price, image }) => ({ name, price: Number(price), image: image || '' })),
      updatedAt: Date.now()
    };
  }

  function loadSerializedGame(saved) {
    stopTimer();
    state.game = {
      title: saved.title || 'Price Challenge',
      timerSeconds: Math.max(5, Number(saved.timerSeconds) || 30),
      sound: saved.sound !== false,
      teams: (saved.teams || []).slice(0,4).map((t, i) => ({
        id: uid(), name: t.name || `Team ${i+1}`, color: t.color || defaultColors[i], score: 0
      })),
      items: (saved.items || []).map(item => ({
        id: uid(), name: item.name || 'Mystery Item', price: Number(item.price) || 0, image: item.image || ''
      }))
    };
    while (state.game.teams.length < 2) {
      const i = state.game.teams.length;
      state.game.teams.push({ id: uid(), name: `Team ${i+1}`, color: defaultColors[i], score: 0 });
    }
    state.remaining = state.game.timerSeconds;
    state.screen = 'setup';
    state.editItemId = null;
    resetGameProgress();
    saveSettings();
    render();
  }

  function resetGameProgress() {
    state.roundIndex = 0;
    state.turnIndex = 0;
    state.turnStatus = 'ready';
    state.bids = {};
    state.scoredRound = false;
    state.game.teams.forEach(t => t.score = 0);
    state.remaining = state.game.timerSeconds;
  }

  function render() {
    app.innerHTML = `
      <main class="app-shell">
        ${renderTopbar()}
        ${state.screen !== 'setup' && state.hostControlsOpen ? renderHostControls() : ''}
        ${state.screen === 'setup' ? renderSetup() : ''}
        ${state.screen === 'game' ? renderGame() : ''}
        ${state.screen === 'end' ? renderEnd() : ''}
      </main>
    `;
    bindEvents();
  }

  function renderTopbar() {
    return `
      <header class="topbar">
        <div class="brand">
          <div class="logo" aria-hidden="true">$</div>
          <div>
            <h1>${escapeHtml(state.game.title || 'Price Challenge')}</h1>
            <p>Closest without going over wins the round.</p>
          </div>
        </div>
        <div class="top-actions">
          ${state.screen === 'setup'
            ? `<button class="ghost" data-action="toggle-sound">${state.game.sound ? '🔊 Sound On' : '🔇 Sound Off'}</button>`
            : `<button class="ghost host-button" data-action="toggle-host">🎛️ ${state.hostControlsOpen ? 'Hide Host' : 'Host Controls'}</button>`}
        </div>
      </header>
    `;
  }

  function renderHostControls() {
    return `
      <section class="host-controls" aria-label="Host controls">
        <div>
          <strong>🎛️ Host Controls</strong>
          <span class="helper">Keep this panel closed while teams are playing.</span>
        </div>
        <div class="host-actions">
          <button class="ghost" data-action="toggle-sound">${state.game.sound ? '🔊 Sound On' : '🔇 Sound Off'}</button>
          <button data-action="back-setup">✏️ Edit Game</button>
        </div>
      </section>
    `;
  }

  function renderSetup() {
    return `
      <section class="grid two">
        <div class="card">
          <div class="section-title"><h2>Game Setup</h2><span class="helper">2–4 teams</span></div>
          <div class="field">
            <label for="game-title">Game title</label>
            <input id="game-title" type="text" maxlength="50" value="${escapeHtml(state.game.title)}" />
          </div>
          <div class="field">
            <label for="timer-seconds">Time per team</label>
            <select id="timer-seconds">
              ${[15,20,30,45,60,90].map(n => `<option value="${n}" ${Number(state.game.timerSeconds) === n ? 'selected' : ''}>${n} seconds</option>`).join('')}
            </select>
            <div class="helper" style="margin-top:6px">The timer starts only after that team taps “Start My Timer.”</div>
          </div>
          <div class="section-title" style="margin-top:22px"><h3>Teams</h3><button data-action="add-team" ${state.game.teams.length >= 4 ? 'disabled' : ''}>+ Add Team</button></div>
          <div id="team-editors">
            ${state.game.teams.map((team, i) => `
              <div class="team-editor" data-team-id="${team.id}">
                <div class="field">
                  <label for="team-color-${i}">Color</label>
                  <input id="team-color-${i}" type="color" data-role="team-color" value="${escapeHtml(team.color)}" />
                </div>
                <div class="field">
                  <label for="team-name-${i}">Team ${i+1}</label>
                  <div style="display:flex;gap:8px">
                    <input id="team-name-${i}" type="text" data-role="team-name" maxlength="28" value="${escapeHtml(team.name)}" />
                    ${state.game.teams.length > 2 ? '<button class="danger" data-action="remove-team" title="Remove team">✕</button>' : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="section-title"><h2>Saved Games</h2><button data-action="save-game">Save Current</button></div>
          <p class="helper">Saved games stay in this browser. Export a JSON backup if you want to move them to another computer.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            <button data-action="export-game">⬇ Export</button>
            <label class="button-like" for="import-file">⬆ Import</label>
            <input id="import-file" class="hidden" type="file" accept="application/json,.json" />
          </div>
          ${state.savedGames.length ? `
            <div class="item-list">
              ${state.savedGames.map(g => `
                <div class="item-row">
                  <div class="item-thumb placeholder">🎮</div>
                  <div class="item-meta"><strong>${escapeHtml(g.title)}</strong><span>${(g.items || []).length} item${(g.items || []).length === 1 ? '' : 's'} · ${g.timerSeconds || 30}s</span></div>
                  <div class="item-actions">
                    <button data-action="load-saved" data-id="${g.id}">Load</button>
                    <button class="danger" data-action="delete-saved" data-id="${g.id}">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="empty-state">No saved games yet.</div>'}
        </div>
      </section>

      <section class="card" style="margin-top:18px">
        <div class="section-title"><h2>Price Items</h2><span class="helper">${state.game.items.length} round${state.game.items.length === 1 ? '' : 's'}</span></div>
        <div class="item-form">
          <div class="field">
            <label for="item-name">Item name</label>
            <input id="item-name" type="text" maxlength="70" placeholder="Example: Giant LEGO Set" />
          </div>
          <div class="field">
            <label for="item-price">Actual price</label>
            <input id="item-price" type="number" min="0.01" step="0.01" placeholder="119.99" />
          </div>
          <div class="field image-field">
            <label for="item-image">Picture</label>
            <input id="item-image" type="file" accept="image/*" />
          </div>
          <button class="primary add-item-button" data-action="add-item">+ Add Item</button>
        </div>
        <div class="helper" style="margin-top:10px">Pictures are resized in your browser before saving so a game can hold more items.</div>
        <div class="item-list">
          ${state.game.items.length ? state.game.items.map((item, i) => `
            <div class="item-row">
              ${item.image ? `<img class="item-thumb" src="${item.image}" alt="${escapeHtml(item.name)}" />` : '<div class="item-thumb placeholder">🛍️</div>'}
              <div class="item-meta"><strong>${i+1}. ${escapeHtml(item.name)}</strong><span>${money(item.price)}</span></div>
              <div class="item-actions">
                <button data-action="move-item-up" data-id="${item.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button data-action="move-item-down" data-id="${item.id}" ${i === state.game.items.length - 1 ? 'disabled' : ''}>↓</button>
                <button data-action="edit-item" data-id="${item.id}">Edit</button>
                <button class="danger" data-action="delete-item" data-id="${item.id}">Delete</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">Add at least one item to start the game.</div>'}
        </div>
        <div class="setup-footer">
          <div class="helper">Tip: You can save or export the game after adding all your items.</div>
          <button class="primary big" data-action="start-game" ${state.game.items.length < 1 ? 'disabled' : ''}>Start Game →</button>
        </div>
      </section>
    `;
  }

  function renderScoreboard() {
    const currentTeam = state.game.teams[state.turnIndex];
    const item = state.game.items[state.roundIndex];
    const roundWinners = state.turnStatus === 'revealed' && item ? getRoundResults(item).winners : [];
    return `
      <section class="scoreboard" aria-label="Scoreboard">
        ${state.game.teams.map(team => {
          const bid = state.bids[team.id];
          const isRoundWinner = roundWinners.includes(team.id);
          let status = 'Waiting';
          if (isRoundWinner) status = '🏆 Round winner';
          else if (bid?.timedOut) status = 'No bid';
          else if (bid?.locked) status = '🔒 Locked';
          else if (team.id === currentTeam?.id && !['complete','revealing','revealed'].includes(state.turnStatus)) status = 'Your turn';
          const active = team.id === currentTeam?.id && !['complete','revealing','revealed'].includes(state.turnStatus);
          return `
            <div class="score-card ${active ? 'active' : ''} ${isRoundWinner ? 'round-winner' : ''}" style="--team-color:${team.color}">
              <div class="team-color-strip"></div>
              <div class="name">${escapeHtml(team.name)}</div>
              <div class="score">${team.score}</div>
              <div class="status">${status}</div>
            </div>
          `;
        }).join('')}
      </section>
    `;
  }

  function renderGame() {
    const item = state.game.items[state.roundIndex];
    if (!item) return renderEnd();
    const team = state.game.teams[state.turnIndex];
    const percent = Math.max(0, Math.min(100, (state.remaining / state.game.timerSeconds) * 100));
    const timerClass = state.remaining <= 5 ? 'danger' : state.remaining <= 10 ? 'warning' : '';

    return `
      ${renderScoreboard()}
      <section class="game-layout ${state.turnStatus === 'revealed' ? 'has-reveal' : ''}">
        <div class="card product-stage">
          <div class="round-kicker">Round ${state.roundIndex + 1} of ${state.game.items.length}</div>
          <h2>${escapeHtml(item.name)}</h2>
          ${item.image ? `<img class="product-image" src="${item.image}" alt="${escapeHtml(item.name)}" />` : '<div class="product-placeholder" aria-label="No product image">🛒</div>'}
          <p class="helper" style="margin-top:14px">Guess the retail price. Closest bid without going over wins 1 point.</p>
        </div>

        <aside class="card turn-panel ${timerClass}">
          ${state.turnStatus === 'ready' ? `
            <div class="ready-box">
              <div class="pass-icon">🤲</div>
              <div class="round-kicker">Next up</div>
              <h2>Pass to ${escapeHtml(team.name)}</h2>
              <div class="turn-team" style="--team-color:${team.color}"><span class="team-dot"></span>${escapeHtml(team.name)}</div>
              <p class="helper">Your ${state.game.timerSeconds}-second timer starts only when you press the button. Other teams: look away!</p>
              <button class="primary big game-show-button" data-action="start-turn">Start My Timer</button>
            </div>
          ` : ''}

          ${state.turnStatus === 'bidding' ? `
            <div class="turn-team" style="--team-color:${team.color}"><span class="team-dot"></span>${escapeHtml(team.name)}</div>
            <div class="timer-shell ${timerClass}" style="--timer-progress:${percent}">
              <div class="timer-ring">
                <div class="timer ${timerClass}" aria-live="polite">${state.remaining}</div>
                <div class="timer-label">seconds</div>
              </div>
            </div>
            <div class="timer-bar"><div style="width:${percent}%"></div></div>
            <div class="hurry-label ${state.remaining <= 5 ? 'show' : ''}" aria-hidden="true">HURRY!</div>
            <div class="bid-wrap">
              <label for="bid-input">Your bid</label>
              <div class="currency-input"><span>$</span><input id="bid-input" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off" placeholder="0.00" /></div>
              <button class="success big lock-button" style="width:100%;margin-top:12px" data-action="lock-bid">🔒 Lock In</button>
            </div>
            <p class="helper">Once locked, your bid is hidden and cannot be changed.</p>
          ` : ''}

          ${state.turnStatus === 'complete' ? `
            <div class="ready-box">
              <div class="pass-icon">✅</div>
              <h2>All teams are locked!</h2>
              <p class="helper">Bids stay hidden until you reveal the actual price.</p>
              <button class="primary big reveal-button" data-action="reveal-price">✨ Reveal Price</button>
            </div>
          ` : ''}

          ${state.turnStatus === 'revealing' ? `
            <div class="dramatic-reveal" aria-live="assertive">
              <div class="reveal-spark">✨</div>
              <div class="round-kicker">And the actual price is…</div>
              <div class="mystery-price">$ ? ? ?</div>
              <div class="reveal-dots"><span></span><span></span><span></span></div>
            </div>
          ` : ''}

          ${state.turnStatus === 'revealed' ? renderReveal(item) : ''}

          ${!['revealed','revealing'].includes(state.turnStatus) ? `
            <div class="locked-grid">
              ${state.game.teams.map(t => {
                const b = state.bids[t.id];
                return `<div class="lock-row"><strong>${escapeHtml(t.name)}</strong><span class="lock-badge">${b?.timedOut ? '⏰ No bid' : b?.locked ? '🔒 Locked' : 'Waiting'}</span></div>`;
              }).join('')}
            </div>
          ` : ''}
          <div class="progress-line">Item ${state.roundIndex + 1} / ${state.game.items.length}</div>
        </aside>
      </section>
    `;
  }

  function getRoundResults(item) {
    const valid = state.game.teams
      .map(team => ({ team, bid: state.bids[team.id] }))
      .filter(x => x.bid?.locked && !x.bid.timedOut && Number(x.bid.amount) <= Number(item.price));

    const best = valid.length ? Math.max(...valid.map(x => Number(x.bid.amount))) : null;
    const winners = best === null ? [] : valid.filter(x => Number(x.bid.amount) === best).map(x => x.team.id);
    return { best, winners };
  }

  function renderReveal(item) {
    const { winners } = getRoundResults(item);
    const winnerNames = state.game.teams.filter(t => winners.includes(t.id)).map(t => t.name);
    let banner = 'No winner this round — every bid was over or missing.';
    if (winnerNames.length === 1) banner = `🏆 ${escapeHtml(winnerNames[0])} wins the round!`;
    if (winnerNames.length > 1) banner = `🏆 Tie! ${winnerNames.map(escapeHtml).join(' & ')} each get a point.`;

    return `
      <div class="reveal-results">
        <div class="round-kicker">Actual Price</div>
        <div class="reveal-price">${money(item.price)}</div>
        <div class="winner-banner ${winners.length ? 'celebrate' : ''}">${banner}</div>
        <div class="results">
          ${state.game.teams.map(team => {
            const bid = state.bids[team.id];
            const isWinner = winners.includes(team.id);
            const amount = bid?.amount;
            const timedOut = bid?.timedOut;
            const over = !timedOut && bid?.locked && Number(amount) > Number(item.price);
            const diff = !timedOut && bid?.locked ? Number(item.price) - Number(amount) : null;
            const note = timedOut ? 'Timer expired' : over ? `${money(Math.abs(diff))} over` : bid?.locked ? `${money(diff)} under` : 'No bid';
            return `
              <div class="result-row ${isWinner ? 'winner' : ''} ${over ? 'over' : ''}" style="--team-color:${team.color}">
                <div><div class="result-name">${escapeHtml(team.name)} ${isWinner ? '⭐' : ''}</div><div class="result-note">${note}</div></div>
                <strong>${timedOut || !bid?.locked ? '—' : money(amount)}</strong>
                <span>${over ? '❌' : isWinner ? '🏆' : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="controls-row">
          ${state.roundIndex < state.game.items.length - 1
            ? '<button class="primary big game-show-button" data-action="next-round">Next Round →</button>'
            : '<button class="primary big game-show-button" data-action="finish-game">Finish Game 🏆</button>'}
        </div>
      </div>
    `;
  }

  function renderEnd() {
    const ranking = [...state.game.teams].sort((a,b) => b.score - a.score);
    const top = ranking[0]?.score ?? 0;
    const champions = ranking.filter(t => t.score === top);
    const championText = champions.length === 1
      ? `${escapeHtml(champions[0].name)} wins!`
      : `It's a tie: ${champions.map(t => escapeHtml(t.name)).join(' & ')}!`;
    const medals = ['🥇','🥈','🥉','⭐'];
    return `
      ${renderScoreboard()}
      <section class="card end-screen">
        <div class="finale-kicker">FINAL RESULTS</div>
        <div class="trophy">🏆</div>
        <h2>${championText}</h2>
        <p class="helper">What a game! Here are the final scores.</p>
        <div class="final-ranking">
          ${ranking.map((team, i) => `
            <div class="final-row ${i === 0 ? 'champion-row' : ''}" style="--team-color:${team.color}">
              <div class="final-team"><span class="final-medal">${medals[i] || '⭐'}</span><strong>${escapeHtml(team.name)}</strong></div>
              <span>${team.score} point${team.score === 1 ? '' : 's'}</span>
            </div>
          `).join('')}
        </div>
        <div class="controls-row">
          <button class="primary big game-show-button" data-action="play-again">Play Again</button>
          <button data-action="back-setup">Edit Game</button>
        </div>
      </section>
    `;
  }

  function bindEvents() {
    document.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', handleAction);
    });

    const titleInput = document.getElementById('game-title');
    if (titleInput) titleInput.addEventListener('input', e => {
      state.game.title = e.target.value;
      saveSettings();
    });

    const timerSelect = document.getElementById('timer-seconds');
    if (timerSelect) timerSelect.addEventListener('change', e => {
      state.game.timerSeconds = Number(e.target.value);
      state.remaining = state.game.timerSeconds;
      saveSettings();
    });

    document.querySelectorAll('[data-role="team-name"]').forEach(input => {
      input.addEventListener('input', e => {
        const id = e.target.closest('[data-team-id]').dataset.teamId;
        const team = state.game.teams.find(t => t.id === id);
        if (team) team.name = e.target.value;
        saveSettings();
      });
    });

    document.querySelectorAll('[data-role="team-color"]').forEach(input => {
      input.addEventListener('input', e => {
        const id = e.target.closest('[data-team-id]').dataset.teamId;
        const team = state.game.teams.find(t => t.id === id);
        if (team) team.color = e.target.value;
        saveSettings();
      });
    });

    const importInput = document.getElementById('import-file');
    if (importInput) importInput.addEventListener('change', importGame);

    const bidInput = document.getElementById('bid-input');
    if (bidInput) {
      setTimeout(() => bidInput.focus(), 0);
      bidInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') lockBid();
      });
    }
  }

  async function handleAction(e) {
    const action = e.currentTarget.dataset.action;
    const id = e.currentTarget.dataset.id;
    switch (action) {
      case 'toggle-sound':
        state.game.sound = !state.game.sound; saveSettings(); render(); break;
      case 'toggle-host':
        state.hostControlsOpen = !state.hostControlsOpen; render(); break;
      case 'add-team': addTeam(); break;
      case 'remove-team': removeTeam(e.currentTarget); break;
      case 'add-item': await addItem(); break;
      case 'edit-item': editItem(id); break;
      case 'delete-item': deleteItem(id); break;
      case 'move-item-up': moveItem(id, -1); break;
      case 'move-item-down': moveItem(id, 1); break;
      case 'start-game': startGame(); break;
      case 'start-turn': startTurn(); break;
      case 'lock-bid': lockBid(); break;
      case 'reveal-price': revealPrice(); break;
      case 'next-round': nextRound(); break;
      case 'finish-game': finishGame(); break;
      case 'play-again': playAgain(); break;
      case 'back-setup': backToSetup(); break;
      case 'save-game': await saveCurrentGame(); break;
      case 'load-saved': await loadSavedGame(id); break;
      case 'delete-saved': await deleteSavedGame(id); break;
      case 'export-game': exportGame(); break;
    }
  }

  function addTeam() {
    if (state.game.teams.length >= 4) return;
    const i = state.game.teams.length;
    state.game.teams.push({ id: uid(), name: `Team ${i+1}`, color: defaultColors[i], score: 0 });
    saveSettings();
    render();
  }

  function removeTeam(button) {
    if (state.game.teams.length <= 2) return;
    const id = button.closest('[data-team-id]').dataset.teamId;
    state.game.teams = state.game.teams.filter(t => t.id !== id);
    saveSettings();
    render();
  }

  async function resizeImage(file, maxDimension = 1100, quality = .78) {
    if (!file) return '';
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });

    let width = img.width;
    let height = img.height;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function addItem() {
    const nameEl = document.getElementById('item-name');
    const priceEl = document.getElementById('item-price');
    const imageEl = document.getElementById('item-image');
    const name = nameEl.value.trim();
    const price = Number(priceEl.value);
    if (!name) return showToast('Please enter an item name.');
    if (!(price > 0)) return showToast('Please enter a price greater than $0.');

    let image = '';
    const file = imageEl.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) return showToast('Please choose an image file.');
      if (file.size > 15 * 1024 * 1024) return showToast('That image is too large. Please choose one under 15 MB.');
      try { image = await resizeImage(file); }
      catch (_) { return showToast('I could not read that image. Try a different file.'); }
    }

    state.game.items.push({ id: uid(), name, price: Number(price.toFixed(2)), image });
    render();
    showToast('Item added.');
  }

  function editItem(id) {
    const item = state.game.items.find(x => x.id === id);
    if (!item) return;
    openItemEditModal(item);
  }

  function openItemEditModal(item) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <h3 id="edit-title">Edit Item</h3>
        <div class="field"><label for="modal-name">Item name</label><input id="modal-name" type="text" value="${escapeHtml(item.name)}"></div>
        <div class="field"><label for="modal-price">Actual price</label><input id="modal-price" type="number" min="0.01" step="0.01" value="${Number(item.price).toFixed(2)}"></div>
        <div class="field"><label for="modal-image">Replace picture (optional)</label><input id="modal-image" type="file" accept="image/*"></div>
        <div class="modal-actions"><button data-modal="cancel">Cancel</button><button class="primary" data-modal="save">Save Changes</button></div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-modal="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-modal="save"]').addEventListener('click', async () => {
      const name = backdrop.querySelector('#modal-name').value.trim();
      const price = Number(backdrop.querySelector('#modal-price').value);
      if (!name || !(price > 0)) return showToast('Enter a valid name and price.');
      const file = backdrop.querySelector('#modal-image').files?.[0];
      if (file) {
        try { item.image = await resizeImage(file); }
        catch (_) { return showToast('I could not read that image.'); }
      }
      item.name = name;
      item.price = Number(price.toFixed(2));
      backdrop.remove();
      render();
      showToast('Item updated.');
    });
  }

  function deleteItem(id) {
    state.game.items = state.game.items.filter(x => x.id !== id);
    render();
  }

  function moveItem(id, direction) {
    const i = state.game.items.findIndex(x => x.id === id);
    const target = i + direction;
    if (i < 0 || target < 0 || target >= state.game.items.length) return;
    [state.game.items[i], state.game.items[target]] = [state.game.items[target], state.game.items[i]];
    render();
  }

  function startGame() {
    syncSetupInputs();
    if (state.game.items.length < 1) return showToast('Add at least one item first.');
    if (state.game.teams.some(t => !t.name.trim())) return showToast('Give every team a name.');
    resetGameProgress();
    state.screen = 'game';
    state.hostControlsOpen = false;
    saveSettings();
    render();
  }

  function syncSetupInputs() {
    const title = document.getElementById('game-title');
    if (title) state.game.title = title.value.trim() || 'Price Challenge';
    document.querySelectorAll('[data-role="team-name"]').forEach(input => {
      const id = input.closest('[data-team-id]').dataset.teamId;
      const team = state.game.teams.find(t => t.id === id);
      if (team) team.name = input.value.trim();
    });
  }

  function startTurn() {
    state.turnStatus = 'bidding';
    state.remaining = state.game.timerSeconds;
    beep('start');
    render();
    stopTimer();
    state.timerId = setInterval(() => {
      state.remaining -= 1;
      if (state.remaining <= 5 && state.remaining > 0) beep('urgent');
      if (state.remaining <= 0) {
        state.remaining = 0;
        stopTimer();
        timeoutBid();
        return;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function updateTimerDisplay() {
    const timer = document.querySelector('.timer');
    const bar = document.querySelector('.timer-bar > div');
    const shell = document.querySelector('.timer-shell');
    const panel = document.querySelector('.turn-panel');
    const hurry = document.querySelector('.hurry-label');
    const percent = Math.max(0, (state.remaining / state.game.timerSeconds) * 100);
    if (timer) {
      timer.textContent = state.remaining;
      timer.classList.toggle('danger', state.remaining <= 5);
      timer.classList.toggle('warning', state.remaining <= 10 && state.remaining > 5);
    }
    if (shell) {
      shell.style.setProperty('--timer-progress', percent);
      shell.classList.toggle('danger', state.remaining <= 5);
      shell.classList.toggle('warning', state.remaining <= 10 && state.remaining > 5);
    }
    if (panel) {
      panel.classList.toggle('danger', state.remaining <= 5);
      panel.classList.toggle('warning', state.remaining <= 10 && state.remaining > 5);
    }
    if (hurry) hurry.classList.toggle('show', state.remaining <= 5);
    if (bar) bar.style.width = `${percent}%`;
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function lockBid() {
    if (state.turnStatus !== 'bidding') return;
    const input = document.getElementById('bid-input');
    const amount = Number(input?.value);
    if (!Number.isFinite(amount) || amount < 0) return showToast('Enter a valid bid first.');
    stopTimer();
    const team = state.game.teams[state.turnIndex];
    state.bids[team.id] = { amount: Number(amount.toFixed(2)), locked: true, timedOut: false };
    beep('lock');
    advanceTurn();
  }

  function timeoutBid() {
    const team = state.game.teams[state.turnIndex];
    state.bids[team.id] = { amount: null, locked: false, timedOut: true };
    beep('timeup');
    showToast(`${team.name} ran out of time — no bid recorded.`);
    advanceTurn();
  }

  function advanceTurn() {
    if (state.turnIndex < state.game.teams.length - 1) {
      state.turnIndex += 1;
      state.turnStatus = 'ready';
      state.remaining = state.game.timerSeconds;
    } else {
      state.turnStatus = 'complete';
    }
    render();
  }

  function revealPrice() {
    if (state.turnStatus !== 'complete') return;
    clearRevealTimer();
    state.turnStatus = 'revealing';
    beep('reveal');
    render();
    state.revealTimerId = setTimeout(finalizeReveal, 1350);
  }

  function finalizeReveal() {
    state.revealTimerId = null;
    if (state.turnStatus !== 'revealing') return;
    state.turnStatus = 'revealed';
    const item = state.game.items[state.roundIndex];
    let winners = [];
    if (!state.scoredRound) {
      winners = getRoundResults(item).winners;
      winners.forEach(id => {
        const team = state.game.teams.find(t => t.id === id);
        if (team) team.score += 1;
      });
      state.scoredRound = true;
    } else {
      winners = getRoundResults(item).winners;
    }
    render();
    if (winners.length) {
      beep('win');
      const colors = state.game.teams.filter(t => winners.includes(t.id)).map(t => t.color);
      setTimeout(() => launchConfetti(colors), 100);
    }
  }

  function clearRevealTimer() {
    if (state.revealTimerId) clearTimeout(state.revealTimerId);
    state.revealTimerId = null;
  }

  function nextRound() {
    clearRevealTimer();
    state.roundIndex += 1;
    state.turnIndex = 0;
    state.turnStatus = 'ready';
    state.bids = {};
    state.scoredRound = false;
    state.remaining = state.game.timerSeconds;
    render();
  }

  function finishGame() {
    stopTimer();
    clearRevealTimer();
    state.screen = 'end';
    state.hostControlsOpen = false;
    render();
    const top = Math.max(...state.game.teams.map(t => t.score));
    const colors = state.game.teams.filter(t => t.score === top).map(t => t.color);
    setTimeout(() => launchConfetti(colors, 95), 120);
    beep('win');
  }

  function playAgain() {
    clearRevealTimer();
    resetGameProgress();
    state.screen = 'game';
    state.hostControlsOpen = false;
    render();
  }

  function backToSetup() {
    stopTimer();
    clearRevealTimer();
    state.screen = 'setup';
    state.hostControlsOpen = false;
    render();
  }


  function launchConfetti(colors = [], count = 70) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const palette = colors.length ? colors : defaultColors;
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    layer.setAttribute('aria-hidden', 'true');
    const shapes = ['■', '●', '▲'];
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.textContent = shapes[i % shapes.length];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.color = palette[i % palette.length];
      piece.style.animationDelay = `${Math.random() * .45}s`;
      piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
      piece.style.fontSize = `${8 + Math.random() * 10}px`;
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 4300);
  }

  async function saveCurrentGame() {
    syncSetupInputs();
    if (!state.game.items.length) return showToast('Add at least one item before saving.');
    const saved = serializeGame();
    try {
      await dbPut(saved);
      await refreshSavedGames();
      render();
      showToast('Game saved in this browser.');
    } catch (_) {
      showToast('Could not save this game in the browser. Try Export instead.');
    }
  }

  async function loadSavedGame(id) {
    const game = state.savedGames.find(g => g.id === id);
    if (!game) return;
    loadSerializedGame(game);
    showToast('Saved game loaded.');
  }

  async function deleteSavedGame(id) {
    try {
      await dbDelete(id);
      await refreshSavedGames();
      render();
      showToast('Saved game deleted.');
    } catch (_) { showToast('Could not delete that saved game.'); }
  }

  function exportGame() {
    syncSetupInputs();
    if (!state.game.items.length) return showToast('Add at least one item before exporting.');
    const data = serializeGame();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(data.title) || 'price-challenge'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importGame(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.items) || !Array.isArray(parsed.teams)) throw new Error('Invalid');
      loadSerializedGame(parsed);
      showToast('Game imported.');
    } catch (_) {
      showToast('That file is not a valid Price Challenge game.');
    } finally {
      e.target.value = '';
    }
  }

  function slugify(value) {
    return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
})();
