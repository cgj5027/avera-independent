import { serviceContext } from '../context.js';
import { storeConnection } from '../logic/plaidRecords.js';
export default async function (req) {
    try {
        const context = serviceContext(req);
        const user = await context.auth.me();
        if (!user?.id)
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const body = await req.json();
        if (typeof body.public_token !== 'string' || !body.public_token.startsWith('public-sandbox-') || body.public_token.length > 512)
            return Response.json({ error: 'A Sandbox public token is required' }, { status: 400 });
        const exchanged = await context.plaid.request('/item/public_token/exchange', { public_token: body.public_token });
        const actual = await context.plaid.request('/item/get', { access_token: exchanged.access_token });
        const institution = await context.plaid.request('/institutions/get_by_id', { institution_id: actual.item.institution_id, country_codes: ['US'] });
        return Response.json(await storeConnection(context, user, exchanged, { institution_id: actual.item.institution_id, institution_name: institution.institution.name }));
    }
    catch {
        return Response.json({ error: 'Sandbox connection could not be completed. Please retry.' }, { status: 502 });
    }
}
