module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Prevent SELECT * queries in SQL strings
    'no-restricted-syntax': [
      'error',
      {
        selector: "TemplateLiteral[quasis] > TemplateElement[value.raw=/SELECT\\s+\\*/i]",
        message: 'SELECT * is not allowed. Use explicit column selection instead. Import column definitions from backend/db/types.ts'
      },
      {
        selector: "Literal[value=/SELECT\\s+\\*/i]",
        message: 'SELECT * is not allowed. Use explicit column selection instead. Import column definitions from backend/db/types.ts'
      }
    ],
    // Allow explicit any when needed
    '@typescript-eslint/no-explicit-any': 'warn',
    // Allow unused vars starting with _
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.config.js',
    '*.config.ts'
  ]
};
