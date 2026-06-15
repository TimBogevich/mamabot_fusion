/**
 * Weekly notification handler.
 *
 * Queries all users with an LMP date, computes their current pregnancy week,
 * and returns counts of checked and notified users. Actual notification logic
 * (duplicate protection, message sending) is added by sibling tasks FN-021
 * and FN-022.
 *
 * @module sendWeekly
 */

const { db } = require('../../firestore');
const { calculatePregnancyWeek } = require('../../utils/pregnancyWeek');
const { updateUser } = require('../../collections/users');

// ---------------------------------------------------------------------------
// Internal dependency references (mutable for testability via __inject)
// ---------------------------------------------------------------------------

/** @type {typeof calculatePregnancyWeek} */
let _calculatePregnancyWeek = calculatePregnancyWeek;

/** @type {typeof updateUser} */
let _updateUser = updateUser;

/* eslint-disable no-unused-vars */
/** @type {(chatId: number|string, text: string) => Promise<Object>} */
let _sendMessage = null;
/* eslint-enable no-unused-vars */

/**
 * Checks all users with an LMP date and determines who should receive a
 * weekly notification.
 *

 * For each user, checks:
 * - outOfRange is false (pregnancy week is 1–42)
 * - current week > lastNotifiedWeek (duplicate protection)
 *
 * After sending a notification, updates lastNotifiedWeek in Firestore so
 * the same user is not re-notified at the same week on subsequent runs.
 *
 * @returns {Promise<{ checked: number, notified: number, skipped: number, errors: number }>}
 *   `checked` — number of users with an lmpDate
 *   `notified` — number of users actually notified
 *   `skipped` — number of users skipped (duplicate week or outOfRange)
 *   `errors` — number of users where a Firestore update failed
 */
async function sendWeeklyNotifications() {
  const snap = await db.collection('users').where('lmpDate', '!=', null).get();

  let checked = 0;
  let notified = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    const user = doc.data();
    checked++;

    const { week, outOfRange } = _calculatePregnancyWeek(user.lmpDate);

    // Skip users whose pregnancy is out of range (before week 1 or after week 42)
    if (outOfRange) {
      skipped++;
      continue;
    }

    // Duplicate-protection gate: skip if the week has not advanced
    if (week <= (user.lastNotifiedWeek || 0)) {
      console.log(`[sendWeeklyNotifications] user ${user.chatId}: week ${week} → skipped (lastNotifiedWeek=${user.lastNotifiedWeek})`);
      skipped++;
      continue;
    }

    // -------------------------------------------------------------------
    // TODO (FN-022): Fetch pregnancy data, format message, call sendMessage
    // -------------------------------------------------------------------

    // Update lastNotifiedWeek in Firestore after successful notification
    try {
      await _updateUser(user.chatId, { lastNotifiedWeek: week });
    } catch (err) {
      console.error(`[sendWeeklyNotifications] user ${user.chatId}: failed to update lastNotifiedWeek — ${err.message}`);
      errors++;
      continue;
    }

    notified++;
  }

  console.log(`[sendWeeklyNotifications] Checked ${checked} users, notified ${notified}, skipped ${skipped}, errors ${errors}`);

  return { checked, notified, skipped, errors };
}

/**
 * Injects mock dependencies for testing.
 *
 * Allows overriding internal references to calculatePregnancyWeek,
 * updateUser, and sendMessage without module-level mocking.
 *
 * @param {{ calculatePregnancyWeek?: Function, updateUser?: Function, sendMessage?: Function }} deps
 * @returns {void}
 *
 * @example
 *   const { sendWeeklyNotifications, __inject } = require('./sendWeekly');
 *   __inject({ calculatePregnancyWeek: mockCalc, updateUser: mockUpdateUser });
 *
 * @private
 */
function __inject(deps) {
  if (deps.calculatePregnancyWeek) _calculatePregnancyWeek = deps.calculatePregnancyWeek;
  if (deps.updateUser) _updateUser = deps.updateUser;
  if (deps.sendMessage) _sendMessage = deps.sendMessage;
}

module.exports = {
  sendWeeklyNotifications,
  __inject,
};

