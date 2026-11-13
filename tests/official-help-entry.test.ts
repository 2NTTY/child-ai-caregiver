import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ALL_OFFICIAL_HELP_IDS,
  matchOfficialHelpForText,
  OFFICIAL_HELP,
  OFFICIAL_HELP_ENTRY_COPY,
} from '../src/shared/agent-feedback.ts';

test('matchOfficialHelpForText deterministically identifies emergency and medical-consult cues without model tool calls', () => {
  for (const text of [
    'BB突然抽搐同埋嘴唇發紫點算？',
    '小朋友呼吸困難抖唔到氣！',
    '高燒不退而且叫唔醒、意識不清',
    'Baby is having a seizure and difficulty breathing',
    '懷疑誤服清潔劑，係咪即刻打 999 去急症室？',
  ]) {
    const matched = matchOfficialHelpForText(text);
    assert.ok(matched.includes('emergency-hk-v1'), `must match emergency-hk-v1 for: ${text}`);
  }

  for (const text of [
    '請問退燒藥水幾多 ml 先啱？',
    '醫生開咗撲熱息痛同抗生素，點樣餵藥？',
    '想問母嬰健康院同埋安全用藥劑量問題',
    'What is the paracetamol dosage for my baby?',
  ]) {
    const matched = matchOfficialHelpForText(text);
    assert.ok(matched.includes('medical-consult-hk-v1'), `must match medical-consult-hk-v1 for: ${text}`);
  }

  const combined = matchOfficialHelpForText('BB高燒不退抽搐，可唔可以即刻餵退燒藥水？');
  assert.deepEqual(combined, ['emergency-hk-v1', 'medical-consult-hk-v1']);

  for (const ordinary of [
    '',
    '   ',
    '你好！',
    '今日下晝飲咗 120ml 奶同埋換咗兩次片',
    '請問六個月大加固食咩蔬果好？',
  ]) {
    assert.deepEqual(matchOfficialHelpForText(ordinary), [], `ordinary text must not false-trigger urgent help: ${ordinary}`);
  }
});

test('OFFICIAL_HELP and chatScreen provide an always-available, non-agent-dependent official help entry', async () => {
  assert.deepEqual(ALL_OFFICIAL_HELP_IDS, ['emergency-hk-v1', 'medical-consult-hk-v1']);
  assert.ok(OFFICIAL_HELP['emergency-hk-v1'].sources.length >= 2);
  assert.ok(OFFICIAL_HELP['medical-consult-hk-v1'].sources.length >= 1);
  assert.match(OFFICIAL_HELP_ENTRY_COPY.urgentNotice, /毋須等待 AI 搜尋或審核/);

  const screenCode = await readFile(new URL('../frontend/src/screens/chatScreen.tsx', import.meta.url), 'utf8');
  assert.match(screenCode, /matchOfficialHelpForText/);
  assert.match(screenCode, /OFFICIAL_HELP_ENTRY_COPY\.highlightedButtonLabel/);
  assert.match(screenCode, /testID="chat-official-help-urgent-notice"/);
  assert.match(screenCode, /activeHelpIds\.length \? <OfficialHelpCards ids=\{activeHelpIds\} \/> : null/);
});
