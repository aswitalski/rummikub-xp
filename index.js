const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 5000;

const Database = require('./src/database/client.js');
const API = require('./src/api/api.js');

express()
    .use((request, response, next) => {
      console.log(`${request.method} ${request.url}`);
      return next();
    })
    // static
    .use(express.static(path.join(__dirname, 'public')))
    // api
    .get('/api/health', (req, res) => res.json(API.health()))
    // start up
    .listen(PORT, async () => {
      console.log('--------------------------------------------')
      console.log(`  Starting Rummikub XP server on port ${PORT}`)
      console.log('--------------------------------------------')
      await Database.connect();
    });
