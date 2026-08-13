(() => {
  'use strict';

  const P = window.PC;
  const S = P.state;

  P.bind = () => {
    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', P.handleAction);
    });

    const connect = (id, eventName, handler) => {
      const element = document.getElementById(id);
      if (element) element.addEventListener(eventName, handler);
    };

    connect('game-title', 'input', (event) => {
      S.game.title = event.target.value;
      P.saveSettings();
    });

    connect('timer-seconds', 'change', (event) => {
      S.game.timerSeconds = Number(event.target.value);
      S.remaining = S.game.timerSeconds;
      P.saveSettings();
    });

    connect('points-round', 'change', (event) => {
      S.game.pointsPerRound = Number(event.target.value);
      P.saveSettings();
    });

    connect('tie-mode', 'change', (event) => {
      S.game.tieMode = event.target.value;
      P.saveSettings();
    });

    const checkboxes = [
      ['random-items', 'randomizeItems'],
      ['random-teams', 'randomizeTeams'],
      ['rotate-teams', 'rotateTeams'],
      ['sound-toggle', 'sound']
    ];

    checkboxes.forEach(([id, key]) => {
      connect(id, 'change', (event) => {
        S.game[key] = event.target.checked;
        P.saveSettings();
      });
    });

    document.querySelectorAll('[data-role="team-name"]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const holder = event.target.closest('[data-team-id]');
        const currentTeam = P.byId(holder.dataset.teamId);
        if (currentTeam) currentTeam.name = event.target.value;
        P.saveSettings();
      });
    });

    document.querySelectorAll('[data-role="team-color"]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const holder = event.target.closest('[data-team-id]');
        const currentTeam = P.byId(holder.dataset.teamId);
        if (currentTeam) currentTeam.color = event.target.value;
        P.saveSettings();
        holder.style.setProperty('--team-color', event.target.value);
      });
    });

    connect('import-file', 'change', P.importGame);

    const bidInput = document.getElementById('bid-input');
    if (bidInput) {
      setTimeout(() => bidInput.focus(), 0);
      bidInput.addEventListener('input', (event) => {
        S.draftBid = event.target.value;
      });
      bidInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') P.lockBid();
      });
    }
  };

  P.handleAction = async (event) => {
    const action = event.currentTarget.dataset.action;
    const id = event.currentTarget.dataset.id;

    switch (action) {
      case 'go-teams': P.goTeams(); break;
      case 'enter-host': P.enterHost(); break;
      case 'return-host': P.returnHost(); break;
      case 'go-ready': P.goReady(); break;
      case 'toggle-host': P.toggleHost(); break;
      case 'toggle-sound':
        S.game.sound = !S.game.sound;
        P.saveSettings();
        P.render();
        break;
      case 'add-team': P.addTeam(); break;
      case 'remove-team': P.removeTeam(event.currentTarget); break;
      case 'add-item': await P.addItem(); break;
      case 'edit-item': P.editItem(id); break;
      case 'delete-item':
        S.game.items = S.game.items.filter((item) => item.id !== id);
        P.render();
        break;
      case 'move-item-up': P.moveItem(id, -1); break;
      case 'move-item-down': P.moveItem(id, 1); break;
      case 'start-game': P.startGame(); break;
      case 'start-turn': P.startTurn(); break;
      case 'lock-bid': P.lockBid(); break;
      case 'reveal-price': P.revealPrice(); break;
      case 'next-round': P.nextRound(); break;
      case 'start-tiebreaker': P.startTiebreaker(); break;
      case 'finish-game': P.finishGame(); break;
      case 'quick-rematch': P.quickRematch(); break;
      case 'pause-game': P.pauseGame(); break;
      case 'resume-game': P.resumeGame(); break;
      case 'host-no-bid': P.hostNoBid(); break;
      case 'score-plus': P.adjustScore(id, 1); break;
      case 'score-minus': P.adjustScore(id, -1); break;
      case 'undo-result': P.undoLastResult(); break;
      case 'replay-round': P.replayRound(); break;
      case 'skip-round': P.skipRound(); break;
      case 'end-early': P.finishGame(); break;
      case 'save-game': await P.saveCurrentGame(); break;
      case 'load-saved': await P.loadSavedGame(id); break;
      case 'delete-saved': await P.deleteSavedGame(id); break;
      case 'export-game': P.exportGame(); break;
      default: break;
    }
  };

  P.goTeams = () => {
    P.stopTimer();
    P.clearRevealTimer();
    S.screen = 'teams';
    S.hostControlsOpen = false;
    S.paused = false;
    P.render();
  };

  P.enterHost = () => {
    P.syncTeams();
    if (S.game.teams.some((team) => !team.name.trim())) {
      P.showToast('Give every team a name.');
      return;
    }
    S.screen = 'host';
    P.render();
  };

  P.returnHost = () => {
    P.stopTimer();
    P.clearRevealTimer();
    S.screen = 'host';
    S.hostControlsOpen = false;
    S.paused = false;
    P.render();
  };

  P.goReady = () => {
    P.syncHost();
    if (!S.game.items.length) {
      P.showToast('Add at least one item first.');
      return;
    }
    S.screen = 'ready';
    S.hostControlsOpen = false;
    P.saveSettings();
    P.render();
  };

  P.toggleHost = () => {
    S.hostControlsOpen = !S.hostControlsOpen;
    P.render();
  };

  P.addTeam = () => {
    if (S.game.teams.length >= 4) return;
    const index = S.game.teams.length;
    S.game.teams.push(P.team(`Team ${index + 1}`, index));
    P.saveSettings();
    P.render();
  };

  P.removeTeam = (button) => {
    if (S.game.teams.length <= 2) return;
    const holder = button.closest('[data-team-id]');
    const id = holder.dataset.teamId;
    S.game.teams = S.game.teams.filter((team) => team.id !== id);
    P.saveSettings();
    P.render();
  };

  P.syncTeams = () => {
    document.querySelectorAll('[data-role="team-name"]').forEach((input) => {
      const holder = input.closest('[data-team-id]');
      const currentTeam = P.byId(holder.dataset.teamId);
      if (currentTeam) currentTeam.name = input.value.trim();
    });
  };

  P.syncHost = () => {
    const title = document.getElementById('game-title');
    if (title) S.game.title = title.value.trim() || 'Price Challenge';
    P.saveSettings();
  };
})();
