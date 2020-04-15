const express = require('express');
const path = require('path');

const morgan = require('morgan');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 5000;

const DatabaseClient = require('./src/database/client.js');
const API = require('./src/controllers/api.js');
const Account = require('./src/controllers/account.js');
const Authentication = require('./src/auth/authentication.js');

express()
    .use(morgan('combined'))
    .use(bodyParser.json())
    // static
    .use(express.static(path.join(__dirname, 'public')))
    // api
    .get(
        '/api/health', Authentication.secureRequestCallback,
        (req, res) => res.json(API.health()))
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
      Authentication.init();
      await DatabaseClient.connect();
    });
