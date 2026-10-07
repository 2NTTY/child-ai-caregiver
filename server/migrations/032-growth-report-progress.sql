ALTER TABLE family_documents
  ADD COLUMN source_revision bigint NOT NULL DEFAULT 0 CHECK(source_revision>=0),
  ADD COLUMN progress_encrypted text CHECK(progress_encrypted IS NULL OR progress_encrypted LIKE 'yb1.%'),
  ADD COLUMN report_valid_until timestamptz,
  ADD COLUMN report_day date;
