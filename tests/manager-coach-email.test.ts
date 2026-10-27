import assert from 'node:assert/strict';
import test from 'node:test';
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from './helpers/managerRouteHarness.ts';
const route = 'app/api/manager/clubs/[clubId]/coaches/email/route.ts';
const context = { params: Promise.resolve({ clubId: 'A' }) };
const payload = { member_id: 'target-A', email: '  Coach@Example.test  ', user_id: 'outside' };
function fixture() { return managerDatabase(managerFixture(), { users: [{ id: 'target', email: 'technical@noemail.local' }] }); }
test('active club manager can fill a coach placeholder email without changing username, password or membership', async () => {
 const h = fixture();
 const response = await loadManagerModule(route, h.mocks).POST(managerRequest('POST', payload), context);
 assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
 assert.deepEqual(await response.json(), { ok: true, email: 'coach@example.test' });
 assert.deepEqual(h.authWrites, [{ id: 'target', patch: { email: 'coach@example.test', email_confirm: true } }]);
 assert.deepEqual(h.writes, []);
});
test('foreign, inactive or privileged accounts and existing real email addresses remain protected', async () => {
 for (const mode of ['foreign-manager', 'foreign-coach', 'inactive-coach', 'platform', 'manager', 'org-owner', 'real-email']) {
  const tables = managerFixture();
  if (mode === 'foreign-manager') tables.club_members[0].club_id = 'B';
  if (mode === 'foreign-coach') tables.club_members[3].club_id = 'B';
  if (mode === 'inactive-coach') tables.club_members[3].is_active = false;
  if (mode === 'platform') tables.app_admins = [{ user_id: 'target' }];
  if (mode === 'manager') tables.club_members.push({ id: 'manager-B', user_id: 'target', club_id: 'B', role: 'manager', is_active: true });
  if (mode === 'org-owner') tables.organization_members = [{ user_id: 'target', organization_id: 'B', role: 'owner' }];
  const h = managerDatabase(tables, { users: [{ id: 'target', email: mode === 'real-email' ? 'real@example.test' : 'tech@noemail.local' }] });
  const response = await loadManagerModule(route, h.mocks).POST(managerRequest('POST', payload), context);
  assert.ok([403, 404, 409].includes(response.status), mode); assert.deepEqual(h.authWrites, [], mode);
 }
});
test('invalid email, missing authentication and failed scope checks do not write', async () => {
 for (const email of ['', 'bad', 'x@y@z.test', 'technical@NOEMAIL.LOCAL']) {
  const h = fixture(); const response = await loadManagerModule(route, h.mocks).POST(managerRequest('POST', { ...payload, email }), context);
  assert.equal(response.status, 400); assert.deepEqual(h.authWrites, []);
 }
 const h = fixture(), request = managerRequest('POST', payload); request.headers.delete('authorization');
 assert.equal((await loadManagerModule(route, h.mocks).POST(request, context)).status, 401);
 assert.deepEqual(h.authWrites, []);
 const failed = managerDatabase(managerFixture(), { failureTable: 'organization_members' });
 assert.equal((await loadManagerModule(route, failed.mocks).POST(managerRequest('POST', payload), context)).status, 503);
 assert.deepEqual(failed.authWrites, []);
});
test('technical addresses do not complete a staff file, while a real address and function do', () => {
 const { staffProfileMissingKey } = loadManagerModule('lib/staffProfile.ts', {});
 assert.equal(staffProfileMissingKey('', 'tech@noemail.local'), 'coaches.functionAndEmailMissing');
 assert.equal(staffProfileMissingKey('Coach', 'tech@noemail.local'), 'coaches.emailMissing');
 assert.equal(staffProfileMissingKey(' ', 'real@example.test'), 'coaches.functionMissing');
 assert.equal(staffProfileMissingKey('Coach', 'real@example.test'), null);
});
