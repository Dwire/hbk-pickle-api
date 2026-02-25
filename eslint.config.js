import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import unusedImports from 'eslint-plugin-unused-imports'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

const config = [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    ignores: ['src/generated/prisma/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      globals: {
        process: 'readonly',
        crypto: 'readonly'
      }
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
      '@typescript-eslint': tseslint
    },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_'
        }
      ],
      'import/order': [
        'error',
        {
          'newlines-between': 'always'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
]

export default config
