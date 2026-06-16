/**
 * @fileoverview Обработчик раздела «Питание» MamaBot.
 *
 * Позволяет записывать приёмы пищи, выбирать тип приёма (завтрак/обед/ужин/перекус),
 * вводить список продуктов текстом, указывать количество воды.
 *
 * Данные сохраняются в коллекцию `nutrition_logs` через createNutritionLog().
 *
 * @module nutritionMenu
 */

const { t } = require('../../i18n');
const { getUser, updateUser } = require('../../collections/users');
const { sendMessage } = require('../../utils/telegram');
const { createNutritionLog, getNutritionLogsByUserAndDate } = require('../../schemas/nutritionLogs');
const { db } = require('../../firestore');

/** @type {((chatId: number|string) => Promise<Object>)|null} */
let _showMainMenu = null;
try {
  _showMainMenu = require('../menu/mainMenu').showMainMenu;
} catch (_err) {
  // mainMenu ещё не смержен
}

/** @type {typeof t} */
let _t = t;
/** @type {typeof getUser} */
let _getUser = getUser;
/** @type {typeof updateUser} */
let _updateUser = updateUser;
/** @type {typeof sendMessage} */
let _sendMessage = sendMessage;
/** @type {typeof createNutritionLog} */
let _createNutritionLog = createNutritionLog;
/** @type {typeof getNutritionLogsByUserAndDate} */
let _getNutritionLogsByUserAndDate = getNutritionLogsByUserAndDate;
/** @type {typeof db} */
let _db = db;

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const VALID_MEAL_LABELS = {
  breakfast: { en: 'Breakfast', ru: 'Завтрак' },
  lunch: { en: 'Lunch', ru: 'Обед' },
  dinner: { en: 'Dinner', ru: 'Ужин' },
  snack: { en: 'Snack', ru: 'Перекус' },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// --- Внутренние async-функции ---

async function _showNutritionMenuImpl(chatId) {
  const title = await _t(chatId, 'nutrition.title');
  const logLabel = await _t(chatId, 'nutrition.log_meal');
  const historyLabel = await _t(chatId, 'nutrition.history');
  const backLabel = await _t(chatId, 'nutrition.back_to_menu');

  await _updateUser(chatId, { nutritionState: null });

  await _sendMessage(chatId, title, {
    reply_markup: {
      inline_keyboard: [
        [{ text: logLabel, callback_data: 'nutrition_log_start' }],
        [{ text: historyLabel, callback_data: 'nutrition_history' }],
        [{ text: backLabel, callback_data: 'nutrition_back' }],
      ],
    },
  });
  return { status: 'nutrition_menu_shown' };
}

async function _showMealTypeSelectionImpl(chatId) {
  const prompt = await _t(chatId, 'nutrition.select_meal_type');
  const labels = [];
  for (const mt of VALID_MEAL_TYPES) {
    labels.push(await _t(chatId, `nutrition.${mt}`));
  }
  const backLabel = await _t(chatId, 'nutrition.back_to_menu');

  await _sendMessage(chatId, prompt, {
    reply_markup: {
      inline_keyboard: [
        VALID_MEAL_TYPES.map((mt, idx) => ({
          text: labels[idx],
          callback_data: `nutrition_log_type_${mt}`,
        })),
        [{ text: backLabel, callback_data: 'nutrition_back' }],
      ],
    },
  });
  return { status: 'meal_type_selection_shown' };
}

async function _askFoodsImpl(chatId, mealType) {
  const state = `awaiting_foods_${mealType}`;
  await _updateUser(chatId, { nutritionState: state });

  const msg = await _t(chatId, 'nutrition.ask_foods');
  await _sendMessage(chatId, msg);

  return { status: 'awaiting_foods', mealType };
}

async function _handleFoodsInputImpl(chatId, text, mealType) {
  const foods = text.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  if (foods.length === 0) {
    await _sendMessage(chatId, await _t(chatId, 'nutrition.invalid_foods'));
    return { status: 'invalid_foods' };
  }

  await _createNutritionLog({
    userId: String(chatId),
    date: todayISO(),
    mealType,
    foods,
    waterGlasses: 0,
  });

  await _updateUser(chatId, { nutritionState: null });

  const mealLabel = VALID_MEAL_LABELS[mealType];
  const lang = (await _getUser(chatId))?.language || 'ru';
  const mealName = mealLabel[lang] || mealType;

  const msg = await _t(chatId, 'nutrition.saved', {
    mealType: mealName,
    foods: foods.join(', '),
    water: 0,
  });
  await _sendMessage(chatId, msg);

  if (_showMainMenu) {
    await _showMainMenu(chatId);
  }

  return { status: 'nutrition_saved', mealType, foods };
}

async function _showHistoryImpl(chatId) {
  const endDate = todayISO();
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const startISO = d.toISOString().slice(0, 10);

  const logs = await _getNutritionLogsByUserAndDate(_db, String(chatId), startISO, endDate);

  if (logs.length === 0) {
    await _sendMessage(chatId, await _t(chatId, 'nutrition.no_data'));
  } else {
    const recent = logs.slice(0, 10);
    const lang = (await _getUser(chatId))?.language || 'ru';
    const title = await _t(chatId, 'nutrition.history_title', { count: recent.length });
    const lines = recent.map((e) => {
      const mealName = VALID_MEAL_LABELS[e.mealType]?.[lang] || e.mealType;
      return `${e.date} | ${mealName} | ${(e.foods || []).join(', ')} | Water: ${e.waterGlasses || 0}gl`;
    });
    await _sendMessage(chatId, `${title}\n\n${lines.join('\n')}`);
  }

  if (_showMainMenu) {
    await _showMainMenu(chatId);
  }
  return { status: 'history_shown', count: logs.length };
}

// --- Публичное API ---

function showNutritionMenu(chatId) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }
  return _showNutritionMenuImpl(chatId);
}

async function handleNutritionCallback(chatId, callbackData) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }

  if (callbackData === 'menu_nutrition' || callbackData === 'nutrition_menu') {
    return _showNutritionMenuImpl(chatId);
  }
  if (callbackData === 'nutrition_log_start') {
    return _showMealTypeSelectionImpl(chatId);
  }
  if (callbackData === 'nutrition_history') {
    return _showHistoryImpl(chatId);
  }
  if (callbackData === 'nutrition_back') {
    await _updateUser(chatId, { nutritionState: null });
    if (_showMainMenu) {
      await _showMainMenu(chatId);
    }
    return { status: 'nutrition_back' };
  }

  const typeMatch = callbackData.match(/^nutrition_log_type_(\w+)$/);
  if (typeMatch) {
    return _askFoodsImpl(chatId, typeMatch[1]);
  }

  return _showNutritionMenuImpl(chatId);
}

async function handleNutritionInput(chatId, text) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }

  const user = await _getUser(chatId);
  if (!user || !user.nutritionState) {
    return { status: 'no_nutrition_state' };
  }

  const match = user.nutritionState.match(/^awaiting_foods_(\w+)$/);
  if (!match) {
    await _updateUser(chatId, { nutritionState: null });
    return { status: 'unknown_nutrition_state' };
  }

  return _handleFoodsInputImpl(chatId, text, match[1]);
}

function __inject(deps) {
  if (deps.t) _t = deps.t;
  if (deps.getUser) _getUser = deps.getUser;
  if (deps.updateUser) _updateUser = deps.updateUser;
  if (deps.sendMessage) _sendMessage = deps.sendMessage;
  if (deps.createNutritionLog) _createNutritionLog = deps.createNutritionLog;
  if (deps.getNutritionLogsByUserAndDate) _getNutritionLogsByUserAndDate = deps.getNutritionLogsByUserAndDate;
  if (deps.db) _db = deps.db;
  if (deps.showMainMenu !== undefined) _showMainMenu = deps.showMainMenu;
}

module.exports = { showNutritionMenu, handleNutritionCallback, handleNutritionInput, __inject };
