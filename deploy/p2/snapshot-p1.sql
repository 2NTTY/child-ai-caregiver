-- Run with API/worker stopped, before and after migration 006-023.
-- Hash only the original P1 columns; additive P2 columns are not data loss.
-- Returns no original content, account identifiers, or credential material.
WITH original_rows AS (
  SELECT 'workspaces' AS resource, id::text AS id,
    jsonb_build_array(id, owner_user_id, storage_epoch, created_at)::text AS payload FROM workspaces
  UNION ALL SELECT 'children', id::text,
    jsonb_build_array(id, workspace_id, display_name, display_name_encrypted, created_at)::text FROM children
  UNION ALL SELECT 'text_records', id::text,
    jsonb_build_array(id, child_id, author_user_id, text, text_encrypted, created_at)::text FROM text_records
  UNION ALL SELECT 'chat_messages', id::text,
    jsonb_build_array(id, child_id, owner_user_id, author_user_id, role, text, text_encrypted, in_reply_to, created_at)::text FROM chat_messages
  UNION ALL SELECT 'user', id, to_jsonb(u)::text FROM "user" u
  UNION ALL SELECT 'account', id, to_jsonb(a)::text FROM account a
  UNION ALL SELECT 'storage_security', id::text, to_jsonb(s)::text FROM storage_security s
  UNION ALL SELECT 'deleted_children', id::text, to_jsonb(d)::text FROM deleted_children d
), resources(resource) AS (
  VALUES ('workspaces'), ('children'), ('text_records'), ('chat_messages'),
    ('user'), ('account'), ('storage_security'), ('deleted_children')
)
SELECT r.resource, count(o.id) AS row_count,
  encode(sha256(convert_to(coalesce(string_agg(o.payload, E'\n' ORDER BY o.id), ''), 'UTF8')), 'hex') AS sha256
FROM resources r LEFT JOIN original_rows o ON o.resource = r.resource
GROUP BY r.resource ORDER BY r.resource;
