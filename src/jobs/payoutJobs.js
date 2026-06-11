/**
 * payoutJobs — releases matured seller earnings (Pending → Available)
 * after the configured holding period. Runs hourly.
 */
let cron = null;
try { cron = require('node-cron'); } catch { cron = null; }

const logger = require('../utils/logger');
const { releaseMaturedEarnings } = require('../services/walletService');

function startPayoutJobs() {
  if (!cron) {
    logger.warn('[PayoutJob] node-cron not installed — earnings release job disabled');
    return;
  }
  // Hourly at minute 5
  cron.schedule('5 * * * *', () => {
    releaseMaturedEarnings().catch((e) =>
      logger.error(`[PayoutJob] release failed: ${e.message}`)
    );
  });
  // Also run once shortly after boot so restarts don't delay releases
  setTimeout(() => {
    releaseMaturedEarnings().catch(() => {});
  }, 15 * 1000);
  logger.info('[PayoutJob] Earnings release job scheduled (hourly)');
}

module.exports = { startPayoutJobs };
