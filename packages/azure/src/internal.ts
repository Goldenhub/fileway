import type { StorageErrorCode } from "@fileway/core";

// Internal: connection-string parsing and error classification for
// AzureDriver. Not exported from the package.

// Azurite's well-known development account (public, documented by Microsoft).
const DEV_ACCOUNT = "devstoreaccount1";
const DEV_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const DEV_ENDPOINT = "http://127.0.0.1:10000/devstoreaccount1";

/** Splits a connection string into the fields this driver understands. */
export function parseConnectionString(value: string): {
  accountName?: string;
  accountKey?: string;
  sasToken?: string;
  endpoint?: string;
} {
  const parts: Record<string, string> = {};
  for (const segment of value.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }
  if (parts.UseDevelopmentStorage === "true") {
    return { accountName: DEV_ACCOUNT, accountKey: DEV_KEY, endpoint: DEV_ENDPOINT };
  }
  const accountName = parts.AccountName;
  const endpoint =
    parts.BlobEndpoint ??
    (accountName
      ? `${parts.DefaultEndpointsProtocol ?? "https"}://${accountName}.blob.${parts.EndpointSuffix ?? "core.windows.net"}`
      : undefined);
  return {
    ...(accountName ? { accountName } : {}),
    ...(parts.AccountKey ? { accountKey: parts.AccountKey } : {}),
    ...(parts.SharedAccessSignature ? { sasToken: parts.SharedAccessSignature } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

/** Classifies an Azure failure into a typed code from the service error code,
 * falling back to the HTTP status. */
export function classifyAzureError(status: number, code: string | undefined): StorageErrorCode {
  switch (code) {
    case "ContainerNotFound":
    case "ContainerBeingDeleted":
      return "bucket-not-found";
    case "BlobNotFound":
    case "ResourceNotFound":
      return "not-found";
    case "AuthenticationFailed":
    case "AuthorizationFailure":
    case "AuthorizationPermissionMismatch":
    case "AuthorizationResourceTypeMismatch":
    case "NoAuthenticationInformation":
    case "InvalidAuthenticationInfo":
      return "auth-failed";
    case "RequestBodyTooLarge":
    case "BlockCountExceedsLimit":
      return "size-exceeded";
    case "ServerBusy":
    case "TooManyRequests":
      return "rate-limited";
  }
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "auth-failed";
  if (status === 404) return "not-found";
  if (status === 413) return "size-exceeded";
  return "provider-error";
}
