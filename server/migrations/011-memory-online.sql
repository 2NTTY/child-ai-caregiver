ALTER TABLE online_operations DROP CONSTRAINT online_operations_kind_check;
ALTER TABLE online_operations ADD CONSTRAINT online_operations_kind_check
  CHECK (kind IN ('children','care','profile','chat','family','preferences','memory'));
ALTER TABLE online_changes DROP CONSTRAINT online_changes_kind_check;
ALTER TABLE online_changes ADD CONSTRAINT online_changes_kind_check
  CHECK (kind IN ('children','care','profile','chat','family','preferences','memory'));

-- Erase conservative copies without resetting the original operation identity.
CREATE FUNCTION redact_online_memory_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE online_operations SET result_encrypted=NULL WHERE child_id=OLD.child_id AND kind='memory';
  RETURN OLD;
END $$;
CREATE TRIGGER online_fact_receipt_deletion BEFORE DELETE ON memory_facts
  FOR EACH ROW EXECUTE FUNCTION redact_online_memory_receipts();
CREATE TRIGGER online_topic_receipt_deletion BEFORE DELETE ON memory_topics
  FOR EACH ROW EXECUTE FUNCTION redact_online_memory_receipts();
