import type { Database } from '../database.ts';
import { ApiError } from '../errors.ts';

export async function claimQuota(db: Database,owner: string,operation: string,limit=30,duration=60000,now=Date.now()) {
  const bucket=Math.floor(now/duration),key=JSON.stringify([owner,operation,duration,bucket]);
  try {
    const rows=await db.transaction(async tx=>{
      await tx.query('DELETE FROM service_usage WHERE expires_at<$1',[now]);
      return tx.query(`INSERT INTO service_usage(usage_key,used,expires_at) VALUES($1,1,$2)
        ON CONFLICT(usage_key) DO UPDATE SET used=service_usage.used+1 WHERE service_usage.used<$3 RETURNING used`,[key,(bucket+1)*duration,limit]);
    });
    if(!rows.length)throw new ApiError(429,'REQUEST_LIMITED','Request limit reached. Please try again after the reset.');
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'SERVICE_LIMITS_UNAVAILABLE','Service limits are unavailable.');}
}
