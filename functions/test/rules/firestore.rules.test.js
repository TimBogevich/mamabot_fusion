import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve firestore.rules path relative to this test file:
 * functions/test/rules/firestore.rules.test.js → firestore.rules (project root)
 */
const rulesPath = resolve(__dirname, '..', '..', '..', 'firestore.rules');

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

beforeAll(async () => {
  const rules = readFileSync(rulesPath, 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: 'mamabot-97d22',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/**
 * Seed data bypassing Firestore rules (simulates server-side writes).
 */
async function seed(collection, docId, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection(collection).doc(docId).set(data);
  });
}

// ─── Auth helpers ───────────────────────────────────────────────────────────

function aliceAuth() {
  return testEnv.authenticatedContext('111');
}

function unauth() {
  return testEnv.unauthenticatedContext();
}

// ═══════════════════════════════════════════════════════════════════════════
// Коллекция users
// ═══════════════════════════════════════════════════════════════════════════

describe('users collection', () => {

  // ── Read ───────────────────────────────────────────────────────────────
  it('authenticated Alice can read her own document users/111', async () => {
    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('users').doc('111').get(),
    );
  });

  it('authenticated Alice can write her own document users/111', async () => {
    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('users').doc('111').set({ name: 'Alice' }),
    );
  });

  it("authenticated Alice CANNOT read Bob's document users/222", async () => {
    await seed('users', '222', { name: 'Bob' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('users').doc('222').get(),
    );
  });

  it("authenticated Alice CANNOT write Bob's document users/222", async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('users').doc('222').set({ name: 'Alice' }),
    );
  });

  it('unauthenticated user CANNOT read users/111', async () => {
    await seed('users', '111', { name: 'Alice' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('users').doc('111').get(),
    );
  });

  it('unauthenticated user CANNOT write users/111', async () => {
    const guest = unauth();
    await assertFails(
      guest.firestore().collection('users').doc('111').set({ name: 'Alice' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Коллекция mood_logs
// ═══════════════════════════════════════════════════════════════════════════

describe('mood_logs collection', () => {

  // ── Read ───────────────────────────────────────────────────────────────
  it('Alice can read her own mood_log (userId == "111")', async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('mood_logs').doc('log1').get(),
    );
  });

  it('Alice can create a mood_log with her own userId', async () => {
    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('mood_logs').doc('log1').set({ userId: '111', mood: 'happy' }),
    );
  });

  it("Alice CANNOT read Bob's mood_log (userId == '222')", async () => {
    await seed('mood_logs', 'log2', { userId: '222', mood: 'sad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('mood_logs').doc('log2').get(),
    );
  });

  it("Alice CANNOT create a mood_log with Bob's userId", async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('mood_logs').doc('log-hijack').set({ userId: '222', mood: 'angry' }),
    );
  });

  it('unauthenticated user CANNOT read a mood_log', async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('mood_logs').doc('log1').get(),
    );
  });

  it('unauthenticated user CANNOT create a mood_log', async () => {
    const guest = unauth();
    await assertFails(
      guest.firestore().collection('mood_logs').doc('log1').set({ userId: '111', mood: 'happy' }),
    );
  });

  // ── Update ─────────────────────────────────────────────────────────────
  it("Alice can update her own mood_log (keeping userId '111')", async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('mood_logs').doc('log1').update({ mood: 'excited' }),
    );
  });

  it("Alice CANNOT update her mood_log to change userId to '222' (hijack prevention)", async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('mood_logs').doc('log1').update({ userId: '222', mood: 'hijacked' }),
    );
  });

  it("Alice CANNOT update Bob's mood_log", async () => {
    await seed('mood_logs', 'log2', { userId: '222', mood: 'sad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('mood_logs').doc('log2').update({ mood: 'neutral' }),
    );
  });

  // ── Delete ─────────────────────────────────────────────────────────────
  it('Alice can delete her own mood_log', async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('mood_logs').doc('log1').delete(),
    );
  });

  it("Alice CANNOT delete Bob's mood_log", async () => {
    await seed('mood_logs', 'log2', { userId: '222', mood: 'sad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('mood_logs').doc('log2').delete(),
    );
  });

  // ── Unauthenticated mutations ──────────────────────────────────────────
  it('unauthenticated user CANNOT update a mood_log', async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('mood_logs').doc('log1').update({ mood: 'sad' }),
    );
  });

  it('unauthenticated user CANNOT delete a mood_log', async () => {
    await seed('mood_logs', 'log1', { userId: '111', mood: 'happy' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('mood_logs').doc('log1').delete(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Коллекция nutrition_logs
// ═══════════════════════════════════════════════════════════════════════════

describe('nutrition_logs collection', () => {

  // ── Read ───────────────────────────────────────────────────────────────
  it('Alice can read her own nutrition_log (userId == "111")', async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('nutrition_logs').doc('meal1').get(),
    );
  });

  it('Alice can create a nutrition_log with her own userId', async () => {
    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('nutrition_logs').doc('meal1').set({ userId: '111', meal: 'oatmeal' }),
    );
  });

  it("Alice CANNOT read Bob's nutrition_log (userId == '222')", async () => {
    await seed('nutrition_logs', 'meal2', { userId: '222', meal: 'salad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('nutrition_logs').doc('meal2').get(),
    );
  });

  it("Alice CANNOT create a nutrition_log with Bob's userId", async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('nutrition_logs').doc('meal-hijack').set({ userId: '222', meal: 'pizza' }),
    );
  });

  it('unauthenticated user CANNOT read a nutrition_log', async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('nutrition_logs').doc('meal1').get(),
    );
  });

  it('unauthenticated user CANNOT create a nutrition_log', async () => {
    const guest = unauth();
    await assertFails(
      guest.firestore().collection('nutrition_logs').doc('meal1').set({ userId: '111', meal: 'oatmeal' }),
    );
  });

  // ── Update ─────────────────────────────────────────────────────────────
  it("Alice can update her own nutrition_log (keeping userId '111')", async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('nutrition_logs').doc('meal1').update({ meal: 'pancakes' }),
    );
  });

  it("Alice CANNOT update her nutrition_log to change userId to '222' (hijack prevention)", async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('nutrition_logs').doc('meal1').update({ userId: '222', meal: 'hijacked' }),
    );
  });

  it("Alice CANNOT update Bob's nutrition_log", async () => {
    await seed('nutrition_logs', 'meal2', { userId: '222', meal: 'salad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('nutrition_logs').doc('meal2').update({ meal: 'pasta' }),
    );
  });

  // ── Delete ─────────────────────────────────────────────────────────────
  it('Alice can delete her own nutrition_log', async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('nutrition_logs').doc('meal1').delete(),
    );
  });

  it("Alice CANNOT delete Bob's nutrition_log", async () => {
    await seed('nutrition_logs', 'meal2', { userId: '222', meal: 'salad' });

    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('nutrition_logs').doc('meal2').delete(),
    );
  });

  // ── Unauthenticated mutations ──────────────────────────────────────────
  it('unauthenticated user CANNOT update a nutrition_log', async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('nutrition_logs').doc('meal1').update({ meal: 'smoothie' }),
    );
  });

  it('unauthenticated user CANNOT delete a nutrition_log', async () => {
    await seed('nutrition_logs', 'meal1', { userId: '111', meal: 'oatmeal' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('nutrition_logs').doc('meal1').delete(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Коллекция pregnancy_data
// ═══════════════════════════════════════════════════════════════════════════

describe('pregnancy_data collection', () => {

  it('authenticated Alice can read pregnancy_data/1_ru', async () => {
    await seed('pregnancy_data', '1_ru', { week: 1, title: 'Неделя 1' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('pregnancy_data').doc('1_ru').get(),
    );
  });

  it('authenticated Alice CANNOT write to pregnancy_data/1_ru', async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('pregnancy_data').doc('1_ru').set({ week: 1, title: 'Неделя 1' }),
    );
  });

  it('unauthenticated user CANNOT read pregnancy_data/1_ru', async () => {
    await seed('pregnancy_data', '1_ru', { week: 1, title: 'Неделя 1' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('pregnancy_data').doc('1_ru').get(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Коллекция partners (заглушка)
// ═══════════════════════════════════════════════════════════════════════════

describe('partners collection (stub)', () => {

  it('authenticated Alice can read partners/doc', async () => {
    await seed('partners', 'pair1', { partnerId: '222' });

    const alice = aliceAuth();
    await assertSucceeds(
      alice.firestore().collection('partners').doc('pair1').get(),
    );
  });

  it('authenticated Alice CANNOT write to partners/doc', async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('partners').doc('pair1').set({ partnerId: '222' }),
    );
  });

  it('unauthenticated user CANNOT read partners/doc', async () => {
    await seed('partners', 'pair1', { partnerId: '222' });

    const guest = unauth();
    await assertFails(
      guest.firestore().collection('partners').doc('pair1').get(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Default deny
// ═══════════════════════════════════════════════════════════════════════════

describe('default deny', () => {

  it('authenticated user CANNOT read a non-existent collection unknown/xxx', async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('unknown').doc('xxx').get(),
    );
  });

  it('authenticated user CANNOT write to a non-existent collection unknown/xxx', async () => {
    const alice = aliceAuth();
    await assertFails(
      alice.firestore().collection('unknown').doc('xxx').set({ data: 'test' }),
    );
  });
});