/**
 * GlamCos Seed Script
 * Adds Categories, Subcategories, and Services to the database
 * Run: node seed_glamcos.js
 */

const mongoose = require('mongoose');
const slugify  = require('slugify');

const MONGO_URI = 'mongodb://127.0.0.1:27017/servify_platform';

// ── Minimal inline models ──────────────────────────────────────────────────

const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, description: String, icon: String,
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    type: { type: String, default: 'service' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
  { timestamps: true }
);
CategorySchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});
const Category = mongoose.models.Category || mongoose.model('Category', CategorySchema);

const ServiceSchema = new mongoose.Schema(
  { name: String, slug: String, description: String,
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    price: Number, comparePrice: Number, duration: Number,
    thumbnail: String, images: [String], tags: [String],
    serviceArea: { type: String, default: 'flexible' },
    status: { type: String, default: 'active' },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false } },
  { timestamps: true }
);
ServiceSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    const suffix = this._id.toString().slice(-4);
    this.slug = slugify(`${this.name}-${suffix}`, { lower: true, strict: true });
  }
  next();
});
const Service = mongoose.models.Service || mongoose.model('Service', ServiceSchema);

const UserSchema = new mongoose.Schema({ role: String, email: String });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ── Seed Data ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    name: 'Glow & Skincare', icon: '✨', description: 'Professional skincare treatments for glowing, healthy skin',
    subcategories: ['Facials', 'Cleanups', 'Detan & Brightening', 'Acne Treatment', 'Luxury Skincare'],
    services: [
      { name: 'Advanced Facial',           price: 999,  comparePrice: 1999, duration: 60, tags: ['facial','skincare','glow'] },
      { name: 'Hydrating Facial',          price: 799,  comparePrice: 1499, duration: 60, tags: ['facial','hydration','moisture'] },
      { name: 'Anti-aging Facial',         price: 1499, comparePrice: 2499, duration: 75, tags: ['facial','anti-aging','collagen'] },
      { name: 'Gold Facial',               price: 1299, comparePrice: 1999, duration: 60, tags: ['facial','gold','luxury'] },
      { name: 'Diamond Facial',            price: 1499, comparePrice: 2499, duration: 75, tags: ['facial','diamond','premium'] },
      { name: 'Basic Cleanup',             price: 499,  comparePrice: 899,  duration: 45, tags: ['cleanup','basic','skincare'] },
      { name: 'Detan Treatment',           price: 699,  comparePrice: 1299, duration: 45, tags: ['detan','brightening','tan removal'] },
      { name: 'Acne Control Facial',       price: 999,  comparePrice: 1799, duration: 60, tags: ['acne','facial','treatment'] },
      { name: 'Skin Brightening Therapy',  price: 1199, comparePrice: 1999, duration: 60, tags: ['brightening','glow','therapy'] },
      { name: 'Korean Glass Skin Facial',  price: 1999, comparePrice: 2999, duration: 75, tags: ['korean','glass skin','luxury'] },
    ],
  },
  {
    name: 'Hair Services', icon: '💇‍♀️', description: 'Complete hair care from cuts to color treatments',
    subcategories: ['Haircuts', 'Hair Spa', 'Hair Treatments', 'Hair Coloring', 'Styling'],
    services: [
      { name: 'Women Haircut',       price: 499,  comparePrice: 999,  duration: 45,  tags: ['haircut','women','trim'] },
      { name: 'Men Haircut',         price: 299,  comparePrice: 699,  duration: 30,  tags: ['haircut','men','trim'] },
      { name: 'Hair Spa',            price: 999,  comparePrice: 1999, duration: 60,  tags: ['hair spa','nourishment','shine'] },
      { name: 'Keratin Treatment',   price: 2999, comparePrice: 6999, duration: 120, tags: ['keratin','smoothening','frizz control'] },
      { name: 'Smoothening',         price: 3999, comparePrice: 8999, duration: 150, tags: ['smoothening','straight hair','long lasting'] },
      { name: 'Hair Coloring',       price: 1499, comparePrice: 3999, duration: 90,  tags: ['color','highlights','fashion'] },
      { name: 'Blow Dry',            price: 499,  comparePrice: 999,  duration: 30,  tags: ['blow dry','styling','volume'] },
      { name: 'Party Hairstyling',   price: 999,  comparePrice: 1999, duration: 45,  tags: ['party','styling','occasion'] },
    ],
  },
  {
    name: 'Nail Art & Care', icon: '💅', description: 'Nail grooming, art, and extension services',
    subcategories: ['Manicure', 'Pedicure', 'Nail Art', 'Nail Extensions', 'Gel Nails'],
    services: [
      { name: 'Basic Manicure',          price: 299,  comparePrice: 599,  duration: 30,  tags: ['manicure','nails','basic'] },
      { name: 'Luxury Spa Manicure',     price: 799,  comparePrice: 1299, duration: 60,  tags: ['manicure','spa','luxury'] },
      { name: 'Basic Pedicure',          price: 399,  comparePrice: 699,  duration: 40,  tags: ['pedicure','feet','basic'] },
      { name: 'Spa Pedicure',            price: 899,  comparePrice: 1499, duration: 60,  tags: ['pedicure','spa','relaxing'] },
      { name: 'Nail Art (per nail)',      price: 50,   comparePrice: 150,  duration: 20,  tags: ['nail art','design','creative'] },
      { name: 'Gel Nail Polish',         price: 699,  comparePrice: 1299, duration: 45,  tags: ['gel','nails','long lasting'] },
      { name: 'Acrylic Extensions',      price: 1499, comparePrice: 2499, duration: 90,  tags: ['extensions','acrylic','nails'] },
      { name: 'Gel Extensions',          price: 1799, comparePrice: 2999, duration: 90,  tags: ['gel extensions','natural look','nails'] },
      { name: 'French Manicure',         price: 599,  comparePrice: 999,  duration: 45,  tags: ['french','classic','elegant'] },
    ],
  },
  {
    name: 'Makeup & Beauty', icon: '💄', description: 'Professional makeup for all occasions',
    subcategories: ['Bridal Makeup', 'Party Makeup', 'Airbrush', 'HD Makeup', 'Natural Look'],
    services: [
      { name: 'Bridal Makeup (Full)',       price: 5999,  comparePrice: 12000, duration: 180, tags: ['bridal','makeup','wedding'] },
      { name: 'Engagement Makeup',         price: 3999,  comparePrice: 7999,  duration: 120, tags: ['engagement','makeup','occasion'] },
      { name: 'Party Makeup',              price: 1999,  comparePrice: 3999,  duration: 75,  tags: ['party','glamour','evening'] },
      { name: 'Airbrush Makeup',           price: 3499,  comparePrice: 5999,  duration: 90,  tags: ['airbrush','flawless','HD'] },
      { name: 'HD Makeup',                 price: 2999,  comparePrice: 4999,  duration: 90,  tags: ['HD','makeup','camera ready'] },
      { name: 'Natural Everyday Makeup',   price: 999,   comparePrice: 1999,  duration: 45,  tags: ['natural','everyday','light'] },
      { name: 'Saree Draping',             price: 799,   comparePrice: 1499,  duration: 30,  tags: ['saree','draping','occasion'] },
      { name: 'Mehendi (Full Hands)',       price: 999,   comparePrice: 1999,  duration: 90,  tags: ['mehendi','bridal','henna'] },
      { name: 'Mehendi (Simple)',           price: 499,   comparePrice: 999,   duration: 45,  tags: ['mehendi','simple','design'] },
    ],
  },
  {
    name: 'Wellness & Spa', icon: '🧘‍♀️', description: 'Relaxing and therapeutic body treatments',
    subcategories: ['Body Massage', 'Body Scrub', 'Body Polishing', 'Aromatherapy', 'Head Massage'],
    services: [
      { name: 'Swedish Full Body Massage',  price: 2499, comparePrice: 3999, duration: 60,  tags: ['massage','relaxing','full body'] },
      { name: 'Deep Tissue Massage',        price: 2999, comparePrice: 4499, duration: 60,  tags: ['deep tissue','therapeutic','pain relief'] },
      { name: 'Aromatherapy Massage',       price: 2799, comparePrice: 3999, duration: 60,  tags: ['aromatherapy','essential oils','calming'] },
      { name: 'Head & Scalp Massage',       price: 699,  comparePrice: 1299, duration: 30,  tags: ['head massage','scalp','relaxing'] },
      { name: 'Body Scrub',                 price: 1499, comparePrice: 2499, duration: 45,  tags: ['scrub','exfoliation','glow'] },
      { name: 'Body Polishing',             price: 1999, comparePrice: 3499, duration: 60,  tags: ['polishing','smooth skin','brightening'] },
      { name: 'Foot Reflexology',           price: 999,  comparePrice: 1799, duration: 45,  tags: ['reflexology','foot','relaxing'] },
      { name: 'Hot Stone Massage',          price: 3499, comparePrice: 5499, duration: 75,  tags: ['hot stone','luxury','deep relaxation'] },
    ],
  },
  {
    name: 'Threading & Waxing', icon: '🪡', description: 'Hair removal and eyebrow shaping services',
    subcategories: ['Eyebrow Threading', 'Facial Threading', 'Full Body Waxing', 'Rica Waxing', 'Upperlip & Chin'],
    services: [
      { name: 'Eyebrow Threading',         price: 50,   comparePrice: 100,  duration: 10,  tags: ['threading','eyebrow','shaping'] },
      { name: 'Upperlip Threading',        price: 30,   comparePrice: 60,   duration: 5,   tags: ['threading','upperlip'] },
      { name: 'Full Face Threading',       price: 200,  comparePrice: 400,  duration: 30,  tags: ['threading','full face','clean'] },
      { name: 'Underarm Waxing',           price: 199,  comparePrice: 399,  duration: 15,  tags: ['waxing','underarm','hair removal'] },
      { name: 'Full Leg Waxing',           price: 499,  comparePrice: 999,  duration: 40,  tags: ['waxing','legs','smooth'] },
      { name: 'Full Body Waxing',          price: 1499, comparePrice: 2499, duration: 90,  tags: ['waxing','full body','smooth'] },
      { name: 'Rica Wax (Full Legs)',       price: 799,  comparePrice: 1499, duration: 45,  tags: ['rica wax','legs','gentle'] },
      { name: 'Bikini Waxing',             price: 699,  comparePrice: 1299, duration: 30,  tags: ['bikini','waxing','sensitive'] },
    ],
  },
  {
    name: 'Eyelash & Eyebrow', icon: '👁️', description: 'Eye enhancement services for a dramatic look',
    subcategories: ['Lash Extensions', 'Lash Lifting', 'Eyebrow Tinting', 'Brow Lamination', 'Lash Tinting'],
    services: [
      { name: 'Classic Lash Extensions',   price: 2499, comparePrice: 3999, duration: 90,  tags: ['lash extensions','classic','volume'] },
      { name: 'Volume Lash Extensions',    price: 3499, comparePrice: 5999, duration: 120, tags: ['volume lash','dramatic','extensions'] },
      { name: 'Lash Lifting',              price: 1499, comparePrice: 2499, duration: 60,  tags: ['lash lift','curl','natural'] },
      { name: 'Lash Tinting',              price: 799,  comparePrice: 1299, duration: 30,  tags: ['lash tint','dark','defined'] },
      { name: 'Eyebrow Tinting',           price: 499,  comparePrice: 899,  duration: 20,  tags: ['brow tint','defined','color'] },
      { name: 'Brow Lamination',           price: 1199, comparePrice: 1999, duration: 45,  tags: ['brow lamination','fluffy','defined'] },
      { name: 'Eyebrow Microblading',      price: 4999, comparePrice: 8999, duration: 120, tags: ['microblading','semi-permanent','natural brows'] },
    ],
  },
  {
    name: 'Dental & Oral Care', icon: '🦷', description: 'Professional oral care and cosmetic dental services',
    subcategories: ['Teeth Cleaning', 'Teeth Whitening', 'Dental Consultation'],
    services: [
      { name: 'Teeth Cleaning (Scaling)',  price: 999,  comparePrice: 1999, duration: 45,  tags: ['teeth cleaning','scaling','oral hygiene'] },
      { name: 'Teeth Whitening',           price: 3999, comparePrice: 6999, duration: 60,  tags: ['whitening','bright smile','cosmetic'] },
      { name: 'Dental Consultation',       price: 299,  comparePrice: 599,  duration: 30,  tags: ['consultation','dental','checkup'] },
    ],
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Find admin user to use as createdBy
  let adminUser = await User.findOne({ role: { $in: ['admin', 'superadmin'] } }).lean();
  if (!adminUser) {
    console.log('⚠️  No admin user found — creating placeholder');
    const placeholderUser = new mongoose.Types.ObjectId();
    adminUser = { _id: placeholderUser };
  }
  const adminId = adminUser._id;
  console.log('Admin ID:', adminId);

  let catCreated = 0, subCreated = 0, svcCreated = 0;

  for (const catDef of CATEGORIES) {
    // Upsert top-level category
    let cat = await Category.findOne({ name: catDef.name });
    if (!cat) {
      cat = await Category.create({
        name: catDef.name,
        description: catDef.description,
        icon: catDef.icon,
        type: 'service',
        isActive: true,
        parent: null,
        sortOrder: CATEGORIES.indexOf(catDef),
        createdBy: adminId,
      });
      catCreated++;
      console.log(`  ✅ Created category: ${cat.name}`);
    } else {
      console.log(`  ⏭️  Category exists: ${cat.name}`);
    }

    // Create subcategories
    for (const subName of catDef.subcategories) {
      let sub = await Category.findOne({ name: subName, parent: cat._id });
      if (!sub) {
        sub = await Category.create({
          name: subName,
          description: `${subName} services under ${catDef.name}`,
          icon: catDef.icon,
          type: 'service',
          isActive: true,
          parent: cat._id,
          sortOrder: catDef.subcategories.indexOf(subName),
          createdBy: adminId,
        });
        subCreated++;
        console.log(`    ✅ Created subcategory: ${sub.name}`);
      } else {
        console.log(`    ⏭️  Subcategory exists: ${sub.name}`);
      }
    }

    // Create services under the main category
    for (const svcDef of catDef.services) {
      let svc = await Service.findOne({ name: svcDef.name, category: cat._id });
      if (!svc) {
        svc = new Service({
          name:         svcDef.name,
          description:  `Professional ${svcDef.name} service. Includes all necessary products and tools. Results may vary based on skin/hair type.`,
          category:     cat._id,
          provider:     adminId,
          price:        svcDef.price,
          comparePrice: svcDef.comparePrice,
          duration:     svcDef.duration,
          tags:         svcDef.tags || [],
          thumbnail:    '',
          images:       [],
          serviceArea:  'flexible',
          status:       'active',
          isActive:     true,
          isFeatured:   false,
        });
        await svc.save();
        svcCreated++;
        console.log(`      ✅ Created service: ${svc.name} (₹${svc.price})`);
      } else {
        console.log(`      ⏭️  Service exists: ${svc.name}`);
      }
    }
  }

  console.log(`\n🎉 Seed complete!`);
  console.log(`   Categories created:    ${catCreated}`);
  console.log(`   Subcategories created: ${subCreated}`);
  console.log(`   Services created:      ${svcCreated}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
