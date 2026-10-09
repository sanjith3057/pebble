/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.spec.js',
    '<rootDir>/tests/**/*.test.js',
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/dist'],
  collectCoverageFrom: [
    'core/**/*.js',
    'security/**/*.js',
    'tools/**/*.js',
    'apps/desktop/{characters,settings,character-state}.js',
    '!**/node_modules/**',
  ],
};
