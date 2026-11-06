import { serviceContext } from '../context.js';
import { allRecords } from '../logic/plaid.js';
import { credentialFor } from '../logic/plaidRecords.js';
export default async function (req) {
    try {
        const context = serviceContext(req);
        const user = await context.auth.me();
        if (!user?.id)
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const body = await req.json();
        const items = await allRecords(context.records.PlaidItem, { created_by_id: user.id, item_id: body.item_id });
        if (items.length !== 1)
            return Response.json({ error: 'Connection not found' }, { status: 404 });
        const item = items[0];
        if (body.demo_only && (!['early_career', 'multi_income', 'financial_improvement'].includes(item.demo_profile)))
            return Response.json({ error: 'Not a demo connection' }, { status: 400 });
        const credential = await credentialFor(context, user, item);
        if (body.demo_only && credential.demo_profile !== item.demo_profile)
            return Response.json({ error: 'Not a verified demo connection' }, { status: 400 });
        try {
            await context.plaid.request('/item/remove', { access_token: credential.access_token });
        }
        catch (error) {
            if (!['INVALID_ACCESS_TOKEN', 'ITEM_NOT_FOUND'].includes(error.code))
                throw error;
        }
        // Mark first so a retried partial cleanup cannot sync this revoked Item.
        await context.records.PlaidItem.update(item.id, { status: 'disconnected' });
        for (const name of ['Transaction', 'Account']) {
            const records = await allRecords(context.records[name], { created_by_id: user.id, plaid_item_id: item.item_id, source: 'Plaid Sandbox' });
            for (const row of records)
                await context.records[name].delete(row.id);
        }
        // Keep credentials until all local cleanup completes, allowing retries.
        await context.records.PlaidItem.delete(item.id);
        await context.privateRecords.PlaidCredential.delete(credential.id);
        return Response.json({ disconnected: true });
    }
    catch {
        return Response.json({ error: 'Disconnect did not finish. Retry to complete cleanup.' }, { status: 502 });
    }
}
