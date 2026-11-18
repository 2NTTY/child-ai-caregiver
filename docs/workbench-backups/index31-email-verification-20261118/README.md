# Workbench index31: waiting for email verification

Compares two independent waiting pages, not steps of one application. The private catalogue now has 23 comparison groups; 22 previous groups, 25 original entries and one separate historical singleton were preserved. Neither the invitation-acceptance nor the password-reset comparison was replaced.

## Exact sources and permissions

- [django-allauth-ui verification-sent template](https://github.com/danihodovic/django-allauth-ui/blob/449f50c6ac3d9a8340d4a1305a614203e3c14a53/allauth_ui/templates/account/verification_sent.html). Version 1.8.1 per project metadata. The complete English light-theme prompt tells the visitor to open a link, check spam, and seek help if no message arrives; sign-in and sign-up links follow. No address, resend control or success state. Templates matched the official Python wheel; its unmodified compiled stylesheet is identified by SHA-256 bc598baf5912c64656ed6c5bbda439081674d1affeb2b61e078c1e427da27ebd. django-allauth-ui, django-allauth 64.2.1, Tailwind CSS 4.1.4 and DaisyUI 5.0.27 MIT notices retained privately.
- [Flask Accounts pending-verification template](https://github.com/GabeKL22/flask_accounts/blob/3c69e5cc52707d2e43aefbf03f1814eb2d4d9f4f/flask_accounts/auth/templates/auth/verify_email.html). Version 0.2.2 per project metadata. Its pending-email screen states the destination, presents a single empty six-digit input, and has separate verification and resend controls. The selected fixed state has no flash notice. No change-address or back option. The original CSS is unchanged; its decorative animation was paused at its first frame. MIT, Gabriel Leffew, 2026.
- [Product comparison boundary](https://github.com/2NTTY/child-ai-caregiver/blob/71198ec3513d1bf158ae416c2169eb569fd70334/frontend/src/screens/loginScreen.tsx): the product has a verification resend request on its existing login page. Registration, identity verification, and consent are distinct; the references do not establish a separate product screen, a six-digit flow, or a completed verification.

## Verified private evidence

Four screenshots from inert, offline source-derived presentations. No upstream scripts ran, no real person, inbox, usable verification code or token, submission, mail delivery or account operation. They are not author screenshots or physical-mobile tests. Both documents fit their measured full page in each viewport without a clipped inner scroll: A from its heading through the sign-in/sign-up links and B through its resend control. Rendered pixels were checked in addition to document geometry. Fingerprints (dimensions / bytes / SHA-256):
- A-wide: 1150x870 / 84463 / c28060c12ff0f14757736ff1bcb2a462e19a0daf9ab5d7eb341101a49855296c
- A-narrow: 390x898 / 73069 / ee99d80fb3182b3da18930b1e0f5fedb5de2bd3d57200631623d09883e72998c
- B-wide: 1150x870 / 86650 / 94172c60608174003d5d3ce8262791ac6f89d5b787e2bb63f6cf5911f511ed4e
- B-narrow: 390x898 / 73431 / bd191f33294fafa3aa44e0f1f4fc19ab44322f867cc2678f2f291068a4360a80

In both desktop and narrow workbench views, next/previous showed exactly one design, moved keyboard focus to the destination and placed it 10 CSS px from the top. Side-by-side, stacked narrow presentation, single-design views, both source widths, original-size image scrolling and the return link were checked. Earlier links were compared for preservation, not reopened.

Private backups (bytes / SHA-256) were independently downloaded and matched byte for byte:
- incremental archive (30 entries verified): 990912 / 8ebf9463bea2634f01cd0bba9ec6bdfb7e609884172afe469b6d5526071eb644
- standalone comparison reader: 441958 / dcdb3dd891e4d7fbb48404fa2c7fbed443f6538e4d80cd870ba3ac8fe4f8cf91

Only this self-authored text index is on the backup branch. It cannot recreate the screenshots. The private standalone reader restores this pair; the full historical catalogue still needs the base and increments through index30. No image, raw source, secret, private access link or personal data was included in the commit.
