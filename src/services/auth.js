const passport = require('passport');
const {Strategy} = require('passport-http-bearer');

const Postgres = require('./postgres.js');

const authenticate = async (token, callback) => {
  const user = await Postgres.getUserByToken(token);
  callback(null, user ? {user} : false);
};

module.exports = {

  get REQUIRE_TOKEN() {
    return passport.authenticate('bearer', {
      session: false,
    });
  },

  init() {
    passport.use(new Strategy(authenticate));
  },
};
