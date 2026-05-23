/**
 * Shift model — Tracks volunteer clock-in/clock-out times and break durations.
 * breakDuration is stored in milliseconds.
 *
 * @author Yen Yi Huang
 */

const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
  {
    staffName: { type: String, required: true },
    clockInTime: { type: Date, required: true },
    clockOutTime: { type: Date, default: null },
    breakStartTime: { type: Date, default: null },
    breakDuration: { type: Number, default: 0 }, // Saved in milliseconds
  },
  { timestamps: true },
);

module.exports = mongoose.model("Shift", shiftSchema);
