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
})();
