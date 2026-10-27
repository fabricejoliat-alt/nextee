import test from 'node:test';
import assert from 'node:assert/strict';
import { loadManagerModule, managerDatabase } from './helpers/managerRouteHarness.ts';
const { loadLegalOrganizationAccessSummary } = loadManagerModule('lib/server/organizationSummary.ts', {});
const { organizationAccessLabelKey, organizationGateBlocks } = loadManagerModule('lib/organizationPolicy.ts', {});
const row = { organization_id: 'academy', player_id: 'junior', name: 'Academy', org_type: 'academy', accessible: false, reason: 'authorization_required' };
async function summary(authorized: boolean, status = 'pending', birthDate = '2015-01-01', originType = 'external_club') {
 const h = managerDatabase({ profiles: [{ id: 'junior', birth_date: birthDate }], academy_roster_entries: [{ academy_id: 'academy', player_id: 'junior', status, origin_type: originType }] });
 h.db.rpc = async (name: string) => ({ error: null, data: name === 'organization_access_summary_checked' ? [row] : authorized });
 const result = await loadLegalOrganizationAccessSummary(h.db, 'junior');
 assert.deepEqual(h.writes, []);
 assert.equal(result[0].accessible, false);
 return result[0];
}
test('parent authorization and manager activation are distinct without changing access', async () => {
 assert.equal(organizationAccessLabelKey(await summary(false)), 'organization.parentAuthorizationAwaited');
 assert.equal(organizationAccessLabelKey(await summary(true)), 'organization.managerActivationAwaited');
 assert.equal(organizationAccessLabelKey(await summary(true, 'pending', '2015-01-01', 'activitee_club')), 'organization.sourceApproval');
 assert.equal(organizationAccessLabelKey(await summary(false, 'pending', '1980-01-01')), 'organization.accessUnavailable');
});
test('suspension, end, documents and unknown causes are not called missing parental consent', async () => {
 assert.equal(organizationAccessLabelKey(await summary(false, 'suspended')), 'organization.affiliationSuspended');
 assert.equal(organizationAccessLabelKey(await summary(false, 'ended')), 'organization.affiliationEnded');
 assert.equal(organizationAccessLabelKey({ ...row, reason: 'legal_required' }), 'organization.documentsToValidate');
 assert.equal(organizationAccessLabelKey({ ...row, reason: 'unknown' }), 'organization.accessUnavailable');
 const sion = { ...row, organization_id: 'sion', accessible: true, reason: null };
 assert.equal(organizationAccessLabelKey(sion), 'organization.ready');
 assert.equal(organizationGateBlocks([row, sion]), false);
 assert.equal(organizationGateBlocks([row, sion], 'academy'), true);
});
