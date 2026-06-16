/**
 * @fileoverview Обработчик раздела «Пригласить партнёра» MamaBot.
 *
 * Генерирует 6-символьный код-приглашение для партнёра, принимает код
 * от партнёра для привязки, показывает статус партнёрства.
 *
 * Данные хранятся в коллекции `partners`, привязка через `linkPartner()`.
 *
 * @module partnerMenu
 */

const { t } = require('../../i18n');
const { getUser, updateUser } = require('../../collections/users');
const { sendMessage } = require('../../utils/telegram');
const { createPartner, getPartner, linkPartner, getPartnershipByMom } = require('../../collections/partners');

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
/** @type {typeof createPartner} */
let _createPartner = createPartner;
/** @type {typeof getPartner} */
let _getPartner = getPartner;
/** @type {typeof linkPartner} */
let _linkPartner = linkPartner;
/** @type {typeof getPartnershipByMom} */
let _getPartnershipByMom = getPartnershipByMom;

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// --- Внутренние async-функции ---

async function _showPartnerMenuImpl(chatId) {
  const title = await _t(chatId, 'partner.title');
  const inviteLabel = await _t(chatId, 'partner.create_code');
  const enterLabel = await _t(chatId, 'partner.enter_code');
  const statusLabel = await _t(chatId, 'partner.status_btn');
  const backLabel = await _t(chatId, 'partner.back_to_menu');

  await _sendMessage(chatId, title, {
    reply_markup: {
      inline_keyboard: [
        [{ text: inviteLabel, callback_data: 'partner_create_code' }],
        [{ text: enterLabel, callback_data: 'partner_enter_code' }],
        [{ text: statusLabel, callback_data: 'partner_status' }],
        [{ text: backLabel, callback_data: 'partner_back' }],
      ],
    },
  });
  return { status: 'partner_menu_shown' };
}

async function _generateCodeImpl(chatId) {
  const user = await _getUser(chatId);
  if (!user) {
    await _sendMessage(chatId, 'Error: user not found.');
    return { status: 'user_not_found' };
  }

  const existing = await _getPartnershipByMom(String(chatId));
  if (existing) {
    const code = existing.partnerCode || existing.id;
    const status = existing.status === 'active'
      ? await _t(chatId, 'partner.status_active')
      : await _t(chatId, 'partner.status_pending', { code });
    await _sendMessage(chatId, status);
    if (_showMainMenu) await _showMainMenu(chatId);
    return { status: 'already_exists' };
  }

  let code;
  for (let attempt = 0; attempt < 10; attempt++) {
    code = generateCode();
    const existingPartner = await _getPartner(code);
    if (!existingPartner) break;
  }

  await _createPartner(code, { momChatId: String(chatId) });
  await _updateUser(chatId, { partnerCode: code });

  const msg = await _t(chatId, 'partner.code_created', { code });
  await _sendMessage(chatId, msg);

  if (_showMainMenu) await _showMainMenu(chatId);
  return { status: 'code_created', code };
}

async function _askPartnerCodeImpl(chatId) {
  await _updateUser(chatId, { partnerState: 'awaiting_partner_code' });
  const msg = await _t(chatId, 'partner.ask_code');
  await _sendMessage(chatId, msg);
  return { status: 'awaiting_partner_code' };
}

async function _enterCodeImpl(chatId, code) {
  await _updateUser(chatId, { partnerState: null });
  const normalized = code.trim().toUpperCase();

  if (normalized.length !== 6 || !/^[A-Z0-9]{6}$/.test(normalized)) {
    await _sendMessage(chatId, await _t(chatId, 'partner.invalid_code'));
    if (_showMainMenu) await _showMainMenu(chatId);
    return { status: 'invalid_code' };
  }

  const partnership = await _getPartner(normalized);
  if (!partnership) {
    await _sendMessage(chatId, await _t(chatId, 'partner.not_found'));
    if (_showMainMenu) await _showMainMenu(chatId);
    return { status: 'not_found' };
  }

  if (partnership.momChatId === String(chatId)) {
    await _sendMessage(chatId, await _t(chatId, 'partner.cant_join_own'));
    if (_showMainMenu) await _showMainMenu(chatId);
    return { status: 'own_code' };
  }

  try {
    await _linkPartner(normalized, String(chatId));
    await _updateUser(chatId, { role: 'partner', partnerCode: normalized });
    await _sendMessage(chatId, await _t(chatId, 'partner.linked'));
  } catch (err) {
    await _sendMessage(chatId, await _t(chatId, 'partner.link_error'));
    console.error('[partner] linkPartner error:', err.message);
  }

  if (_showMainMenu) await _showMainMenu(chatId);
  return { status: 'linked' };
}

async function _showStatusImpl(chatId) {
  const partnership = await _getPartnershipByMom(String(chatId));
  if (!partnership) {
    const user = await _getUser(chatId);
    if (user && user.partnerCode) {
      const p = await _getPartner(user.partnerCode);
      if (p) {
        const status = p.status === 'active'
          ? await _t(chatId, 'partner.status_active')
          : await _t(chatId, 'partner.status_pending', { code: p.partnerCode || p.id });
        await _sendMessage(chatId, status);
      } else {
        await _sendMessage(chatId, await _t(chatId, 'partner.no_partner'));
      }
    } else {
      await _sendMessage(chatId, await _t(chatId, 'partner.no_partner'));
    }
  } else {
    const status = partnership.status === 'active'
      ? await _t(chatId, 'partner.status_active')
      : await _t(chatId, 'partner.status_pending', { code: partnership.partnerCode || partnership.id });
    await _sendMessage(chatId, status);
  }

  if (_showMainMenu) await _showMainMenu(chatId);
  return { status: 'status_shown' };
}

// --- Публичное API ---

function showPartnerMenu(chatId) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }
  return _showPartnerMenuImpl(chatId);
}

async function handlePartnerCallback(chatId, callbackData) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }

  if (callbackData === 'menu_invite_partner') {
    return _showPartnerMenuImpl(chatId);
  }
  if (callbackData === 'partner_create_code') {
    return _generateCodeImpl(chatId);
  }
  if (callbackData === 'partner_enter_code') {
    return _askPartnerCodeImpl(chatId);
  }
  if (callbackData === 'partner_status') {
    return _showStatusImpl(chatId);
  }
  if (callbackData === 'partner_back') {
    await _updateUser(chatId, { partnerState: null });
    if (_showMainMenu) await _showMainMenu(chatId);
    return { status: 'partner_back' };
  }

  return _showPartnerMenuImpl(chatId);
}

async function handlePartnerInput(chatId, text) {
  if (chatId === null || chatId === undefined) {
    throw new Error('chatId is required');
  }

  const user = await _getUser(chatId);
  if (!user || user.partnerState !== 'awaiting_partner_code') {
    return { status: 'no_partner_state' };
  }

  return _enterCodeImpl(chatId, text);
}

function __inject(deps) {
  if (deps.t) _t = deps.t;
  if (deps.getUser) _getUser = deps.getUser;
  if (deps.updateUser) _updateUser = deps.updateUser;
  if (deps.sendMessage) _sendMessage = deps.sendMessage;
  if (deps.createPartner) _createPartner = deps.createPartner;
  if (deps.getPartner) _getPartner = deps.getPartner;
  if (deps.linkPartner) _linkPartner = deps.linkPartner;
  if (deps.getPartnershipByMom) _getPartnershipByMom = deps.getPartnershipByMom;
  if (deps.showMainMenu !== undefined) _showMainMenu = deps.showMainMenu;
}

module.exports = { showPartnerMenu, handlePartnerCallback, handlePartnerInput, __inject };
