/**
 * @fileoverview Integration scenarios — end-to-end handler tests with Firestore emulator.
 *
 * Tests full business flows with real Firestore (emulator) and mocked Telegram API.
 * Global fetch is mocked to prevent real HTTP calls.
 *
 * Run: FIRESTORE_EMULATOR_HOST=localhost:8080 node --test functions/test/integration/scenarios.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const { db } = require('../../src/firestore');

globalThis.fetch = async (url) => {
  if (typeof url === 'string' && url.includes('api.telegram.org')) {
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  return { ok: false, json: async () => ({ ok: false }) };
};

const USERS = [];
let _n = 0;
function nextChatId() { _n++; const id = 5000000000 + _n; USERS.push(String(id)); return id; }

after(async () => {
  for (const uid of USERS) {
    for (const col of ['users', 'settings', 'intro_flags']) {
      try { const d = await db.collection(col).doc(uid).get(); if (d.exists) await d.ref.delete(); } catch (_) {}
    }
    for (const col of ['mood_logs', 'nutrition_logs']) {
      try {
        const snap = await db.collection(col).where('userId', '==', uid).get();
        if (snap.size > 0) { const b = db.batch(); snap.forEach(d => b.delete(d.ref)); await b.commit(); }
      } catch (_) {}
    }
  }
  for (const uid of USERS) {
    try {
      const snap = await db.collection('partners').where('momChatId', '==', uid).get();
      if (snap.size > 0) { const b = db.batch(); snap.forEach(d => b.delete(d.ref)); await b.commit(); }
    } catch (_) {}
  }
});

describe('Integration: Onboarding', () => {
  it('language → LMP → EDD confirmation', async () => {
    const chatId = nextChatId();
    const uid = String(chatId);

    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    const langRes = await handleLanguageChoice(chatId, 'lang_ru', { userId: uid, firstName: 'Test', lastName: 'User', username: 't' });
    assert.strictEqual(langRes.status, 'language_set');

    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    const lmpRes = await handleLmpInput(chatId, '15.03.2026');
    assert.strictEqual(lmpRes.success, true);
    assert.ok(lmpRes.week >= 1 && lmpRes.week <= 42);
    assert.ok(lmpRes.edc);
    assert.strictEqual(lmpRes.lmpDate, '2026-03-15');

    const { handleConfirmEdd } = require('../../src/handlers/onboarding/confirmEdd');
    const confirmRes = await handleConfirmEdd(chatId);
    assert.strictEqual(confirmRes.status, 'edd_confirmed');

    const doc = await db.collection('users').doc(uid).get();
    assert.ok(doc.exists);
    assert.strictEqual(doc.data().language, 'ru');
    assert.strictEqual(doc.data().lmpDate, '2026-03-15');
    assert.ok(doc.data().eddDate);
  });
});

describe('Integration: Week info', () => {
  it('shows current week and navigates', async () => {
    const chatId = nextChatId();
    const uid = String(chatId);

    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    await handleLanguageChoice(chatId, 'lang_ru', { userId: uid, firstName: 'Test', lastName: 'User', username: 't' });
    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    await handleLmpInput(chatId, '01.01.2026');
    const { handleConfirmEdd } = require('../../src/handlers/onboarding/confirmEdd');
    await handleConfirmEdd(chatId);

    const { handleWeekCallback } = require('../../src/handlers/week/weekMenu');
    const cur = await handleWeekCallback(chatId, 'menu_my_week');
    assert.strictEqual(cur.status, 'week_shown');
    assert.ok(cur.week >= 1);

    const nxt = await handleWeekCallback(chatId, 'week_next');
    assert.strictEqual(nxt.week, cur.week + 1);

    const prv = await handleWeekCallback(chatId, 'week_prev');
    assert.strictEqual(prv.week, cur.week);
  });
});

describe('Integration: Mood logging', () => {
  it('2-step mood logging saves to Firestore', async () => {
    const chatId = nextChatId();
    const uid = String(chatId);

    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    await handleLanguageChoice(chatId, 'lang_ru', { userId: uid, firstName: 'Test', lastName: 'User', username: 't' });
    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    await handleLmpInput(chatId, '01.01.2026');

    const { handleMoodCallback } = require('../../src/handlers/mood/moodMenu');
    const saved = await handleMoodCallback(chatId, 'mood_log_energy_4_5');
    assert.strictEqual(saved.status, 'mood_saved');

    const logs = await db.collection('mood_logs').where('userId', '==', uid).limit(5).get();
    assert.ok(logs.size >= 1);
    assert.strictEqual(logs.docs[0].data().mood, 4);
    assert.strictEqual(logs.docs[0].data().energy, 5);
  });
});

describe('Integration: Nutrition logging', () => {
  it('meal logging saves to Firestore', async () => {
    const chatId = nextChatId();
    const uid = String(chatId);

    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    await handleLanguageChoice(chatId, 'lang_ru', { userId: uid, firstName: 'Test', lastName: 'User', username: 't' });
    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    await handleLmpInput(chatId, '01.01.2026');

    const { handleNutritionCallback, handleNutritionInput } = require('../../src/handlers/nutrition/nutritionMenu');
    await handleNutritionCallback(chatId, 'menu_nutrition');
    await handleNutritionCallback(chatId, 'nutrition_log_type_lunch');

    const result = await handleNutritionInput(chatId, 'суп, котлета, компот');
    assert.strictEqual(result.status, 'nutrition_saved');

    const logs = await db.collection('nutrition_logs').where('userId', '==', uid).limit(5).get();
    assert.ok(logs.size >= 1);
    assert.strictEqual(logs.docs[0].data().mealType, 'lunch');
    assert.deepStrictEqual(logs.docs[0].data().foods, ['суп', 'котлета', 'компот']);
  });
});

describe('Integration: Partner linking', () => {
  it('create code → partner links → verified in Firestore', async () => {
    const momId = nextChatId();
    const partnerId = nextChatId();
    const momUid = String(momId);
    const partnerUid = String(partnerId);

    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    await handleLanguageChoice(momId, 'lang_ru', { userId: momUid, firstName: 'Mom', lastName: '', username: '' });
    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    await handleLmpInput(momId, '01.01.2026');
    await handleLanguageChoice(partnerId, 'lang_ru', { userId: partnerUid, firstName: 'Partner', lastName: '', username: '' });

    const { handlePartnerCallback, handlePartnerInput } = require('../../src/handlers/partner/partnerMenu');

    const createRes = await handlePartnerCallback(momId, 'partner_create_code');
    assert.strictEqual(createRes.status, 'code_created');
    const code = createRes.code;

    await handlePartnerCallback(partnerId, 'partner_enter_code');
    const linkRes = await handlePartnerInput(partnerId, code);
    assert.strictEqual(linkRes.status, 'linked');

    const doc = await db.collection('partners').doc(code).get();
    assert.ok(doc.exists);
    assert.strictEqual(doc.data().momChatId, momUid);
    assert.strictEqual(doc.data().partnerChatId, partnerUid);
  });
});

describe('Integration: Main Menu', () => {
  it('renders without errors', async () => {
    const chatId = nextChatId();
    const { handleLanguageChoice } = require('../../src/handlers/onboarding/languageDialog');
    await handleLanguageChoice(chatId, 'lang_ru', { userId: String(chatId), firstName: 'Test', lastName: '', username: '' });
    const { handleLmpInput } = require('../../src/handlers/onboarding/lmpDialog');
    await handleLmpInput(chatId, '01.01.2026');
    const { showMainMenu } = require('../../src/handlers/menu/mainMenu');
    const result = await showMainMenu(chatId);
    assert.ok(result.ok);
  });
});