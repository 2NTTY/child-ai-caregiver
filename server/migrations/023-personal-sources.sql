ALTER TABLE shared_inputs DROP CONSTRAINT shared_inputs_kind_check;
ALTER TABLE shared_inputs DROP CONSTRAINT shared_inputs_check;
ALTER TABLE shared_inputs ADD CONSTRAINT shared_inputs_kind_check CHECK(kind IN ('paste','public_source','personal_source'));
ALTER TABLE shared_inputs ADD CONSTRAINT shared_inputs_source_kind_check
  CHECK((kind IN ('paste','personal_source') AND source_id IS NULL) OR (kind='public_source' AND source_id IS NOT NULL));
