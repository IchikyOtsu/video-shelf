export type AuthAccount = { id: string };

export function authDestination(onboardingRequired: boolean) {
  return onboardingRequired ? "/onboarding" : "/";
}

export function guestPageDestination(user: { emailVerified: boolean; onboardingCompleted: boolean } | null) {
  if (!user) return null;
  return !user.emailVerified || !user.onboardingCompleted ? "/onboarding" : "/";
}

export function startLegacyMigration<T extends AuthAccount>(account: T, setUser: (account: T) => void, migrate: (userId: string) => Promise<void>, onFailure: () => void) {
  setUser(account);
  void migrate(account.id).catch(onFailure);
}
