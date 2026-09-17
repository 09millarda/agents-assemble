export function canEnrollBrowser(permission: string): boolean { return permission === "granted"; }
export function hasDeniedNotifications(permission: string): boolean { return permission === "denied"; }
export function shouldReplaceExpiredSubscription(deliveryStatus: string): boolean { return deliveryStatus === "expired"; }
