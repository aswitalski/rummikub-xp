const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 5000;

const Database = require('./src/database/client.js');
const API = require('./src/controllers/api.js');
const Account = require('./src/controllers/account.js');

const morgan = require('morgan');
const bodyParser = require('body-parser');

const passport = require('passport');
const {Strategy} = require('passport-http-bearer');

passport.use(new Strategy((token, callback) => {
  if (token = '666') {
    callback(null, {
      user: 'User',
    });
  } else {
    callback(null, false);
  }
}));

const authenticate = () => passport.authenticate('bearer', {
  session: false,
});

express()
    .use(morgan('combined'))
    .use(bodyParser.json())
    // static
    .use(express.static(path.join(__dirname, 'public')))
    // api
    .get('/api/health', authenticate(), (req, res) => res.json(API.health()))
    .post('/login', async (req, res) => {
      const {username, password} = req.body;
      const token = await Account.signIn(username, password);
      if (token) {
        res.json({token});
      } else {
        res.status(403).json({
          error: 'Invalid credentials',
        });
      }
    })
    // start up
    .listen(PORT, async () => {
      console.log('--------------------------------------------')
      console.log(`  Starting Rummikub XP server on port ${PORT}`)
      console.log('--------------------------------------------')
      await Database.connect();
    });
