const mongoose = require('mongoose');

const foodRequestSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    householdSize: {
      type: Number,
      required: true,
      min: 1,
      max: 20
    },
    dietaryNeeds: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'picked-up', 'cancelled'],
      default: 'pending'
    },
    pickupDate: {
      type: Date
    },
    pickupTime: {
      type: String
    },
    notes: {
      type: String,
      maxlength: 500
    },
    clientNotes: {
      type: String,
      maxlength: 500
    },
    staffNotes: {
      type: String,
      maxlength: 1000
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: {
      type: Date
    },
    denialReason: {
      type: String,
      maxlength: 500
    },
    itemsAllocated: [{
      itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 1
      }
    }]
  },
  { timestamps: true }
);

module.exports = mongoose.model('FoodRequest', foodRequestSchema);
