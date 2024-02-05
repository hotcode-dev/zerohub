/* eslint-disable */
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "";

/** SendOfferMessage is sent offer SDP from offering peer to answer peer */
export interface SendOfferMessage {
  answerPeerID: number;
  offerSDP: string;
}

/** SendAnswerMessage is sent answer SDP from answer peer to offering peer */
export interface SendAnswerMessage {
  offerPeerID: number;
  answerSDP: string;
}

/** SendICECandidateMessage is not using yet */
export interface SendICECandidateMessage {
  peerID: number;
  candidate: string;
}

/** ClientMessage is the message sent from client */
export interface ClientMessage {
  offerMessage?: SendOfferMessage | undefined;
  answerMessage?: SendAnswerMessage | undefined;
  sendICECandidate?: SendICECandidateMessage | undefined;
}

function createBaseSendOfferMessage(): SendOfferMessage {
  return { answerPeerID: 0, offerSDP: "" };
}

export const SendOfferMessage = {
  encode(message: SendOfferMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.answerPeerID !== 0) {
      writer.uint32(8).uint32(message.answerPeerID);
    }
    if (message.offerSDP !== "") {
      writer.uint32(18).string(message.offerSDP);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendOfferMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendOfferMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.answerPeerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.offerSDP = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SendOfferMessage {
    return {
      answerPeerID: isSet(object.answerPeerID) ? globalThis.Number(object.answerPeerID) : 0,
      offerSDP: isSet(object.offerSDP) ? globalThis.String(object.offerSDP) : "",
    };
  },

  toJSON(message: SendOfferMessage): unknown {
    const obj: any = {};
    if (message.answerPeerID !== 0) {
      obj.answerPeerID = Math.round(message.answerPeerID);
    }
    if (message.offerSDP !== "") {
      obj.offerSDP = message.offerSDP;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendOfferMessage>, I>>(base?: I): SendOfferMessage {
    return SendOfferMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendOfferMessage>, I>>(object: I): SendOfferMessage {
    const message = createBaseSendOfferMessage();
    message.answerPeerID = object.answerPeerID ?? 0;
    message.offerSDP = object.offerSDP ?? "";
    return message;
  },
};

function createBaseSendAnswerMessage(): SendAnswerMessage {
  return { offerPeerID: 0, answerSDP: "" };
}

export const SendAnswerMessage = {
  encode(message: SendAnswerMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offerPeerID !== 0) {
      writer.uint32(8).uint32(message.offerPeerID);
    }
    if (message.answerSDP !== "") {
      writer.uint32(18).string(message.answerSDP);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendAnswerMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendAnswerMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.offerPeerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.answerSDP = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SendAnswerMessage {
    return {
      offerPeerID: isSet(object.offerPeerID) ? globalThis.Number(object.offerPeerID) : 0,
      answerSDP: isSet(object.answerSDP) ? globalThis.String(object.answerSDP) : "",
    };
  },

  toJSON(message: SendAnswerMessage): unknown {
    const obj: any = {};
    if (message.offerPeerID !== 0) {
      obj.offerPeerID = Math.round(message.offerPeerID);
    }
    if (message.answerSDP !== "") {
      obj.answerSDP = message.answerSDP;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendAnswerMessage>, I>>(base?: I): SendAnswerMessage {
    return SendAnswerMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendAnswerMessage>, I>>(object: I): SendAnswerMessage {
    const message = createBaseSendAnswerMessage();
    message.offerPeerID = object.offerPeerID ?? 0;
    message.answerSDP = object.answerSDP ?? "";
    return message;
  },
};

function createBaseSendICECandidateMessage(): SendICECandidateMessage {
  return { peerID: 0, candidate: "" };
}

export const SendICECandidateMessage = {
  encode(message: SendICECandidateMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerID !== 0) {
      writer.uint32(8).uint32(message.peerID);
    }
    if (message.candidate !== "") {
      writer.uint32(18).string(message.candidate);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendICECandidateMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendICECandidateMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.peerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.candidate = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SendICECandidateMessage {
    return {
      peerID: isSet(object.peerID) ? globalThis.Number(object.peerID) : 0,
      candidate: isSet(object.candidate) ? globalThis.String(object.candidate) : "",
    };
  },

  toJSON(message: SendICECandidateMessage): unknown {
    const obj: any = {};
    if (message.peerID !== 0) {
      obj.peerID = Math.round(message.peerID);
    }
    if (message.candidate !== "") {
      obj.candidate = message.candidate;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendICECandidateMessage>, I>>(base?: I): SendICECandidateMessage {
    return SendICECandidateMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendICECandidateMessage>, I>>(object: I): SendICECandidateMessage {
    const message = createBaseSendICECandidateMessage();
    message.peerID = object.peerID ?? 0;
    message.candidate = object.candidate ?? "";
    return message;
  },
};

function createBaseClientMessage(): ClientMessage {
  return { offerMessage: undefined, answerMessage: undefined, sendICECandidate: undefined };
}

export const ClientMessage = {
  encode(message: ClientMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offerMessage !== undefined) {
      SendOfferMessage.encode(message.offerMessage, writer.uint32(18).fork()).ldelim();
    }
    if (message.answerMessage !== undefined) {
      SendAnswerMessage.encode(message.answerMessage, writer.uint32(26).fork()).ldelim();
    }
    if (message.sendICECandidate !== undefined) {
      SendICECandidateMessage.encode(message.sendICECandidate, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ClientMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          if (tag !== 18) {
            break;
          }

          message.offerMessage = SendOfferMessage.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.answerMessage = SendAnswerMessage.decode(reader, reader.uint32());
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.sendICECandidate = SendICECandidateMessage.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): ClientMessage {
    return {
      offerMessage: isSet(object.offerMessage) ? SendOfferMessage.fromJSON(object.offerMessage) : undefined,
      answerMessage: isSet(object.answerMessage) ? SendAnswerMessage.fromJSON(object.answerMessage) : undefined,
      sendICECandidate: isSet(object.sendICECandidate)
        ? SendICECandidateMessage.fromJSON(object.sendICECandidate)
        : undefined,
    };
  },

  toJSON(message: ClientMessage): unknown {
    const obj: any = {};
    if (message.offerMessage !== undefined) {
      obj.offerMessage = SendOfferMessage.toJSON(message.offerMessage);
    }
    if (message.answerMessage !== undefined) {
      obj.answerMessage = SendAnswerMessage.toJSON(message.answerMessage);
    }
    if (message.sendICECandidate !== undefined) {
      obj.sendICECandidate = SendICECandidateMessage.toJSON(message.sendICECandidate);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<ClientMessage>, I>>(base?: I): ClientMessage {
    return ClientMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ClientMessage>, I>>(object: I): ClientMessage {
    const message = createBaseClientMessage();
    message.offerMessage = (object.offerMessage !== undefined && object.offerMessage !== null)
      ? SendOfferMessage.fromPartial(object.offerMessage)
      : undefined;
    message.answerMessage = (object.answerMessage !== undefined && object.answerMessage !== null)
      ? SendAnswerMessage.fromPartial(object.answerMessage)
      : undefined;
    message.sendICECandidate = (object.sendICECandidate !== undefined && object.sendICECandidate !== null)
      ? SendICECandidateMessage.fromPartial(object.sendICECandidate)
      : undefined;
    return message;
  },
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
