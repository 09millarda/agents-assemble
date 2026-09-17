import { z } from "zod";
import { isUserCodeValid } from "@factory/shared-domain";

export const RequestDeviceAuthorizationBodySchema = z.object({
  machineName: z.string().trim().min(1).optional(),
  daemon_id: z.string().min(1).nullable().optional(),
});
export type RequestDeviceAuthorizationBody = z.infer<typeof RequestDeviceAuthorizationBodySchema>;

export const DeviceAuthorizationResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  expires_in: z.number(),
  interval: z.number(),
});

export const DeviceTokenBodySchema = z.object({
  device_code: z.string().min(1),
});
export type DeviceTokenBody = z.infer<typeof DeviceTokenBodySchema>;

export const DeviceTokenApprovedSchema = z.object({
  status: z.literal("approved"),
  daemonId: z.string().min(1),
  authToken: z.string().min(1),
});

export const DeviceTokenPendingSchema = z.object({
  status: z.literal("pending"),
});

const UserCodeSchema = z.string().refine(isUserCodeValid, { message: "User code is invalid." });

export const ApproveDeviceAuthorizationBodySchema = z.object({
  user_code: UserCodeSchema,
});
export type ApproveDeviceAuthorizationBody = z.infer<typeof ApproveDeviceAuthorizationBodySchema>;

export const DenyDeviceAuthorizationBodySchema = z.object({
  user_code: UserCodeSchema,
});
export type DenyDeviceAuthorizationBody = z.infer<typeof DenyDeviceAuthorizationBodySchema>;

export const ApproveDeviceAuthorizationResponseSchema = z.object({
  daemonId: z.string().min(1),
});

export const DenyDeviceAuthorizationResponseSchema = z.object({
  denied: z.literal(true),
});

export const DeviceAuthorizationStatusSchema = z.object({
  deviceCode: z.string().min(1),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  expiresAt: z.string().datetime(),
});
