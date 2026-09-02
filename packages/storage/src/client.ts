const MAX_CLIENT_BYTES = 32 * 1024;
const MAX_STORAGE_KEYS = 64;

export type StorageSnapshot = {
  available: boolean;
  keys?: number;
  bytes?: number;
  keyNames?: string[];
  error?: string;
};

export type NavigationTimingSnapshot = {
  type?: string;
  redirectCount?: number;
  domInteractive?: number;
  domContentLoaded?: number;
  load?: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
};

export type MemorySnapshot = {
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
};

/** Auto-collected browser / device / page / storage snapshot (SDK → ingest → events.client). */
export type ClientContext = {
  browser?: {
    name?: string;
    version?: string;
    language?: string;
    languages?: string[];
    cookieEnabled?: boolean;
    onLine?: boolean;
    userAgent?: string;
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
    webdriver?: boolean;
    pdfViewerEnabled?: boolean;
    doNotTrack?: string | null;
    productSub?: string;
    appVersion?: string;
    appCodeName?: string;
    appName?: string;
  };
  os?: {
    platform?: string;
    userAgentPlatform?: string;
  };
  device?: {
    vendor?: string;
    maxTouchPoints?: number;
    hardwareConcurrency?: number;
    deviceMemory?: number;
  };
  screen?: {
    width?: number;
    height?: number;
    availWidth?: number;
    availHeight?: number;
    colorDepth?: number;
    pixelRatio?: number;
    orientation?: {
      type?: string;
      angle?: number;
    };
  };
  viewport?: {
    width?: number;
    height?: number;
    outerWidth?: number;
    outerHeight?: number;
    scrollX?: number;
    scrollY?: number;
  };
  page?: {
    url?: string;
    path?: string;
    hash?: string;
    search?: string;
    referrer?: string;
    title?: string;
    visibilityState?: string;
    hidden?: boolean;
    characterSet?: string;
    compatMode?: string;
    readyState?: string;
    lang?: string;
    dir?: string;
    historyLength?: number;
  };
  network?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
    type?: string;
  };
  storage?: {
    localStorage?: StorageSnapshot;
    sessionStorage?: StorageSnapshot;
    cookies?: {
      available: boolean;
      count?: number;
      bytes?: number;
      names?: string[];
    };
    indexedDB?: { available: boolean };
  };
  performance?: {
    navigation?: NavigationTimingSnapshot;
    memory?: MemorySnapshot;
    timeOrigin?: number;
  };
  timezone?: string;
  timezoneOffset?: number;
  /** Populated server-side at ingest from HTTP headers. */
  request?: {
    ip?: string;
    forwardedFor?: string;
    realIp?: string;
    acceptLanguage?: string;
    acceptEncoding?: string;
    referer?: string;
    origin?: string;
    host?: string;
    method?: string;
    cf?: Record<string, string>;
  };
};

export function serializeClient(client: unknown): string | null {
  if (client == null || typeof client !== "object" || Array.isArray(client)) return null;
  try {
    const json = JSON.stringify(client);
    if (!json || json === "{}" || json.length > MAX_CLIENT_BYTES) return null;
    return json;
  } catch {
    return null;
  }
}

export function parseClient(raw: unknown): ClientContext | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ClientContext;
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ClientContext;
    }
    return null;
  } catch {
    return null;
  }
}

export { MAX_CLIENT_BYTES, MAX_STORAGE_KEYS };
