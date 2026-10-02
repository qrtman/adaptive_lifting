export interface AppUser {
  id: string;
  google_sub: string | null;
  email_verified_at: string | null;
  email_verification_required: boolean;
  email_verification_legacy_exempt: boolean;
  deleted_at: string | null;
}

export interface AuthSession {
  id: string;
  user_id: string;
  jwt_id: string;
  revoked_at: string | null;
  active: boolean;
}

export interface Principal {
  user: AppUser;
  sessionId: string;
}

export interface AuthRepository {
  findSession(id: string): Promise<AuthSession | null>;
  findUser(id: string): Promise<AppUser | null>;
}
