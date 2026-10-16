import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.work/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,mjs,ts,tsx}'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-dom',
            'react-dom/*',
            '**/platform/**',
            '**/ui/**',
            '**/app/**',
            '**/runtime/**',
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'indexedDB',
        'AudioContext',
        'fetch',
      ],
    },
  },
)
