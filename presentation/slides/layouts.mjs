// Layout code contains geometry only. Copy lives in content.json; progress lives in project-status.json.
export async function cover(h, c) {
  h.text(c.eyebrow, 72, 94, 520, 44, { size: 24, color: 'teal' });
  h.text(c.title, 68, 172, 520, 110, { size: h.theme.fontSize.cover, bold: true });
  h.text(c.lead, 72, 310, 590, 144, { size: 38, bold: true });
  h.text(c.caption, 74, 566, 600, 44, { size: 23, color: 'muted' });
  await h.art(h.entry.asset, 630, 122, 620, 465);
}

export async function diagram(h) {
  h.heading();
  if (h.entry.crop) await h.art(h.entry.asset, 64, 160, 1152, 508, true, h.entry.crop);
  else await h.art(h.entry.asset, 58, 137, 1164, 544);
}

export async function audience(h, c) {
  h.heading();
  c.ages.forEach((age, index) => {
    const x = 72 + index * 296;
    h.rule(x, 205, 246, 4, index % 2 ? 'amber' : 'teal');
    h.text(age.range, x, 236, 180, 72, { size: 54, bold: true });
    h.text(age.label, x + 184, 258, 56, 38, { size: 24, color: 'muted' });
    h.text(age.detail, x, 326, 260, 45, { size: 25 });
  });
  h.text(c.lead, 74, 440, 660, 115, { size: 35, bold: true });
  h.text(c.caption, 75, 592, 730, 40, { size: 23, color: 'muted' });
  await h.art(h.entry.asset, 808, 383, 392, 294);
}

export async function responsibilities(h, c) {
  h.heading();
  await h.art(h.entry.asset, 36, 252, 318, 238);
  h.text(c.aiTitle, 382, 218, 350, 50, { size: 32, bold: true, color: 'teal' });
  h.text(c.programTitle, 805, 218, 405, 50, { size: 32, bold: true });
  h.rule(767, 218, 2, 280, 'sage');
  h.lines(c.ai, 382, 296, 362, { size: 27, gap: 78 });
  h.lines(c.program, 805, 296, 398, { size: 27, gap: 78 });
  h.text(c.caption, 76, 601, 1128, 54, { size: 24, color: 'muted' });
}

export async function safety(h, c) {
  h.heading();
  await h.art(h.entry.asset, 40, 205, 430, 323);
  c.items.forEach((item, i) => {
    h.text(String(i + 1).padStart(2, '0'), 499, 194 + i * 78, 60, 46, { size: 26, color: 'teal', bold: true });
    h.text(item, 574, 194 + i * 78, 633, 64, { size: 27 });
  });
  h.text(c.caption, 77, 625, 1124, 43, { size: 23, color: 'muted' });
}

export async function status(h, c) {
  const s = h.status;
  h.heading();
  h.text(s.headline, 74, 165, 1140, 65, { size: 40, bold: true });
  h.text(`${s.currentPhase} ${s.phaseState}　${s.summary}`, 76, 241, 1130, 54, { size: 25, color: 'muted' });
  h.text(c.implementedLabel, 75, 322, 510, 43, { size: 28, color: 'teal', bold: true });
  h.lines(s.implemented, 75, 384, 536, { size: 25, gap: 60 });
  h.text(c.remainingLabel, 682, 322, 535, 43, { size: 28, bold: true });
  h.lines(s.notConnected, 682, 384, 520, { size: 25, gap: 60 });
  h.rule(75, 566, 1128, 2, 'sage');
  h.text(`${c.verifiedLabel}：${s.verified.join('；')}`, 76, 591, 1128, 59, { size: 20, color: 'muted' });
  h.text(`${s.asOf}　基線 ${s.baselineCommit.slice(0, 7)}　${s.demoUrl ? s.demoUrl : 'Demo 連結待提供'}`, 76, 664, 1128, 32, { size: 18, color: 'muted' });
}

export async function demo(h, c) {
  h.heading();
  h.text(c.caption, 75, 132, 1130, 45, { size: 23, color: 'muted' });
  for (let i = 0; i < c.steps.length; i++) {
    const step = c.steps[i];
    const x = 76 + (i % 3) * 393;
    const y = 210 + Math.floor(i / 3) * 236;
    h.frame(x, y, 343, 149);
    const screenshot = h.status.demoScreenshots[step.id];
    if (screenshot) {
      await h.art(screenshot, x + 7, y + 7, 329, 135, false);
    } else {
      h.text(String(i + 1).padStart(2, '0'), x + 20, y + 20, 95, 55, { size: 40, color: 'teal', bold: true });
      h.text('截圖預留位置', x + 22, y + 100, 290, 33, { size: 21, color: 'muted' });
    }
    h.text(`${step.phase}  ${step.title}`, x, y + 165, 358, 46, { size: 25 });
  }
}

export async function growth(h, c) {
  h.heading();
  c.capabilities.forEach((name, i) => {
    const x = 76 + i * 290;
    h.rule(x, 216, 240, 3, 'teal');
    h.text(name, x, 247, 267, 58, { size: 34, bold: true });
  });
  h.text(c.lead, 76, 397, 828, 66, { size: 38, bold: true });
  h.text(c.body, 77, 489, 845, 100, { size: 27 });
  h.text(c.caption, 77, 626, 967, 40, { size: 23, color: 'muted' });
  await h.art(h.entry.asset, 934, 367, 296, 222);
}

export async function closing(h, c) {
  await h.art('../assets/brand/mark.svg', 74, 91, 96, 96);
  h.text(c.title, 200, 113, 440, 70, { size: 50, bold: true });
  h.text(c.lead, 75, 263, 1130, 155, { size: 44, bold: true });
  h.text(c.caption, 78, 482, 670, 46, { size: 29, color: 'teal' });
  h.text(h.status.demoUrl || 'Demo 連結待提供', 79, 610, 905, 42, { size: 24, color: 'muted' });
  await h.art(h.entry.asset, 925, 478, 289, 173);
}
