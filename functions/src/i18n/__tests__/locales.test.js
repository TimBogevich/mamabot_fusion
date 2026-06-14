/**
 * @fileoverview Vitest tests for localization JSON files.
 *
 * Validates that both ru.json and en.json:
 * - Exist and are valid JSON
 * - Export plain objects
 * - Have identical key structure
 * - Contain no empty string values
 * - ru.json values contain Cyrillic characters
 * - Required top-level categories are present
 */

import { describe, it, expect } from 'vitest';

// Using dynamic import for JSON files since Vitest 4 is ESM-only
// and JSON files are loaded via import assertion
import ru from '../ru.json' with { type: 'json' };
import en from '../en.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walks a nested object and collects all leaf-key dot-notation paths.
 *
 * @param {object} obj - The object to walk
 * @param {string} [prefix=""] - Accumulated key prefix for recursion
 * @returns {string[]} Array of dot-notation paths, e.g. ["onboarding.welcome", "nutrition.meal_types.breakfast"]
 */
function collectLeafPaths(obj, prefix = '') {
  const paths = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value, fullPath));
    } else {
      paths.push(fullPath);
    }
  }

  return paths;
}

/**
 * Recursively checks if an object's leaf values are all non-empty strings.
 *
 * @param {object} obj - The object to validate
 * @param {string} [prefix=""] - Accumulated key prefix for recursion
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateNoEmptyStrings(obj, prefix = '') {
  const errors = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sub = validateNoEmptyStrings(value, fullPath);
      errors.push(...sub.errors);
    } else if (typeof value !== 'string') {
      errors.push(`${fullPath} is not a string (got ${typeof value})`);
    } else if (value.trim() === '') {
      errors.push(`${fullPath} is an empty string`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolves a dot-notation path to the actual value in an object.
 *
 * @param {object} obj - The object to traverse
 * @param {string} path - Dot-notation path, e.g. "onboarding.welcome"
 * @returns {*} The value at the given path
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((current, part) => current[part], obj);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Localization files', () => {
  // -----------------------------------------------------------------------
  // Existence & validity
  // -----------------------------------------------------------------------

  it('ru.json should exist and be valid JSON', () => {
    expect(ru).toBeDefined();
    expect(typeof ru).toBe('object');
    expect(Array.isArray(ru)).toBe(false);
  });

  it('en.json should exist and be valid JSON', () => {
    expect(en).toBeDefined();
    expect(typeof en).toBe('object');
    expect(Array.isArray(en)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Object type check
  // -----------------------------------------------------------------------

  it('both files should export plain objects (not arrays, not primitives)', () => {
    expect(typeof ru).toBe('object');
    expect(typeof en).toBe('object');
    expect(Array.isArray(ru)).toBe(false);
    expect(Array.isArray(en)).toBe(false);
    expect(ru).not.toBeNull();
    expect(en).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Required top-level categories
  // -----------------------------------------------------------------------

  it('ru.json should have required top-level categories', () => {
    expect(ru).toHaveProperty('onboarding');
    expect(ru).toHaveProperty('menu');
    expect(ru).toHaveProperty('common');
  });

  it('en.json should have required top-level categories', () => {
    expect(en).toHaveProperty('onboarding');
    expect(en).toHaveProperty('menu');
    expect(en).toHaveProperty('common');
  });

  // -----------------------------------------------------------------------
  // Top-level key parity
  // -----------------------------------------------------------------------

  it('should have identical top-level keys in both files', () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();

    expect(enKeys).toEqual(ruKeys);
  });

  // -----------------------------------------------------------------------
  // Full leaf-key parity (recursive)
  // -----------------------------------------------------------------------

  it('should have identical leaf-key paths in both files', () => {
    const ruPaths = collectLeafPaths(ru).sort();
    const enPaths = collectLeafPaths(en).sort();

    expect(enPaths).toEqual(ruPaths);
  });

  // -----------------------------------------------------------------------
  // No empty string values
  // -----------------------------------------------------------------------

  it('ru.json should have no empty string values', () => {
    const result = validateNoEmptyStrings(ru);
    if (!result.valid) {
      console.error('Empty/non-string values found in ru.json:', result.errors);
    }
    expect(result.valid).toBe(true);
  });

  it('en.json should have no empty string values', () => {
    const result = validateNoEmptyStrings(en);
    if (!result.valid) {
      console.error('Empty/non-string values found in en.json:', result.errors);
    }
    expect(result.valid).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Cyrillic check for Russian file
  // -----------------------------------------------------------------------

  it('ru.json values should contain Cyrillic characters', () => {
    const ruPaths = collectLeafPaths(ru);
    const allValues = ruPaths.map((p) => resolvePath(ru, p));

    const cyrillicCount = allValues.filter((v) => /[\u0400-\u04FF]/.test(v)).length;
    expect(cyrillicCount).toBeGreaterThan(allValues.length / 2);
  });
});