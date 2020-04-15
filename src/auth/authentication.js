const passport = require('passport');
const {Strategy} = require('passport-http-bearer');

const DatabaseClient = require('../database/client.js');

const authenticate = async (token, callback) => {
  const user = await DatabaseClient.getUserByToken(token);
  if (user) {
    callback(null, {user});
  } else {
    callback(null, false);
  }
};

module.exports = {

  init() {
    passport.use(new Strategy(authenticate));
  },

  get secureRequestCallback() {
    return passport.authenticate('bearer', {
      session: false,
    });
  },
};
