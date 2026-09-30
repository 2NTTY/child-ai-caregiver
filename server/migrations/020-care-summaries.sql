CREATE TABLE visit_preparations (
 child_id uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),payload_encrypted text NOT NULL
);
CREATE TABLE visit_preparation_revisions (
 child_id uuid NOT NULL REFERENCES visit_preparations(child_id) ON DELETE CASCADE,
 version integer NOT NULL,payload_encrypted text NOT NULL,PRIMARY KEY(child_id,version)
);
