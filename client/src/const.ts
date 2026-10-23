import { type Config, LogLevel } from "./types";

/**
 * The default RTC configuration.
 */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
      ],
    },
  ],
  bundlePolicy: "balanced",
};

/**
 * The default RTC offer options.
 */
export const DEFAULT_RTC_OFFER_OPTIONS: RTCOfferOptions = {
  offerToReceiveAudio: false,
  offerToReceiveVideo: false,
};

/**
 * The error message surfaced via `onZeroHubError` when every configured
 * host has been exhausted by the automatic reconnection.
 */
export const ALL_HOSTS_EXHAUSTED_ERROR_MESSAGE =
  "all ZeroHub hosts are not working, please check the ZeroHub hosts";

/**
 * The default configuration for the ZeroHub client.
 */
export const DEFAULT_CONFIG: Config = {
  tls: true,
  logLevel: LogLevel.Warning,
  logger: console,
  waitIceCandidatesTimeout: 2000,
  autoAnswer: true,
  autoAcceptAnswer: true,
  maxReconnectAttempts: 10,
  reconnectBaseBackoffMs: 250,
  rtcConfig: DEFAULT_RTC_CONFIG,
  rtcOfferOptions: DEFAULT_RTC_OFFER_OPTIONS,
};
