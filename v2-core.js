(() => {
  'use strict';

  const P = window.PC = {};

  P.STORAGE_KEY = 'priceChallenge.settings.v2';
  P.LEGACY_STORAGE_KEY = 'priceChallenge.settings.v1';
  P.DB_NAME = 'priceChallengeDB';
  P.DB_STORE = 'games';
  P.DB_VERSION = 1;
  P.COLORS = ['#ef4444', '#2563eb', '#16a34a', '#9333ea'];
  P.app = document.getElementById('app');
  P.dbPromise = null;
  P.toastTimer = null;

  P.uid = () => (
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  P.team = (name, index) => ({
    id: P.uid(),
    name,
    color: P.COLORS[index],
    score: 0
  });

  P.esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  P.money = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));

  P.byId = (id) => P.state.game.teams.find((team) => team.id === id);
  P.itemNow = () => P.state.playItems[P.state.roundIndex] || null;
  P.teamNow = () => P.byId(P.state.turnOrder[P.state.turnIndex]);

  P.shuffle = (list) => {
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  P.state = {
    screen: 'teams',
    game: {
      title: 'Price Challenge',
      timerSeconds: 30,
      sound: true,
      randomizeItems: true,
      randomizeTeams: true,
      rotateTeams: true,
      pointsPerRound: 1,
      tieMode: 'both',
      teams: [P.team('Team 1', 0), P.team('Team 2', 1)],
      items: []
    },
    savedGames: [],
    playItems: [],
    baseTeamOrder: [],
    roundIndex: 0,
    turnOrder: [],
    turnIndex: 0,
    turnStatus: 'ready',
    bids: {},
    draftBid: '',
    remaining: 30,
    timerId: null,
    revealTimerId: null,
    paused: false,
    hostControlsOpen: false,
    roundScored: false,
    roundHistory: [],
    pendingTiebreaker: [],
    tiebreakerTeams: null,
    isTiebreaker: false
  };

  P.showToast = (message) => {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(P.toastTimer);
    P.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  };

  P.beep = (kind = 'normal') => {
    if (!P.state.game.sound) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const master = context.createGain();
      master.gain.value = 0.055;
      master.connect(context.destination);

      const tones = {
        normal: [[520, 0, 0.08]],
        start: [[480, 0, 0.08], [620, 0.09, 0.09]],
        lock: [[620, 0, 0.07], [820, 0.08, 0.1]],
        urgent: [[760, 0, 0.07]],
        timeup: [[320, 0, 0.12], [240, 0.14, 0.18]],
        reveal: [[440, 0, 0.09], [560, 0.1, 0.09], [700, 0.2, 0.16]],
        win: [[660, 0, 0.11], [820, 0.12, 0.11], [990, 0.24, 0.24]]
      };

      let endAt = 0;
      (tones[kind] || tones.normal).forEach(([frequency, delay, duration]) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(1, context.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          context.currentTime + delay + duration
        );
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(context.currentTime + delay);
        oscillator.stop(context.currentTime + delay + duration);
        endAt = Math.max(endAt, delay + duration);
      });

      setTimeout(() => context.close(), Math.ceil((endAt + 0.1) * 1000));
    } catch (_) {
      // Sound is optional. The game still works if audio is unavailable.
    }
  };

  P.saveSettings = () => {
    const game = P.state.game;
    const safeSettings = {
      title: game.title,
      timerSeconds: game.timerSeconds,
      sound: game.sound,
      randomizeItems: game.randomizeItems,
      randomizeTeams: game.randomizeTeams,
      rotateTeams: game.rotateTeams,
      pointsPerRound: game.pointsPerRound,
      tieMode: game.tieMode,
      teams: game.teams.map(({ id, name, color }) => ({ id, name, color }))
    };

    try {
      localStorage.setItem(P.STORAGE_KEY, JSON.stringify(safeSettings));
    } catch (_) {
      // Local settings are a convenience only.
    }
  };

  P.loadSettings = () => {
    try {
      const raw = localStorage.getItem(P.STORAGE_KEY)
        || localStorage.getItem(P.LEGACY_STORAGE_KEY);
      const saved = JSON.parse(raw);
      if (!saved) return;

      Object.assign(P.state.game, {
        title: saved.title || 'Price Challenge',
        timerSeconds: Number(saved.timerSeconds) || 30,
        sound: saved.sound !== false,
        randomizeItems: saved.randomizeItems !== false,
        randomizeTeams: saved.randomizeTeams !== false,
        rotateTeams: saved.rotateTeams !== false,
        pointsPerRound: Math.max(1, Number(saved.pointsPerRound) || 1),
        tieMode: saved.tieMode === 'tiebreaker' ? 'tiebreaker' : 'both'
      });

      if (Array.isArray(saved.teams) && saved.teams.length >= 2) {
        P.state.game.teams = saved.teams.slice(0, 4).map((team, index) => ({
          id: team.id || P.uid(),
          name: team.name || `Team ${index + 1}`,
          color: team.color || P.COLORS[index],
          score: 0
        }));
      }

      P.state.remaining = P.state.game.timerSeconds;
    } catch (_) {
      // Keep defaults if old browser settings cannot be read.
    }
  };

  P.openDb = () => {
    if (P.dbPromise) return P.dbPromise;

    P.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(P.DB_NAME, P.DB_VERSION);

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(P.DB_STORE)) {
          request.result.createObjectStore(P.DB_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return P.dbPromise;
  };

  P.dbGetAll = async () => {
    const db = await P.openDb();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(P.DB_STORE, 'readonly')
        .objectStore(P.DB_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  };

  P.dbPut = async (value) => {
    const db = await P.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(P.DB_STORE, 'readwrite');
      transaction.objectStore(P.DB_STORE).put(value);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  };

  P.dbDelete = async (id) => {
    const db = await P.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(P.DB_STORE, 'readwrite');
      transaction.objectStore(P.DB_STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  };

  P.refreshSavedGames = async () => {
    try {
      P.state.savedGames = (await P.dbGetAll())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (_) {
      P.state.savedGames = [];
    }
  };

  P.serializeGame = () => {
    const game = P.state.game;
    return {
      id: P.uid(),
      version: 2,
      title: game.title.trim() || 'Price Challenge',
      timerSeconds: Number(game.timerSeconds),
      sound: game.sound,
      randomizeItems: game.randomizeItems,
      randomizeTeams: game.randomizeTeams,
      rotateTeams: game.rotateTeams,
      pointsPerRound: Number(game.pointsPerRound),
      tieMode: game.tieMode,
      teams: game.teams.map(({ name, color }) => ({ name, color })),
      items: game.items.map(({ name, price, image }) => ({
        name,
        price: Number(price),
        image: image || ''
      })),
      updatedAt: Date.now()
    };
  };

  P.loadSerializedGame = (saved) => {
    P.stopTimer?.();
    P.clearRevealTimer?.();

    P.state.game = {
      title: saved.title || 'Price Challenge',
      timerSeconds: Math.max(5, Number(saved.timerSeconds) || 30),
      sound: saved.sound !== false,
      randomizeItems: saved.randomizeItems !== false,
      randomizeTeams: saved.randomizeTeams !== false,
      rotateTeams: saved.rotateTeams !== false,
      pointsPerRound: Math.max(1, Number(saved.pointsPerRound) || 1),
      tieMode: saved.tieMode === 'tiebreaker' ? 'tiebreaker' : 'both',
      teams: (saved.teams || []).slice(0, 4).map((team, index) => ({
        id: P.uid(),
        name: team.name || `Team ${index + 1}`,
        color: team.color || P.COLORS[index],
        score: 0
      })),
      items: (saved.items || []).map((item) => ({
        id: P.uid(),
        name: item.name || 'Mystery Item',
        price: Number(item.price) || 0,
        image: item.image || ''
      }))
    };

    while (P.state.game.teams.length < 2) {
      const index = P.state.game.teams.length;
      P.state.game.teams.push(P.team(`Team ${index + 1}`, index));
    }

    P.resetProgress();
    P.state.screen = 'teams';
    P.saveSettings();
    P.render();
  };

  P.resetProgress = () => {
    P.stopTimer?.();
    P.clearRevealTimer?.();

    Object.assign(P.state, {
      playItems: [],
      baseTeamOrder: [],
      roundIndex: 0,
      turnOrder: [],
      turnIndex: 0,
      turnStatus: 'ready',
      bids: {},
      draftBid: '',
      remaining: P.state.game.timerSeconds,
      paused: false,
      hostControlsOpen: false,
      roundScored: false,
      roundHistory: [],
      pendingTiebreaker: [],
      tiebreakerTeams: null,
      isTiebreaker: false
    });

    P.state.game.teams.forEach((team) => {
      team.score = 0;
    });
  };

  P.resizeImage = async (file, maxDimension = 1100, quality = 0.78) => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = dataUrl;
    });

    let width = image.width;
    let height = image.height;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  P.addItem = async () => {
    const name = document.getElementById('item-name')?.value.trim() || '';
    const price = Number(document.getElementById('item-price')?.value);
    const file = document.getElementById('item-image')?.files?.[0];

    if (!name) return P.showToast('Please enter an item name.');
    if (!(price > 0)) return P.showToast('Please enter a price greater than $0.');

    let image = '';
    if (file) {
      if (!file.type.startsWith('image/')) {
        return P.showToast('Please choose an image file.');
      }
      try {
        image = await P.resizeImage(file);
      } catch (_) {
        return P.showToast('I could not read that image.');
      }
    }

    P.state.game.items.push({
      id: P.uid(),
      name,
      price: Number(price.toFixed(2)),
      image
    });
    P.render();
    P.showToast('Item added.');
  };

  P.editItem = (id) => {
    const item = P.state.game.items.find((entry) => entry.id === id);
    if (!item) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>Edit Item</h3>
        <div class="field">
          <label for="modal-item-name">Item name</label>
          <input id="modal-item-name" type="text" value="${P.esc(item.name)}">
        </div>
        <div class="field">
          <label for="modal-item-price">Actual price</label>
          <input id="modal-item-price" type="number" min="0.01" step="0.01" value="${Number(item.price).toFixed(2)}">
        </div>
        <div class="field">
          <label for="modal-item-image">Replace picture (optional)</label>
          <input id="modal-item-image" type="file" accept="image/*">
        </div>
        <div class="modal-actions">
          <button data-modal="cancel">Cancel</button>
          <button class="primary" data-modal="save">Save Changes</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-modal="cancel"]').addEventListener(
      'click',
      () => backdrop.remove()
    );

    backdrop.querySelector('[data-modal="save"]').addEventListener(
      'click',
      async () => {
        const name = backdrop.querySelector('#modal-item-name').value.trim();
        const price = Number(backdrop.querySelector('#modal-item-price').value);
        const file = backdrop.querySelector('#modal-item-image').files?.[0];

        if (!name || !(price > 0)) {
          return P.showToast('Enter a valid name and price.');
        }

        if (file) {
          try {
            item.image = await P.resizeImage(file);
          } catch (_) {
            return P.showToast('I could not read that image.');
          }
        }

        item.name = name;
        item.price = Number(price.toFixed(2));
        backdrop.remove();
        P.render();
        P.showToast('Item updated.');
      }
    );
  };

  P.moveItem = (id, direction) => {
    const index = P.state.game.items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= P.state.game.items.length) return;

    [P.state.game.items[index], P.state.game.items[target]] = [
      P.state.game.items[target],
      P.state.game.items[index]
    ];
    P.render();
  };

  P.saveCurrentGame = async () => {
    P.syncHost();
    if (!P.state.game.items.length) {
      return P.showToast('Add at least one item before saving.');
    }

    try {
      await P.dbPut(P.serializeGame());
      await P.refreshSavedGames();
      P.render();
      P.showToast('Game saved in this browser.');
    } catch (_) {
      P.showToast('Could not save this game. Try Export instead.');
    }
  };

  P.loadSavedGame = async (id) => {
    const saved = P.state.savedGames.find((game) => game.id === id);
    if (!saved) return;
    P.loadSerializedGame(saved);
    P.state.screen = 'host';
    P.render();
    P.showToast('Saved game loaded.');
  };

  P.deleteSavedGame = async (id) => {
    try {
      await P.dbDelete(id);
      await P.refreshSavedGames();
      P.render();
      P.showToast('Saved game deleted.');
    } catch (_) {
      P.showToast('Could not delete that saved game.');
    }
  };

  P.exportGame = () => {
    P.syncHost();
    if (!P.state.game.items.length) {
      return P.showToast('Add at least one item before exporting.');
    }

    const data = P.serializeGame();
    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${P.slug(data.title) || 'price-challenge'}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  P.importGame = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.items) || !Array.isArray(parsed.teams)) {
        throw new Error('Invalid game file');
      }
      P.loadSerializedGame(parsed);
      P.state.screen = 'host';
      P.render();
      P.showToast('Game imported.');
    } catch (_) {
      P.showToast('That file is not a valid Price Challenge game.');
    } finally {
      event.target.value = '';
    }
  };

  P.slug = (value) => String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  P.init = async () => {
    P.loadSettings();
    await P.refreshSavedGames();
    P.render();
  };
})();
