const {Client} = require('pg');

const connectionString = process.env.DATABASE_URL || '';

const client = new Client({connectionString});

module.exports = {

  isConnected: false,

  async connect() {
    try {
      await client.connect();
      console.log('=> Connected to the database');
      this.isConnected = true;
    } catch (e) {
      console.error('=> ERROR: cannot connect to the database!');
      this.isConnected = false;
    }
  },

  async findUser(username, password) {
    const query = {
      text: 'SELECT * FROM users WHERE username = $1 AND password = $2',
      values: [username, password],
    };
    const result = await client.query(query);
    if (result.rows.length) {
      return result.rows[0];
    }
    return null;
  },

  async insertToken(userId, token) {
    const query = {
      text: 'INSERT INTO tokens (user_id, token) VALUES ($1, $2)',
      values: [userId, token],
    };
    await client.query(query);
  },

  async getUserByToken(token) {
    const query = {
      text:
          'SELECT username FROM users JOIN tokens ON users.id = tokens.user_id ' +
          'WHERE token = $1 AND NOW() < created_on + INTERVAL \'2 hours\'',
      values: [token],
    };
    const result = await client.query(query);
    if (result.rows.length) {
      return result.rows[0];
    }
    return null;
  },
};
