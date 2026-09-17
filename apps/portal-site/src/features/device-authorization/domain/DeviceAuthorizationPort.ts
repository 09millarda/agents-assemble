export interface DeviceAuthorizationPort {
  approveDeviceAuthorization(userCode: string): Promise<{ daemonId: string }>;
  denyDeviceAuthorization(userCode: string): Promise<{ denied: true }>;
}
