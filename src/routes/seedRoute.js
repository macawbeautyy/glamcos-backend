/**
 * ONE-TIME SEED ROUTE — DELETE AFTER USE
 * POST /api/v1/seed?secret=glamcos_seed_2026
 * Seeds product categories + makes macawbeautyy@gmail.com superadmin
 */
const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');

const SEED_SECRET = 'glamcos_seed_2026';

const CategorySchema = new mongoose.Schema({
  name: String, slug: String, description: String,
  icon: String, type: { type: String, default: 'product' },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

const UserSchema = new mongoose.Schema({ email: String, role: String }, { strict: false });

const CATS = [
  { parent: { name: 'Hair Care',  icon: '💆', type: 'product', slug: 'hair-care',  description: 'Shampoos, conditioners, hair oils' },
    subs: [{ name:'Shampoo',icon:'🧴',slug:'shampoo'},{ name:'Conditioner',icon:'🫧',slug:'conditioner'},{ name:'Hair Oil',icon:'💧',slug:'hair-oil'},{ name:'Hair Serum',icon:'✨',slug:'hair-serum'},{ name:'Hair Mask',icon:'🌿',slug:'hair-mask'}] },
  { parent: { name: 'Skincare',   icon: '🧴', type: 'product', slug: 'skincare',   description: 'Moisturisers, serums, face wash' },
    subs: [{ name:'Moisturiser',icon:'🫶',slug:'moisturiser'},{ name:'Face Serum',icon:'💎',slug:'face-serum'},{ name:'Face Wash',icon:'🫧',slug:'face-wash'},{ name:'Sunscreen',icon:'☀️',slug:'sunscreen'}] },
  { parent: { name: 'Makeup',     icon: '💄', type: 'product', slug: 'makeup',     description: 'Lipstick, foundation, eye makeup' },
    subs: [{ name:'Lipstick',icon:'💋',slug:'lipstick'},{ name:'Foundation',icon:'🎭',slug:'foundation'},{ name:'Eye Makeup',icon:'👁',slug:'eye-makeup'}] },
  { parent: { name: 'Nail Care',  icon: '💅', type: 'product', slug: 'nail-care',  description: 'Nail polish, nail tools' },
    subs: [{ name:'Nail Polish',icon:'💅',slug:'nail-polish'},{ name:'Nail Tools',icon:'🪮',slug:'nail-tools'}] },
  { parent: { name: 'Tools',      icon: '🪮', type: 'product', slug: 'tools',      description: 'Professional salon tools' },
    subs: [{ name:'Scissors',icon:'✂️',slug:'scissors'},{ name:'Brushes',icon:'🖌️',slug:'brushes'}] },
  { parent: { name: 'Fragrance',  icon: '🌸', type: 'product', slug: 'fragrance',  description: 'Perfumes and body mists' },
    subs: [{ name:'Perfume',icon:'🌸',slug:'perfume'},{ name:'Body Mist',icon:'💨',slug:'body-mist'}] },
];

router.post('/', async (req, res) => {
  if (req.query.secret !== SEED_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  try {
    const Category = mongoose.models.Category || mongoose.model('Category', CategorySchema);
    const User     = mongoose.models.User     || mongoose.model('User', UserSchema);

    // Upgrade user to superadmin first (need ID for createdBy)
    const user = await User.findOneAndUpdate(
      { email: 'macawbeautyy@gmail.com' },
      { role: 'superadmin' },
      { new: true }
    );
    const adminId = user?._id || new mongoose.Types.ObjectId();

    // Wipe old categories
    const deleted = await Category.deleteMany({});

    // Seed fresh
    const created = [];
    for (const cat of CATS) {
      const p = await Category.create({ ...cat.parent, type: 'product', createdBy: adminId });
      created.push(p.name);
      for (const sub of cat.subs) {
        await Category.create({ ...sub, type: 'product', parent: p._id, createdBy: adminId });
      }
    }

    res.json({
      success: true,
      deletedOld: deleted.deletedCount,
      seeded: created,
      userRole: user?.role || 'not found',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
 
