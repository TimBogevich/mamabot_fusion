/**
 * @fileoverview Обработчик раздела «Дневник настроения» MamaBot.
 *
 * Позволяет записывать настроение (mood 1вЂ“5) и уровень энергии (energy 1вЂ“5),
 * просматривать историю записей и статистику.
 *
 * Данные сохраняются в коллекцию `mood_logs` через createMoodLog().
 *
 * @module moodMenu
 */

const { t } = require('../../i18n');
const { sendMessage } = require('../../utils/telegram');
const { createMoodLog, getMoodLogsByUserAndDate } = require('../../schemas/moodLogs');
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
/** @type {typeof sendMessage} */
let _sendMessage = sendMessage;
/** @type {typeof createMoodLog} */
let _createMoodLog = createMoodLog;
/** @type {typeof getMoodLogsByUserAndDate} */
let _getMoodLogsByUserAndDate = getMoodLogsByUserAndDate;
/** @type {typeof db} */
let _db = db;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function avg(arr, field) {
  if (arr.length === 0) return 0;
  return parseFloat((arr.reduce((s, x) => s + x[field], 0) / arr.length).toFixed(1));
}

// --- Внутренние async-функции ---

async function _showMoodMenuImpl(chatId) {
  const title = await _t(chatId, 'mood.title');
  const logLabel = await _t(chatId, 'mood.log_mood');
  const historyLabel = await _t(chatId, 'mood.history');
  const backLabel = await _t(chatId, 'mood.back_to_menu');

  await _sendMessage(chatId, title, {
    reply_markup: {
      inline_keyboard: [
        [{ text: logLabel, callback_data: 'mood_log_start' }],
        [{ text: historyLabel, callback_data: 'mood_log_history' }],
        [{ text: backLabel, callback_data: 'mood_back' }],
      ],
    },
  });
  return { status: 'mood_menu_shown' };
}

async function _showMoodSelectionImpl(chatId) {
  const prompt = await _t(chatId, 'mood.select_mood');
  const labels = [];
  for (let i = 1; i <= 5; i++) {
    labels.push(await _t(chatId, `mood.mood_${i}`));
  }
  const backLabel = await _t(chatId, 'mood.back_to_menu');

  await _sendMessage(chatId, prompt, {
    reply_markup: {
      inline_keyboard: [
        labels.map((label, idx) => ({
          text: label,
          callback_data: `mood_log_mood_${idx + 1}`,
        })),
        [{ text: backLabel, callback_data: 'mood_back' }],
      ],
    },
  });
  return { status: 'mood_selection_shown' };
}

async function _showEnergySelectionImpl(chatId, moodValue) {
  const prompt = await _t(chatId, 'mood.select_energy');
  const labels = [];
  for (let i = 1; i <= 5; i++) {
    labels.push(await _t(chatId, `mood.energy_${i}`));
  }
  const backLabel = await _t(chatId, 'mood.back_to_menu');

  await _sendMessage(chatId, prompt, {
    reply_markup: {
      inline_keyboard: [
        labels.map((label, idx) => ({
          text: label,
          callback_data: `mood_log_energy_${moodValue}_${idx + 1}`,
        })),
        [{ text: backLabel, callback_data: 'mood_back' }],
      ],
    },
  });
  return { status: 'energy_selection_shown', mood: moodValue };
}

async function _saveMoodLogImpl(chatId, moodValue, energyValue) {
  try {
    await _createMoodLog({
      userId: String(chatId),
      date: todayISO(),
      mood: moodValue,
      energy: energyValue,
    });

    const msg = await _t(chatId, 'mood.saved', { mood: moodValue, energy: energyValue });
    await _sendMessage(chatId, msg);

    if (_showMainMenu) {
      await _showMainMenu(chatId);
    }
    return { status: 'mood_saved', mood: moodValue, energy: energyValue };
  } catch (err) {
    console.error('[mood] saveMoodLog error:', err.message);
    await _sendMessage(chatId, await _t(chatId, 'mood.save_error'));
    if (_showMainMenu) {
      await _showMainMenu(chatId);
    }
    return { status: 'save_error', error: err.message };
  }
}

async function _showHistoryImpl(chatId) {
  const endDate = todayISO();
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const startISO = d.toISOString().slice(0, 10);

  const logs = await _getMoodLogsByUserAndDate(_db, String(chatId), startISO, endDate);

  if (logs.length === 0) {
    await _sendMessage(chatId, await _t(chatId, 'mood.no_data'));
  } else {
    const recent = logs.slice(0, 10);
    const title = await _t(chatId, 'mood.history_title', { count: recent.length });
    const lines = recent.map((e) =>
      `${e.date} | Mood: ${e.mood}/5 Energy: ${e.energy}/5`,
    );
    await _sendMessage(chatId, `${title}\n\n${lines.join('\n')}`);
  }

  if (_showMainMenu) {
    await _showMainMenu(chatId);
  }
  return { status: 'history_shown', count: logs.length };
}

async function _showStatsImpl(chatId) {
  const endDate = todayISO();
  const d30 = new Date();
  d30.setDate(d30.getDate() - 30);
  const start30 = d30.toISOString().slice(0, 10);
  const d7 = new Date();
  d7.setDate(d7.getDate() - 7);
  const start7 = d7.toISOString().slice(0, 10);

  const allLogs = await _getMoodLogsByUserAndDate(_db, String(chatId), start30, endDate);
  const logs7 = allLogs.filter((l) => l.date >= start7);

  if (logs7.length === 0) {
    await _sendMessage(chatId, await _t(chatId, 'mood.stats_not_enough'));
  } else {
    const msg = await _t(chatId, 'mood.stats_title', {
      avg_mood_7: avg(logs7, 'mood'),
      avg_energy_7: avg(logs7, 'energy'),
      count_7: logs7.length,
      avg_mood_30: avg(allLogs, 'mood'),
      avg_energy_30: avg(allLogs, 'energy'),
      count_30: allLogs.length,
    });
    await _sendMessage(chatId, msg);
  }

  if (_showMainMenu) {
    await _showMainMenu(chatId);
  }
  return { status: 'stats_shown', count7: logs7.length, count30: allLogs.length };
}

// --- Публичное API ---

function showMoodMenu(chatId) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }
  return _showMoodMenuImpl(chatId);
}

async function handleMoodCallback(chatId, callbackData) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }

  if (callbackData === 'menu_mood_diary' || callbackData === 'mood_menu') {
    return _showMoodMenuImpl(chatId);
  }
  if (callbackData === 'mood_log_start') {
    return _showMoodSelectionImpl(chatId);
  }
  if (callbackData === 'mood_log_history') {
    return _showHistoryImpl(chatId);
  }
  if (callbackData === 'mood_log_stats') {
    return _showStatsImpl(chatId);
  }
  if (callbackData === 'mood_back') {
    if (_showMainMenu) {
      await _showMainMenu(chatId);
    }
    return { status: 'mood_back' };
  }

  const moodMatch = callbackData.match(/^mood_log_mood_(\d)$/);
  if (moodMatch) {
    return _showEnergySelectionImpl(chatId, parseInt(moodMatch[1], 10));
  }

  const energyMatch = callbackData.match(/^mood_log_energy_(\d)_(\d)$/);
  if (energyMatch) {
    return _saveMoodLogImpl(chatId, parseInt(energyMatch[1], 10), parseInt(energyMatch[2], 10));
  }

  return _showMoodMenuImpl(chatId);
}

function __inject(deps) {
  if (deps.t) _t = deps.t;
  if (deps.sendMessage) _sendMessage = deps.sendMessage;
  if (deps.createMoodLog) _createMoodLog = deps.createMoodLog;
  if (deps.getMoodLogsByUserAndDate) _getMoodLogsByUserAndDate = deps.getMoodLogsByUserAndDate;
  if (deps.db) _db = deps.db;
  if (deps.showMainMenu !== undefined) _showMainMenu = deps.showMainMenu;
}

module.exports = { showMoodMenu, handleMoodCallback, __inject };