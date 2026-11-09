/** Read-only diagnostic metadata. Business status/code and retry semantics remain separate. */
export interface ReadFailureDiagnostic {
  category: "http" | "schema" | "scope" | "duplicates" | "invalid_json";
  status: number;
  code: string | null;
}
