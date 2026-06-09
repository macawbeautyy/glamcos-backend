/**
 * sellerController — Seller registration, onboarding and management
 */
const SellerProfile = require('../models/SellerProfile');
const User          = require('../models/User');
const Product       = require('../models/Product');
const Order         = require('../models/Order');
const axios         = require('axios');

// ── GST Format Validator ───────────────────────────────────────────────────────
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// ── State code → name map (from GST first 2 digits) ──────────────────────────
const GST_STATE_CODES = {
  '01': 'Jammu & Kashmir',  '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh',       '05': 'Uttarakhand',      '06': 'Haryana',
  '07': 'Delhi',            '08': 'Rajasthan',         '09': 'Uttar Pradesh',
  '10': 'Bihar',            '11': 'Sikkim',            '12': 'Arunachal Pradesh',
  '13': 'Nagaland',         '14': 'Manipur',           '15': 'Mizoram',
  '16': 'Tripura',          '17': 'Meghalaya',         '18': 'Assam',
  '19': 'West Bengal',      '20': 'Jharkhand',         '21': 'Odisha',
  '22': 'Chhattisgarh',     '23': 'Madhya Pradesh',   '24': 'Gujarat',
  '25': 'Daman & Diu',      '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh',   '29': 'Karnataka',         '30': 'Goa',
  '31': 'Lakshadweep',      '32': 'Kerala',            '33': 'Tamil Nadu',
  '34': 'Puducherry',       '35': 'Andaman & Nicobar', '36': 'Telangana',
  '37': 'Andhra Pradesh',   '38': 'Ladakh',            '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

// Extract partial data from GST number itself (no API needed)
function parseGSTNumber(gst) {
  const stateCode = gst.substring(0, 2);
  const pan       = gst.substring(2, 12);  // PAN embedded in GST
  const state     = GST_STATE_CODES[stateCode] || null;
  // Entity type from 13th char: P=Proprietor, F=Firm, C=Company, T=Trust, B=Body of Individuals etc.
  const entityChar = gst.charAt(12);
  const entityTypes = { P: 'Proprietor', F: 'Firm/LLP', C: 'Company', T: 'Trust', B: 'Body of Individuals', A: 'AOP', K: 'Krishi Kalyan Cess', G: 'Government', L: 'Local Authority', J: 'Artificial Juridical Person', H: 'Hindu Undivided Family (HUF)' };
  const entityType = entityTypes[entityChar] || 'Business';
  return { stateCode, state, pan, entityType };
}

// ── Verify / fetch GST data ────────────────────────────────────────────────────
// ── GST Captcha proxy ─────────────────────────────────────────────────────────
exports.getGSTCaptcha = async (req, res) => {
  try {
    const resp = await axios.get('https://api.gstverify.dubey.app/api/v1/gst/captcha', { timeout: 10000 });
    return res.json({ success: true, sessionId: resp.data.sessionId, image: resp.data.image });
  } catch (err) {
    return res.status(502).json({ success: false, message: 'Could not fetch captcha' });
  }
};

exports.verifyGST = async (req, res) => {
  try {
    const { gstNumber, sessionId, captcha } = req.body;
    if (!gstNumber) return res.status(400).json({ success: false, message: 'GST number is required' });

    const gst = gstNumber.trim().toUpperCase();
    if (!GST_REGEX.test(gst)) {
      return res.status(400).json({ success: false, message: 'Invalid GST number format. Expected: 22AAAAA0000A1Z5' });
    }

    // Try GST verification — multiple sources in priority order
    let fetchedData = null;
    let verified = false;

    // Helper: parse a GST API response (same shape for portal + gstincheck.co.in)
    const parseGSTAPIResponse = (d) => {
      if (!d) return null;
      const addr      = d.pradr?.addr || {};
      const addrParts = [addr.bno, addr.bnm, addr.flno, addr.st, addr.loc, addr.dst].filter(Boolean);
      const parsedGST = parseGSTNumber(gst);
      return {
        legalName:              d.lgnm     || d.tradeNam || '',
        tradeName:              d.tradeNam || d.lgnm     || '',
        gstStatus:              d.sts      || 'Active',
        registeredAddress:      addrParts.join(', '),
        state:                  GST_STATE_CODES[gst.substring(0, 2)] || addr.stcd || parsedGST.state || '',
        pincode:                addr.pncd  || '',
        constitutionOfBusiness: d.ctb      || parsedGST.entityType   || '',
        taxpayerType:           d.dty      || '',
        fetchedAt:              new Date(),
      };
    };

    // ── 1. Try gstverify.dubey.app with API key (most reliable) ────────────────
    try {
      const dubeyKey = process.env.GST_DUBEY_API_KEY;
      if (dubeyKey) {
        console.log('[GST] Calling dubey API for', gst);
        const resp = await axios.post(
          'https://api.gstverify.dubey.app/api/v1/gst/details',
          { gstin: gst },
          { headers: { 'X-API-Key': dubeyKey, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        console.log('[GST] Dubey response status:', resp.status, 'keys:', Object.keys(resp.data || {}));
        const d = resp.data?.data || resp.data;
        if (d && d.lgnm) {
          fetchedData = parseGSTAPIResponse(d);
          verified    = d.sts === 'Active';
          console.log('[GST] Got full data from dubey:', fetchedData.tradeName || fetchedData.legalName);
        } else {
          console.log('[GST] Dubey returned no lgnm:', JSON.stringify(d)?.substring(0, 200));
        }
      }
    } catch (dubeyErr) {
      console.error('[GST] Dubey API error:', dubeyErr?.response?.status, dubeyErr?.response?.data, dubeyErr?.message);
    }

    // ── 2. Try public GST portal (free fallback) ──────────────────────────────
    if (!fetchedData) {
      try {
        const portalResp = await axios.get(
          `https://services.gst.gov.in/services/api/search/gstin?gstin=${gst}`,
          { timeout: 8000, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }
        );
        if (portalResp.data?.flag && portalResp.data?.data?.lgnm) {
          fetchedData = parseGSTAPIResponse(portalResp.data.data);
          verified    = portalResp.data.data.sts === 'Active';
        }
      } catch (portalErr) { console.error('[GST] Portal error:', portalErr?.response?.status, portalErr?.message); }
    }

    // ── 3. Try gstincheck.co.in with API key (fallback) ───────────────────────
    if (!fetchedData) {
      try {
        const apiKey = process.env.GST_VERIFICATION_API_KEY;
        if (apiKey) {
          const resp = await axios.get(`https://sheet.gstincheck.co.in/check/${apiKey}/${gst}`, { timeout: 8000 });
          if (resp.data?.flag && resp.data?.data) {
            fetchedData = parseGSTAPIResponse(resp.data.data);
            verified    = resp.data.data.sts === 'Active';
          }
        }
      } catch (checkErr) { console.error('[GST] gstincheck error:', checkErr?.response?.status, checkErr?.message); }
    }

    if (fetchedData) {
      return res.json({
        success: true,
        verified,
        data: fetchedData,
        message: verified ? 'GST verified successfully' : 'GST found but status is not Active',
      });
    }

    // No API key or API failed — extract what we can from the GST number itself
    const parsed = parseGSTNumber(gst);
    return res.json({
      success: true,
      verified: false,
      data: {
        state:       parsed.state,
        entityType:  parsed.entityType,
        pan:         parsed.pan,
        stateCode:   parsed.stateCode,
        gstStatus:   'Pending Verification',
        // tradeName and legalName are unknown without API — leave blank so user fills manually
        tradeName:   '',
        legalName:   '',
      },
      manualReview: true,
      message: 'GST format is valid. Business details will be verified manually by admin.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── IFSC Lookup ────────────────────────────────────────────────────────────────
exports.lookupIFSC = async (req, res) => {
  try {
    const { ifsc } = req.params;
    if (!ifsc) return res.status(400).json({ success: false, message: 'IFSC code is required' });

    const code = ifsc.trim().toUpperCase();
    // Basic IFSC format: 4 alpha + 0 + 6 alphanumeric
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Invalid IFSC format' });
    }

    const resp = await axios.get(`https://ifsc.razorpay.com/${code}`, { timeout: 8000 });
    if (resp.data && resp.data.BANK) {
      return res.json({
        success: true,
        data: {
          bankName:      resp.data.BANK,
          branchName:    resp.data.BRANCH,
          branchAddress: resp.data.ADDRESS,
          city:          resp.data.CITY,
          state:         resp.data.STATE,
          contact:       resp.data.CONTACT,
        },
      });
    }
    return res.status(404).json({ success: false, message: 'IFSC code not found' });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ success: false, message: 'IFSC code not found' });
    }
    res.status(500).json({ success: false, message: 'IFSC lookup failed: ' + err.message });
  }
};

// ── Save onboarding step ───────────────────────────────────────────────────────
exports.saveOnboardingStep = async (req, res) => {
  try {
    const userId = req.user._id;
    const { step, data } = req.body;

    if (!step || !data) return res.status(400).json({ success: false, message: 'step and data are required' });

    let profile = await SellerProfile.findOne({ user: userId });
    if (!profile) {
      profile = new SellerProfile({ user: userId });
    }

    if (step === 1) {
      // Business Info
      const fields = ['businessName','legalBusinessName','businessType','description','phone',
        'gstNumber','gstVerified','gstStatus','gstFetchedData','businessAddress',
        'businessState','businessCity','businessPincode'];
      fields.forEach(f => { if (data[f] !== undefined) profile[f] = data[f]; });
      // Sync legacy address
      profile.address = {
        street:  data.businessAddress || '',
        city:    data.businessCity    || '',
        state:   data.businessState   || '',
        pincode: data.businessPincode || '',
      };
      if (profile.onboardingStep < 1) profile.onboardingStep = 1;
    } else if (step === 2) {
      // Bank Details
      if (data.bankAccount) {
        profile.bankAccount = data.bankAccount;
        profile.bankName      = data.bankAccount.bankName    || null;
        profile.branchName    = data.bankAccount.branchName  || null;
        profile.branchAddress = data.bankAccount.branchAddress || null;
      }
      if (profile.onboardingStep < 2) profile.onboardingStep = 2;
    }

    await profile.save();
    res.json({ success: true, message: `Step ${step} saved`, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Upload document ────────────────────────────────────────────────────────────
exports.uploadDocument = async (req, res) => {
  try {
    const userId = req.user._id;
    const { docType } = req.params;   // gstCertificate | brandAuthorizationLetter | manufacturerAuthDocument | businessAddressProof
    const { url } = req.body;

    const allowed = ['gstCertificate','brandAuthorizationLetter','manufacturerAuthDocument','businessAddressProof'];
    if (!allowed.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }
    if (!url) return res.status(400).json({ success: false, message: 'Document URL is required' });

    const profile = await SellerProfile.findOne({ user: userId });
    if (!profile) return res.status(404).json({ success: false, message: 'Seller profile not found' });

    profile[docType] = { url, status: 'uploaded', uploadedAt: new Date() };
    await profile.save();

    res.json({ success: true, message: 'Document uploaded', data: profile[docType] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Submit onboarding (final step) ────────────────────────────────────────────
exports.submitOnboarding = async (req, res) => {
  try {
    const userId = req.user._id;
    const profile = await SellerProfile.findOne({ user: userId });
    if (!profile) return res.status(404).json({ success: false, message: 'Seller profile not found' });

    if (!profile.businessName) {
      return res.status(400).json({ success: false, message: 'Complete Business Information first' });
    }
    if (!profile.gstCertificate?.url) {
      return res.status(400).json({ success: false, message: 'GST Certificate is required' });
    }

    profile.onboardingCompleted = true;
    profile.onboardingStep      = 3;
    profile.sellerStatus        = 'submitted';
    profile.status              = 'pending';
    await profile.save();

    res.json({ success: true, message: 'Onboarding submitted for review', data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

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

// ── Admin: request changes from seller ────────────────────────────────────────
exports.adminRequestChanges = async (req, res) => {
  try {
    const { changes } = req.body;
    if (!changes || !changes.trim()) {
      return res.status(400).json({ success: false, message: 'Changes description is required' });
    }
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Seller not found' });

    profile.sellerStatus      = 'under_review';
    profile.status            = 'under_review';
    profile.requestedChanges  = changes.trim();
    await profile.save();

    res.json({ success: true, message: 'Changes requested from seller', data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: review a document ───────────────────────────────────────────────────
exports.adminReviewDocument = async (req, res) => {
  try {
    const { sellerId, docType } = req.params;
    const { status, reviewNote } = req.body;

    const allowed = ['gstCertificate','brandAuthorizationLetter','manufacturerAuthDocument','businessAddressProof'];
    if (!allowed.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type' });
    }
    if (!['approved','rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const profile = await SellerProfile.findById(sellerId);
    if (!profile) return res.status(404).json({ success: false, message: 'Seller not found' });

    if (profile[docType]) {
      profile[docType].status     = status;
      profile[docType].reviewNote = reviewNote || null;
      profile.markModified(docType);
    }
    await profile.save();

    res.json({ success: true, message: `Document ${status}`, data: profile[docType] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: approve a product ───────────────────────────────────────────────────
exports.adminApproveProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.status        = 'active';
    product.productStatus = 'approved';
    product.isActive      = true;
    product.approvedBy    = req.user._id;
    product.approvedAt    = new Date();
    product.rejectionReason = null;
    await product.save();

    res.json({ success: true, message: 'Product approved', data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: reject a product ────────────────────────────────────────────────────
exports.adminRejectProduct = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Rejection reason is required' });

    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.status          = 'rejected';
    product.productStatus   = 'rejected';
    product.isActive        = false;
    product.rejectionReason = reason.trim();
    await product.save();

    res.json({ success: true, message: 'Product rejected', data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: request product changes ────────────────────────────────────────────
exports.adminRequestProductChanges = async (req, res) => {
  try {
    const { changes } = req.body;
    if (!changes?.trim()) return res.status(400).json({ success: false, message: 'Changes description is required' });

    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.productStatus    = 'under_review';
    product.status           = 'pending_approval';
    product.requestedChanges = changes.trim();
    await product.save();

    res.json({ success: true, message: 'Changes requested', data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: get all pending products ───────────────────────────────────────────
exports.adminGetPendingProducts = async (req, res) => {
  try {
    const { status = 'pending_approval', seller, category, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (seller)   filter.seller   = seller;
    if (category) filter.category = category;

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName email')
      .populate('category', 'name')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({ success: true, data: products, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
