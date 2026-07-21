export type JwtClaims = {
  sub?: string;
  exp?: number;
  apps: string[];
};

export type FrontendSession = {
  token: string;
  email: string;
  username: string;
  displayName: string | null;
  gatewayUserId: string;
  apps: string[];
  subject?: string;
  expiresAt: number | null;
};

export type AuthLoginResponse = {
  token: string;
  user: {
    username?: string;
    email: string;
    user_id?: string;
  };
};

