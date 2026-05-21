const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

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

employeeSchema.pre('save', async function () {
  if (!this.isModified('pin')) return;
  this.pin = await bcrypt.hash(this.pin, 12);
});

employeeSchema.methods.comparePin = function (candidatePin) {
  return bcrypt.compare(candidatePin, this.pin);
};

module.exports = mongoose.model('Employee', employeeSchema);