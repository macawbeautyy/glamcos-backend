const mongoose = require('mongoose');

const CategorySuggestionSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: ['product', 'service', 'both'], default: 'product' },
  parentName:  { type: String, trim: true, default: '' }, // parent category name for subcategory suggestion
  reason:      { type: String, trim: true, default: '' }, // why the user wants this category
  suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote:   { type: String, trim: true, default: '' },
  createdCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
}, { timestamps: true });

module.exports = mongoose.model('CategorySuggestion', CategorySuggestionSchema);
