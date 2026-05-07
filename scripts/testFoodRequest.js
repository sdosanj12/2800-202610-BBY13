require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const FoodRequest = require('../models/FoodRequest');

const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;
const uri = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}/${MONGODB_DATABASE}?retryWrites=true&w=majority`;

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to Atlas');

  // Grab any existing user to use as clientId
  const anyUser = await User.findOne();
  if (!anyUser) {
    console.error('No users in DB — run testUser.js first or sign up via the app');
    await mongoose.disconnect();
    return;
  }
  console.log('Using clientId from user:', anyUser.username);

  // Create
  const req = await FoodRequest.create({
    clientId: anyUser._id,
    householdSize: 3,
    dietaryNeeds: ['gluten-free', 'nut allergy'],
    notes: 'Test request from script'
  });
  console.log('Created FoodRequest:', req._id, '| status:', req.status);

  // Find
  const found = await FoodRequest.findById(req._id).populate('clientId', 'username email');
  console.log('Found:', found._id, '| client:', found.clientId.username, '| status:', found.status);

  // Update status to approved
  const updated = await FoodRequest.findByIdAndUpdate(
    req._id,
    { status: 'approved', approvedBy: anyUser._id, approvedAt: new Date() },
    { new: true, runValidators: true }
  );
  console.log('Updated status:', updated.status, '| approvedAt:', updated.approvedAt);

  // Delete
  await FoodRequest.findByIdAndDelete(req._id);
  const gone = await FoodRequest.findById(req._id);
  console.log('Deleted — findById result (should be null):', gone);

  await mongoose.disconnect();
  console.log('Done. All FoodRequest tests passed.');
}

run().catch((err) => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});
