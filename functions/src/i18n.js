/**
 * @fileoverview Internationalization (i18n) module for MamaBot.
 *
 * Provides two functions:
 *   - t(userId, key, vars?) – resolves a dot-notation key to a localized string
 *   - setLanguage(userId, lang) – persists the user's language preference to Firestore
 *
 * Locale JSON files are loaded synchronously at module scope via require(),
 * which means they are cached by Node.js for the lifetime of the process.
 *
 * Usage:
 *   const { t, setLanguage } = require('./i18n');
 *   const msg = await t(chatId, 'menu.week_info');
 *   const msg2 = await t(chatId, 'onboarding.welcome', { name: 'Анна' });
 *   await setLanguage(chatId, 'en');
 *
 * @module i18n
 */

const usersModule = require('./collections/users');

// ---------------------------------------------------------------------------
// Load locale files (synchronous, cached by Node.js require())
// ---------------------------------------------------------------------------

/** @type {Record<string, any>} */
const ru = require('./locales/ru.json');

/** @type {Record<string, any>} */
const en = require('./locales/en.json');

/** Map of language code → locale object */
const LOCALES = { ru, en };

// ---------------------------------------------------------------------------
// Internal dependency references (mutable for testability)
// ---------------------------------------------------------------------------

/** @type {typeof usersModule.getUser} */
let _getUser = usersModule.getUser.bind(usersModule);
/** @type {typeof usersModule.updateUser} */
let _updateUser = usersModule.updateUser.bind(usersModule);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a dot-notation path against a nested object.
 *
 * @param {Record<string, any>} obj - The object to traverse
 * @param {string} path - Dot-notation path, e.g. "onboarding.welcome"
 * @returns {*} The value at the given path, or undefined if not found
 */
function resolvePath(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Applies {{variable}} interpolation to a string.
 *
 * Replaces all occurrences of {{varname}} with the corresponding value from
 * `vars`. Leaves unmatched placeholders intact (no crash).
 *
 * @param {string} str - The template string
 * @param {Record<string, string|number>} vars - Variable substitutions
 * @returns {string} The interpolated string
 */
function interpolate(str, vars) {
  if (typeof str !== 'string') {
    return String(str);
  }

  const entries = Object.entries(vars);
  if (entries.length === 0) {
    return str;
  }

  let result = str;
  for (const [key, value] of entries) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  return result;
}

/**
 * Validates that a language code is supported.
 *
 * @param {string} lang - Language code to validate
 * @returns {boolean} True if the language is supported
 */
function isValidLanguage(lang) {
  return lang === 'ru' || lang === 'en';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a dot-notation locale key to a localized string for the user.
 *
 * Lookup order:
 *   1. User's preferred language (from Firestore `users/{userId}`)
 *   2. Russian (`ru`) if user has no language preference
 *   3. The raw `key` string if the key is missing from both locale files
 *
 * @param {number|string} userId - Telegram chat ID (used as Firestore document ID)
 * @param {string} key - Dot-notation locale key, e.g. "menu.week_info"
 * @param {Record<string, string|number>} [vars={}] - Optional substitutions for
 *        {{placeholder}} patterns in the localized string
 * @returns {Promise<string>} The resolved and interpolated string
 *
 * @example
 *   await t(chatId, 'menu.week_info');
 *   await t(chatId, 'onboarding.welcome', { name: 'Анна' });
 *   await t(chatId, 'onboarding.week_calculated', { week: 5, edc: '2026-12-01' });
 *   await t(chatId, 'nonexistent.key'); // returns 'nonexistent.key'
 */
async function t(userId, key, vars = {}) {
  // Handle invalid key types gracefully
  if (typeof key !== 'string') {
    return String(key);
  }

  // If key is empty, return it as-is
  if (key === '') {
    return '';
  }

  // Read the user's language preference
  let lang = 'ru';

  try {
    const user = await _getUser(userId);
    if (user && user.language && isValidLanguage(user.language)) {
      lang = user.language;
    }
  } catch (_err) {
    // If Firestore is unavailable, fall back to 'ru'
    lang = 'ru';
  }

  // Try the user's preferred language first
  const locale = LOCALES[lang];
  if (locale) {
    const value = resolvePath(locale, key);
    if (typeof value === 'string') {
      return interpolate(value, vars);
    }
  }

  // Fall back to Russian if the user's locale didn't have the key
  if (lang !== 'ru') {
    const ruValue = resolvePath(ru, key);
    if (typeof ruValue === 'string') {
      return interpolate(ruValue, vars);
    }
  }

  // Last resort: return the raw key
  return key;
}

/**
 * Sets the user's language preference in Firestore.
 *
 * @param {number|string} userId - Telegram chat ID
 * @param {'ru'|'en'} lang - Language code to set. Must be 'ru' or 'en'.
 * @returns {Promise<string>} The updated language code
 * @throws {Error} If `lang` is not 'ru' or 'en'
 *
 * @example
 *   await setLanguage(chatId, 'en');
 *   await setLanguage(chatId, 'ru');
 */
async function setLanguage(userId, lang) {
  if (!isValidLanguage(lang)) {
    throw new Error(
      `Invalid language code: "${lang}". Supported values are "ru" and "en".`,
    );
  }

  await _updateUser(userId, { language: lang });
  return lang;
}

/**
 * Injects mock dependencies for testing.
 *
 * Pass an object with optional `getUser` and/or `updateUser` functions
 * to override the default Firestore-backed implementations.
 *
 * @param {{ getUser?: Function, updateUser?: Function }} deps - Mock dependencies
 * @returns {void}
 *
 * @example
 *   const { t, __inject } = require('./i18n');
 *   __inject({ getUser: mockGetUser, updateUser: mockUpdateUser });
 *
 * @private
 */
function __inject(deps) {
  if (deps.getUser) _getUser = deps.getUser;
  if (deps.updateUser) _updateUser = deps.updateUser;
}

module.exports = { t, setLanguage, __inject };