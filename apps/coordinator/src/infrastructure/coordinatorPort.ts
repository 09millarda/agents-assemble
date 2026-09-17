export function resolveCoordinatorPort(environment: NodeJS.ProcessEnv): number {
  return Number(environment.COORDINATOR_PORT ?? 3003);
}
