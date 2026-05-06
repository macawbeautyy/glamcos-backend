const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const hash = await bcrypt.hash('Test@1234', 10);
  const result = await db.collection('users').updateMany(
    {},
    { $set: { password: hash } }
  );
  console.log('Updated:', result.modifiedCount, 'users');
  console.log('Password is now: Test@1234');
  process.exit();
});