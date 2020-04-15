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
};
