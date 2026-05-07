const SalonPartner     = require('../models/SalonPartner');
const SalonAppointment = require('../models/SalonAppointment');

// GET /api/v1/salon-appointments/salons  — list approved partner salons
exports.listSalons = async (req, res) => {
  try {
    const { city } = req.query;
    const filter = { status: 'approved', enableBooking: true };
    if (city) filter.city = new RegExp(city, 'i');
    const salons = await SalonPartner.find(filter).select('-gstNumber -userId -adminNote -reviewedBy');
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
