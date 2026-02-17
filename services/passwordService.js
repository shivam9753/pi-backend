const bcrypt = require('bcrypt');

const DEFAULT_SALT_ROUNDS = 12;

async function hashPassword(password, saltRounds = DEFAULT_SALT_ROUNDS) {
  return await bcrypt.hash(password, saltRounds);
}

async function comparePassword(plain, hashed) {
  return await bcrypt.compare(plain, hashed);
}

module.exports = {
  hashPassword,
  comparePassword,
  DEFAULT_SALT_ROUNDS
};
