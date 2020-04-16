const DatabaseClient = require('../database/client.js');

const camelCase = string =>
    string.replace(/_([a-z])/g, match => match.slice(1).toUpperCase());

const normalizeKeys = object => {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    result[camelCase(key)] = value;
  }
  return result;
};

module.exports = {

  health() {
    return {
      status: DatabaseClient.isConnected ? 'OK' : 'ERROR',
    };
  },

  async players() {
    const players = await DatabaseClient.getPlayers();
    return players.map(normalizeKeys);
  },

  async competitions() {
    const competitions = await DatabaseClient.getCompetitions();
    const friendly = {
      id: null,
      name: 'Friendly',
    };
    return [friendly, ...competitions].map(normalizeKeys);
  },

  async games() {
    const games = await DatabaseClient.getGames();
    return games.map(normalizeKeys);
  },
};
