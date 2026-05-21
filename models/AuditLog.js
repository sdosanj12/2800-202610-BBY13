const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['added', 'updated', 'deleted', 'approved', 'denied', 'pickup'],
      required: true
    },
    item: {
      type: String,
      required: true,
      maxlength: 200
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId
    },
    details: {
      type: String,
      maxlength: 500
    },
    user: {
      type: String,
      default: 'System'
    },
    role: {
      type: String,
      default: 'System'
    }
  },
  { timestamps: true }
);

// Convenience static to write a log entry in one line
auditLogSchema.statics.log = function (action, item, details, user, role, itemId) {
  return this.create({ action, item, details, user: user || 'System', role: role || 'System', itemId });
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
