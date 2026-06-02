/**
 * Add Free Test Service
 * Usage: node src/utils/addTestService.js
 *
 * Adds a ₹0 "Test Booking" service for testing the full booking + provider notification flow.
 * Does NOT delete any existing data.
 */
const mongoose = require('mongoose');
const config   = require('../config/env');
const Service  = require('../models/Service');
const Category = require('../models/Category');
const User     = require('../models/User');

async function run() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');

  // Find any category to attach to
  const category = await Category.findOne({ isActive: true }).lean();
  if (!category) {
    console.error('No active categories found. Please seed the database first.');
    process.exit(1);
  }

  // Find admin user as provider
  const admin = await User.findOne({ role: { $in: ['superadmin', 'admin'] } }).lean();

  // Check if already exists
  const exists = await Service.findOne({ slug: 'free-test-booking' });
  if (exists) {
    console.log('✅ Test service already exists:', exists._id.toString());
    process.exit(0);
  }

  const svc = await Service.create({
    name:        '🧪 Free Test Booking (₹0)',
    slug:        'free-test-booking',
    description: 'Zero-charge test service for testing the booking and provider notification flow. Delete after testing.',
    category:    category._id,
    provider:    admin?._id || null,
    price:       0,
    duration:    30,
    serviceArea: 'on_site',
    status:      'active',
    isActive:    true,
    isFeatured:  false,
    tags:        ['test', 'free'],
    thumbnail:   'https://via.placeholder.com/400x300?text=Test+Service',
    images:      ['https://via.placeholder.com/400x300?text=Test+Service'],
  });

  console.log('');
  console.log('='.repeat(50));
  console.log('  FREE TEST SERVICE CREATED');
  console.log('='.repeat(50));
  console.log('  Name  : 🧪 Free Test Booking (₹0)');
  console.log('  ID    :', svc._id.toString());
  console.log('  Price : ₹0');
  console.log('='.repeat(50));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
