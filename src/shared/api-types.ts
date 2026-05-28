export type RegisterRequest = {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type AuthResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
  };
};

export type CreateInviteResponse = {
  code: string;
};

export type ErrorResponse = {
  error: string;
};
