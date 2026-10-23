import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'work/**',
      'publish/**',
      'release/**',
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'docs/assets-verification.json',
      'scripts/**/*.cjs',
      'scripts/**/*.mjs'
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error'
    }
  }
)
