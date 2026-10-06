# Growth history subtitle check

- Added the exact subtitle `查看已結束的關注與跟進記錄` through the existing History source-copy slot.
- Kept the existing `styles.meta` typography and `sourceCopy` spacing. No style changes. Growth does not append a source suffix; other categories are unchanged.
- Product files changed: `src/screens/historyScreen.tsx` and `src/components/history/history-filters.ts`.
- Test file changed: `scripts/history-controls.test.mjs`. The shared harness can render each category; a new assertion compares the subtitle slot and styles for all seven categories at 1440, 1024, 390 and 320 widths.
- Final focused tests: 16/16 passed. Final `npm run typecheck`: exit 0.
- Existing controls, filter/reset, scope clearing, row name/date-only structure, restore guards, concise success and explicit unknown/failure checks passed in the focused suite.

## Preserved failures and approved corrections

1. First focused run: 15/16 passed. The old source-string assertion explicitly required the Growth subtitle to remain hidden. It was changed only after parent approval to reflect the user's new request. Initial and final logs are separate.
2. First typecheck: failed because the isolated frontend staging tree omitted the unchanged root shared family type import. The parent approved a read-only baseline type link in the staging tree. Shared source was not edited. Initial and final logs are separate.

## Scope and limits

Both supplied Library reference images were materialized and visually inspected. No browser, build, Git or Sites operations were performed. There are no new rendered UI screenshots. Four-width component-prop checks establish composition/style parity, not actual browser geometry. Browser QA, full aggregate and final integration remain with the parent.

The patch is against the frozen cleanup base. No frozen-base files were changed. `source-manifest.json` records exact preimage and result hashes. The separate button-feedback worker confirmed its history-controls change is confined to the press-opacity assertion, separate from this patch's harness/header and final-copy hunks.
