CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  author_user_id text REFERENCES "user" (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'model')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 40000 AND text ~ '[^[:space:]]'),
  in_reply_to uuid UNIQUE REFERENCES chat_messages (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'user' AND author_user_id IS NOT NULL AND author_user_id = owner_user_id AND in_reply_to IS NULL)
      OR (role = 'model' AND author_user_id IS NULL AND in_reply_to IS NOT NULL)),
  CHECK (role <> 'user' OR char_length(text) <= 10000)
);
CREATE INDEX chat_messages_owner_child_recent_idx ON chat_messages (owner_user_id, child_id, created_at DESC, id DESC);