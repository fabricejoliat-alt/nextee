"""Review ledger, not a vulnerability scanner. Evidence remains in the exported definitions."""
import json,csv,re,collections
from pathlib import Path
rows=json.loads(Path('docs/legal/evidence/20261004-test-inventory.json').read_text())
functions={r['item'].split('(')[0]:r for r in rows if r['category']=='function'}
bootstrap={'profiles','clubs','club_members','organizations','organization_members','organization_settings','app_admins','player_guardians','programs','program_members','user_notification_preferences','push_subscriptions'}
repairs={'recompute_golf_round_stats','sync_org_player_performance_from_groups','ensure_event_thread_for_event','sync_event_thread_participants','pick_event_thread_actor_user_id'}
out=[]
for r in rows:
 name=r['item'];d=r['details'];cat=r['category'];scope='';role='';status='';purpose='';note='';deps=[]
 if cat=='function':
  base=name.split('(')[0];definition=d['definition'];ret=re.search(r'RETURNS ([^\n]+)',definition)
  deps=sorted(set(re.findall(r'public\.([a-z_0-9]+)\s*\(',definition))-{base})
  role=','.join(x for x,k in [('anon','anon_execute'),('authenticated','authenticated_execute'),('service','service_execute')] if d[k])
  scope=' / '.join(re.findall(r'legal_required_(?:direct|event|group|session)_access\(([^;]*?)\)',definition)) or 'See parameter/identity checks in definition and called predicates'
  if 'RETURNS trigger' in definition:purpose='Internal trigger';status='Not a standalone PostgREST mutation';note='Review parent write policy and trigger depth; EXECUTE privilege alone is not RPC exploitability.'
  elif base in repairs:purpose='Internal derived data / event thread';status='Confirmed exposed internal entry; candidate 20261102';note='HTTP fixture proof; only performance sync mutation itself not forced. Nested definer triggers remain tested.'
  elif not d['authenticated_execute'] and not d['anon_execute']:purpose='Server/internal RPC';status='Direct client call closed by privileges';note='Reachable from service routes/definer callers; inspect those authorizations.'
  elif 'legal_required_' in definition:purpose='Guarded business RPC or guard predicate';status='Guard present, disabled on TEST';note='A guard is not business authorization. Candidate guards-on behavior not executed.'
  elif base.startswith(('is_','can_','parent_can_','rules_coach_','rules_is_','etiquette_is_')):purpose='RLS/read authorization predicate';status='Boolean helper, not a confirmed business-data bypass';note='Some accept arbitrary user UUID. Minimize anonymous role/membership probing after policy dependency review.'
  elif base in {'om_competition_coefficient','om_holes_bonus_brut','om_holes_bonus_net','om_period_limit','om_period_slot','rules_series_phase','auth_info'}:purpose='Pure calculation / own JWT context';status='No persisted business mutation';note='Inputs or own auth context only; legal gate normally unnecessary.'
  elif base=='staff_seed_group_players_attendees':purpose='Staff event attendance mutation';status='Role-checked legacy RPC, legal boundary incomplete';note='Manager fixture succeeds; requires event legal guard and active staff review before activation. Event trigger may inherit guards, not a proven bypass with flags off.'
  else:purpose='Unclassified callable';status='REVIEW REQUIRED';note='Do not activate until purpose and callable chain are resolved.'
 elif cat=='relation':
  role='anon SELECT='+str(d['anon_select'])+'; authenticated S/I/U/D='+','.join(str(d[k]) for k in ['authenticated_select','authenticated_insert','authenticated_update','authenticated_delete'])
  policies=d.get('policies') or [];defs=' '.join((p.get('using') or '')+' '+(p.get('check') or '') for p in policies)
  deps=sorted(set(re.findall(r'(?:public\.)?([a-z_][a-z_0-9]*)\(',defs)) & set(functions))
  cols={c['name'] for c in d['columns']};scope=','.join(k for k in ['club_id','organization_id','event_id','club_event_id','group_id','session_id','round_id','thread_id','player_id','user_id','beneficiary_id'] if k in cols) or 'platform / linked parent row; see policies'
  purpose=('Legal registry/evidence' if name.startswith('legal_') else 'Identity and bootstrap' if name in bootstrap else 'Golf/OM' if name.startswith(('golf_','om_')) else 'Messages' if name.startswith(('thread_','message_')) else 'Marketplace' if name.startswith('marketplace_') else 'Learning' if name.startswith(('rules_','etiquette_','validation_')) else 'Player documents' if 'document' in name else 'Events/training/groups' if name.startswith(('club_event','training_','club_training','coach_group')) else 'Club business/configuration')
  if not any(d[k] for k in ['authenticated_select','authenticated_insert','authenticated_update','authenticated_delete']) and not d['anon_select']:status='Direct privileges closed';note='Service routes and indirect definer callers remain separate review surface.'
  elif d['rls'] and not policies:status='RLS with no allow policy: direct rows closed';note='Privileges alone do not grant rows. storage public URL bypass is separate.'
  elif name=='app_translations':status='Intentional public translation catalog';note='Not subject to personal acceptance; read-only public purpose.'
  elif name=='marketplace_items':status='Confirmed cross-club/anonymous read; candidate 20261102';note='Permissive policies OR together; HTTP route is club-scoped but direct table was not.'
  elif name in bootstrap:status='Scoped bootstrap/identity: exemption decision required';note='Do not blanket-gate authentication, role selection, family access or legal presentation dependencies.'
  elif any(p['name']=='legal_required_direct_access' and not p['permissive'] for p in policies):status='Restrictive legal gate installed but OFF';note='Existing business RLS remains; club scope must be assessed (golf currently platform only).'
  else:status='Business RLS exists; legal coverage not demonstrated';note='Some policies query guarded parents; definer helpers can bypass parent RLS. Follow dependency graph; no confirmed legal bypass claimed with flags off.'
 elif cat=='bucket':
  purpose={'avatars':'Public profile illustrations','camp-images':'Public camp illustrations','club-news-images':'Public news illustrations','marketplace':'Public listing media','validation-exercise-images':'Public learning illustrations','player-documents':'Private junior documents'}[name]
  role='Public URL' if d['public'] else 'Server-signed URL / service';scope='Object path and associated record';status='Public delivery exempt from RLS acceptance gate' if d['public'] else 'Private direct read/upload denied in fixture; signed delivery works';note='Choose publication purpose and removal/revocation rules; cached/public URLs cannot be revoked by legal page gate.'
 else:continue
 out.append(dict(category=cat,item=name,purpose=purpose,roles=role,scope=scope,qualification=status,indirect_calls='; '.join(deps),review_note=note))
with open('docs/legal/evidence/20261004-access-review.csv','w') as file:
 w=csv.DictWriter(file,fieldnames=out[0].keys());w.writeheader();w.writerows(out)
print(json.dumps(collections.Counter(x['qualification'] for x in out),indent=2))
