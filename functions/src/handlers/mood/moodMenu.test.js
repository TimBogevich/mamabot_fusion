/**
 * @fileoverview Unit-тесты обработчика раздела «Дневник настроения».
 *
 * Все зависимости мокируются через __inject. Firestore-запросы не выполняются.
 */

const mockT = vi.fn();
const mockSendMessage = vi.fn();
const mockCreateMoodLog = vi.fn();
const mockGetMoodLogsByUserAndDate = vi.fn();
const mockShowMainMenu = vi.fn();
const mockDb = {};

beforeEach(() => {
  vi.resetAllMocks();
  mockT.mockImplementation((_chatId, key) => Promise.resolve(key));

  const { __inject } = require('./moodMenu');
  __inject({
    t: mockT,
    sendMessage: mockSendMessage,
    createMoodLog: mockCreateMoodLog,
    getMoodLogsByUserAndDate: mockGetMoodLogsByUserAndDate,
    db: mockDb,
    showMainMenu: mockShowMainMenu,
  });
});

const { showMoodMenu, handleMoodCallback } = require('./moodMenu');

describe('showMoodMenu', () => {
  it('отклоняет null chatId синхронно', () => {
    expect(() => showMoodMenu(null)).toThrow('chatId is required');
    expect(() => showMoodMenu(undefined)).toThrow('chatId is required');
  });

  it('показывает меню настроения с тремя кнопками', async () => {
    const result = await showMoodMenu(12345);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const msg = mockSendMessage.mock.calls[0][1];
    expect(msg).toBe('mood.title');

    const keyboard = mockSendMessage.mock.calls[0][2].reply_markup;
    expect(keyboard.inline_keyboard).toHaveLength(3);
    expect(result).toEqual({ status: 'mood_menu_shown' });
  });
});

describe('handleMoodCallback', () => {
  it('отклоняет null chatId', async () => {
    await expect(handleMoodCallback(null, 'mood_menu')).rejects.toThrow('chatId is required');
  });

  it('menu_mood_diary показывает меню', async () => {
    const result = await handleMoodCallback(12345, 'menu_mood_diary');

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'mood_menu_shown' });
  });

  it('mood_menu показывает меню', async () => {
    const result = await handleMoodCallback(12345, 'mood_menu');

    expect(result).toEqual({ status: 'mood_menu_shown' });
  });

  it('mood_log_start показывает выбор настроения (5 кнопок + назад)', async () => {
    const result = await handleMoodCallback(12345, 'mood_log_start');

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const keyboard = mockSendMessage.mock.calls[0][2].reply_markup;
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard[0]).toHaveLength(5);
    expect(result).toEqual({ status: 'mood_selection_shown' });
  });

  it('mood_log_mood_3 показывает выбор энергии', async () => {
    const result = await handleMoodCallback(12345, 'mood_log_mood_3');

    const keyboard = mockSendMessage.mock.calls[0][2].reply_markup;
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard[0]).toHaveLength(5);
    // check callback_data encodes mood=3
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('mood_log_energy_3_1');
    expect(result).toEqual({ status: 'energy_selection_shown', mood: 3 });
  });

  it('mood_log_energy_3_4 сохраняет запись', async () => {
    mockCreateMoodLog.mockResolvedValue(undefined);

    const result = await handleMoodCallback(12345, 'mood_log_energy_3_4');

    expect(mockCreateMoodLog).toHaveBeenCalledTimes(1);
    expect(mockCreateMoodLog).toHaveBeenCalledWith({
      userId: '12345',
      date: expect.any(String),
      mood: 3,
      energy: 4,
    });
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'mood_saved', mood: 3, energy: 4 });
  });

  it('mood_log_energy_3_4 при ошибке сохранения показывает ошибку', async () => {
    mockCreateMoodLog.mockRejectedValue(new Error('DB error'));

    const result = await handleMoodCallback(12345, 'mood_log_energy_3_4');

    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'mood.save_error');
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'save_error', error: 'DB error' });
  });

  it('mood_log_history показывает историю', async () => {
    mockGetMoodLogsByUserAndDate.mockResolvedValue([
      { date: '2026-06-15', mood: 4, energy: 3 },
      { date: '2026-06-14', mood: 5, energy: 4 },
    ]);

    const result = await handleMoodCallback(12345, 'mood_log_history');

    expect(mockGetMoodLogsByUserAndDate).toHaveBeenCalledTimes(1);
    const msg = mockSendMessage.mock.calls[0][1];
    expect(msg).toContain('4/5');
    expect(msg).toContain('5/5');
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'history_shown', count: 2 });
  });

  it('mood_log_history без записей показывает no_data', async () => {
    mockGetMoodLogsByUserAndDate.mockResolvedValue([]);

    const result = await handleMoodCallback(12345, 'mood_log_history');

    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'mood.no_data');
    expect(result).toEqual({ status: 'history_shown', count: 0 });
  });

  it('mood_log_stats показывает статистику', async () => {
    const logs = [];
    for (let i = 0; i < 10; i++) {
      logs.push({ date: `2026-06-${String(15 - i).padStart(2, '0')}`, mood: 3 + (i % 3), energy: 2 + (i % 4) });
    }
    mockGetMoodLogsByUserAndDate.mockResolvedValue(logs);

    const result = await handleMoodCallback(12345, 'mood_log_stats');

    expect(mockT).toHaveBeenCalledWith(12345, 'mood.stats_title', expect.any(Object));
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'stats_shown', count7: expect.any(Number), count30: 10 });
  });

  it('mood_log_stats без записей показывает stats_not_enough', async () => {
    mockGetMoodLogsByUserAndDate.mockResolvedValue([]);

    const result = await handleMoodCallback(12345, 'mood_log_stats');

    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'mood.stats_not_enough');
    expect(result.count7).toBe(0);
  });

  it('mood_back возвращает в главное меню', async () => {
    const result = await handleMoodCallback(12345, 'mood_back');

    expect(mockShowMainMenu).toHaveBeenCalledWith(12345);
    expect(result).toEqual({ status: 'mood_back' });
  });

  it('неизвестный callback показывает меню по умолчанию', async () => {
    const result = await handleMoodCallback(12345, 'mood_unknown');

    expect(result).toEqual({ status: 'mood_menu_shown' });
  });
});
