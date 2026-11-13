import { serviceContext } from '../context.js';
import { allRecords, PlaidFailure } from '../logic/plaid.js';
import { credentialFor } from '../logic/plaidRecords.js';
export default async function (req) {
    try {
        const context = serviceContext(req);
        const user = await context.auth.me();
        if (!user?.id)
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const body = await req.json().catch(() => ({}));
        let accessToken;
        if (body.item_id) {
            const items = await allRecords(context.records.PlaidItem, { created_by_id: user.id, item_id: body.item_id });
            if (items.length !== 1)
                return Response.json({ error: 'Connection not found' }, { status: 404 });
            accessToken = (await credentialFor(context, user, items[0])).access_token;
        }
        const token = await context.plaid.request('/link/token/create', {
            user: { client_user_id: user.id },
            client_name: 'Avera',
            ...(accessToken ? { access_token: accessToken } : { products: ['transactions'] }),
            country_codes: ['US'],
            language: 'en'
        });
        return Response.json({ link_token: token.link_token, expiration: token.expiration });
    }
    catch (error) {
        if (error instanceof PlaidFailure && error.code === 'NOT_CONFIGURED')
            return Response.json({ error: 'Sandbox connections are not configured.', code: 'SANDBOX_NOT_CONFIGURED' }, { status: 503 });
        return Response.json({ error: 'Sandbox Link is unavailable. Please retry.' }, { status: 502 });
    }
}
