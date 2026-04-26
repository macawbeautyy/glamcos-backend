/**
 * Database Seeder
 * Usage: node src/utils/seeder.js   (or SEED_DATABASE.bat)
 *
 * Creates: admin + test users, categories, services
 */
const mongoose = require('mongoose');
const config   = require('../config/env');
const logger   = require('./logger');

const User     = require('../models/User');
const Category = require('../models/Category');
const Service  = require('../models/Service');

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────
const adminUser = {
  firstName: 'Super', lastName: 'Admin',
  email: 'admin@servify.com', phone: '+919999999999',
  password: 'Admin@123456', role: 'superadmin', status: 'active',
  isEmailVerified: true, isPhoneVerified: true,
};

const testUsers = [
  {
    firstName: 'Rahul', lastName: 'Sharma',
    email: 'user@servify.com', phone: '+919876543210',
    password: 'User@123456', role: 'user', status: 'active',
  },
  {
    firstName: 'Priya', lastName: 'Patel',
    email: 'provider@servify.com', phone: '+919876543211',
    password: 'Provider@123456', role: 'provider', status: 'active',
    provider_status: 'approved',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────
const categorySeed = [
  { name: 'Bridal Makeup',   slug: 'bridal-makeup',   icon: '👰', description: 'Complete bridal looks for your special day',         isActive: true, isFeatured: true,  sortOrder: 1 },
  { name: 'Hair Care',       slug: 'hair-care',        icon: '💇', description: 'Haircuts, styling, colouring and treatments',        isActive: true, isFeatured: true,  sortOrder: 2 },
  { name: 'Facial & Skin',   slug: 'facial-skin',      icon: '✨', description: 'Facials, clean-ups and advanced skin treatments',    isActive: true, isFeatured: true,  sortOrder: 3 },
  { name: 'Nail Art',        slug: 'nail-art',         icon: '💅', description: 'Manicures, pedicures and creative nail art',         isActive: true, isFeatured: false, sortOrder: 4 },
  { name: 'Waxing',          slug: 'waxing',           icon: '🌸', description: 'Full-body waxing and hair-removal services',         isActive: true, isFeatured: false, sortOrder: 5 },
  { name: 'Wellness & Spa',  slug: 'wellness-spa',     icon: '🧘', description: 'Massages, body treatments and relaxation therapies', isActive: true, isFeatured: true,  sortOrder: 6 },
  { name: 'Mehendi',         slug: 'mehendi',          icon: '🌿', description: 'Bridal and party mehendi designs',                  isActive: true, isFeatured: false, sortOrder: 7 },
  { name: 'Eyebrows & Lash', slug: 'eyebrows-lash',   icon: '👁',  description: 'Threading, tinting and lash extensions',            isActive: true, isFeatured: false, sortOrder: 8 },
];

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────
const buildServices = (cats, adminId) => {
  const bySlug = {};
  cats.forEach((c) => { bySlug[c.slug] = c._id; });

  const svc = (name, slug, price, duration, rating, featured, tags, description, img) => ({
    name, description,
    category:    bySlug[slug],
    provider:    adminId,
    price, duration,
    thumbnail:   img,
    images:      [img],
    tags,
    serviceArea: 'on_site',
    status:      'active',
    isActive:    true,
    isFeatured:  featured,
    rating,
  });

  return [
    svc('Complete Bridal Package',    'bridal-makeup', 15999, 240, 4.9, true,  ['bridal','wedding','makeup'],      'Full bridal makeover including hair, makeup, mehendi and saree draping.',          'https://images.unsplash.com/photo-1519741497674-611481863552?w=400'),
    svc('Engagement Makeup',          'bridal-makeup',  5999, 120, 4.7, false, ['engagement','makeup','party'],    'Glamorous makeup for your engagement. Includes skin prep and light hair styling.',  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400'),
    svc('Haircut & Blow-dry',         'hair-care',       799,  60, 4.6, true,  ['haircut','styling','blow-dry'],   'Expert haircut and blow-dry by certified stylists. Includes wash and conditioning.','https://images.unsplash.com/photo-1560869713-7d0a29430803?w=400'),
    svc('Hair Colour (Global)',        'hair-care',      2499, 150, 4.5, false, ['colour','highlights'],            'Full-head global colour with premium brands. Includes toning and mask.',           'https://images.unsplash.com/photo-1522337094846-8a818192de1f?w=400'),
    svc('Keratin Smoothening',         'hair-care',      4999, 180, 4.8, true,  ['keratin','smoothening'],          'Salon-grade keratin for frizz-free, straight and shiny hair. Lasts 3-5 months.',  'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=400'),
    svc('Deep Cleansing Facial',       'facial-skin',    1299,  60, 4.7, true,  ['facial','cleansing','skin'],      'Removes blackheads, unclogs pores and brightens skin. Suits all skin types.',      'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400'),
    svc('Anti-Ageing Gold Facial',     'facial-skin',    2999,  90, 4.9, false, ['gold','anti-ageing','luxury'],    'Luxury 24K gold facial. Reduces fine lines and gives a radiant glow.',            'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=400'),
    svc('Gel Nail Extensions',         'nail-art',       1499,  90, 4.6, true,  ['nails','gel','extensions'],       'Beautiful gel nail extensions with your choice of design and gel polish.',         'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400'),
    svc('Manicure & Pedicure Combo',   'nail-art',        999,  90, 4.5, false, ['manicure','pedicure'],            'Relaxing combo with scrub, massage, cuticle care and polish application.',         'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400'),
    svc('Full Body Waxing',            'waxing',         1799,  90, 4.4, false, ['waxing','hair removal'],          'Complete full-body waxing using premium cold and hot wax. Smooth skin guaranteed.', 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=400'),
    svc('Swedish Full Body Massage',   'wellness-spa',   2499,  60, 4.8, true,  ['massage','relaxation','spa'],     'Relaxing full-body Swedish massage by certified therapists. Relieves tension.',     'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400'),
    svc('Deep Tissue Massage',         'wellness-spa',   2999,  60, 4.7, false, ['deep tissue','therapy'],          'Therapeutic massage targeting chronic muscle pain, knots and tension.',            'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400'),
    svc('Bridal Mehendi (Full)',        'mehendi',        3999, 180, 4.9, true,  ['mehendi','bridal','henna'],       'Intricate full bridal mehendi for hands and feet. Premium organic henna.',         'https://images.unsplash.com/photo-1583309219338-a582f1db9a41?w=400'),
    svc('Eyebrow Threading & Shaping', 'eyebrows-lash',   149,  15, 4.5, false, ['threading','eyebrows'],           'Precise threading and shaping to define your natural arch.',                      'https://images.unsplash.com/photo-1616683693504-3ea7e9ad6fec?w=400'),
    svc('Lash Extensions (Classic)',   'eyebrows-lash',  2499,  90, 4.6, false, ['lash extensions','lashes'],       'Classic individual lash extensions for a natural, fuller look. Lasts 3-4 weeks.', 'https://images.unsplash.com/photo-1519014816548-bf5fe059798b?w=400'),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
const seedDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info('MongoDB connected for seeding');

    await Promise.all([User.deleteMany({}), Category.deleteMany({}), Service.deleteMany({})]);
    logger.info('Cleared existing data');

    const admin = await User.create(adminUser);
    logger.info(`Admin created: ${admin.email}`);
    for (const u of testUsers) {
      const created = await User.create(u);
      logger.info(`User created: ${created.email} (${created.role})`);
    }

    // inject createdBy (required field) before bulk insert
    const catsWithCreator = categorySeed.map((c) => ({ ...c, createdBy: admin._id }));
    const cats    = await Category.insertMany(catsWithCreator);
    logger.info(`${cats.length} categories created`);

    const svcs    = await Service.insertMany(buildServices(cats, admin._id));
    logger.info(`${svcs.length} services created`);

    logger.info('');
    logger.info('='.repeat(55));
    logger.info('  DATABASE SEEDED SUCCESSFULLY');
    logger.info('='.repeat(55));
    logger.info('  Admin    : admin@servify.com    / Admin@123456');
    logger.info('  User     : user@servify.com     / User@123456');
    logger.info('  Provider : provider@servify.com / Provider@123456');
    logger.info(`  Categories: ${cats.length}   Services: ${svcs.length}`);
    logger.info('='.repeat(55));

    process.exit(0);
  } catch (err) {
    logger.error(`Seeding failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
};

seedDB();
