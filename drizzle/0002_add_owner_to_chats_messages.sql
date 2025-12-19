ALTER TABLE chats ADD COLUMN owner TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE messages ADD COLUMN owner TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_chats_owner_createdAt ON chats(owner, createdAt);
CREATE INDEX IF NOT EXISTS idx_messages_owner_chatId ON messages(owner, chatId);

