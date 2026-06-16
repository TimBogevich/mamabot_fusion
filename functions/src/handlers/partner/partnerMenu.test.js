/**
 * @fileoverview Unit-тесты обработчика раздела «Пригласить партнёра».
 *
 * Все зависимости мокируются через __inject. Firestore-запросы не выполняются.
 */

const mockT = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockSendMessage = vi.fn();
const mockCreatePartner = vi.fn();
const mockGetPartner = vi.fn();
const mockLinkPartner = vi.fn();
const mockGetPartnershipByMom = vi.fn();
const mockShowMainMenu = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockT.mockImplementation((_chatId, key) => Promise.resolve(key));
  mockGetUser.mockResolvedValue({ language: 'ru' });
  mockUpdateUser.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue({ ok: true });
  mockShowMainMenu.mockResolvedValue({ message_id: 42 });

  const { __inject } = require('./partnerMenu');
  __inject({
    t: mockT,
    getUser: mockGetUser,
    updateUser: mockUpdateUser,
    sendMessage: mockSendMessage,
    createPartner: mockCreatePartner,
    getPartner: mockGetPartner,
    linkPartner: mockLinkPartner,
    getPartnershipByMom: mockGetPartnershipByMom,
    showMainMenu: mockShowMainMenu,
  });
});

const CHAT_ID = 12345;

describe('showPartnerMenu', () => {
  it('выбрасывает Error при chatId = null', () => {
    expect(() => showPartnerMenu(null)).toThrow('chatId is required');
  });

  it('выбрасывает Error при chatId = undefined', () => {
    expect(() => showPartnerMenu(undefined)).toThrow('chatId is required');
  });

  it('отправляет меню с inline_keyboard из 4 кнопок', async () => {
    const { showPartnerMenu } = require('./partnerMenu');

    await showPartnerMenu(CHAT_ID);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const keyboard = mockSendMessage.mock.calls[0][2].reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(4);
    expect(keyboard[0][0].callback_data).toBe('partner_create_code');
    expect(keyboard[1][0].callback_data).toBe('partner_enter_code');
    expect(keyboard[2][0].callback_data).toBe('partner_status');
    expect(keyboard[3][0].callback_data).toBe('partner_back');
  });

  it('возвращает { status: "partner_menu_shown" }', async () => {
    const { showPartnerMenu } = require('./partnerMenu');

    const result = await showPartnerMenu(CHAT_ID);
    expect(result).toEqual({ status: 'partner_menu_shown' });
  });
});

describe('handlePartnerCallback', () => {
  it('menu_invite_partner вызывает showPartnerMenu', async () => {
    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'menu_invite_partner');

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'partner_menu_shown' });
  });

  it('partner_create_code создаёт код приглашения', async () => {
    mockGetPartnershipByMom.mockResolvedValue(null);
    mockGetPartner.mockResolvedValue(null);
    mockCreatePartner.mockResolvedValue(undefined);

    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_create_code');

    expect(mockGetPartnershipByMom).toHaveBeenCalledWith(String(CHAT_ID));
    expect(mockCreatePartner).toHaveBeenCalled();
    expect(mockUpdateUser).toHaveBeenCalledWith(CHAT_ID, expect.objectContaining({ partnerCode: expect.any(String) }));
    expect(result.status).toBe('code_created');
    expect(result.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('partner_create_code при существующем партнёрстве', async () => {
    mockGetPartnershipByMom.mockResolvedValue({ id: 'ABC123', status: 'pending' });

    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_create_code');

    expect(result).toEqual({ status: 'already_exists' });
    expect(mockShowMainMenu).toHaveBeenCalled();
  });

  it('partner_enter_code устанавливает partnerState', async () => {
    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_enter_code');

    expect(mockUpdateUser).toHaveBeenCalledWith(CHAT_ID, { partnerState: 'awaiting_partner_code' });
    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.ask_code');
    expect(result).toEqual({ status: 'awaiting_partner_code' });
  });

  it('partner_status показывает статус', async () => {
    mockGetPartnershipByMom.mockResolvedValue({ id: 'ABC123', status: 'active' });

    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_status');

    expect(mockGetPartnershipByMom).toHaveBeenCalledWith(String(CHAT_ID));
    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.status_active');
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'status_shown' });
  });

  it('partner_status когда нет партнёра', async () => {
    mockGetPartnershipByMom.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ language: 'ru' });

    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_status');

    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.no_partner');
    expect(result).toEqual({ status: 'status_shown' });
  });

  it('partner_back очищает partnerState и возвращает в меню', async () => {
    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_back');

    expect(mockUpdateUser).toHaveBeenCalledWith(CHAT_ID, { partnerState: null });
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'partner_back' });
  });

  it('неизвестный callback_data показывает меню', async () => {
    const { handlePartnerCallback } = require('./partnerMenu');

    const result = await handlePartnerCallback(CHAT_ID, 'partner_unknown');

    expect(mockSendMessage).toHaveBeenCalled();
    expect(result).toEqual({ status: 'partner_menu_shown' });
  });
});

describe('handlePartnerInput', () => {
  it('возвращает no_partner_state если пользователь не в режиме ввода кода', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru' });

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'ABC123');

    expect(result).toEqual({ status: 'no_partner_state' });
  });

  it('возвращает no_partner_state если пользователь не найден', async () => {
    mockGetUser.mockResolvedValue(null);

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'ABC123');

    expect(result).toEqual({ status: 'no_partner_state' });
  });

  it('принимает код через partnerState', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', partnerState: 'awaiting_partner_code' });
    mockGetPartner.mockResolvedValue({ momChatId: '99999', id: 'XYZ789' });
    mockLinkPartner.mockResolvedValue(undefined);

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'xyz789');

    expect(mockUpdateUser).toHaveBeenCalledWith(CHAT_ID, { partnerState: null });
    expect(mockLinkPartner).toHaveBeenCalledWith('XYZ789', String(CHAT_ID));
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'linked' });
  });

  it('отклоняет короткий код', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', partnerState: 'awaiting_partner_code' });

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'AB');

    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.invalid_code');
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'invalid_code' });
  });

  it('отклоняет несуществующий код', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', partnerState: 'awaiting_partner_code' });
    mockGetPartner.mockResolvedValue(null);

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'ABC123');

    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.not_found');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('не позволяет присоединиться к своему коду', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', partnerState: 'awaiting_partner_code' });
    mockGetPartner.mockResolvedValue({ momChatId: String(CHAT_ID) });

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'ABC123');

    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.cant_join_own');
    expect(result).toEqual({ status: 'own_code' });
  });

  it('обрабатывает ошибку linkPartner', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', partnerState: 'awaiting_partner_code' });
    mockGetPartner.mockResolvedValue({ momChatId: '99999' });
    mockLinkPartner.mockRejectedValue(new Error('Firestore write failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { handlePartnerInput } = require('./partnerMenu');

    const result = await handlePartnerInput(CHAT_ID, 'ABC123');

    expect(mockT).toHaveBeenCalledWith(CHAT_ID, 'partner.link_error');
    expect(result).toEqual({ status: 'linked' });
    errorSpy.mockRestore();
  });
});

const { showPartnerMenu, handlePartnerCallback, handlePartnerInput } = require('./partnerMenu');
