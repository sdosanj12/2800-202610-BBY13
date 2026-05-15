const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      select: false
    },
    roles: {
      type: [{ type: String, enum: ['client', 'volunteer', 'admin'] }],
      default: ['client']
    },
    householdSize: {
      type: Number
    },
    dietaryNeeds: {
      type: [String],
      default: []
    },
    firstTimeMode: {
      type: Boolean,
      default: true
    },
    hintsSeen: {
      type: [String],
      default: []
    },
    preferredLanguage: {
      type: String,
      default: 'en'
    }
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
