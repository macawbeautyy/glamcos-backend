const mongoose = require('mongoose');

const salonSpaceListingSchema = new mongoose.Schema({
  // ── Basics ─────────────────────────────────────────────────────────────
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  category:    { type: String, default: 'Unisex Salon', trim: true },
  spaceType:   { type: String, enum: ['chair', 'room', 'station', 'full_salon'], default: 'full_salon' },

  // 'sale' | 'rent' — top-level branch that decides which pricing block applies
  listingType: { type: String, enum: ['sale', 'rent', 'lease'], default: 'rent' },

  // What's actually being sold/rented — the empty shop, the shop + fixtures,
  // or the whole running business (staff, clients, brand). Mainly relevant
  // for 'sale' but kept generic since a rented space can also come furnished.
  saleScope: { type: String, enum: ['shop_only', 'shop_equipment', 'shop_business'], default: 'shop_only' },

  // ── Location ───────────────────────────────────────────────────────────
  address:  { type: String, default: '', trim: true },
  landmark: { type: String, default: '', trim: true },
  city:     { type: String, default: '', trim: true },
  pincode:  { type: String, default: '', trim: true },
  area:     { type: String, default: '', trim: true }, // legacy free-text "area, city" label, kept for back-compat
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },

  // ── Space details ──────────────────────────────────────────────────────
  areaUnit:        { type: String, enum: ['sqft', 'sqyard', 'sqm'], default: 'sqft' },
  carpetAreaSqft:  { type: Number, default: 0 },
  builtupAreaSqft: { type: Number, default: 0 },
  floor:           { type: String, default: '', trim: true },
  totalFloors:     { type: String, default: '', trim: true },
  furnishing:      { type: String, enum: ['bare', 'semi', 'full'], default: 'bare' },
  washrooms:       { type: Number, default: 0 },
  parking:         { type: String, default: '', trim: true },
  powerBackupKW:   { type: Number, default: 0 },
  frontageWidthFt: { type: Number, default: 0 },
  amenities:       [{ type: String }],

  // ── Salon / business details (unlocked by saleScope) ──────────────────
  chairs:          { type: Number, default: 0 },
  treatmentRooms:  { type: Number, default: 0 },
  equipment:       [{ type: String }],
  staffCount:      { type: Number, default: 0 },
  staffStaying:    { type: String, enum: ['yes', 'no', 'some', ''], default: '' },
  brandAffiliation:{ type: String, default: '', trim: true },
  licenses:        [{ type: String }],
  yearsInOperation:{ type: Number, default: 0 },
  // A bracket key (e.g. '1l_3l'), not an exact figure — kept as a range so
  // sellers aren't forced to disclose a precise number.
  monthlyRevenue:  { type: String, enum: ['', 'under_1l', '1l_3l', '3l_5l', '5l_10l', '10l_plus'], default: '' },
  reasonForSelling:{ type: String, default: '', trim: true },

  // ── Sale-only pricing ──────────────────────────────────────────────────
  askingPrice:      { type: Number, default: 0 },
  negotiable:       { type: Boolean, default: false },
  ownershipType:    { type: String, enum: ['freehold', 'leasehold', 'society', ''], default: '' },
  possessionStatus: { type: String, enum: ['ready', 'under_transfer', ''], default: '' },

  // ── Rent/lease-only pricing ─────────────────────────────────────────────
  monthlyRent:         { type: Number, default: 0 },
  securityDeposit:     { type: Number, default: 0 },
  maintenanceCharges:  { type: Number, default: 0 },
  lockInMonths:        { type: Number, default: 0 },
  leaseTenureYears:    { type: Number, default: 0 },
  availableFrom:       { type: String, default: '', trim: true },
  subLeasePermitted:   { type: Boolean, default: false },

  // Legacy single "price" field — kept in sync with askingPrice/monthlyRent
  // for back-compat with existing filters/sorts that read `price`.
  price: { type: Number, default: 0 },

  // ── Media ──────────────────────────────────────────────────────────────
  images: [{ type: String }],
  videos: [{ type: String }],

  // ── Contact ────────────────────────────────────────────────────────────
  contactName:  { type: String, default: '', trim: true },
  contactPhone: { type: String, default: '', trim: true },
  contactEmail: { type: String, default: '', trim: true },

  // ── Owner ──────────────────────────────────────────────────────────────
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ── Admin workflow ─────────────────────────────────────────────────────
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },

  // Set to true whenever an owner edits an already-approved listing, so it
  // drops back into the pending queue for re-review without losing the fact
  // that it was live before (mirrors FranchiseListing's edit-review flow).
  wasApprovedBeforeEdit: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('SalonSpaceListing', salonSpaceListingSchema);
