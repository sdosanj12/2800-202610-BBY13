const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    category: {
      type: String,
      enum: ['canned', 'fresh', 'dry', 'frozen', 'beverages', 'baby', 'other'],
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      enum: ['cans', 'bags', 'boxes', 'units', 'kg', 'lbs', 'liters'],
      required: true
    },
    expiryDate: {
      type: Date
    },
    storageLocation: {
      type: String,
      enum: ['shelf', 'fridge', 'freezer', 'pantry'],
      default: 'shelf'
    },
    status: {
      type: String,
      enum: ['in-stock', 'low-stock', 'out-of-stock', 'expired'],
      default: 'in-stock'
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    notes: {
      type: String,
      maxlength: 500
    }
  },
  { timestamps: true }
);

function computeStatus(doc) {
  if (doc.expiryDate && doc.expiryDate < new Date()) return 'expired';
  if (doc.quantity === 0) return 'out-of-stock';
  if (doc.quantity < 5) return 'low-stock';
  return 'in-stock';
}

inventoryItemSchema.pre('save', function () {
  this.status = computeStatus(this);
});

inventoryItemSchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate() || {};
  const incoming = { ...update, ...(update.$set || {}) };

  if (incoming.quantity === undefined && incoming.expiryDate === undefined) return;

  const current = await this.model.findOne(this.getQuery());
  if (!current) return;

  const merged = {
    quantity: incoming.quantity !== undefined ? incoming.quantity : current.quantity,
    expiryDate: incoming.expiryDate !== undefined ? incoming.expiryDate : current.expiryDate
  };

  this.set('status', computeStatus(merged));
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
