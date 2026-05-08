require('dotenv').config();
const mongoose = require('mongoose');

const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;

if (!MONGODB_HOST || !MONGODB_USER || !MONGODB_PASSWORD || !MONGODB_DATABASE) {
  console.warn('[DB] Warning: one or more MongoDB env vars are missing — connection will fail');
}

const uri = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}/${MONGODB_DATABASE}?retryWrites=true&w=majority`;

async function connectDB() {
  try {
    await mongoose.connect(uri);
    console.log('[DB] Mongoose connected to Atlas');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB };
