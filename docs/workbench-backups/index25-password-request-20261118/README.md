# Workbench index25: forgot-password request and next-step guidance

Text-only provenance record, not a preview. No product changes. Index25 adds one private comparison: 17 comparison groups total, plus 25 original entries and one separate historical single. Earlier entries were preserved; not every older view was retested.

## Design sources

- A: dracory/auth, authored v2 design prototype (directory name, not a release): [standalone request page](https://github.com/dracory/auth/blob/fb832888cfb9564f1e4f050e82e77b619fc13997/dev/prototypes/v2/password-restore.html). Root license: GPL v3. Bootstrap 5.3.3 (6e1f75f420f68e1d52733b8e407fc7c3766c9dba) and Bootstrap Icons 1.11.3 (8d88686c03c3768a2d82ba4f20c3c4e1b100fa29), both MIT. Short request card, empty field and return-to-login affordance. No matching result state is supplied by this prototype.
- B: Django 5.2.0 final, commit 9e7cc2b628fe8fd3895986af9b7fc9525034c1b0: [request](https://github.com/django/django/blob/9e7cc2b628fe8fd3895986af9b7fc9525034c1b0/django/contrib/admin/templates/registration/password_reset_form.html) and [independent result template](https://github.com/django/django/blob/9e7cc2b628fe8fd3895986af9b7fc9525034c1b0/django/contrib/admin/templates/registration/password_reset_done.html). BSD-3-Clause; bundled icon notice also retained privately. Default anonymous English request/result layouts with original template structure and CSS. The result is conditional; it does not establish account existence or mail delivery.
- [Product comparison point](https://github.com/2NTTY/child-ai-caregiver/blob/39f2f32287e032501c7b0c2663db57972e7fce9b/frontend/src/screens/loginScreen.tsx): login can request recovery using its existing email field. This reference does not establish a separate product result page.

## Verification

Two inert request layouts and one independent result layout, captured at 1150×680 and 390×760 CSS px. Last content measured inside all six frames without horizontal or vertical source overflow. Six captures represent two designs, not six proposals. Desk and narrow catalogue controls verified: both/single, request/result, original size (local overflow only), source disclosure and return. A's result slot explicitly says no source result available. No live application, account, email, tokens, reset link, mail service, or mobile device was used; no scheduled action and no deployment.

Private capture fingerprints (PNG; filename / pixels / bytes / SHA-256):
- A-request-wide: 1150×680 / 69474 / 79c1377a0c0838d45a5a5111cc953736a5de47f1e11009125e5ff6e79cec3042
- A-request-narrow: 390×760 / 60932 / 492712f85b676a3f864b2cb56cd8b465483b1a752552e7fc491514109fe6db9d
- B-request-wide: 1150×680 / 74015 / bd6591be8153a5f43516dafee490bbd3b48d7ba69cbf8ac8b3cd498a23604444
- B-request-narrow: 390×760 / 68114 / c7d6894fedf1bb8e16203d61f6d84fbe092de47d68d5c839f46cb1ae9f8c2cf9
- B-done-wide: 1150×680 / 87845 / 94e44615bd49ed968fb64af45f1b949516512ba64cf4b9ac46a417a7ed9cc2ae
- B-done-narrow: 390×760 / 82879 / 3d07642b9d82fda2ba4f6d80a0bc867ac3e644d6609e34c05c2f7db152c05747

Private backup verification (byte-identical after readback):
- incremental ZIP: 1544801 bytes / b243b9f92c26f4b299d0b939e731c66176435a84c9ce074deeb983dc43abc66b
- standalone pair HTML: 644285 bytes / 412f5de08147d03b177d767bcb1430c7a3aedba504c39b1206b5bd1f1f1aa7ef

This branch contains only authored text. It cannot recreate the offline preview from this note or the fingerprints. The private standalone file opens the new pair without dependencies. Restoring all older assets also requires the pre-existing private catalogue base and prior increments through index24. No third-party source, image, font, preview, private file link or credential is included here.
