require('dotenv').config();
const bcrypt = require('bcrypt');
const { connectDB, mongoose } = require('../databaseConnection');
const User = require('../models/User');
const FoodRequest = require('../models/FoodRequest');
const InventoryItem = require('../models/InventoryItem');

const SALT_ROUNDS = 12;

const testUsers = [
  {
    username: 'maria_client',
    email: 'maria@test.com',
    password: 'clientpass123',
    roles: ['client'],
    householdSize: 4,
    dietaryNeeds: ['halal', 'no nuts']
  },
  {
    username: 'ahmed_client',
    email: 'ahmed@test.com',
    password: 'ahmedpass123',
    roles: ['client'],
    householdSize: 6,
    dietaryNeeds: ['halal']
  },
  {
    username: 'robert_volunteer',
    email: 'robert@test.com',
    password: 'volpass123',
    roles: ['volunteer']
  },
  {
    username: 'jessica_staff',
    email: 'jessica@test.com',
    password: 'staffpass123',
    roles: ['admin']
  }
];

const testInventory = [
  { name: 'Canned Black Beans', category: 'canned', quantity: 50, unit: 'cans', expiryDate: '2026-12-31', storageLocation: 'shelf' },
  { name: 'Brown Rice', category: 'dry', quantity: 30, unit: 'bags', expiryDate: '2027-06-30', storageLocation: 'shelf' },
  { name: 'Frozen Vegetables', category: 'frozen', quantity: 20, unit: 'bags', expiryDate: '2026-09-15', storageLocation: 'freezer' },
  { name: 'Apple Juice', category: 'beverages', quantity: 3, unit: 'boxes', expiryDate: '2026-08-01', storageLocation: 'pantry' },
  { name: 'Baby Formula', category: 'baby', quantity: 0, unit: 'units', expiryDate: '2026-12-01', storageLocation: 'shelf' },
  { name: 'Pasta', category: 'dry', quantity: 100, unit: 'boxes', expiryDate: '2027-01-15', storageLocation: 'shelf' },
  { name: 'Canned Soup', category: 'canned', quantity: 4, unit: 'cans', expiryDate: '2026-11-30', storageLocation: 'shelf' }
];

async function seedDatabase() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await FoodRequest.deleteMany({});
    await InventoryItem.deleteMany({});
    console.log('Cleared existing test data');

    // Create users
    const createdUsers = {};
    for (const userData of testUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
      const user = await User.create({
        ...userData,
        password: hashedPassword
      });
      createdUsers[userData.username] = user;
      console.log(`Created user: ${userData.username} (${userData.roles[0]})`);
    }

    // Create inventory items (staff is the addedBy)
    const staff = createdUsers['jessica_staff'];
    for (const item of testInventory) {
      await InventoryItem.create({
        ...item,
        addedBy: staff._id
      });
      console.log(`Created inventory: ${item.name}`);
    }

    // Create sample food requests
    const maria = createdUsers['maria_client'];
    const ahmed = createdUsers['ahmed_client'];

    await FoodRequest.create({
      clientId: maria._id,
      householdSize: 4,
      dietaryNeeds: ['halal', 'no nuts'],
      notes: 'Need food for the next two weeks',
      status: 'pending'
    });
    console.log('Created pending request for maria_client');

    await FoodRequest.create({
      clientId: maria._id,
      householdSize: 4,
      dietaryNeeds: ['halal'],
      notes: 'Last month\'s request',
      status: 'approved',
      pickupDate: new Date('2026-04-15'),
      pickupTime: '14:30',
      approvedBy: staff._id,
      approvedAt: new Date()
    });
    console.log('Created approved request for maria_client (history)');

    await FoodRequest.create({
      clientId: ahmed._id,
      householdSize: 6,
      dietaryNeeds: ['halal'],
      notes: 'Family of 6',
      status: 'pending'
    });
    console.log('Created pending request for ahmed_client');

    console.log('\n=== SEED COMPLETE ===');
    console.log('Users created:');
    testUsers.forEach(u => console.log(`  - ${u.username} / ${u.password} (${u.roles[0]})`));

    await mongoose.connection.close();
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
}

seedDatabase();