import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {openPreview, assertFits} from '../preview-browser.mjs';
const links = [['香港消防處：先遣急救員計劃', 'https://www.hkfsd.gov.hk/chi/fire_ambulance_services/responder.html'], ['香港消防處：召喚救護服務', 'https://www.hkfsd.gov.hk/chi/fire_ambulance_services/fire_information.html']];
export async function verifyEmergencyHelp(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, '/chat', width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures), help = page.getByTestId('emergency-help');
    await help.waitFor(); assert.equal(await page.getByTestId('agent-run-view').count(), 0);
    assert.ok((await help.textContent()).includes('毋須等候 Agent 回覆。')); assert.ok((await help.textContent()).includes('2026-09-28'));
    for (const [label, href] of links) {const link = help.getByRole('link', {name: label, exact: true}); assert.equal(await link.getAttribute('href'), href); assert.equal(await link.getAttribute('target'), '_blank'); assert.ok((await link.getAttribute('rel')).includes('noopener'));}
    await help.getByRole('link', {name: links[0][0], exact: true}).focus(); assert.equal(await help.getByRole('link', {name: links[0][0], exact: true}).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', {name: '切換合成預覽情境', exact: true}).click(); await page.getByRole('button', {name: '離線', exact: true}).click(); await help.waitFor();
    await assertFits(page, `emergency help before Agent/offline ${width}`); await help.scrollIntoViewIfNeeded(); await page.screenshot({path: resolve(directory, `emergency-help-${width}.png`)}); await page.close();
  }
  return 'emergency help: four widths, fixed root display data before Agent/offline, real focusable official links with safe target attributes; no website clicks, calls or classifier';
}
