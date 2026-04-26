/**
 * Platform-wide constants.
 * Centralized so all apps use identical values.
 */

// User roles across the platform
const ROLES = {
  USER: 'user',
  PROVIDER: 'provider',
  VENDOR: 'vendor',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
};

// Account statuses
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  PENDING: 'pending_verification',
};

// Booking statuses (service bookings)
const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROVIDER_ASSIGNED: 'provider_assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
};

// Order statuses (marketplace orders)
const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned',
  REFUNDED: 'refunded',
};

// Payment statuses
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

// Payment methods
const PAYMENT_METHODS = {
  COD: 'cod',
  UPI: 'upi',
  CARD: 'card',
  NET_BANKING: 'net_banking',
  WALLET: 'wallet',
};

// Notification types
const NOTIFICATION_TYPES = {
  BOOKING_CREATED: 'booking_created',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_COMPLETED: 'booking_completed',
  ORDER_PLACED: 'order_placed',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_DELIVERED: 'order_delivered',
  PAYMENT_RECEIVED: 'payment_received',
  REVIEW_RECEIVED: 'review_received',
  PROMO_OFFER: 'promo_offer',
  SYSTEM: 'system',
};

// App types (identifies which app is making the request)
const APP_TYPES = {
  USER: 'user_app',
  PROVIDER: 'provider_app',
  MARKETPLACE: 'marketplace_app',
  ADMIN: 'admin_panel',
};

// Pagination defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 50,
};

module.exports = {
  ROLES,
  USER_STATUS,
  BOOKING_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  NOTIFICATION_TYPES,
  APP_TYPES,
  PAGINATION,
};
