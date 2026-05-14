module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['error'] }],
  },
  overrides: [
    {
      // Test files use `any` extensively for mocks and console for trace
      // output; both are deliberate. Errors still block.
      files: ['src/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        // Mocks intentionally use `Function` to stand in for arbitrary callbacks.
        '@typescript-eslint/ban-types': 'off',
        'no-empty': 'off',
      },
    },
    {
      // Build/dev scripts log to stdout deliberately.
      files: ['scripts/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      // Mock modules under __mocks__/ mirror real surfaces and ape their
      // `any` usage on purpose.
      files: ['**/__mocks__/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
