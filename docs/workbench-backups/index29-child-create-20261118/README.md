# Workbench index29: starting a child's profile

A new full-page comparison of intake forms. The private catalogue preserves the 20 previous groups, 25 original links and one historical singleton, for 21 groups total. Historical entries were compared for preservation, not all rerun. This is not the older existing-child profile view, dashboard or member invitation.

## Fixed source documents

- [Baby Buddy v1.0.0](https://github.com/babybuddy/babybuddy/blob/83b68d74f9671784500ceaa6168f5e8ffd7e2f34/core/templates/core/child_form.html), native /children/add/ in the 83b68d7 release. First and last name and birth date are required; a picture is optional when uploads are enabled. The full source form ends with Submit. Empty fixed state of the original Django template with the same-version compiled styles; date picker closed and no file selected. BSD-2-Clause; Bootstrap 4.0.0-beta.2 MIT; Font Awesome 4.7.0 code MIT / font OFL.
- [BabyTracker NewBabyForm](https://github.com/mbentancour/babytracker/blob/bcc0513567c2fba7c935bd61886ce998a2bf1fab/frontend/src/components/OnboardingScreen.jsx), frontend package 1.0.0 (no release tag claimed). This appears on the application root in the fresh, first-child administrator onboarding branch, not at a dedicated create-child URL. Two required fields (first name, birth date), optional surname, no picture field and an explicit Back action. Exact source JSX, English strings and stylesheet adapted to an inert dark-theme initial state. The first-name example is placeholder text, not a field value. Source program and own inline icon MIT, Martin Bentancour; fixed offline DM Sans OFL 1.1 from google/fonts commit c30b221beb0c1da59d563feb91ec8656a1fa972a. Same font family, not a claim about the exact bytes delivered by an unpinned CDN. This BabyTracker repository is distinct from the dashboard project referenced in earlier comparisons.
- [Product boundary at 0a47c9b36f13](https://github.com/2NTTY/child-ai-caregiver/blob/0a47c9b36f1384610af413dec72dc226cda263a0/frontend/src/screens/profileScreen.tsx). Creating a child requires only a display name with review and explicit confirmation. Neither reference is a reason to require dates or images, infer missing particulars, or change sharing rights.

## Verified coverage

Four complete source pages: 1150 x 780 desktop and 390 x 844 narrow for each. All four A fields and Submit visible; all three B fields, Add Baby and Back visible. All input values were empty at both widths. No horizontal/vertical content overflow; visible B font family and loaded font checked. Thirty A source blobs and ten B source blobs plus the fixed font and license were verified. No app runtime, genuine profile, upload, data entry, permissions change, or form submission. Date chooser, server behavior, actual account and device validation not performed.

The new reader opens one design at a time. Page-forward/page-back changes the displayed design and moves keyboard focus to it. Desktop and narrow checks found the destination heading card 10 CSS px from the top. Compared with both-visible, single-view, narrow-source, image-local original-size and catalogue return modes.

Private screenshot fingerprints (dimensions / bytes / SHA-256):
- A-wide: 1150x780 / 77174 / b9bb002cd92977847c034c51a491a529f06461fa65ee56800cf1af07ece21bbc
- A-narrow: 390x844 / 66487 / 85339c8f2477dab19d1c86b2078f86883985e72150d800ad4d7acb7c83bab5ef
- B-wide: 1150x780 / 56340 / bb954b0bfe02d95e9d56a6a40db6d19d2cf2b63312b2ff6409e8e770ef9de6e0
- B-narrow: 390x844 / 51654 / ad66362626ba79e4a58c91ecc7ae92dc6db0b9e423d97ee8a0d4e6efd327c9ef

Private backup byte readback:
- incremental package: 833909 / 97c9606700e4b2de51cb34cff3de5fe55843af9020fba0e40b15853b2dbe193d
- standalone reader: 367183 / 965483ec27d5cab8bcb83a3cd200ab75815d7ccc0a55239562c00cf3c6ffa968

This branch contains only this author-written index. It cannot reconstruct the preview. The private standalone reader restores this pair; the historical catalogue needs its base and previous private increments through index28. No raw third-party assets, screenshots, family data, credentials or private access links were pushed.
