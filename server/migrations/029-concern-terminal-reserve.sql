-- Ordinary events remain capped at 200 by the store. These two bounded slots
-- are reserved for cancelling/settling a follow-up and ending the concern.
ALTER TABLE concern_events
  DROP CONSTRAINT concern_events_sequence_check,
  ADD CONSTRAINT concern_events_sequence_check CHECK (sequence BETWEEN 1 AND 202);
