require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const InventoryItem = require('../models/InventoryItem');

const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;
const uri = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}/${MONGODB_DATABASE}?retryWrites=true&w=majority`;

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to Atlas');

  const anyUser = await User.findOne();
  if (!anyUser) {
    console.error('No users in DB — run testUser.js first or sign up via the app');
    await mongoose.disconnect();
    return;
  }
  console.log('Using addedBy from user:', anyUser.username);

  // Clean up any leftover test item
  await InventoryItem.deleteMany({ name: 'Test Canned Beans' });

  // Create with quantity 50
  const item = await InventoryItem.create({
    name: 'Test Canned Beans',
    category: 'canned',
    quantity: 50,
    unit: 'cans',
    addedBy: anyUser._id
  });
  console.log('Created — quantity:', item.quantity, '| status:', item.status, '(expect in-stock)');

  // Update quantity to 3 (low-stock)
  const lowStock = await InventoryItem.findByIdAndUpdate(
    item._id,
    { quantity: 3 },
    { new: true, runValidators: true }
  );
  console.log('Updated to 3 — status:', lowStock.status, '(expect low-stock)');

  // Update quantity to 0 (out-of-stock)
  const outOfStock = await InventoryItem.findByIdAndUpdate(
    item._id,
    { quantity: 0 },
    { new: true, runValidators: true }
  );
  console.log('Updated to 0 — status:', outOfStock.status, '(expect out-of-stock)');

  // Find by name
  const found = await InventoryItem.findOne({ name: 'Test Canned Beans' });
  console.log('Found by name:', found.name, '| status:', found.status);

  // Delete
  await InventoryItem.findByIdAndDelete(item._id);
  const gone = await InventoryItem.findById(item._id);
  console.log('Deleted — findById result (should be null):', gone);

  await mongoose.disconnect();
  console.log('Done. All InventoryItem tests passed.');
}

run().catch((err) => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});
