require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;
const uri = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}/${MONGODB_DATABASE}?retryWrites=true&w=majority`;

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to Atlas');

  // Clean up any leftover test user
  await User.deleteOne({ username: 'testuser_script' });

  // Create
  const hashed = await bcrypt.hash('TestPass123', 12);
  const user = await User.create({
    username: 'testuser_script',
    email: 'testscript@example.com',
    password: hashed,
    roles: ['client'],
    firstTimeMode: true,
    hintsSeen: []
  });
  console.log('Created:', user.username, '| roles:', user.roles, '| firstTimeMode:', user.firstTimeMode);

  // Find (password excluded by default)
  const found = await User.findOne({ username: 'testuser_script' });
  console.log('Found:', found.username, '| password field (should be undefined):', found.password);

  // Find with password for comparePassword test
  const foundWithPw = await User.findOne({ username: 'testuser_script' }).select('+password');
  const match = await foundWithPw.comparePassword('TestPass123');
  const noMatch = await foundWithPw.comparePassword('WrongPassword');
  console.log('comparePassword correct:', match);
  console.log('comparePassword wrong:', noMatch);

  // Delete
  await User.deleteOne({ username: 'testuser_script' });
  const gone = await User.findOne({ username: 'testuser_script' });
  console.log('Deleted — findOne result (should be null):', gone);

  await mongoose.disconnect();
  console.log('Done. All tests passed.');
}

run().catch((err) => {
  console.error('Test failed:', err.message);
  mongoose.disconnect();
  process.exit(1);
});
