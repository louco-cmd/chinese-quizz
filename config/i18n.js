/**
 * Traductions de l'interface Jiayou
 * 'en' → mode en→zh (apprendre le chinois, interface anglaise)
 * 'zh' → mode zh→en (apprendre l'anglais, interface chinoise)
 */
const translations = {
  en: {
    // Navbar
    nav_collection: 'Collection',
    nav_add_word:   'Add Word',
    nav_quiz:       'Quiz',
    nav_duels:      'Duels',
    nav_store:      'Store',

    // Dashboard
    add_a_word:           'Add a word',
    input_placeholder:    'Type Chinese characters...',
    submit_btn:           'Add the Word',
    searching:            'Searching...',
    only_chinese_allowed: 'Only Chinese characters allowed',
    how_to_type_chinese:  'How to type Chinese?',

    // Dashboard – modal mot existant
    word_found:     'Word found',
    word_details:   'Word details',
    label_chinese:  'Chinese',
    label_pinyin:   'Pinyin',
    label_english:  'English',
    label_desc:     'Description',
    cancel:         'Cancel',
    capture:        'Capture (3 ₵)',
    edit_before:    'Edit before adding',
    already_captured: 'Already captured',
    adding:         'Adding...',

    // Collection
    search_placeholder:    'Search Chinese, pinyin...',
    col_chinese:           'Chinese',
    col_pinyin:            'Pinyin',
    col_english:           'English',
    hide_translation:      'hide translation',
    show_translation:      'show translation',
    no_words_yet:          'No words yet.',
    edit_word:             'Edit Word',
    save:                  'Save',

    // Quiz (page sélection)
    quiz_title_pinyin:     'Quiz Pinyin',
    quiz_desc_pinyin:      'From english to pinyin',
    quiz_title_char:       'Quiz characters',
    quiz_desc_char:        'From English to chinese characters',
    quiz_settings:         'Quiz settings',
    start_quiz:            'Start quiz',
    cancel_quiz:           'Cancel',
    your_difficulties:     'Your difficulties',
    number_of_words:       'NUMBER OF WORDS',
    difficulty_label:      'DIFFICULTY',

    // Quiz-play
    submit:      'Submit',
    correct:     '✅ Correct!',
    incorrect_answer: '✅ Correct answer:',
    quiz_completed:  'Quiz Completed',
    correct_pct:     '% correct',
    coins_earned:    'Coins Earned',
    collect:         'Collect',
    end_quiz:        'End Quiz',
    loading_words:   'Loading words...',

    // Settings
    settings_title:         'Settings',
    learning_section:       'Learning',
    learning_direction:     'Learning direction',
    learning_direction_sub: 'What language are you learning?',
    learning_chinese:       "I'm learning Chinese",
    learning_english:       "I'm learning English",
    notif_section:          'Notifications',
    word_review:            'Word review reminders',
    word_review_sub:        'A difficult word every 2 hours',
    duel_notif:             'Duel notifications',
    duel_notif_sub:         'Get notified when someone challenges you',
    account_section:        'Account',
    logout:                 'Logout',
    confirm_logout:         'Confirm logout',
    logout_confirm_text:    'Are you sure you want to log out?',
    delete_account:         'Delete account',
  },

  zh: {
    // Navbar
    nav_collection: '我的词库',
    nav_add_word:   '添加词汇',
    nav_quiz:       '测验',
    nav_duels:      '对战',
    nav_store:      '商城',

    // Dashboard
    add_a_word:           '添加词汇',
    input_placeholder:    '输入英文单词...',
    submit_btn:           '添加词汇',
    searching:            '搜索中...',
    only_chinese_allowed: '只能输入汉字',
    how_to_type_chinese:  '如何输入汉字？',

    // Dashboard – modal mot existant
    word_found:     '找到词汇',
    word_details:   '词汇详情',
    label_chinese:  '中文',
    label_pinyin:   '拼音',
    label_english:  '英文',
    label_desc:     '描述',
    cancel:         '取消',
    capture:        '收藏 (3 ₵)',
    edit_before:    '编辑后添加',
    already_captured: '已收藏',
    adding:         '添加中...',

    // Collection
    search_placeholder:    '搜索词汇...',
    col_chinese:           '中文',
    col_pinyin:            '拼音',
    col_english:           '英文',
    hide_translation:      '隐藏翻译',
    show_translation:      '显示翻译',
    no_words_yet:          '词库为空',
    edit_word:             '编辑词汇',
    save:                  '保存',

    // Quiz (page sélection)
    quiz_title_pinyin:     '拼音测验',
    quiz_desc_pinyin:      '从英文到拼音',
    quiz_title_char:       '英译中测验',
    quiz_desc_char:        '看中文，写英文',
    quiz_settings:         '测验设置',
    start_quiz:            '开始测验',
    cancel_quiz:           '取消',
    your_difficulties:     '我的难点',
    number_of_words:       '词汇数量',
    difficulty_label:      '难度',

    // Quiz-play
    submit:      '确认',
    correct:     '✅ 正确！',
    incorrect_answer: '✅ 正确答案：',
    quiz_completed:  '测验完成',
    correct_pct:     '% 正确率',
    coins_earned:    '获得金币',
    collect:         '领取',
    end_quiz:        '结束测验',
    loading_words:   '加载词汇中...',

    // Settings
    settings_title:         '设置',
    learning_section:       '学习',
    learning_direction:     '测验方向',
    learning_direction_sub: '你在学习哪种语言？',
    learning_chinese:       '我在学中文',
    learning_english:       '我在学英文',
    notif_section:          '通知',
    word_review:            '词汇复习提醒',
    word_review_sub:        '每2小时一个难词',
    duel_notif:             '对战通知',
    duel_notif_sub:         '有人向你发起挑战时收到通知',
    account_section:        '账户',
    logout:                 '退出登录',
    confirm_logout:         '确认退出',
    logout_confirm_text:    '确定要退出登录吗？',
    delete_account:         '删除账户',
  },
};

module.exports = translations;
