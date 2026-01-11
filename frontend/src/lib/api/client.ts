import axios, { AxiosResponse } from "axios";
import { getApiUrl } from "@/lib/config";
import { isCognitoConfigured } from "@/lib/amplify-config";

/**
 * Get Cognito ID token from Amplify session.
 * Returns null if not authenticated or Cognito not configured.
 */
async function getCognitoToken(): Promise<string | null> {
  const cognitoConfigured = await isCognitoConfigured();
  if (!cognitoConfigured) {
    return null;
  }

  try {
    // Dynamic import to avoid loading Amplify when not configured
    const { fetchAuthSession } = await import("aws-amplify/auth");
    const session = await fetchAuthSession({ forceRefresh: false });
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    // Not authenticated or session expired
    return null;
  }
}

/**
 * Get password token from localStorage (fallback for development).
 */
function getPasswordToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const authStorage = localStorage.getItem("auth-storage");
    if (authStorage) {
      const { state } = JSON.parse(authStorage);
      return state?.token ?? null;
    }
  } catch (error) {
    console.error("Error parsing auth storage:", error);
  }

  return null;
}

// API client with runtime-configurable base URL
// The base URL is fetched from the API config endpoint on first request
// Timeout increased to 10 minutes (600000ms = 600s) to accommodate slow LLM operations
// (transformations, insights generation, chat) especially on slower hardware (Ollama, LM Studio)
// Note: Frontend uses milliseconds, backend uses seconds
// Local LLMs can take several minutes for complex questions with large contexts
export const apiClient = axios.create({
  timeout: 600000, // 600 seconds = 10 minutes
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: false,
});

// Request interceptor to add base URL and auth header
apiClient.interceptors.request.use(async (config) => {
  // Set the base URL dynamically from runtime config
  if (!config.baseURL) {
    const apiUrl = await getApiUrl();
    config.baseURL = `${apiUrl}/api`;
  }

  // Try to get auth token (Cognito first, then password fallback)
  let token: string | null = null;

  // Try Cognito token first (primary auth method)
  token = await getCognitoToken();

  // Fall back to password token (development mode)
  if (!token) {
    token = getPasswordToken();
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Handle FormData vs JSON content types
  if (config.data instanceof FormData) {
    // Remove any Content-Type header to let browser set multipart boundary
    delete config.headers["Content-Type"];
  } else if (
    config.method &&
    ["post", "put", "patch"].includes(config.method.toLowerCase())
  ) {
    config.headers["Content-Type"] = "application/json";
  }

  return config;
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Clear auth state and redirect to login
      if (typeof window !== "undefined") {
        // Clear password auth storage
        localStorage.removeItem("auth-storage");

        // If Cognito is configured, also sign out from Cognito
        try {
          const cognitoConfigured = await isCognitoConfigured();
          if (cognitoConfigured) {
            const { signOut } = await import("aws-amplify/auth");
            await signOut();
          }
        } catch {
          // Ignore sign out errors or configuration check failures
        }

        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
