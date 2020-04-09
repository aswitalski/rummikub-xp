const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5000

express()
  .use((request, response, next) => {
    console.log(`${request.method} ${request.url}`);
    return next();
  })
  .use(express.static(path.join(__dirname, 'public')))
  .get('/', (req, res) => res.render('public/index.html'))
  .listen(PORT, () => {
    console.log('--------------------------------------------')
    console.log(`  Starting Rummikub XP server on port ${PORT}`)
    console.log('--------------------------------------------\n')
  });
