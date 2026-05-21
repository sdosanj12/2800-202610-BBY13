const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['added', 'updated', 'deleted', 'approved', 'denied', 'pickup'],
      required: true,
      index: true,
    },
    // Human-readable name of the item at the time of the event
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    // Keep a ref if the item still exists; null if it was deleted
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      default: null,
    },
    details: {
      type: String,
      maxlength: 500,
      default: '',
    },
    // Who performed the action
    performedBy: {
      type: String,   // username / display name — stored as string so it
      required: true, // survives employee deletion
    },
    performedById: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,  // Employee _id if available
    },
    role: {
      type: String,
      default: 'Admin',
    },
  },
  { timestamps: true }   // createdAt = when the event happened
);

// Index for the audit-log page queries (sort by newest, filter by action/date)
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);