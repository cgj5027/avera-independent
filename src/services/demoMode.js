import { sandboxErrorMessage, sandboxErrorReference } from './sandboxErrors';
/**
 * Sample-workspace orchestration. The independent server stages selection/reset
 * atomically. Returning to personal finances never deletes sample records.
 * Historical SDK/Plaid seeding remains a compatibility-only advanced path.
 */
import { application } from '@/api/application';
import { listRecords, createRecords, deleteRecordsWhere } from './dataService';
import { buildDemoDataset, createDemoRecords, DEMO_PROFILES, DEMO_PROFILE_KEYS } from './demoProfiles';
import { getDemoWorkspace, setModeOwner, setDataMode, activateSampleWorkspace, getModeSnapshot, getModeOwner } from '@/lib/mode';

async function activeUser() {
  const owner=getModeOwner(),selection=getModeSnapshot();
  const user=await application.auth.currentUser();
  if(!user?.id)throw new Error('Sign in to use sample data.');
  if((owner&&owner!==user.id)||selection!==getModeSnapshot())throw new Error('Your account or workspace changed. Please retry.');
  if(!owner)setModeOwner(user.id);
  return user;
}

/** Entities a demo workspace seeds. PlaidItem is handled alongside its imports. */
const DEMO_ENTITIES = [
  'transaction',
  'account',
  'bill',
  'billSuggestionDismissal',
  'budgetCategory',
  'goalContribution',
  'goal',
  'property',
  'mortgageRecord',
  'incomeSource',
  'householdProfile',
  'jobProfile',
  'forecastRecord',
];

/** Explicit compatibility cleanup: removes records tagged to these sample profiles,
 *  plus owned sample Plaid Sandbox Items and their imports. */
export async function removeDemoData(profileKeys, plaidItemIds = []) {
  const keys = Array.isArray(profileKeys) ? profileKeys : [profileKeys];
  const validKeys = keys.filter((k) => DEMO_PROFILE_KEYS.includes(k));
  if (validKeys.length) {
    for (const key of DEMO_ENTITIES) {
      await deleteRecordsWhere(key, { demo_profile: { $in: validKeys } });
    }
  }
  /* Remembered Item ids are untrusted; only owned, demo-tagged connections
     may be removed. The backend also verifies the private credential tag. */
  const demoItems = await listRecords('plaidItem', { demo_profile: { $in: validKeys } }, {allDatasets:true});
  const itemIds = [...new Set([...demoItems.map((i) => i.item_id)].filter(Boolean))];
  for (const itemId of itemIds) {
    await application.services.invoke('plaidDisconnect', { item_id:itemId, demo_only:true });
  }
  return itemIds;
}

async function seedStructuralRecords(profileKey, includeTransactionData) {
  const dataset = buildDemoDataset(profileKey, new Date(), { includeTransactionData });
  await createDemoRecords(
    dataset,
    (key, rows) => createRecords(key, rows)
  );
}

/** Connects the profile's Plaid Sandbox custom user, syncs it, and returns the item id. */
async function connectPlaidDemo(profileKey) {
  const res = await application.services.invoke('demoSandboxConnect', { profile_key: profileKey });
  const itemId = res.data?.item_id ?? null;
  if (!itemId) throw new Error(res.data?.error || 'Plaid Sandbox connection failed.');
  // Sandbox transaction preparation is asynchronous. Both an empty successful
  // sync and PRODUCT_NOT_READY are transient; never discard the Item after one poll.
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const result = await application.services.invoke('plaidSync', { item_id: itemId });
    const own = result.data?.results?.find(r => r.item_id === itemId);
    if (!own) throw Object.assign(new Error('Demo sync failed'), { code: 'SANDBOX_SYNC_FAILED' });
    if (own.status === 'synced' && own.transactions > 0) return itemId;
    if (own.status !== 'synced' && own.error !== 'PRODUCT_NOT_READY') throw Object.assign(new Error('Demo sync failed'), { code: 'SANDBOX_SYNC_FAILED' });
    if (attempt < delays.length) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
  }
  const pending = Object.assign(new Error('Demo transactions are not ready'), { code: 'SANDBOX_DATA_PENDING' });
  throw pending;
}

/**
 * Loads a demo profile: clears any existing demo workspace for this user,
 * optionally connects the matching Plaid Sandbox custom user, and seeds the
 * profile. Returns { plaid_used, warning } — the warning is shown when Plaid
 * failed and the labeled Avera sample dataset was used instead.
 */
export async function loadDemoProfile(profileKey, { viaPlaid = false } = {}) {
  const user = await activeUser();
  if (!user?.id) throw new Error('Sign in to load demo data.');
  setModeOwner(user.id);
  if (!DEMO_PROFILES[profileKey]) throw new Error('Unknown demo profile.');
  if(application.capabilities?.sampleWorkspaces&&!viaPlaid){
    const selection=getModeSnapshot();
    const result=await application.services.invoke('sampleWorkspace',{profile:profileKey});
    const current=await application.auth.currentUser();
    if(current.id!==user.id||selection!==getModeSnapshot())throw new Error('Your account changed. Please retry.');
    activateSampleWorkspace(result.data.workspace);
    return {plaid_used:false,warning:''};
  }

  /* A demo workspace holds exactly one profile: clear every demo tag first. */
  await removeDemoData(DEMO_PROFILE_KEYS, getDemoWorkspace()?.plaid_item_id ? [getDemoWorkspace().plaid_item_id] : []);

  let plaidItemId = null;
  let warning = '';
  if (viaPlaid) {
    try {
      plaidItemId = await connectPlaidDemo(profileKey);
    } catch (error) {
      await removeDemoData(profileKey);
      plaidItemId = null;
      warning = `${sandboxErrorMessage(error)} You can explore sample data in the meantime.${sandboxErrorReference(error)}`;
    }
  }

  await seedStructuralRecords(profileKey, !plaidItemId);
  activateSampleWorkspace({ profile: profileKey, plaid_item_id: plaidItemId });
  return { plaid_used: Boolean(plaidItemId), warning };
}

/** Resets the ACTIVE demo workspace only: this user, this profile, nothing else. */
export async function resetDemoProfile() {
  const ws = getDemoWorkspace();
  if (!ws?.profile) throw new Error('No demo profile is active.');
  if(application.capabilities?.sampleWorkspaces){
    const user=await activeUser(),selection=getModeSnapshot();
    const result=await application.services.invoke('sampleWorkspace',{profile:ws.profile,reset:true});
    if((await application.auth.currentUser()).id!==user.id||selection!==getModeSnapshot())throw new Error('Your account changed. Please retry.');
    activateSampleWorkspace(result.data.workspace);return {plaid_used:false,warning:''};
  }
  const viaPlaid = Boolean(ws.plaid_item_id);
  await removeDemoData(ws.profile, viaPlaid ? [ws.plaid_item_id] : []);
  return loadDemoProfile(ws.profile, { viaPlaid });
}

/** Returning to personal finances preserves all sample records and the remembered scenario. */
export async function exitDemoMode() { setDataMode('manual'); }
