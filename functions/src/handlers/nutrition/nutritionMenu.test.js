/**
 * @fileoverview Unit-тесты обработчика раздела «Питание».
 *
 * Все зависимости мокируются через __inject. Firestore-запросы не выполняются.
 */

const mockT = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockSendMessage = vi.fn();
const mockCreateNutritionLog = vi.fn();
const mockGetNutritionLogsByUserAndDate = vi.fn();
const mockShowMainMenu = vi.fn();
const mockDb = {};

beforeEach(() => {
  vi.resetAllMocks();
  mockT.mockImplementation((_chatId, key) => Promise.resolve(key));
  mockGetUser.mockResolvedValue({ language: 'ru' });
  mockUpdateUser.mockResolvedValue(undefined);

  const { __inject } = require('./nutritionMenu');
  __inject({
    t: mockT,
    getUser: mockGetUser,
    updateUser: mockUpdateUser,
    sendMessage: mockSendMessage,
    createNutritionLog: mockCreateNutritionLog,
    getNutritionLogsByUserAndDate: mockGetNutritionLogsByUserAndDate,
    db: mockDb,
    showMainMenu: mockShowMainMenu,
  });
});

const { showNutritionMenu, handleNutritionCallback, handleNutritionInput } = require('./nutritionMenu');

describe('showNutritionMenu', () => {
  it('отклоняет null chatId', () => {
    expect(() => showNutritionMenu(null)).toThrow('chatId is required');
  });

  it('показывает меню питания', async () => {
    const result = await showNutritionMenu(12345);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(12345, { nutritionState: null });
    expect(result).toEqual({ status: 'nutrition_menu_shown' });
  });
});

describe('handleNutritionCallback', () => {
  it('menu_nutrition показывает меню', async () => {
    const result = await handleNutritionCallback(12345, 'menu_nutrition');
    expect(result).toEqual({ status: 'nutrition_menu_shown' });
  });

  it('nutrition_log_start показывает выбор типа пищи', async () => {
    const result = await handleNutritionCallback(12345, 'nutrition_log_start');

    const keyboard = mockSendMessage.mock.calls[0][2].reply_markup;
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard[0]).toHaveLength(4);
    expect(result).toEqual({ status: 'meal_type_selection_shown' });
  });

  it('nutrition_log_type_breakfast устанавливает awaiting_foods', async () => {
    const result = await handleNutritionCallback(12345, 'nutrition_log_type_breakfast');

    expect(mockUpdateUser).toHaveBeenCalledWith(12345, { nutritionState: 'awaiting_foods_breakfast' });
    expect(result).toEqual({ status: 'awaiting_foods', mealType: 'breakfast' });
  });

  it('nutrition_back возвращает в меню', async () => {
    const result = await handleNutritionCallback(12345, 'nutrition_back');

    expect(mockUpdateUser).toHaveBeenCalledWith(12345, { nutritionState: null });
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'nutrition_back' });
  });

  it('nutrition_history без записей', async () => {
    mockGetNutritionLogsByUserAndDate.mockResolvedValue([]);

    const result = await handleNutritionCallback(12345, 'nutrition_history');

    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'nutrition.no_data');
    expect(result).toEqual({ status: 'history_shown', count: 0 });
  });

  it('nutrition_history с записями', async () => {
    mockGetNutritionLogsByUserAndDate.mockResolvedValue([
      { date: '2026-06-15', mealType: 'breakfast', foods: ['egg', 'toast'], waterGlasses: 2 },
      { date: '2026-06-14', mealType: 'lunch', foods: ['soup', 'salad'], waterGlasses: 3 },
    ]);

    const result = await handleNutritionCallback(12345, 'nutrition_history');

    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'history_shown', count: 2 });
  });
});

describe('handleNutritionInput', () => {
  it('сохраняет приём пищи', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', nutritionState: 'awaiting_foods_lunch' });
    mockCreateNutritionLog.mockResolvedValue(undefined);

    const result = await handleNutritionInput(12345, 'суп, салат, хлеб');

    expect(mockCreateNutritionLog).toHaveBeenCalledWith({
      userId: '12345',
      date: expect.any(String),
      mealType: 'lunch',
      foods: ['суп', 'салат', 'хлеб'],
      waterGlasses: 0,
    });
    expect(mockShowMainMenu).toHaveBeenCalled();
    expect(result).toEqual({ status: 'nutrition_saved', mealType: 'lunch', foods: ['суп', 'салат', 'хлеб'] });
  });

  it('возвращает ошибку при пустом вводе', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', nutritionState: 'awaiting_foods_breakfast' });

    const result = await handleNutritionInput(12345, '   ');

    expect(mockSendMessage).toHaveBeenCalledWith(12345, 'nutrition.invalid_foods');
    expect(result).toEqual({ status: 'invalid_foods' });
  });

  it('возвращает no_nutrition_state если состояние не установлено', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru' });

    const result = await handleNutritionInput(12345, 'еда');

    expect(result).toEqual({ status: 'no_nutrition_state' });
  });

  it('сбрасывает неизвестное состояние', async () => {
    mockGetUser.mockResolvedValue({ language: 'ru', nutritionState: 'unknown_state' });

    const result = await handleNutritionInput(12345, 'еда');

    expect(mockUpdateUser).toHaveBeenCalledWith(12345, { nutritionState: null });
    expect(result).toEqual({ status: 'unknown_nutrition_state' });
  });
});
