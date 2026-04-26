/**
 * GlamCos API Seed Script
 * Seeds Categories, Subcategories, and Services via the running backend API
 *
 * Usage: node seed_via_api.js <adminEmail> <adminPassword>
 * Example: node seed_via_api.js admin@glamcos.com admin123
 */

const http = require('http');

const BASE = 'http://localhost:5000/api/v1';
const [,, ADMIN_EMAIL, ADMIN_PASS] = process.argv;

if (!ADMIN_EMAIL || !ADMIN_PASS) {
  console.error('Usage: node seed_via_api.js <adminEmail> <adminPassword>');
  process.exit(1);
}

let TOKEN = '';

// ── HTTP helper ────────────────────────────────────────────────────────────

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api/v1${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(json.message || `HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error('Invalid JSON: ' + raw.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Seed Data ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    name: 'Glow & Skincare', icon: '✨',
    description: 'Professional skincare treatments for glowing, healthy skin',
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
    name: 'Hair Services', icon: '💇‍♀️',
    description: 'Complete hair care from cuts to colour treatments',
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
    name: 'Nail Art & Care', icon: '💅',
    description: 'Nail grooming, art, and extension services',
    subcategories: ['Manicure', 'Pedicure', 'Nail Art', 'Nail Extensions', 'Gel Nails'],
    services: [
      { name: 'Basic Manicure',         price: 299,  comparePrice: 599,  duration: 30, tags: ['manicure','nails','basic'] },
      { name: 'Luxury Spa Manicure',    price: 799,  comparePrice: 1299, duration: 60, tags: ['manicure','spa','luxury'] },
      { name: 'Basic Pedicure',         price: 399,  comparePrice: 699,  duration: 40, tags: ['pedicure','feet','basic'] },
      { name: 'Spa Pedicure',           price: 899,  comparePrice: 1499, duration: 60, tags: ['pedicure','spa','relaxing'] },
      { name: 'Gel Nail Polish',        price: 699,  comparePrice: 1299, duration: 45, tags: ['gel','nails','long lasting'] },
      { name: 'Acrylic Extensions',     price: 1499, comparePrice: 2499, duration: 90, tags: ['extensions','acrylic','nails'] },
      { name: 'Gel Extensions',         price: 1799, comparePrice: 2999, duration: 90, tags: ['gel extensions','natural look','nails'] },
      { name: 'French Manicure',        price: 599,  comparePrice: 999,  duration: 45, tags: ['french','classic','elegant'] },
      { name: 'Nail Art Design',        price: 299,  comparePrice: 599,  duration: 30, tags: ['nail art','design','creative'] },
    ],
  },
  {
    name: 'Makeup & Beauty', icon: '💄',
    description: 'Professional makeup for all occasions',
    subcategories: ['Bridal Makeup', 'Party Makeup', 'Airbrush', 'HD Makeup', 'Natural Look'],
    services: [
      { name: 'Bridal Makeup (Full)',      price: 5999, comparePrice: 12000, duration: 180, tags: ['bridal','makeup','wedding'] },
      { name: 'Engagement Makeup',         price: 3999, comparePrice: 7999,  duration: 120, tags: ['engagement','makeup','occasion'] },
      { name: 'Party Makeup',              price: 1999, comparePrice: 3999,  duration: 75,  tags: ['party','glamour','evening'] },
      { name: 'Airbrush Makeup',           price: 3499, comparePrice: 5999,  duration: 90,  tags: ['airbrush','flawless','HD'] },
      { name: 'HD Makeup',                 price: 2999, comparePrice: 4999,  duration: 90,  tags: ['HD','makeup','camera ready'] },
      { name: 'Natural Everyday Makeup',   price: 999,  comparePrice: 1999,  duration: 45,  tags: ['natural','everyday','light'] },
      { name: 'Saree Draping',             price: 799,  comparePrice: 1499,  duration: 30,  tags: ['saree','draping','occasion'] },
      { name: 'Mehendi Full Hands',        price: 999,  comparePrice: 1999,  duration: 90,  tags: ['mehendi','bridal','henna'] },
      { name: 'Mehendi Simple',            price: 499,  comparePrice: 999,   duration: 45,  tags: ['mehendi','simple','design'] },
    ],
  },
  {
    name: 'Wellness & Spa', icon: '🧘‍♀️',
    description: 'Relaxing and therapeutic body treatments',
    subcategories: ['Body Massage', 'Body Scrub', 'Body Polishing', 'Aromatherapy', 'Head Massage'],
    services: [
      { name: 'Swedish Full Body Massage', price: 2499, comparePrice: 3999, duration: 60, tags: ['massage','relaxing','full body'] },
      { name: 'Deep Tissue Massage',       price: 2999, comparePrice: 4499, duration: 60, tags: ['deep tissue','therapeutic','pain relief'] },
      { name: 'Aromatherapy Massage',      price: 2799, comparePrice: 3999, duration: 60, tags: ['aromatherapy','essential oils','calming'] },
      { name: 'Head & Scalp Massage',      price: 699,  comparePrice: 1299, duration: 30, tags: ['head massage','scalp','relaxing'] },
      { name: 'Body Scrub',                price: 1499, comparePrice: 2499, duration: 45, tags: ['scrub','exfoliation','glow'] },
      { name: 'Body Polishing',            price: 1999, comparePrice: 3499, duration: 60, tags: ['polishing','smooth skin','brightening'] },
      { name: 'Foot Reflexology',          price: 999,  comparePrice: 1799, duration: 45, tags: ['reflexology','foot','relaxing'] },
      { name: 'Hot Stone Massage',         price: 3499, comparePrice: 5499, duration: 75, tags: ['hot stone','luxury','deep relaxation'] },
    ],
  },
  {
    name: 'Threading & Waxing', icon: '🪡',
    description: 'Hair removal and eyebrow shaping services',
    subcategories: ['Eyebrow Threading', 'Facial Threading', 'Full Body Waxing', 'Rica Waxing', 'Upperlip & Chin'],
    services: [
      { name: 'Eyebrow Threading',      price: 50,   comparePrice: 100,  duration: 10, tags: ['threading','eyebrow','shaping'] },
      { name: 'Upperlip Threading',     price: 30,   comparePrice: 60,   duration: 5,  tags: ['threading','upperlip'] },
      { name: 'Full Face Threading',    price: 200,  comparePrice: 400,  duration: 30, tags: ['threading','full face','clean'] },
      { name: 'Underarm Waxing',        price: 199,  comparePrice: 399,  duration: 15, tags: ['waxing','underarm','hair removal'] },
      { name: 'Full Leg Waxing',        price: 499,  comparePrice: 999,  duration: 40, tags: ['waxing','legs','smooth'] },
      { name: 'Full Body Waxing',       price: 1499, comparePrice: 2499, duration: 90, tags: ['waxing','full body','smooth'] },
      { name: 'Rica Wax Full Legs',     price: 799,  comparePrice: 1499, duration: 45, tags: ['rica wax','legs','gentle'] },
      { name: 'Bikini Waxing',          price: 699,  comparePrice: 1299, duration: 30, tags: ['bikini','waxing','sensitive'] },
    ],
  },
  {
    name: 'Eyelash & Eyebrow', icon: '👁️',
    description: 'Eye enhancement services for a dramatic look',
    subcategories: ['Lash Extensions', 'Lash Lifting', 'Eyebrow Tinting', 'Brow Lamination', 'Lash Tinting'],
    services: [
      { name: 'Classic Lash Extensions',  price: 2499, comparePrice: 3999, duration: 90,  tags: ['lash extensions','classic','volume'] },
      { name: 'Volume Lash Extensions',   price: 3499, comparePrice: 5999, duration: 120, tags: ['volume lash','dramatic','extensions'] },
      { name: 'Lash Lifting',             price: 1499, comparePrice: 2499, duration: 60,  tags: ['lash lift','curl','natural'] },
      { name: 'Lash Tinting',             price: 799,  comparePrice: 1299, duration: 30,  tags: ['lash tint','dark','defined'] },
      { name: 'Eyebrow Tinting',          price: 499,  comparePrice: 899,  duration: 20,  tags: ['brow tint','defined','color'] },
      { name: 'Brow Lamination',          price: 1199, comparePrice: 1999, duration: 45,  tags: ['brow lamination','fluffy','defined'] },
      { name: 'Eyebrow Microblading',     price: 4999, comparePrice: 8999, duration: 120, tags: ['microblading','semi-permanent','natural brows'] },
    ],
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🔐 Logging in as admin...');
  const loginRes = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  TOKEN = loginRes.data?.tokens?.accessToken || loginRes.data?.token || loginRes.token;
  if (!TOKEN) throw new Error('Login failed — no token received. Response: ' + JSON.stringify(loginRes).slice(0, 300));
  console.log('✅ Logged in successfully\n');

  let catCreated = 0, subCreated = 0, svcCreated = 0, skipped = 0;

  // Fetch existing categories
  const existingCatsRes = await request('GET', '/categories', null, TOKEN);
  const existingCats = existingCatsRes.data || [];
  const catMap = {};
  existingCats.forEach((c) => { catMap[c.name] = c._id; });

  for (const catDef of CATEGORIES) {
    let catId = catMap[catDef.name];

    // Create parent category if missing
    if (!catId) {
      try {
        const r = await request('POST', '/categories', {
          name: catDef.name,
          description: catDef.description,
          icon: catDef.icon,
          type: 'service',
        }, TOKEN);
        catId = r.data?._id;
        catMap[catDef.name] = catId;
        catCreated++;
        console.log(`✅ Category: ${catDef.name}`);
      } catch (e) {
        console.log(`⚠️  Category "${catDef.name}" error: ${e.message}`);
        // Try to find it again (might be a duplicate name error)
        const freshRes = await request('GET', '/categories', null, TOKEN);
        const fresh = (freshRes.data || []).find((c) => c.name === catDef.name);
        if (fresh) { catId = fresh._id; catMap[catDef.name] = catId; }
        else continue;
      }
    } else {
      console.log(`⏭️  Category exists: ${catDef.name}`);
    }

    // Create subcategories
    for (const subName of catDef.subcategories) {
      try {
        await request('POST', '/categories', {
          name: subName,
          description: `${subName} services under ${catDef.name}`,
          icon: catDef.icon,
          type: 'service',
          parent: catId,
        }, TOKEN);
        subCreated++;
        process.stdout.write(`  ✅ Sub: ${subName}\n`);
      } catch (e) {
        if (e.message.includes('duplicate') || e.message.includes('unique') || e.message.includes('exists')) {
          process.stdout.write(`  ⏭️  Sub exists: ${subName}\n`);
        } else {
          process.stdout.write(`  ⚠️  Sub "${subName}": ${e.message}\n`);
        }
        skipped++;
      }
    }

    // Create services
    for (const svcDef of catDef.services) {
      try {
        await request('POST', '/services/admin/create', {
          name:        svcDef.name,
          description: `Professional ${svcDef.name} service. Includes all necessary products and tools. Book now for the best results.`,
          category:    catId,
          price:       svcDef.price,
          comparePrice: svcDef.comparePrice,
          duration:    svcDef.duration,
          tags:        svcDef.tags || [],
          serviceArea: 'flexible',
        }, TOKEN);
        svcCreated++;
        process.stdout.write(`    ✅ Service: ${svcDef.name} (₹${svcDef.price})\n`);
      } catch (e) {
        if (e.message.includes('duplicate') || e.message.includes('unique') || e.message.includes('exists')) {
          process.stdout.write(`    ⏭️  Service exists: ${svcDef.name}\n`);
        } else {
          process.stdout.write(`    ⚠️  Service "${svcDef.name}": ${e.message}\n`);
        }
        skipped++;
      }
    }
    console.log('');
  }

  console.log('─────────────────────────────────');
  console.log(`🎉 Seed complete!`);
  console.log(`   Categories created:    ${catCreated}`);
  console.log(`   Subcategories created: ${subCreated}`);
  console.log(`   Services created:      ${svcCreated}`);
  console.log(`   Skipped (exists/err):  ${skipped}`);
  console.log('─────────────────────────────────');
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
