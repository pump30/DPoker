export type User = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  createdAt: number;
};

export type CreateUserInput = {
  username: string;
  passwordHash: string;
  displayName: string;
};
