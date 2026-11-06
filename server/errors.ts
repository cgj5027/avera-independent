export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status=status; this.code=code; }
}
export function invalid(message = 'Invalid request.'): never { throw new ApiError(400, 'INVALID_REQUEST', message); }
export function missing(): never { throw new ApiError(404, 'NOT_FOUND', 'Record not found.'); }
