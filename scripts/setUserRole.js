const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function setUserRole() {
  try {
    await mongoose.connect(process.env.ATLAS_URL);
    console.log('Connected to database');

    const email = process.argv[2];
    const role = process.argv[3];

    if (!email || !role) {
      console.log('Usage: node setUserRole.js <email> <role>');
      console.log('Example: node setUserRole.js user@example.com admin');
      process.exit(1);
    }

    if (!['user', 'reviewer', 'admin'].includes(role)) {
      console.log('Role must be: user, reviewer, or admin');
      process.exit(1);
    }

    // Find user by email and update role
    const user = await User.findOneAndUpdate(
      { email: email },
      { role: role },
      { new: true, upsert: true }
    );

    console.log(`✅ User role updated:`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name || 'Not set'}`);
    console.log(`   Role: ${user.role}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

setUserRole();