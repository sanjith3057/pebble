/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/tests/**/*.spec.js',
    '<rootDir>/tests/**/*.test.js',
  ],
  testPathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/dist'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};