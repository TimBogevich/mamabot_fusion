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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Paths of modules we need to mock (relative to this test file)
// ---------------------------------------------------------------------------

const FIRESTORE_PATH = req.resolve("../../../firestore.js");
const PREGNANCY_WEEK_PATH = req.resolve("../../../utils/pregnancyWeek.js");
const SEND_WEEKLY_PATH = req.resolve("../sendWeekly.js");

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
  return {
    forEach(callback) {
      users.forEach((userData) => {
        callback({ data: () => userData });
      });
    },
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

describe("sendWeeklyNotifications", () => {
  beforeEach(() => {
    cleanCache();
  });

  afterEach(() => {
    cleanCache();
  });

  it("exports a function", () => {
    // Arrange — minimal mocks (db never called)
    const mockDb = vi.fn();
    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: vi.fn(),
    });

    // Act
    const mod = req("../sendWeekly.js");

    // Assert
    expect(typeof mod.sendWeeklyNotifications).toBe("function");
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

    const { sendWeeklyNotifications } = req("../sendWeekly.js");

    // Act
    await sendWeeklyNotifications();

    // Assert
    expect(mockCollection).toHaveBeenCalledWith("users");
    expect(mockWhere).toHaveBeenCalledWith("lmpDate", "!=", null);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("returns correct counts with mixed data", async () => {
    // Arrange
    const users = [
      { lmpDate: "2026-06-01" },   // valid week=2
      { lmpDate: "2025-01-01" },   // outOfRange=true (too old)
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {
      if (lmpDate === "2026-06-01") return { week: 2, outOfRange: false };
      if (lmpDate === "2025-01-01") return { week: 76, outOfRange: true };
      return { week: 0, outOfRange: true };
    });

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const { sendWeeklyNotifications } = req("../sendWeekly.js");

    // Act
    const result = await sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 2, notified: 1 });
  });

  it("returns zero counts when no users have lmpDate", async () => {
    // Arrange
    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot([]));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: vi.fn(),
    });

    const { sendWeeklyNotifications } = req("../sendWeekly.js");

    // Act
    const result = await sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it("handles all valid weeks correctly", async () => {
    // Arrange
    const users = [
      { lmpDate: "2026-06-08" },  // week 1
      { lmpDate: "2026-01-21" },  // week 20
      { lmpDate: "2025-09-03" },  // week 40
    ];

    const mockGet = vi.fn().mockResolvedValue(createQuerySnapshot(users));
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { collection: mockCollection };

    const mockCalc = vi.fn((lmpDate) => {
      if (lmpDate === "2026-06-08") return { week: 1, outOfRange: false };
      if (lmpDate === "2026-01-21") return { week: 20, outOfRange: false };
      if (lmpDate === "2025-09-03") return { week: 40, outOfRange: false };
      return { week: 0, outOfRange: true };
    });

    injectMocks({
      firestoreMock: { db: mockDb },
      pregnancyWeekMock: mockCalc,
    });

    const { sendWeeklyNotifications } = req("../sendWeekly.js");

    // Act
    const result = await sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 3, notified: 3 });
  });

  it("returns zero notified when all users are outOfRange", async () => {
    // Arrange
    const users = [
      { lmpDate: "2024-01-01" },  // outOfRange
      { lmpDate: "2023-06-15" },  // outOfRange
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

    const { sendWeeklyNotifications } = req("../sendWeekly.js");

    // Act
    const result = await sendWeeklyNotifications();

    // Assert
    expect(result).toEqual({ checked: 2, notified: 0 });
  });
});