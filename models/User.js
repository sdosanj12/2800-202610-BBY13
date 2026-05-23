/**
 * User model — Represents a client, volunteer, or admin user.
 * Stores credentials (password hashed with bcrypt), role assignments,
 * onboarding state, and dietary profile.
 *
 * @author Brian Lau
 * @author Shirin Sajeeb
 * @author Evan Tang
 */

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
    firstTimeMode: {
      type: Boolean,
      default: true
    },
    hintsSeen: {
      type: [String],
      default: []
    },
      householdSize: {
      type: String,
      default: "1"
    },

    allergies: {
      type: [String],
      default: []
    },

    dietaryRestrictions: { 
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


/**
 * Compares a plain-text password against the stored bcrypt hash.
 * @param {string} candidatePassword - The password to verify
 * @returns {Promise<boolean>} True if the password matches
 */
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
