const crypto = require('crypto');

const DatabaseClient = require('../database/client.js');

const createHash = text => crypto.createHash('md5')
                               .update(`${text}${process.env.HASH_SALT}`)
                               .digest('hex');

module.exports = {

  async signIn(username, password) {
    const hash = createHash(password);
    const user = await DatabaseClient.findUser(username, hash);
    if (user) {
      const token = createHash(String(Math.random())).slice(0, 16);
      await DatabaseClient.insertToken(user.id, token);
      return token;
    }
    return null;
  },
};