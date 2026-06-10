require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const SellerProfile = require('./src/models/SellerProfile');
  const User = require('./src/models/User');

  const profiles = await SellerProfile.find({}, '_id user businessName');
  console.log(`Found ${profiles.length} seller profile(s)`);
  const userIds = profiles.map(p => p.user).filter(Boolean);

  if (userIds.length) {
    const r = await User.updateMany({ _id: { $in: userIds }, role: 'vendor' }, { role: 'user' });
    console.log(`Downgraded ${r.modifiedCount} vendor user(s) to 'user'`);
  }

  const result = await SellerProfile.deleteMany({});
  console.log(`Deleted ${result.deletedCount} seller profile(s)`);

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
