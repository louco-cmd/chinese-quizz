CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    provider TEXT NOT NULL,  -- 'google' ou 'apple'
    provider_id TEXT UNIQUE NOT NULL, -- l'ID renvoyé par le fournisseur
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);