import { readJsonLimited, requestFailureResponse, RequestFailure } from '../logic/requestSafety.js';
import { validDistance, DEFAULT_DISTANCE_MILES } from '../logic/jobDistance.js';
import { claimUsage } from '../logic/usageLimits.js';
// Employment discovery: finds real, current job/gig listings matching the
// user's opportunity profile. Source selection is isolated behind the shared
// provider adapter (logic/opportunitySource.js) so approved job-data
// APIs can be added without changing profile matching or result presentation.
// Read-only; listings are validated server-side before display.
import { serviceContext } from '../context.js';
import { searchListings, JOB_TYPES } from '../logic/opportunitySource.js';
export default async function (req) {
    try {
        const context = serviceContext(req);
        const user = await context.auth.me();
        if (!user?.id)
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        await claimUsage(context, user, 'searchJobOpportunities');
        const body = await readJsonLimited(req);
        const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 400) : '');
        const profile = {
            skills: str(body.skills),
            interests: str(body.interests),
            experience: str(body.experience),
            experience_level: ['entry_level', 'mid_level', 'senior'].includes(body.experience_level)
                ? body.experience_level
                : 'entry_level',
            preferred_roles: str(body.preferred_roles),
            work_mode: ['any', 'remote', 'hybrid', 'onsite'].includes(body.work_mode) ? body.work_mode : 'any',
            location: str(body.location),
            distance_miles: body.distance_miles ?? DEFAULT_DISTANCE_MILES,
            job_type: JOB_TYPES.includes(body.job_type) ? body.job_type : 'any',
        };
        if (!validDistance(profile.distance_miles))
            return Response.json({ error: 'Choose a search distance from 1 to 250 miles.' }, { status: 400 });
        if (!profile.skills)
            return Response.json({ error: 'Describe your skills to search for opportunities.' }, { status: 400 });
        const result = await searchListings(context, profile, 'combined');
        return Response.json(result);
    }
    catch (error) {
        console.error('job_search_failed', { code: error instanceof RequestFailure ? error.code ?? 'INVALID_REQUEST' : 'JOB_SEARCH_FAILED' });
        const failure = requestFailureResponse(error);
        if (failure)
            return failure;
        return Response.json({ error: 'Job search is unavailable. Please retry.' }, { status: 502 });
    }
}
