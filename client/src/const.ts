import { type Config, LogLevel } from "./types";

export const defaultRtcConfig: RTCConfiguration = {
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

export const defaultConfig: Config = {
  tls: true,
  logLevel: LogLevel.Warning,
  waitIceCandidatesTimeout: 2000,
  autoAnswer: true,
  autoAcceptAnswer: true,
  rtcConfig: defaultRtcConfig,
};

export const defaultRtcOfferOptions: RTCOfferOptions = {
  iceRestart: true,
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};
