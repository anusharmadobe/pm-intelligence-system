module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/backend/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/backend/tests/env.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/backup/', '<rootDir>/data/', '<rootDir>/dist/'],
  watchPathIgnorePatterns: ['<rootDir>/backup/', '<rootDir>/data/', '<rootDir>/dist/'],
  maxWorkers: 1
};
