export interface DaemonConnectionPort {
  connectToFactoryApi(factoryApiUrl: string, authToken: string): Promise<void>;
}
