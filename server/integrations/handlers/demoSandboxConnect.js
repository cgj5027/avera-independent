import { readJsonLimited, requestFailureResponse } from '../logic/requestSafety.js';
import { claimUsage } from '../logic/usageLimits.js';
// Demo Mode: connects the selected profile's Plaid Sandbox custom user.
// Uses the real Sandbox flow (public token → exchange → accounts), stores the
// Item demo-tagged so reset can remove only this demo workspace's data.
import { serviceContext } from '../context.js';
import { PlaidFailure } from '../logic/plaid.js';
import { storeConnection } from '../logic/plaidRecords.js';
import { demoSandboxConfig } from '../logic/demoPlaidConfigs.js';
export default async function (req) {
    let stage = 'SANDBOX_AUTH_FAILED';
    try {
        const context = serviceContext(req);
        const user = await context.auth.me();
        if (!user?.id)
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        stage = 'SERVICE_LIMITS_UNAVAILABLE';
        await claimUsage(context, user, 'demoSandboxConnect');
        const body = await readJsonLimited(req);
        const profileKey = typeof body.profile_key === 'string' ? body.profile_key : '';
        let config;
        try {
            config = demoSandboxConfig(profileKey);
        }
        catch {
            return Response.json({ error: 'Unknown demo profile' }, { status: 400 });
        }
        // Real Plaid Sandbox connection behavior: public token for the custom
        // user, then a standard token exchange.
        stage = 'SANDBOX_TOKEN_FAILED';
        const token = await context.plaid.request('/sandbox/public_token/create', {
            institution_id: config.institution_id,
            initial_products: config.products,
            options: {
                override_username: 'user_custom',
                override_password: JSON.stringify({ override_accounts: config.accounts }),
            },
        });
        stage = 'SANDBOX_EXCHANGE_FAILED';
        const exchanged = await context.plaid.request('/item/public_token/exchange', { public_token: token.public_token });
        stage = 'SANDBOX_IMPORT_FAILED';
        const result = await storeConnection(context, user, exchanged, { institution_id: config.institution_id, institution_name: config.institution_name, demo_profile: profileKey });
        return Response.json({ ...result, profile_key: profileKey });
    }
    catch (error) {
        const failure = requestFailureResponse(error);
        if (failure)
            return failure;
        if (error instanceof PlaidFailure && ['NOT_CONFIGURED', 'INVALID_API_KEYS', 'UNAUTHORIZED'].includes(error.code))
            return Response.json({ error: 'Sandbox connections are not configured.', code: 'SANDBOX_NOT_CONFIGURED' }, { status: 503 });
        return Response.json({ error: 'Demo Sandbox connection could not be completed.', code: stage }, { status: 502 });
    }
}
