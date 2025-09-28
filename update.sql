-- Table mots déjà existante
CREATE TABLE IF NOT EXISTS mots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pinyin TEXT,
    description TEXT
);

-- Ajout des 30 mots de base (hors "manger", "ami", "merci" que tu as déjà)
INSERT INTO mots (chinese, english, pinyin, description) VALUES
('我', 'I / me', 'wǒ', 'pronoun'),
('你', 'you', 'nǐ', 'pronoun'),
('他', 'he / him', 'tā', 'pronoun'),
('她', 'she / her', 'tā', 'pronoun'),
('我们', 'we / us', 'wǒmen', 'pronoun'),
('你们', 'you (plural)', 'nǐmen', 'pronoun'),
('他们', 'they / them', 'tāmen', 'pronoun'),
('这', 'this', 'zhè', 'demonstrative'),
('那', 'that', 'nà', 'demonstrative'),
('哪', 'which', 'nǎ', 'question word'),
('什么', 'what', 'shénme', 'question word'),
('谁', 'who', 'shéi', 'question word'),
('哪儿', 'where', 'nǎr', 'question word'),
('多少', 'how many / how much', 'duōshǎo', 'question word'),
('好', 'good', 'hǎo', 'adjective'),
('不好', 'not good / bad', 'bù hǎo', 'adjective'),
('大', 'big', 'dà', 'adjective'),
('小', 'small', 'xiǎo', 'adjective'),
('多', 'many / much', 'duō', 'adjective'),
('少', 'few / little', 'shǎo', 'adjective'),
('爱', 'love', 'ài', 'verb'),
('去', 'go', 'qù', 'verb'),
('来', 'come', 'lái', 'verb'),
('看', 'see / look at', 'kàn', 'verb'),
('听', 'listen / hear', 'tīng', 'verb'),
('说', 'speak / say', 'shuō', 'verb'),
('读', 'read', 'dú', 'verb'),
('写', 'write', 'xiě', 'verb'),
('喜欢', 'like', 'xǐhuān', 'verb'),
('学', 'learn / study', 'xué', 'verb');