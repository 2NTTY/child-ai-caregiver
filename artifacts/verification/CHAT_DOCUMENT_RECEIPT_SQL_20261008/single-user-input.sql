SELECT version();

SHOW exit_on_error;

SHOW listen_addresses;

SHOW unix_socket_directories;

CREATE SCHEMA receipt_sql_test;

SET search_path TO receipt_sql_test, public;

CREATE TABLE "user" (id text PRIMARY KEY);

CREATE TABLE children (id uuid PRIMARY KEY);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  UNIQUE (id,child_id,owner_user_id)
);

CREATE TABLE family_document_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, op_id uuid NOT NULL,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, storage_epoch uuid NOT NULL,
  request_encrypted text NOT NULL CHECK(request_encrypted LIKE 'yb1.%'),
  result_encrypted text NOT NULL CHECK(result_encrypted LIKE 'yb1.%'), PRIMARY KEY(user_id,op_id)
);

INSERT INTO "user" VALUES ('synthetic-owner-a'),('synthetic-owner-b');

INSERT INTO children VALUES
 ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');

INSERT INTO agent_runs VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','synthetic-owner-a'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','synthetic-owner-b'),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','synthetic-owner-a');

INSERT INTO family_document_operations VALUES
 ('synthetic-owner-a','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','yb1.synthetic-request-a','yb1.synthetic-result-a'),
 ('synthetic-owner-a','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','yb1.synthetic-request-b','yb1.synthetic-result-b'),
 ('synthetic-owner-b','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','yb1.synthetic-request-c','yb1.synthetic-result-c'),
 ('synthetic-owner-b','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','yb1.synthetic-request-d','yb1.synthetic-result-d');

CREATE TABLE verification_results (test_name text PRIMARY KEY, result text NOT NULL);

CREATE FUNCTION assert_test(test_name text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL: %', test_name; END IF;
  INSERT INTO verification_results VALUES (test_name,'PASS');
  RAISE NOTICE 'PASS: %', test_name;
END $$;

CREATE FUNCTION expect_error(test_name text, command text, expected_state text, expected_constraint text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed_state text; observed_constraint text; observed_message text;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE, observed_constraint = CONSTRAINT_NAME,
      observed_message = MESSAGE_TEXT;
  END;
  IF observed_state IS DISTINCT FROM expected_state OR
    (expected_constraint IS NOT NULL AND observed_constraint IS DISTINCT FROM expected_constraint) THEN
    RAISE EXCEPTION 'FAIL: %, expected %/%, got %/%: %', test_name, expected_state, expected_constraint,
      observed_state, observed_constraint, observed_message;
  END IF;
  INSERT INTO verification_results VALUES (test_name,'PASS ' || observed_state || ' ' || observed_constraint);
  RAISE NOTICE 'PASS: % [% %]', test_name, observed_state, observed_constraint;
END $$;

SET search_path TO receipt_sql_test, public;

BEGIN;

ALTER TABLE family_document_operations ADD CONSTRAINT family_document_operations_agent_scope
  UNIQUE(user_id,op_id,child_id);

CREATE TABLE agent_document_operations (
  run_id uuid NOT NULL,
  child_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  op_id uuid NOT NULL,
  tool_name text NOT NULL CHECK(tool_name IN ('generate_family_document','change_family_document')),
  PRIMARY KEY(owner_user_id,op_id),
  UNIQUE(run_id,op_id),
  FOREIGN KEY(run_id,child_id,owner_user_id)
    REFERENCES agent_runs(id,child_id,owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY(owner_user_id,op_id,child_id)
    REFERENCES family_document_operations(user_id,op_id,child_id) ON DELETE CASCADE
);

ROLLBACK;

SELECT assert_test('036 DDL rollback leaves no table or added constraint',
 to_regclass('receipt_sql_test.agent_document_operations') IS NULL AND
 NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='family_document_operations'::regclass AND conname='family_document_operations_agent_scope'));

BEGIN;

ALTER TABLE family_document_operations ADD CONSTRAINT family_document_operations_agent_scope
  UNIQUE(user_id,op_id,child_id);

CREATE TABLE agent_document_operations (
  run_id uuid NOT NULL,
  child_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  op_id uuid NOT NULL,
  tool_name text NOT NULL CHECK(tool_name IN ('generate_family_document','change_family_document')),
  PRIMARY KEY(owner_user_id,op_id),
  UNIQUE(run_id,op_id),
  FOREIGN KEY(run_id,child_id,owner_user_id)
    REFERENCES agent_runs(id,child_id,owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY(owner_user_id,op_id,child_id)
    REFERENCES family_document_operations(user_id,op_id,child_id) ON DELETE CASCADE
);

COMMIT;

SELECT assert_test('036 preserves all pre-existing synthetic operation payloads',
 (SELECT count(*) FROM family_document_operations)=4 AND
 (SELECT result_encrypted FROM family_document_operations WHERE user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000001')='yb1.synthetic-result-a' AND
 (SELECT count(*) FROM agent_document_operations)=0);

SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid IN ('agent_document_operations'::regclass,'family_document_operations'::regclass) ORDER BY conname;

SELECT assert_test('both receipt uniqueness keys exist',
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='agent_document_operations'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (owner_user_id, op_id)') AND
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='agent_document_operations'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (run_id, op_id)'));

SELECT expect_error('run FK rejects mismatching owner',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-b','30000000-0000-4000-8000-000000000003','generate_family_document')
 $sql$,'23503','agent_document_operations_run_id_child_id_owner_user_id_fkey');

SELECT expect_error('run FK rejects mismatching child',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','synthetic-owner-a','30000000-0000-4000-8000-000000000002','generate_family_document')
 $sql$,'23503','agent_document_operations_run_id_child_id_owner_user_id_fkey');

SELECT expect_error('run FK rejects nonexistent run',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','generate_family_document')
 $sql$,'23503','agent_document_operations_run_id_child_id_owner_user_id_fkey');

SELECT expect_error('operation FK rejects mismatching owner',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000003','generate_family_document')
 $sql$,'23503','agent_document_operations_owner_user_id_op_id_child_id_fkey');

SELECT expect_error('operation FK rejects mismatching child',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000002','generate_family_document')
 $sql$,'23503','agent_document_operations_owner_user_id_op_id_child_id_fkey');

SELECT expect_error('operation FK rejects missing committed operation',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000099','generate_family_document')
 $sql$,'23503','agent_document_operations_owner_user_id_op_id_child_id_fkey');

SELECT expect_error('unsupported receipt tool is rejected',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','synthetic_unsupported_tool')
 $sql$,'23514','agent_document_operations_tool_name_check');

INSERT INTO agent_document_operations VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','generate_family_document'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','synthetic-owner-a','30000000-0000-4000-8000-000000000002','change_family_document');

SELECT assert_test('both allowed tools create scoped receipts',(SELECT count(*) FROM agent_document_operations)=2);

SELECT expect_error('owner operation cannot be linked to another valid run',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','generate_family_document')
 $sql$,'23505','agent_document_operations_pkey');

SELECT expect_error('run operation unique key rejects duplicate across owner keys',$sql$
 INSERT INTO agent_document_operations VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-b','30000000-0000-4000-8000-000000000001','generate_family_document') ON CONFLICT(owner_user_id,op_id) DO NOTHING
 $sql$,'23505','agent_document_operations_run_id_op_id_key');

INSERT INTO agent_document_operations VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','generate_family_document')
 ON CONFLICT(owner_user_id,op_id) DO NOTHING;

SELECT assert_test('same operation retry retains one original receipt',
 (SELECT count(*) FROM agent_document_operations WHERE owner_user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000001')=1 AND
 (SELECT run_id FROM agent_document_operations WHERE owner_user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000001')='20000000-0000-4000-8000-000000000001');

INSERT INTO agent_document_operations VALUES
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000001','change_family_document')
 ON CONFLICT(owner_user_id,op_id) DO NOTHING;

SELECT assert_test('conflicting retry cannot overwrite original run or tool',
 (SELECT count(*) FROM agent_document_operations)=2 AND
 EXISTS(SELECT 1 FROM agent_document_operations WHERE owner_user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000001' AND run_id='20000000-0000-4000-8000-000000000001' AND tool_name='generate_family_document'));

BEGIN;

INSERT INTO family_document_operations VALUES
 ('synthetic-owner-a','30000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','yb1.synthetic-rollback-request','yb1.synthetic-rollback-result');

INSERT INTO agent_document_operations VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000010','generate_family_document');

ROLLBACK;

SELECT assert_test('explicit transaction rollback removes operation and receipt',
 NOT EXISTS(SELECT 1 FROM family_document_operations WHERE op_id='30000000-0000-4000-8000-000000000010') AND
 NOT EXISTS(SELECT 1 FROM agent_document_operations WHERE op_id='30000000-0000-4000-8000-000000000010'));

DO $$
DECLARE observed_state text;
BEGIN
 BEGIN
  INSERT INTO family_document_operations VALUES
   ('synthetic-owner-a','30000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','yb1.synthetic-aborted-request','yb1.synthetic-aborted-result');
  INSERT INTO agent_document_operations VALUES
   ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','synthetic-owner-a','30000000-0000-4000-8000-000000000011','generate_family_document');
 EXCEPTION WHEN foreign_key_violation THEN observed_state := SQLSTATE;
 END;
 PERFORM assert_test('failed receipt link atomically rolls back preceding operation insert',
  observed_state='23503' AND NOT EXISTS(SELECT 1 FROM family_document_operations WHERE op_id='30000000-0000-4000-8000-000000000011') AND
  NOT EXISTS(SELECT 1 FROM agent_document_operations WHERE op_id='30000000-0000-4000-8000-000000000011'));
END $$;

DELETE FROM agent_runs WHERE id='20000000-0000-4000-8000-000000000001';

SELECT assert_test('run deletion cascades its receipt and retains committed operation',
 NOT EXISTS(SELECT 1 FROM agent_document_operations WHERE run_id='20000000-0000-4000-8000-000000000001') AND
 EXISTS(SELECT 1 FROM family_document_operations WHERE user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000001') AND
 EXISTS(SELECT 1 FROM agent_document_operations WHERE run_id='20000000-0000-4000-8000-000000000002'));

DELETE FROM family_document_operations WHERE user_id='synthetic-owner-a' AND op_id='30000000-0000-4000-8000-000000000002';

SELECT assert_test('operation deletion cascades its receipt and retains unrelated run',
 NOT EXISTS(SELECT 1 FROM agent_document_operations WHERE op_id='30000000-0000-4000-8000-000000000002') AND
 EXISTS(SELECT 1 FROM agent_runs WHERE id='20000000-0000-4000-8000-000000000002'));

TABLE verification_results;

SELECT count(*) AS passed_checks FROM verification_results;

DO $$
BEGIN
 IF (SELECT count(*) FROM verification_results) <> 19 THEN
  RAISE EXCEPTION 'FAIL: final verification count differs from 19';
 END IF;
 RAISE NOTICE 'ALL_CHECKS_PASSED:19';
END $$;

