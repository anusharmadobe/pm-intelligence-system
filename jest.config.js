module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/backend/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/backend/tests/env.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/backend/tests/teardown.ts'],
  modulePathIgnorePatterns: ['<rootDir>/backup/', '<rootDir>/data/', '<rootDir>/dist/'],
  watchPathIgnorePatterns: ['<rootDir>/backup/', '<rootDir>/data/', '<rootDir>/dist/'],
  maxWorkers: 1,
  testTimeout: 10000
};
