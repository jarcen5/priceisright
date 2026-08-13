(() => {
  'use strict';

  const P = window.PC;
  const S = P.state;

  P.startGame = () => {
    S.playItems = S.game.randomizeItems
      ? P.shuffle(S.game.items)
      : [...S.game.items];

    const teamIds = S.game.teams.map((team) => team.id);
    S.baseTeamOrder = S.game.randomizeTeams
      ? P.shuffle(teamIds)
      : teamIds;

    S.game.teams.forEach((team) => {
      team.score = 0;
    });

    S.roundHistory = [];
    S.roundIndex = 0;
    S.tiebreakerTeams = null;
    S.isTiebreaker = false;
    P.prepareRound();
    S.screen = 'game';
    S.hostControlsOpen = false;
    P.render();
  };

  P.turnOrder = () => {
    let order = [...S.baseTeamOrder];

    if (S.game.rotateTeams && order.length) {
      const shift = S.roundIndex % order.length;
      order = [...order.slice(shift), ...order.slice(0, shift)];
    }

    if (S.tiebreakerTeams?.length) {
      order = order.filter((id) => S.tiebreakerTeams.includes(id));
    }

    return order;
  };

  P.prepareRound = () => {
    P.stopTimer();
    P.clearRevealTimer();
    S.turnOrder = P.turnOrder();
    S.turnIndex = 0;
    S.turnStatus = 'ready';
    S.bids = {};
    S.draftBid = '';
    S.remaining = S.game.timerSeconds;
    S.paused = false;
    S.roundScored = false;
    S.pendingTiebreaker = [];
  };

  P.startTurn = () => {
    if (S.paused || S.turnStatus !== 'ready') return;
    S.turnStatus = 'bidding';
    S.remaining = S.game.timerSeconds;
    S.draftBid = '';
    P.beep('start');
    P.render();
    P.startTimer();
  };

  P.startTimer = () => {
    P.stopTimer();
    S.timerId = setInterval(() => {
      if (S.paused) return;

      S.remaining -= 1;
      if (S.remaining <= 5 && S.remaining > 0) {
        P.beep('urgent');
      }

      if (S.remaining <= 0) {
        S.remaining = 0;
        P.stopTimer();
        P.timeoutBid();
        return;
      }

      P.updateTimer();
    }, 1000);
  };

  P.stopTimer = () => {
    if (S.timerId) clearInterval(S.timerId);
    S.timerId = null;
  };

  P.updateTimer = () => {
    const percent = Math.max(
      0,
      (S.remaining / S.game.timerSeconds) * 100
    );

    const timer = document.querySelector('.timer');
    const bar = document.querySelector('.timer-bar > div');
    const shell = document.querySelector('.timer-shell');
    const panel = document.querySelector('.turn-panel');
    const hurry = document.querySelector('.hurry-label');

    if (timer) {
      timer.textContent = S.remaining;
      timer.classList.toggle('danger', S.remaining <= 5);
      timer.classList.toggle(
        'warning',
        S.remaining <= 10 && S.remaining > 5
      );
    }

    if (shell) {
      shell.style.setProperty('--timer-progress', percent);
      shell.classList.toggle('danger', S.remaining <= 5);
      shell.classList.toggle(
        'warning',
        S.remaining <= 10 && S.remaining > 5
      );
    }

    if (panel) {
      panel.classList.toggle('danger', S.remaining <= 5);
      panel.classList.toggle(
        'warning',
        S.remaining <= 10 && S.remaining > 5
      );
    }

    if (hurry) {
      hurry.classList.toggle('show', S.remaining <= 5);
    }

    if (bar) {
      bar.style.width = `${percent}%`;
    }
  };

  P.lockBid = () => {
    if (S.paused || S.turnStatus !== 'bidding') return;

    const amount = Number(document.getElementById('bid-input')?.value);
    if (!Number.isFinite(amount) || amount < 0) {
      P.showToast('Enter a valid bid first.');
      return;
    }

    P.stopTimer();
    const currentTeam = P.teamNow();
    S.bids[currentTeam.id] = {
      amount: Number(amount.toFixed(2)),
      locked: true,
      timedOut: false
    };
    S.draftBid = '';
    P.beep('lock');
    P.advanceTurn();
  };

  P.timeoutBid = () => {
    const currentTeam = P.teamNow();
    if (!currentTeam) return;

    S.bids[currentTeam.id] = {
      amount: null,
      locked: false,
      timedOut: true
    };
    S.draftBid = '';
    P.beep('timeup');
    P.showToast(`${currentTeam.name} ran out of time — no bid recorded.`);
    P.advanceTurn();
  };

  P.hostNoBid = () => {
    if (!['ready', 'bidding'].includes(S.turnStatus)) return;

    P.stopTimer();
    const currentTeam = P.teamNow();
    if (!currentTeam) return;

    S.bids[currentTeam.id] = {
      amount: null,
      locked: false,
      timedOut: true
    };
    S.draftBid = '';
    P.showToast(`${currentTeam.name} marked as no bid.`);
    P.advanceTurn();
  };

  P.advanceTurn = () => {
    if (S.turnIndex < S.turnOrder.length - 1) {
      S.turnIndex += 1;
      S.turnStatus = 'ready';
      S.remaining = S.game.timerSeconds;
    } else {
      S.turnStatus = 'complete';
    }
    P.render();
  };

  P.pauseGame = () => {
    if (S.screen !== 'game' || S.paused) return;

    if (S.turnStatus === 'bidding') {
      S.draftBid = document.getElementById('bid-input')?.value || S.draftBid;
      P.stopTimer();
    }

    S.paused = true;
    P.render();
  };

  P.resumeGame = () => {
    if (!S.paused) return;
    S.paused = false;
    P.render();

    if (S.turnStatus === 'bidding') {
      P.startTimer();
    }
  };

  P.nextRound = () => {
    S.tiebreakerTeams = null;
    S.isTiebreaker = false;
    P.nextItem();
  };

  P.startTiebreaker = () => {
    if (!S.pendingTiebreaker.length) return;
    S.tiebreakerTeams = [...S.pendingTiebreaker];
    S.isTiebreaker = true;
    P.nextItem();
  };

  P.nextItem = () => {
    P.clearRevealTimer();
    S.roundIndex += 1;

    if (S.roundIndex >= S.playItems.length) {
      P.finishGame();
      return;
    }

    P.prepareRound();
    P.render();
  };
})();
