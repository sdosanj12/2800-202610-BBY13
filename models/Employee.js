/**
 * Employee model — Represents an admin/staff employee.
 * Uses a unique Employee ID (format: EMP-XXXXXXXX) and a hashed PIN for login.
 * Separate from the User model to maintain distinct auth systems.
 *
 * @author Supreet Dosanj
 * @author Brian Lau
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

/**
 * Generates a unique Employee ID in the format EMP-XXXXXXXX.
 * Uses crypto.randomBytes for cryptographically secure randomness.
 * @returns {string} Employee ID (e.g. "EMP-AB3K9Z7W")
 */
function generateEmployeeId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'EMP-';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      index: true,
      default: generateEmployeeId
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    role: {
      type: String,
      enum: ['admin', 'manager', 'staff'],
      default: 'staff'
    },
    department: {
      type: String,
      trim: true,
      default: 'General'
    },
    pin: {
      type: String,
      required: true,
      select: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date
    }
  },
  { timestamps: true }
);

/** Pre-save hook: hashes the PIN with bcrypt if it was modified. */
employeeSchema.pre('save', async function () {
  if (!this.isModified('pin')) return;
  this.pin = await bcrypt.hash(this.pin, 12);
});

/**
 * Compares a plain-text PIN against the stored bcrypt hash.
 * @param {string} candidatePin - The PIN to verify
 * @returns {Promise<boolean>} True if the PIN matches
 */
employeeSchema.methods.comparePin = function (candidatePin) {
  return bcrypt.compare(candidatePin, this.pin);
};

module.exports = mongoose.model('Employee', employeeSchema);