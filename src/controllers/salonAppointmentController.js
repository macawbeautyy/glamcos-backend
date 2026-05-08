const SalonPartner     = require('../models/SalonPartner');
const SalonAppointment = require('../models/SalonAppointment');
const Razorpay         = require('razorpay');
const crypto           = require('crypto');

function getRazorpay() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// GET /api/v1/salon-appointments/salons  — list approved partner salons
exports.listSalons = async (req, res) => {
  try {
    const { city } = req.query;
    const filter = { status: 'approved', enableBooking: true };
    if (city) filter.city = new RegExp(city, 'i');
    const salons = await SalonPartner.find(filter).select('-gstNumber -userId -adminNote -reviewedBy -reviewedAt');
    res.json({ salons });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/v1/salon-appointments/slots/:partnerId?date=YYYY-MM-DD
exports.getSlots = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'date query param required.' });

    // Generate slots 9am-8pm every 30 min
    const ALL_SLOTS = [];
    for (let h = 9; h < 20; h++) {
      ALL_SLOTS.push(`${String(h).padStart(2,'0')}:00`);
      ALL_SLOTS.push(`${String(h).padStart(2,'0')}:30`);
    }

    // Find booked slots for this date
    const booked = await SalonAppointment.find({ partnerId, date, status: { $ne: 'cancelled' } }).select('timeSlot');
    const bookedSet = new Set(booked.map(b => b.timeSlot));

    const slots = ALL_SLOTS.map(t => ({ time: t, available: !bookedSet.has(t) }));
    res.json({ slots });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/v1/salon-appointments  — book a slot
exports.book = async (req, res) => {
  try {
    const { partnerId, service, date, timeSlot, userName, userPhone, note } = req.body;
    if (!partnerId || !service || !date || !timeSlot || !userName || !userPhone) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Check partner exists and is approved
    const partner = await SalonPartner.findOne({ _id: partnerId, status: 'approved', enableBooking: true });
    if (!partner) return res.status(404).json({ message: 'Salon not found or not accepting bookings.' });

    // Check slot not already taken
    const conflict = await SalonAppointment.findOne({ partnerId, date, timeSlot, status: { $ne: 'cancelled' } });
    if (conflict) return res.status(409).json({ message: 'This slot is already booked. Please choose another time.' });

    const appt = await SalonAppointment.create({
      partnerId, service, date, timeSlot, userName, userPhone, note,
      userId: req.user?._id,
    });

    res.status(201).json({
      message: 'Appointment booked successfully!',
      appointment: { ...appt.toObject(), salonName: partner.salonName, address: partner.address, city: partner.city },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Slot just got booked. Please pick another time.' });
    console.error('Book slot error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/v1/salon-appointments/my  — user's appointments
exports.myAppointments = async (req, res) => {
  try {
    const appts = await SalonAppointment.find({ userId: req.user._id })
      .sort({ date: -1, timeSlot: -1 })
      .populate('partnerId', 'salonName address city phone');
    res.json({ appointments: appts });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/v1/salon-appointments/partner/:partnerId  — admin/partner view
exports.partnerAppointments = async (req, res) => {
  try {
    const { date } = req.query;
    const filter = { partnerId: req.params.partnerId };
    if (date) filter.date = date;
    const appts = await SalonAppointment.find(filter).sort({ date: 1, timeSlot: 1 });
    res.json({ appointments: appts });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/v1/salon-appointments/:id/cancel
exports.cancel = async (req, res) => {
  try {
    const appt = await SalonAppointment.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, status: 'booked' },
      { status: 'cancelled' },
      { new: true }
    );
    if (!appt) return res.status(404).json({ message: 'Appointment not found or cannot be cancelled.' });
    res.json({ message: 'Appointment cancelled.', appointment: appt });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/v1/salon-appointments/owner  — appointments for the logged-in salon owner
exports.ownerDashboard = async (req, res) => {
  try {
    const partner = await SalonPartner.findOne({ userId: req.user._id, status: 'approved' });
    if (!partner) return res.status(404).json({ message: 'No approved salon found for this account.' });

    const today = new Date().toISOString().slice(0, 10);
    const { filter = 'upcoming' } = req.query; // 'today' | 'upcoming' | 'all'

    let query = { partnerId: partner._id };
    if (filter === 'today')    query.date = today;
    if (filter === 'upcoming') query.date = { $gte: today };

    const appointments = await SalonAppointment.find(query)
      .sort({ date: 1, timeSlot: 1 })
      .limit(50);

    const totalAll   = await SalonAppointment.countDocuments({ partnerId: partner._id });
    const todayCount = await SalonAppointment.countDocuments({ partnerId: partner._id, date: today, status: { $ne: 'cancelled' } });
    const newCount   = await SalonAppointment.countDocuments({ partnerId: partner._id, ownerSeen: { $ne: true }, status: { $ne: 'cancelled' } });

    res.json({ appointments, salonId: partner._id, stats: { total: totalAll, today: todayCount, newBookings: newCount } });
  } catch (err) {
    console.error('ownerDashboard error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/v1/salon-appointments/owner/mark-seen — mark all as seen by owner
exports.markOwnerSeen = async (req, res) => {
  try {
    const partner = await SalonPartner.findOne({ userId: req.user._id, status: 'approved' });
    if (!partner) return res.status(404).json({ message: 'No approved salon found.' });
    await SalonAppointment.updateMany({ partnerId: partner._id, ownerSeen: { $ne: true } }, { ownerSeen: true });
    res.json({ message: 'Marked as seen.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/v1/salon-appointments/create-order
// Creates a Razorpay order; amount in paise (100 = ₹1)
exports.createOrder = async (req, res) => {
  try {
    const { amount = 100 } = req.body; // default ₹1 token
    const instance = getRazorpay();
    const order = await instance.orders.create({
      amount,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('createOrder error:', err);
    res.status(500).json({ message: 'Could not create payment order.' });
  }
};

// POST /api/v1/salon-appointments/verify-and-book
// Verifies Razorpay signature then books the slot
exports.verifyAndBook = async (req, res) => {
  try {
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      partnerId, service, date, timeSlot, userName, userPhone, note, amount,
    } = req.body;

    // Signature check
    const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');
    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed. Please contact support.' });
    }

    // Check partner still accepting bookings
    const partner = await SalonPartner.findOne({ _id: partnerId, status: 'approved', enableBooking: true });
    if (!partner) return res.status(404).json({ message: 'Salon not available for booking.' });

    // Check slot not already taken
    const conflict = await SalonAppointment.findOne({ partnerId, date, timeSlot, status: { $ne: 'cancelled' } });
    if (conflict) return res.status(409).json({ message: 'Slot was just booked. Please pick another time.' });

    const appt = await SalonAppointment.create({
      partnerId, service, date, timeSlot, userName, userPhone, note,
      userId:      req.user?._id,
      paid:        true,
      tokenAmount: amount || 100,
      paymentId:   razorpay_payment_id,
      orderId:     razorpay_order_id,
    });

    res.status(201).json({
      message: 'Appointment booked and payment verified!',
      appointment: {
        ...appt.toObject(),
        salonName: partner.salonName,
        address:   partner.address,
        city:      partner.city,
      },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Slot just got booked. Please pick another time.' });
    console.error('verifyAndBook error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};
