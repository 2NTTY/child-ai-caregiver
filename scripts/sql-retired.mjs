// Preserve historical source and backups without allowing accidental SQL maintenance.
console.error('SQL execution is retired. Configure deploy/p1/firebase.env.example and use firebase:control / firebase:recovery. See docs/PRODUCTION_FRONTEND.md.');
process.exitCode = 1;
