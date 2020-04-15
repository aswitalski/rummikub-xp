const crypto = require('crypto');

const DatabaseClient = require('../database/client.js');

const salt = process.env.HASH_SALT || '';

const createHash = string =>
    crypto.createHash('md5').update(`${string}${salt}`).digest('hex');

const createToken = (length = 16) =>
    createHash(String(Math.random())).slice(0, length);

module.exports = {

  async signIn(username, password) {
    const hash = createHash(password);
    const user = await DatabaseClient.findUser(username, hash);
    if (user) {
      const token = createToken();
      await DatabaseClient.insertToken(user.id, token);
      console.log(
          `=> User "${username}" signed in, access token is "${token}"`);
      return {
        username,
        token,
      };
    }
    return null;
  },
};