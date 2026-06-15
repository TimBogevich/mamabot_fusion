/**
 * Tests for the sendWeekly notifications handler.
 *
 * Mocks Firestore db and calculatePregnancyWeek via require.cache injection
 * using the same pattern as src/__tests__/webhook.test.js and
 * src/__tests__/utils/telegram.test.js.
 *
 * Uses require.cache injection because vi.mock does not reliably
 * intercept CJS require() calls in this vitest environment.
 */


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';


const req = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Paths of modules we need to mock (relative to this test file)
// ---------------------------------------------------------------------------


const FIRESTORE_PATH = req.resolve('../../../firestore.js');
const PREGNANCY_WEEK_PATH = req.resolve('../../../utils/pregnancyWeek.js');
const SEND_WEEKLY_PATH = req.resolve('../sendWeekly.js');


// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a Firestore snapshot mock with an array of user documents.
 * Each user doc has a .data() method and the snapshot has forEach().
 *
 * @param {Array<Object>} users - Array of user data objects
 * @returns {{ forEach: Function }}
 */
function createQuerySnapshot(users) {

  const docs = users.map((userData) => ({ data: () => userData }));

  return {
    forEach(callback) {
      users.forEach((userData) => {
        callback({ data: () => userData });
      });
    },

    docs,

  };
}

/**
 * Inject mock modules into the require cache before sendingWeekly.js loads.
 *
 * @param {Object} options
 * @param {Object} options.firestoreMock - value for module.exports of firestore.js
 * @param {Function} options.pregnancyWeekMock - calculatePregnancyWeek function
 */
function injectMocks({ firestoreMock, pregnancyWeekMock }) {
  // Mock firestore.js
  req.cache[FIRESTORE_PATH] = {
    id: FIRESTORE_PATH,
    filename: FIRESTORE_PATH,
    loaded: true,
    exports: firestoreMock,
  };

  // Mock pregnancyWeek.js
  req.cache[PREGNANCY_WEEK_PATH] = {
    id: PREGNANCY_WEEK_PATH,
    filename: PREGNANCY_WEEK_PATH,
    loaded: true,
    exports: { calculatePregnancyWeek: pregnancyWeekMock },
  };


  // Clear the sendWeekly module cache so it reloads with fresh mocks
  delete req.cache[SEND_WEEKLY_PATH];

}

/** Remove mock entries from the require cache. */
function cleanCache() {
  delete req.cache[FIRESTORE_PATH];
  delete req.cache[PREGNANCY_WEEK_PATH];
  delete req.cache[SEND_WEEKLY_PATH];
  vi.resetModules();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------


describe('sendWeeklyNotifications', () => {

  beforeEach(() => {
    cleanCache();
  });

  afterEach(() => {
    cleanCache();
  });


  it('exports a function', () => {

    // Arrange — minimal mocks (db never called)
    const mockDb = vi.fn();
    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: vi.fn(),
    });

    // Act

    const mod = req('../sendWeekly.js');

    // Assert
    expect(typeof mod.sendWeeklyNotifications).toBe('function');
    expect(typeof mod.__inject).toBe('function');

  });

  it("queries users collection with where('lmpDate', '!=', null)", async () => {
    // Arrange
    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot([]));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: vi.fn(),
    });


    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: vi.fn().mockResolvedValue() });

    // Act
    await mod.sendWeeklyNotifications();

    // Assert
    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockWhere).toHaveBeenCalledWith('lmpDate', '!=', null);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns correct counts with mixed data', async () => {
    // Arrange
    const users = [
      { lmpDate: '2026-06-01' },   // valid week=2
      { lmpDate: '2025-01-01' },   // outOfRange=true (too old)

    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {

      if (lmpDate === '2026-06-01') return { week: 2, outOfRange: false };
      if (lmpDate === '2025-01-01') return { week: 76, outOfRange: true };

      return { week: 0, outOfRange: true };
    });

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });


    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: vi.fn().mockResolvedValue() });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 2, notified: 1, skipped: 1, errors: 0 });
  });

  it('returns zero counts when no users have lmpDate', async () => {

    // Arrange
    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot([]));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: vi.fn(),
    });


    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: vi.fn().mockResolvedValue() });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 0, notified: 0, skipped: 0, errors: 0 });
  });

  it('handles all valid weeks correctly', async () => {
    // Arrange
    const users = [
      { lmpDate: '2026-06-08' },  // week 1
      { lmpDate: '2026-01-21' },  // week 20
      { lmpDate: '2025-09-03' },  // week 40

    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {

      if (lmpDate === '2026-06-08') return { week: 1, outOfRange: false };
      if (lmpDate === '2026-01-21') return { week: 20, outOfRange: false };
      if (lmpDate === '2025-09-03') return { week: 40, outOfRange: false };

      return { week: 0, outOfRange: true };
    });

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });


    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: vi.fn().mockResolvedValue() });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 3, notified: 3, skipped: 0, errors: 0 });
  });

  it('returns zero notified when all users are outOfRange', async () => {
    // Arrange
    const users = [
      { lmpDate: '2024-01-01' },  // outOfRange
      { lmpDate: '2023-06-15' },  // outOfRange

    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 100, outOfRange: true }));

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });


    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: vi.fn().mockResolvedValue() });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 2, notified: 0, skipped: 2, errors: 0 });
  });

  // -------------------------------------------------------------------------
  // Duplicate-protection tests (FN-021)
  // -------------------------------------------------------------------------

  it('notifies user with no prior notifications (lastNotifiedWeek is undefined)', async () => {
    // Arrange — user with valid week, no lastNotifiedWeek
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: undefined },
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 14, outOfRange: false }));
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.notified).toBe(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { lastNotifiedWeek: 14 });
  });

  it('skips user at same week (lastNotifiedWeek === current week)', async () => {
    // Arrange — user already notified at week 14
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: 14 },
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 14, outOfRange: false }));
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.notified).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('notifies user at new week (week > lastNotifiedWeek)', async () => {
    // Arrange — user advanced from week 14 to week 15
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: 14 },
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 15, outOfRange: false }));
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.notified).toBe(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { lastNotifiedWeek: 15 });
  });

  it('notifies user who fell behind (week 14, lastNotifiedWeek: 13)', async () => {
    // Arrange — user at week 14, last notified at 13
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: 13 },
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 14, outOfRange: false }));
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.notified).toBe(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { lastNotifiedWeek: 14 });
  });

  it('skips user with outOfRange week regardless of lastNotifiedWeek', async () => {
    // Arrange — outOfRange user, even without prior notification
    const users = [
      { chatId: 1, lmpDate: '2024-01-01', lastNotifiedWeek: undefined },
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn(() => ({ week: 43, outOfRange: true }));
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.notified).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('handles multiple users independently in one run', async () => {
    // Arrange — 3 users with different states
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: undefined },  // A: new → notify
      { chatId: 2, lmpDate: '2026-03-01', lastNotifiedWeek: 14 },        // B: same week → skip
      { chatId: 3, lmpDate: '2026-01-01', lastNotifiedWeek: 13 },        // C: advanced → notify
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {
      // Users A and B are at week 14, user C is at week 15
      if (lmpDate === '2026-01-01') return { week: 15, outOfRange: false };
      return { week: 14, outOfRange: false };
    });
    const mockUpdateUser = vi.fn().mockResolvedValue();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    expect(result.checked).toBe(3);
    expect(result.notified).toBe(2);
    expect(result.skipped).toBe(1);
    expect(mockUpdateUser).toHaveBeenCalledTimes(2);
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { lastNotifiedWeek: 14 });
    expect(mockUpdateUser).toHaveBeenCalledWith(3, { lastNotifiedWeek: 15 });
  });

  it('updateUser failure does not crash the entire run', async () => {
    // Arrange — first user's updateUser fails, second user should still be processed
    const users = [
      { chatId: 1, lmpDate: '2026-03-01', lastNotifiedWeek: undefined },  // updateUser fails
      { chatId: 2, lmpDate: '2026-01-01', lastNotifiedWeek: 13 },          // should succeed
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {
      if (lmpDate === '2026-03-01') return { week: 14, outOfRange: false };
      if (lmpDate === '2026-01-01') return { week: 15, outOfRange: false };
      return { week: 0, outOfRange: true };
    });

    // First call (user 1) rejects, second call (user 2) resolves
    const mockUpdateUser = vi.fn()
      .mockRejectedValueOnce(new Error('Firestore write failed'))
      .mockResolvedValueOnce();

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const mod = req('../sendWeekly.js');
    mod.__inject({ updateUser: mockUpdateUser });

    // Act
    const result = await mod.sendWeeklyNotifications();

    // Assert
    // User 1: updateUser rejects → errors++, not notified
    // User 2: updateUser resolves → notified++
    expect(result.checked).toBe(2);
    expect(result.notified).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockUpdateUser).toHaveBeenCalledTimes(2);
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { lastNotifiedWeek: 14 });
    expect(mockUpdateUser).toHaveBeenCalledWith(2, { lastNotifiedWeek: 15 });

  });
});