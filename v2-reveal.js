(() => {
  'use strict';

  const P = window.PC;
  const S = P.state;

  P.clearRevealTimer = () => {
    if (S.revealTimerId) {
      clearTimeout(S.revealTimerId);
    }
    S.revealTimerId = null;
  };

  P.roundResults = (item) => {
    const teamIds = S.turnOrder.length
      ? S.turnOrder
      : S.game.teams.map((team) => team.id);

    const validBids = teamIds
      .map((id) => ({ team: P.byId(id), bid: S.bids[id] }))
      .filter(({ team, bid }) => (
        team &&
        bid?.locked &&
        !bid.timedOut &&
        Number(bid.amount) <= Number(item.price)
      ));

    const best = validBids.length
      ? Math.max(...validBids.map(({ bid }) => Number(bid.amount)))
      : null;

    const winners = best === null
      ? []
      : validBids
          .filter(({ bid }) => Number(bid.amount) === best)
          .map(({ team }) => team.id);

    return { best, winners };
  };

  P.revealPrice = () => {
    if (S.paused || S.turnStatus !== 'complete') return;

    P.clearRevealTimer();
    S.turnStatus = 'revealing';
    P.beep('reveal');
    P.render();
    S.revealTimerId = setTimeout(P.finalizeReveal, 1350);
  };

  P.finalizeReveal = () => {
    S.revealTimerId = null;
    if (S.turnStatus !== 'revealing') return;

    S.turnStatus = 'revealed';
    const item = P.itemNow();
    const { winners } = P.roundResults(item);
    S.pendingTiebreaker = [];

    if (!S.roundScored) {
      let scoreWinners = winners;
      const needsTiebreaker = (
        S.game.tieMode === 'tiebreaker' &&
        winners.length > 1 &&
        S.roundIndex < S.playItems.length - 1
      );

      if (needsTiebreaker) {
        S.pendingTiebreaker = [...winners];
        scoreWinners = [];
      }

      const scoreChanges = [];
      scoreWinners.forEach((id) => {
        const team = P.byId(id);
        if (!team) return;
        team.score += S.game.pointsPerRound;
        scoreChanges.push({
          teamId: id,
          amount: S.game.pointsPerRound
        });
      });

      S.roundHistory.push({
        id: P.uid(),
        itemName: item.name,
        roundIndex: S.roundIndex,
        tiebreaker: S.isTiebreaker,
        winnerNames: winners
          .map((id) => P.byId(id)?.name)
          .filter(Boolean),
        scoreChanges,
        skipped: false,
        undone: false
      });

      S.roundScored = true;
    }

    P.render();

    if (winners.length) {
      P.beep('win');
      const colors = winners
        .map((id) => P.byId(id)?.color)
        .filter(Boolean);
      setTimeout(() => P.confetti(colors), 100);
    }
  };

  P.replayRound = () => {
    P.stopTimer();
    P.clearRevealTimer();

    const historyEntry = [...S.roundHistory]
      .reverse()
      .find((entry) => (
        entry.roundIndex === S.roundIndex && !entry.undone
      ));

    if (historyEntry?.scoreChanges?.length) {
      historyEntry.scoreChanges.forEach((change) => {
        const team = P.byId(change.teamId);
        if (team) {
          team.score = Math.max(0, team.score - change.amount);
        }
      });
      historyEntry.undone = true;
    }

    P.prepareRound();
    P.showToast('Round reset.');
    P.render();
  };

  P.skipRound = () => {
    P.stopTimer();
    P.clearRevealTimer();

    const item = P.itemNow();
    if (item) {
      S.roundHistory.push({
        id: P.uid(),
        itemName: item.name,
        roundIndex: S.roundIndex,
        tiebreaker: S.isTiebreaker,
        winnerNames: [],
        scoreChanges: [],
        skipped: true,
        undone: false
      });
    }

    S.tiebreakerTeams = null;
    S.isTiebreaker = false;

    if (S.roundIndex >= S.playItems.length - 1) {
      P.finishGame();
    } else {
      P.nextItem();
    }
  };

  P.adjustScore = (id, amount) => {
    const team = P.byId(id);
    if (!team) return;
    team.score = Math.max(0, team.score + amount);
    P.render();
  };

  P.undoLastResult = () => {
    const historyEntry = [...S.roundHistory]
      .reverse()
      .find((entry) => !entry.undone && entry.scoreChanges?.length);

    if (!historyEntry) {
      P.showToast('There is no scored round to undo.');
      return;
    }

    historyEntry.scoreChanges.forEach((change) => {
      const team = P.byId(change.teamId);
      if (team) {
        team.score = Math.max(0, team.score - change.amount);
      }
    });

    historyEntry.undone = true;
    P.showToast('Last scored result was undone.');
    P.render();
  };

  P.finishGame = () => {
    P.stopTimer();
    P.clearRevealTimer();
    S.screen = 'end';
    S.hostControlsOpen = false;
    S.paused = false;
    P.render();

    const topScore = Math.max(...S.game.teams.map((team) => team.score));
    const colors = S.game.teams
      .filter((team) => team.score === topScore)
      .map((team) => team.color);

    setTimeout(() => P.confetti(colors, 95), 120);
    P.beep('win');
  };

  P.quickRematch = () => {
    const reshuffleItems = (
      document.getElementById('rematch-items')?.checked !== false
    );
    const reshuffleTeams = (
      document.getElementById('rematch-teams')?.checked !== false
    );

    if (reshuffleItems) {
      S.playItems = P.shuffle(S.game.items);
    } else if (!S.playItems.length) {
      S.playItems = [...S.game.items];
    }

    const teamIds = S.game.teams.map((team) => team.id);
    if (reshuffleTeams) {
      S.baseTeamOrder = P.shuffle(teamIds);
    } else if (!S.baseTeamOrder.length) {
      S.baseTeamOrder = teamIds;
    }

    S.game.teams.forEach((team) => {
      team.score = 0;
    });

    S.roundHistory = [];
    S.roundIndex = 0;
    S.tiebreakerTeams = null;
    S.isTiebreaker = false;
    P.prepareRound();
    S.screen = 'game';
    P.render();
  };

  P.confetti = (colors = [], count = 70) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const palette = colors.length ? colors : P.COLORS;
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';

    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.textContent = ['■', '●', '▲'][i % 3];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.color = palette[i % palette.length];
      piece.style.animationDelay = `${Math.random() * 0.45}s`;
      piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      piece.style.setProperty(
        '--drift',
        `${-80 + Math.random() * 160}px`
      );
      layer.appendChild(piece);
    }

    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 4300);
  };
})();
