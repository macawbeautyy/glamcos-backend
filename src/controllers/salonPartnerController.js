const SalonPartner = require('../models/SalonPartner');
const https = require('https');

// ── Geocode helper — Nominatim (free, no API key) ─────────────────────────────
function geocode(address, city, pincode) {
  return new Promise((resolve) => {
    const q = encodeURIComponent(`${address}, ${city}, ${pincode}, India`);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
    const opts = { headers: { 'User-Agent': 'GlamcosApp/1.0 (glamcoslifestyle@gmail.com)' } };
    https.get(url, opts, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const results = JSON.parse(raw);
          if (results && results[0]) {
            resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          } else {
            // Fallback: try just city
            const q2 = encodeURIComponent(`${city}, India`);
            const url2 = `https://nominatim.openstreetmap.org/search?q=${q2}&format=json&limit=1`;
            https.get(url2, opts, (res2) => {
              let raw2 = '';
              res2.on('data', d => raw2 += d);
              res2.on('end', () => {
                try {
                  const r2 = JSON.parse(raw2);
                  resolve(r2[0] ? { lat: parseFloat(r2[0].lat), lng: parseFloat(r2[0].lon) } : {});
                } catch { resolve({}); }
              });
            }).on('error', () => resolve({}));
          }
        } catch { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

// POST /api/v1/salon-partners  — submit application
exports.apply = async (req, res) => {
  try {
    const {
      ownerName, phone, email, salonName, yearsOld,
      address, city, pincode, avgMonthlySale,
      seatingCapacity, hasGst, gstNumber, services, enableBooking,
    } = req.body;

    // Prevent duplicate pending applications from same phone
    const existing = await SalonPartner.findOne({ phone, status: 'pending' });
    if (existing) {
      return res.status(409).json({ message: 'An application from this phone number is already under review.' });
    }

    const partner = await SalonPartner.create({
      ownerName, phone, email, salonName, yearsOld,
      address, city, pincode, avgMonthlySale,
      seatingCapacity, hasGst, gstNumber, services,
      enableBooking,
      userId: req.user?._id,
    });

    res.status(201).json({ message: 'Application submitted successfully!', partner });
  } catch (err) {
    console.error('SalonPartner apply error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// GET /api/v1/salon-partners/my  — check own status
exports.myStatus = async (req, res) => {
  try {
    const partner = await SalonPartner.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ partner: partner || null });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/v1/salon-partners  — list all (admin)
exports.list = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const partners = await SalonPartner.find(filter).sort({ createdAt: -1 });
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/v1/salon-partners/:id/status  — approve/reject/reset (admin)
exports.updateStatus = async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const updates = { status, adminNote, reviewedAt: new Date(), reviewedBy: req.user._id };

    // Auto-geocode when approving (so the map has stored coordinates)
    if (status === 'approved') {
      const salon = await SalonPartner.findById(req.params.id);
      if (salon && (!salon.lat || !salon.lng)) {
        const coords = await geocode(salon.address, salon.city, salon.pincode);
        if (coords.lat) {
          updates.lat = coords.lat;
          updates.lng = coords.lng;
        }
      }
    }

    const partner = await SalonPartner.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );
    if (!partner) return res.status(404).json({ message: 'Application not found.' });
    res.json({ message: `Application ${status}.`, partner });
  } catch (err) {
    console.error('updateStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};
