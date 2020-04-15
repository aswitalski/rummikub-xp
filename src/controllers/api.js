const DatabaseClient = require('../database/client.js');

module.exports = {

  health() {
    return {
      status: DatabaseClient.isConnected ? 'OK' : 'ERROR',
    };
  }
};
