/** Application ports. Implementations must enforce authorization server-side.
 * Query filters and UI ownership checks are not a security boundary. */
export type Fields = Record<string, any>; // Existing domain DTOs migrate incrementally.
export interface StoredRecord extends Fields { id: string; created_by_id?: string }
export interface User extends Fields { id: string }
export interface RecordPage { items: StoredRecord[]; has_more: boolean; next_cursor?: string | null }
export interface Collection {
  list(query?: Fields, options?: Fields): Promise<RecordPage>;
  get(id: string): Promise<StoredRecord | null>;
  create(fields: Fields): Promise<StoredRecord>;
  update(id: string, fields: Fields): Promise<StoredRecord>;
  delete(id: string): Promise<unknown>;
  createMany(rows: Fields[]): Promise<StoredRecord[]>;
}
export interface ServiceResponse<T = any> { data: T }
export interface ResumeInput { file_name: string; file_base64: string; consent: boolean }
export const PUBLIC_COLLECTIONS = [
  'HouseholdProfile', 'IncomeSource', 'Account', 'Transaction', 'Bill',
  'BillSuggestionDismissal', 'BudgetCategory', 'Goal', 'GoalContribution',
  'Property', 'MortgageRecord', 'ForecastRecord', 'JobProfile', 'PlaidItem',
] as const;
export interface Application {
  auth: {
    /** A hint to attempt verification, never proof of authorization. */
    hasSession(): boolean;
    currentUser(): Promise<User>;
    updateProfile(fields: Fields): Promise<User>;
    signIn(email: string, password: string): Promise<unknown>;
    register(fields: { email: string; password: string }): Promise<unknown>;
    verifyEmail(fields: { email: string; otpCode: string }): Promise<{ access_token?: string }>;
    setSessionToken(token: string): void;
    resendVerification(email: string): Promise<unknown>;
    requestPasswordReset(email: string): Promise<unknown>;
    resetPassword(fields: { resetToken: string; newPassword: string }): Promise<unknown>;
    signInWithProvider(provider: string, returnTo: string): void;
    signOut(redirect?: string): void;
    redirectToSignIn(returnTo: string): void;
  };
  records: { collection(name: string): Collection };
  services: { invoke<T = any>(name: string, payload?: unknown): Promise<ServiceResponse<T>> };
  files: { parseResume(input: ResumeInput): Promise<ServiceResponse> };
  settings: { getPublic(): Promise<Fields> };
  /** Response preserves status semantics of single-use consent handles. */
  consent: {
    getInfo(handle: string): Promise<Response>;
    respond(handle: string, action: 'approve' | 'deny'): Promise<Response>;
  };
}

export interface ClientConfig { backend: 'base44' | 'http' }
export type AdapterFactory = () => Application;
