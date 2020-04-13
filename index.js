const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 5000;

const {Client} = require('pg');

const db = new Client({connectionString: process.env.DATABASE_URL});

express()
    .use((request, response, next) => {
      console.log(`${request.method} ${request.url}`);
      return next();
    })
    .use(express.static(path.join(__dirname, 'public')))
    .get('/', (req, res) => res.render('public/index.html'))
    .listen(PORT, async () => {
      console.log('--------------------------------------------')
      console.log(`  Starting Rummikub XP server on port ${PORT}`)
      console.log('--------------------------------------------')
      try {
        await db.connect();
        console.log('=> Connected to the database');
      } catch (e) {
        console.error('=> ERROR: cannot connect to the database!');
      }
    });
