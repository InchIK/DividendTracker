/**
 * Compatibility exports for existing route modules while authentication is
 * session based. ADMIN_TOKEN and the legacy global WIDGET_TOKEN are no longer
 * accepted anywhere in the application.
 */
export {
  authUserId,
  requireUser as requireAdmin,
  requireOwner,
  requireWidget,
  requireWidgetOrUser as requireAnyAuth,
  type AuthContextEnv as AuthEnv,
} from './session';
