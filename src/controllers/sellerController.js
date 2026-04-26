/**
 * sellerController — Seller registration and management
 */
const SellerProfile = require('../models/SellerProfile');
const User          = require('../models/User');
const Product       = require('../models/Product');
const Order         = require('../models/Order');

// ── Register as seller ─────────────────────────────────────────────────────────
exports.registerSeller = async (req, res) => {
  try {
    const userId = req.user._id;

    // Check if already registered
    const existing = await SellerProfile.findOne({ user: userId });
    if (existing) {
      // Re-apply if previously rejected
      if (existing.status === 'rejected') {
        const { businessName, businessType, description, phone, address, gstin, panNumber } = req.body;
        existing.status = 'pending';
        existing.rejectionReason = null;
        if (businessName) existing.businessName = businessName;
        if (businessType) existing.businessType = businessType;
        if (description)  existing.description  = description;
        if (phone)        existing.phone        = phone;
        if (address)      existing.address      = address;
        if (gstin)        existing.gstin        = gstin;
        if (panNumber)    existing.panNumber    = panNumber;
        await existing.save();
        return res.status(200).json({ success: true, message: 'Reapplication submitted', data: existing });
      }
      return res.status(400).json({ success: false, message: `Seller profile already exists with status: ${existing.status}` });
    }

    const { businessName, businessType, description, phone, address, gstin, panNumber } = req.body;
    if (!businessName || !phone) {
      return res.status(400).json({ success: false, message: 'Business name and phone are required' });
    }

    const profile = await SellerProfile.create({
      user: userId, businessName, businessType, description, phone, address, gstin, panNumber,
    });

    res.status(201).json({ success: true, message: 'Seller registration submitted. Awaiting admin approval.', data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get my seller profile ──────────────────────────────────────────────────────
exports.getMySeller = async (req, res) => {
  try {
    const profile = await SellerProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ success: false, message: 'Seller profile not found' });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Update my seller profile ───────────────────────────────────────────────────
exports.updateMySeller = async (req, res) => {
  try {
    const profile = await SellerProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ success: false, message: 'Seller profile not found' });

    const allowed = ['businessName', 'businessType', 'description', 'phone', 'address', 'gstin', 'panNumber', 'bankAccount'];
    allowed.forEach((f) => { if (req.body[f] !== undefined) profile[f] = req.body[f]; });
    await profile.save();
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get seller dashboard stats ─────────────────────────────────────────────────
exports.getSellerDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    const profile = await SellerProfile.findOne({ user: userId });
    if (!profile || profile.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Seller account not approved' });
    }

    const [products, orders] = await Promise.all([
      Product.find({ seller: userId }).select('name price status stock totalSold images thumbnail rating').lean(),
      Order.find({ seller: userId }).sort('-createdAt').limit(20)
        .populate('buyer', 'firstName lastName phone')
        .populate('items.product', 'name images thumbnail price')
        .lean(),
    ]);

    const totalRevenue = orders
      .filter((o) => o.status === 'delivered')
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    const pendingRevenue = orders
      .filter((o) => ['pending', 'confirmed', 'shipped'].includes(o.status))
      .reduce((s, o) => s + (o.totalAmount || 0), 0);

    res.json({
      success: true,
      data: {
        profile,
        products,
        orders,
        stats: {
          totalProducts:  products.length,
          activeProducts: products.filter((p) => p.status === 'active').length,
          totalOrders:    orders.length,
          totalRevenue,
          pendingRevenue,
          deliveredOrders: orders.filter((o) => o.status === 'delivered').length,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

// ── Get all seller registrations ───────────────────────────────────────────────
exports.adminGetSellers = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const total = await SellerProfile.countDocuments(filter);
    const sellers = await SellerProfile.find(filter)
      .populate('user', 'firstName lastName email phone role status createdAt')
      .populate('approvedBy', 'firstName lastName')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({ success: true, data: sellers, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Approve a seller ───────────────────────────────────────────────────────────
exports.adminApproveSeller = async (req, res) => {
  try {
    const profile = await SellerProfile.findById(req.params.id).populate('user');
    if (!profile) return res.status(404).json({ success: false, message: 'Seller not found' });

    profile.status = 'approved';
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    profile.rejectionReason = null;
    await profile.save();

    // Upgrade user role to vendor
    await User.findByIdAndUpdate(profile.user._id, { role: 'vendor' });

    res.json({ success: true, message: 'Seller approved. User role upgraded to vendor.', data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Reject a seller ────────────────────────────────────────────────────────────
exports.adminRejectSeller = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Seller not found' });

    profile.status = 'rejected';
    profile.rejectionReason = reason.trim();
    await profile.save();

    // Downgrade vendor back to user if previously approved
    await User.findByIdAndUpdate(profile.user, { role: 'user' });

    res.json({ success: true, message: 'Seller rejected', data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Suspend / reinstate a seller ───────────────────────────────────────────────
exports.adminUpdateSellerStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const allowed = ['approved', 'suspended', 'under_review'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const profile = await SellerProfile.findByIdAndUpdate(
      req.params.id,
      { status, ...(reason ? { rejectionReason: reason } : {}) },
      { new: true }
    );
    if (!profile) return res.status(404).json({ success: false, message: 'Seller not found' });

    if (status === 'suspended') {
      await User.findByIdAndUpdate(profile.user, { role: 'user' });
    } else if (status === 'approved') {
      await User.findByIdAndUpdate(profile.user, { role: 'vendor' });
    }

    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: get all marketplace orders ─────────────────────────────────────────
exports.adminGetMarketplaceOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .populate('buyer', 'firstName lastName email phone')
      .populate('seller', 'firstName lastName email')
      .populate('items.product', 'name images thumbnail price')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({ success: true, data: orders, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: get seller's products ───────────────────────────────────────────────
exports.adminGetSellerProducts = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const products = await Product.find({ seller: sellerId })
      .populate('category', 'name')
      .sort('-createdAt')
      .lean();
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
