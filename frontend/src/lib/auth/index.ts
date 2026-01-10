/**
 * Authentication exports.
 *
 * Provides a unified interface for authentication, supporting both
 * Cognito (primary) and password auth (development fallback).
 */

export {
  CognitoAuthProvider,
  useCognitoAuth,
  type CognitoUser,
  type CognitoAuthContextValue,
} from "./cognito-context";

export { configureAmplify, isCognitoConfigured } from "@/lib/amplify-config";
