const {Client} = require('pg');

const client = new Client({connectionString: process.env.DATABASE_URL});

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
    if (result.rows && result.rows.length) {
      return result.rows[0];
    }
    return null;
  },

  async insertToken(userId, token) {
    const query = {
      text: 'INSERT INTO tokens (user_id, token) VALUES ($1, $2)',
      values: [userId, token],
    };
    const result = await client.query(query);
    console.log(result.rows[0]);
  },
};
