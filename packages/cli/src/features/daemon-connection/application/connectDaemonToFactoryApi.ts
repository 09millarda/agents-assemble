import type { DaemonConnectionPort } from "../domain/DaemonConnectionPort";

export async function connectDaemonToFactoryApi(connection: DaemonConnectionPort, factoryApiUrl: string, authToken: string): Promise<void> {
  await connection.connectToFactoryApi(factoryApiUrl, authToken);
}
