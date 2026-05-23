/**
 * generateEmployee.js
 * -------------------
 * Run this script to create a new employee record in MongoDB.
 * The script prints the generated Employee ID — give that ID to the employee
 * so they can log in at /admin/login.
 *
 * Usage:
 *   node scripts/generateEmployee.js --name "Jane Doe" --email "jane@example.com" --pin 1234 --role admin
 *
 * Options:
 *   --name        Full name (required)
 *   --email       Email address (required, must be unique)
 *   --pin         4–8 digit numeric PIN (required)
 *   --role        admin | manager | staff  (default: staff)
 *   --department  Department name (default: General)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;
const uri = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}/${MONGODB_DATABASE}?retryWrites=true&w=majority`;

// --- Simple CLI arg parser ---
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function run() {
  const name = getArg('name');
  const email = getArg('email');
  const pin = getArg('pin');
  const role = getArg('role') || 'staff';
  const department = getArg('department') || 'General';

  // --- Validate inputs ---
  if (!name || !email || !pin) {
    console.error('❌  Missing required arguments.');
    console.error('   Usage: node scripts/generateEmployee.js --name "Jane Doe" --email "jane@example.com" --pin 1234');
    process.exit(1);
  }

  if (!/^\d{4,8}$/.test(pin)) {
    console.error('❌  PIN must be 4–8 digits (numbers only).');
    process.exit(1);
  }

  if (!['admin', 'manager', 'staff'].includes(role)) {
    console.error('❌  Role must be one of: admin, manager, staff');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅  Connected to MongoDB Atlas\n');

  try {
    const employee = await Employee.create({ name, email, pin, role, department });

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║           EMPLOYEE CREATED SUCCESSFULLY           ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Name:         ${employee.name.padEnd(35)}║`);
    console.log(`║  Email:        ${employee.email.padEnd(35)}║`);
    console.log(`║  Role:         ${employee.role.padEnd(35)}║`);
    console.log(`║  Department:   ${employee.department.padEnd(35)}║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  EMPLOYEE ID:  ${employee.employeeId.padEnd(35)}║`);
    console.log('║                                                  ║');
    console.log('║  ⚠️  Share this ID privately with the employee.   ║');
    console.log('║  They will use it + their PIN to log in.         ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      console.error(`❌  Duplicate ${field}: a record with that value already exists.`);
    } else {
      console.error('❌  Error creating employee:', err.message);
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();