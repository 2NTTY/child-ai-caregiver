# History / activity page reference: Nextcloud “All activities”

Status: PASS for a faithful, unchanged page-level visual reference. This is one complete 1280×720 application viewport, not a crop of a component, and not a claim to show every event in an account's history. Research only: no browser session, build, site update, publication, or third-party account access was used.

## Exact artifact

- Official guide: https://docs.nextcloud.com/server/stable/user_manual/en/activity.html
- Official hosted image: https://docs.nextcloud.com/server/stable/user_manual/_images/activity-stream-all.png
- Immutable image source: https://raw.githubusercontent.com/nextcloud/documentation/4290071b5ee1addf6ee9e563dbf7f2b3e307eda5/user_manual/images/activity-stream-all.png
- Source view: https://github.com/nextcloud/documentation/blob/4290071b5ee1addf6ee9e563dbf7f2b3e307eda5/user_manual/images/activity-stream-all.png
- Local original: `activity-stream-all-pinned.png`
- Dimensions: 1280×720.
- Size: 204,670 bytes.
- SHA-256: `4cceded73d2f8930bb9a4254b276dc0e7c7fad2300abe615cd2be6f099348d97`.
- Hosted docs image and immutable repository image independently downloaded; byte size and SHA-256 are identical.
- Source documentation: https://github.com/nextcloud/documentation/blob/4290071b5ee1addf6ee9e563dbf7f2b3e307eda5/user_manual/activity.rst

## Actual-image inspection

The actual original PNG was viewed using the image inspection tool, not inferred from search text. It contains the whole visible app shell: blue global bar; left navigation with All activities selected, By you, By others, Favorites, File changes, Security, File shares, Calendar, Tasks, Comments, Contacts, and Activity settings; content title All activities; Today grouping; event icons, object names and right-aligned relative time. Content includes tagging and renaming `readme.txt`, creating Project notes, example contact/calendar entries, and `welcome.txt`.

Do not reconstruct or restyle it for the reference comparison. Display the original image with aspect ratio intact and the attribution outside the image. The screenshot's English, original brand, colors, spacing, content, and proportions are part of the source reference. No invented mobile version, interactions, or additional activity items have been verified.

## Reuse-rights evidence

The documentation repository explicitly identifies its license as CC BY 3.0 in README.rst and carries the CC Attribution 3.0 Unported license in COPYING:

- https://github.com/nextcloud/documentation/blob/4290071b5ee1addf6ee9e563dbf7f2b3e307eda5/README.rst
- https://github.com/nextcloud/documentation/blob/4290071b5ee1addf6ee9e563dbf7f2b3e307eda5/COPYING
- https://creativecommons.org/licenses/by/3.0/

The image is committed under the repository's `user_manual/images/` path and referenced by its manual. This provides the basis to reuse this documentation image with credit, source/license links, and indication of any changes. No screenshot-specific contrary notice was found. It does not grant rights to claim Nextcloud endorsement or take over its trademark. Do not conflate the documentation license with Nextcloud application's AGPL source-code license.

Suggested credit: “Nextcloud developers, ‘Activity stream showing all recent activities,’ Nextcloud User Manual, CC BY 3.0. Original image, unchanged.” Link the title to the official guide and CC BY 3.0 to its license. A copy of COPYING is preserved here as `nextcloud-doc-COPYING`.

## No real private-data evidence

Visual inspection found no personal email, phone, home address, account name, secret, live endpoint, identifiable user photo, private message, or family data. The visible name/birthday ‘Leon Green (2000)’ is positively verified as shipped example content, not merely assumed synthetic:

- Official server example contact file: https://github.com/nextcloud/server/blob/c6aeaca10355170b65dabbb2edf144c96da003a4/apps/dav/lib/ExampleContentFiles/exampleContact.vcf
- It defines `FN:Leon Green`, birthday 2000-01-01, placeholder `leon@example.com`, and placeholder address/phone.
- Official service reads this example file and labels the card “This is an example contact”: https://github.com/nextcloud/server/blob/c6aeaca10355170b65dabbb2edf144c96da003a4/apps/dav/lib/Service/ExampleContactService.php
- The original docs commit explicitly says screenshots were generated using the Activity app's Cypress screenshot workflow: https://github.com/nextcloud/documentation/commit/aeb5b8b90e1ed8486948fdc0e0ccf534290d792a
- That screenshot source creates a random test user and seeds `Project notes`, renames `welcome.txt` to `readme.txt`, and applies `important`, matching the visible image: https://github.com/nextcloud/activity/blob/b4a754dee07cf123fb7eaefa9681e0ed058afad2/cypress/e2e/screenshots.cy.ts

The workflow's viewport capture is deliberate. It has enough visible navigation, filters, title and actual event feed to be a full-page UX/UI reference, while it is not a full scrolling capture or an implementation.

## Rejected alternatives

OpenProject project activity screenshot was only a content-panel crop. Its My activity screenshot included a real employee name/email. Neither was selected; their imagery is not needed for delivery.
