const pointsTable = [5, 3, 1, 0];

module.exports = {

  calculate(players) {
    const scores =
        [...new Set(players.map(player => player.score))].sort((a, b) => b - a);
    const result = [];
    for (const score of scores) {
      const tiedPlayers =
          players.filter(player => player.score === score).sort();
      const place = result.length + 1;
      const points = pointsTable[result.length];
      for (const player of tiedPlayers) {
        const item = {
          ...player,
          place,
          points,
        };
        result.push(item);
      }
    }
    return result;
  }
};
