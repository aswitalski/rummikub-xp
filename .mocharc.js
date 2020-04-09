require('./test/init.js');

module.exports = {
  colors: true,
  diff: true,
  extension: ['.js'],
  package: './package.json',
  reporter: 'spec',
  slow: 50,
  sort: true,
  timeout: 2000,
  ui: 'bdd',
  'watch-files': ['src/**/*.js', 'test/**/*.js'],
  'watch-ignore': ['public']
};