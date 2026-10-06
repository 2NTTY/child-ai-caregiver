# Published v48 targeted browser verification

Verified 2026-10-06, approximately 07:26–07:33 UTC, in the normal dot cloud Chromium browser.

Site: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/
Published version supplied by parent: v48
Site entry supplied by parent: 306b54fd51461813a9e0d6c05558433b
Site source supplied by parent: 9ab293a0d735124d87cfe099cebf0c71e8813cbd
Deployment supplied by parent: appgdep_6ac4a240c00c8191af384c002fd24e76

## Result: targeted scope passes

This is a targeted verification of the v48 changes. It does not repeat the complete v47 audit.

### Primary and danger feedback

The v47 residual white feedback is removed on both representative controls:

- Primary: “請助手安排” on /tasks
- Danger: “結束關注：日常遊戲與表達” on /growth, which opens a confirmation dialog without applying the change

Both now show black rgba(0,0,0,0.06) hover and black rgba(0,0,0,0.12) ripple. Early samples capture intermediate darker hover alpha during transition. All eight held samples had :active=true, control opacity1, all inspected ancestors opacity1, white text rgb(255,255,254) at opacity1, and ready state present. The first danger sample precedes creation of a ripple span; subsequent held samples contain the expected black ripple.

Release of primary navigated to chat with a generated local draft; that draft was cleared. Release of the danger trigger opened its confirmation. Cancel dismissed the dialog; the final confirmation was not pressed. No data was sent or concern archived.

Evidence: v48-primary-button and v48-danger-dialog-trigger each have before/during/after JPEGs and detailed JSON.

### Mobile current-route navigation

Tested actual iframe content sizes 390 × 600 and 320 × 600. After navigation, released the pointer and clicked an inert area outside the iframe to remove hover/focus pressure before taking each stored state.

Current-route highlighting is persistent mint rgb(186,232,232). Exactly one current control has aria-current="page"; the highlight remains while :active=false. The overlay is pointer-events:none and fills the owning control.

Coverage at both widths: Today, Assistant, Tasks, Growth, Records, and the More route reached by the Records upward gesture. Records correctly owns both /care and /more as the current navigation item. Its button exposes aria-current="page". No aria-selected attribute is required for this button role.

At 390 each item is 78 × 64; at 320 each is 64 × 64. Controls remain inside the viewport. Eleven named states are in v48-navigation-states.json, with the additional initial 390 Today state verified in v48-mobile-390-home.jpg and v48-mobile-390-camera-metrics.json.

### Camera droplet and pointer hit testing

At both viewport widths:

- Decorative surface: 72 × 72, x=0, y=463 to535
- Actual camera button: 56 × 56, x=0, y=479 to535
- Navigation controls begin at y=536, immediately below the one-pixel boundary
- Decorative surface and its SVG have pointer-events:none; SVG is aria-hidden
- Read-only elementFromPoint at camera center resolves inside the camera
- Sampled points in the decorative overflow, right at x=64/y=530 and above at x=8/y=471, resolve to underlying content and are not contained by the camera

This supports the intended edge-attached decoration without expanding the camera hitbox. These are sampled hit tests, not exhaustive testing of every pixel.

Evidence: v48-mobile-390-camera-metrics.json, v48-mobile-320-camera-metrics.json, and home screenshots.

### Safe camera gestures

- Stationary 1.2-second long press opened the three local choices at 390 and320: File, Voice, and “記一句”
- Releasing the long press kept choices open; it did not open the camera or request permission
- Escape collapsed the control and removed the options at both widths
- At320 the menu is 180 × 184 and all choice bounds remain within the visible iframe, ending above navigation
- A rightward drag from the camera at 390 opened the Assistant screen with an empty focused composer and disabled preview button. It did not send anything

No direct short camera tap, camera permission, photo, file selection, voice capture, model invocation, or message send was performed. File/voice directions were visually present but not activated.

Evidence: v48-camera-longpress-options.jpg, v48-camera-320-longpress-options.jpg, v48-camera-escape-cancel.json, v48-camera-320-choices-cancel.json, and v48-camera-text-drag-observation.json.

## Method, corrections, and limits

- Documented native held pointer clicks, locator actions, read-only DOM/computed-style inspection, and ordinary screenshots only
- No DevTools, localhost, hidden application state, runtime edits, source edits, or network bypass
- The inherited v47 helper initially retained closed tab 9 and failed with “Unknown CDP tab 9” after current tab 11 had reached /tasks. It was stopped and reported before retry. Parent approved a bounded correction; the same supported helper was rebuilt against tab 11 and the original probe succeeded once. The failure is preserved in v48-helper-failure.json
- No every-frame continuity or persistent DOM identity claim is made. The eight held samples have ready markers and unchanged opacity; that does not prove absence of every transient frame
- The known QA wrapper label still says 900px after selecting 600px. Actual iframe attributes and border-box measurements confirm 600px content height
- No broader v47 regression result is inferred from this targeted pass

## End state

Synthetic danger dialog canceled, generated desktop chat draft cleared, mobile camera popup canceled, no pending upload/permission/send. Evidence is separate from v46 and v47. Browser can be released.
