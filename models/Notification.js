const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['request-approved', 'request-denied', 'pickup-reminder', 'low-stock', 'pickup-confirmed'],
      required: true
    },
    message: {
      type: String,
      required: true,
      maxlength: 500
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId
    },
    relatedType: {
      type: String,
      enum: ['FoodRequest', 'InventoryItem']
    }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
