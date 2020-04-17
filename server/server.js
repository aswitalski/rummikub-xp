const express = require('express');
const path = require('path');

const morgan = require('morgan');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 5000;

const Auth = require('./services/auth.js');
const Postgres = require('./services/postgres.js');

const Account = require('./controllers/account.js');
const API = require('./controllers/api.js');

express()
    .use(morgan('combined'))
    .use(bodyParser.json())
    // static
    .use(express.static(path.join(__dirname, '../public')))
    // api
    .get(
        '/api/health', Auth.REQUIRE_TOKEN,
        async (req, res) => res.json(await API.health()))
    .get(
        '/api/players', Auth.REQUIRE_TOKEN,
        async (req, res) => res.json(await API.players()))
    .get(
        '/api/competitions', Auth.REQUIRE_TOKEN,
        async (req, res) => res.json(await API.competitions()))
    .get(
        '/api/games', Auth.REQUIRE_TOKEN,
        async (req, res) => res.json(await API.games()))
    // account
    .post(
        '/login',
        async (req, res) => {
          const {username, password} = req.body;
          const credentials = await Account.signIn(username, password);
          if (credentials) {
            res.json(credentials);
          } else {
            res.status(403).json({
              error: 'Invalid credentials',
            });
          }
        })
    // start up
    .listen(PORT, async () => {
      console.log('--------------------------------------------');
      console.log(`  Starting Rummikub XP server on port ${PORT}`);
      console.log('--------------------------------------------');
      // init
      await Auth.init();
      await Postgres.connect();
    });
