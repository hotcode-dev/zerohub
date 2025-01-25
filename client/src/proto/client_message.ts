/* eslint-disable */
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "";

/** SendOfferMessage is sent offer SDP from offering peer to answer peer */
export interface SendOfferMessage {
  answerPeerId: string;
  offerSdp: string;
}

/** Send answer message is sent answer SDP from answer peer to offering peer */
export interface SendAnswerMessage {
  offerPeerId: string;
  answerSdp: string;
}

/** Send ICE candidate message is not using yet */
export interface SendIceCandidateMessage {
  peerId: string;
  candidate: string;
}

/** Update peer metadata message is for update peer metadata message */
export interface UpdatePeerMetadataMessage {
  peerId: string;
  metadata: string;
}

/** ClientMessage is the message sent from client */
export interface ClientMessage {
  sendOfferMessage?: SendOfferMessage | undefined;
  sendAnswerMessage?: SendAnswerMessage | undefined;
  sendIceCandidateMessage?: SendIceCandidateMessage | undefined;
  updatePeerMetadataMessage?: UpdatePeerMetadataMessage | undefined;
}

function createBaseSendOfferMessage(): SendOfferMessage {
  return { answerPeerId: "", offerSdp: "" };
}

export const SendOfferMessage = {
  encode(message: SendOfferMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.answerPeerId !== "") {
      writer.uint32(10).string(message.answerPeerId);
    }
    if (message.offerSdp !== "") {
      writer.uint32(18).string(message.offerSdp);
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
          if (tag !== 10) {
            break;
          }

          message.answerPeerId = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.offerSdp = reader.string();
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
      answerPeerId: isSet(object.answerPeerId) ? globalThis.String(object.answerPeerId) : "",
      offerSdp: isSet(object.offerSdp) ? globalThis.String(object.offerSdp) : "",
    };
  },

  toJSON(message: SendOfferMessage): unknown {
    const obj: any = {};
    if (message.answerPeerId !== "") {
      obj.answerPeerId = message.answerPeerId;
    }
    if (message.offerSdp !== "") {
      obj.offerSdp = message.offerSdp;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendOfferMessage>, I>>(base?: I): SendOfferMessage {
    return SendOfferMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendOfferMessage>, I>>(object: I): SendOfferMessage {
    const message = createBaseSendOfferMessage();
    message.answerPeerId = object.answerPeerId ?? "";
    message.offerSdp = object.offerSdp ?? "";
    return message;
  },
};

function createBaseSendAnswerMessage(): SendAnswerMessage {
  return { offerPeerId: "", answerSdp: "" };
}

export const SendAnswerMessage = {
  encode(message: SendAnswerMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offerPeerId !== "") {
      writer.uint32(10).string(message.offerPeerId);
    }
    if (message.answerSdp !== "") {
      writer.uint32(18).string(message.answerSdp);
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
          if (tag !== 10) {
            break;
          }

          message.offerPeerId = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.answerSdp = reader.string();
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
      offerPeerId: isSet(object.offerPeerId) ? globalThis.String(object.offerPeerId) : "",
      answerSdp: isSet(object.answerSdp) ? globalThis.String(object.answerSdp) : "",
    };
  },

  toJSON(message: SendAnswerMessage): unknown {
    const obj: any = {};
    if (message.offerPeerId !== "") {
      obj.offerPeerId = message.offerPeerId;
    }
    if (message.answerSdp !== "") {
      obj.answerSdp = message.answerSdp;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendAnswerMessage>, I>>(base?: I): SendAnswerMessage {
    return SendAnswerMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendAnswerMessage>, I>>(object: I): SendAnswerMessage {
    const message = createBaseSendAnswerMessage();
    message.offerPeerId = object.offerPeerId ?? "";
    message.answerSdp = object.answerSdp ?? "";
    return message;
  },
};

function createBaseSendIceCandidateMessage(): SendIceCandidateMessage {
  return { peerId: "", candidate: "" };
}

export const SendIceCandidateMessage = {
  encode(message: SendIceCandidateMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerId !== "") {
      writer.uint32(10).string(message.peerId);
    }
    if (message.candidate !== "") {
      writer.uint32(18).string(message.candidate);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendIceCandidateMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendIceCandidateMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.peerId = reader.string();
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

  fromJSON(object: any): SendIceCandidateMessage {
    return {
      peerId: isSet(object.peerId) ? globalThis.String(object.peerId) : "",
      candidate: isSet(object.candidate) ? globalThis.String(object.candidate) : "",
    };
  },

  toJSON(message: SendIceCandidateMessage): unknown {
    const obj: any = {};
    if (message.peerId !== "") {
      obj.peerId = message.peerId;
    }
    if (message.candidate !== "") {
      obj.candidate = message.candidate;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<SendIceCandidateMessage>, I>>(base?: I): SendIceCandidateMessage {
    return SendIceCandidateMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SendIceCandidateMessage>, I>>(object: I): SendIceCandidateMessage {
    const message = createBaseSendIceCandidateMessage();
    message.peerId = object.peerId ?? "";
    message.candidate = object.candidate ?? "";
    return message;
  },
};

function createBaseUpdatePeerMetadataMessage(): UpdatePeerMetadataMessage {
  return { peerId: "", metadata: "" };
}

export const UpdatePeerMetadataMessage = {
  encode(message: UpdatePeerMetadataMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerId !== "") {
      writer.uint32(10).string(message.peerId);
    }
    if (message.metadata !== "") {
      writer.uint32(18).string(message.metadata);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): UpdatePeerMetadataMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpdatePeerMetadataMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.peerId = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.metadata = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): UpdatePeerMetadataMessage {
    return {
      peerId: isSet(object.peerId) ? globalThis.String(object.peerId) : "",
      metadata: isSet(object.metadata) ? globalThis.String(object.metadata) : "",
    };
  },

  toJSON(message: UpdatePeerMetadataMessage): unknown {
    const obj: any = {};
    if (message.peerId !== "") {
      obj.peerId = message.peerId;
    }
    if (message.metadata !== "") {
      obj.metadata = message.metadata;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<UpdatePeerMetadataMessage>, I>>(base?: I): UpdatePeerMetadataMessage {
    return UpdatePeerMetadataMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<UpdatePeerMetadataMessage>, I>>(object: I): UpdatePeerMetadataMessage {
    const message = createBaseUpdatePeerMetadataMessage();
    message.peerId = object.peerId ?? "";
    message.metadata = object.metadata ?? "";
    return message;
  },
};

function createBaseClientMessage(): ClientMessage {
  return {
    sendOfferMessage: undefined,
    sendAnswerMessage: undefined,
    sendIceCandidateMessage: undefined,
    updatePeerMetadataMessage: undefined,
  };
}

export const ClientMessage = {
  encode(message: ClientMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.sendOfferMessage !== undefined) {
      SendOfferMessage.encode(message.sendOfferMessage, writer.uint32(10).fork()).ldelim();
    }
    if (message.sendAnswerMessage !== undefined) {
      SendAnswerMessage.encode(message.sendAnswerMessage, writer.uint32(18).fork()).ldelim();
    }
    if (message.sendIceCandidateMessage !== undefined) {
      SendIceCandidateMessage.encode(message.sendIceCandidateMessage, writer.uint32(26).fork()).ldelim();
    }
    if (message.updatePeerMetadataMessage !== undefined) {
      UpdatePeerMetadataMessage.encode(message.updatePeerMetadataMessage, writer.uint32(34).fork()).ldelim();
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
        case 1:
          if (tag !== 10) {
            break;
          }

          message.sendOfferMessage = SendOfferMessage.decode(reader, reader.uint32());
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.sendAnswerMessage = SendAnswerMessage.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.sendIceCandidateMessage = SendIceCandidateMessage.decode(reader, reader.uint32());
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.updatePeerMetadataMessage = UpdatePeerMetadataMessage.decode(reader, reader.uint32());
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
      sendOfferMessage: isSet(object.sendOfferMessage) ? SendOfferMessage.fromJSON(object.sendOfferMessage) : undefined,
      sendAnswerMessage: isSet(object.sendAnswerMessage)
        ? SendAnswerMessage.fromJSON(object.sendAnswerMessage)
        : undefined,
      sendIceCandidateMessage: isSet(object.sendIceCandidateMessage)
        ? SendIceCandidateMessage.fromJSON(object.sendIceCandidateMessage)
        : undefined,
      updatePeerMetadataMessage: isSet(object.updatePeerMetadataMessage)
        ? UpdatePeerMetadataMessage.fromJSON(object.updatePeerMetadataMessage)
        : undefined,
    };
  },

  toJSON(message: ClientMessage): unknown {
    const obj: any = {};
    if (message.sendOfferMessage !== undefined) {
      obj.sendOfferMessage = SendOfferMessage.toJSON(message.sendOfferMessage);
    }
    if (message.sendAnswerMessage !== undefined) {
      obj.sendAnswerMessage = SendAnswerMessage.toJSON(message.sendAnswerMessage);
    }
    if (message.sendIceCandidateMessage !== undefined) {
      obj.sendIceCandidateMessage = SendIceCandidateMessage.toJSON(message.sendIceCandidateMessage);
    }
    if (message.updatePeerMetadataMessage !== undefined) {
      obj.updatePeerMetadataMessage = UpdatePeerMetadataMessage.toJSON(message.updatePeerMetadataMessage);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<ClientMessage>, I>>(base?: I): ClientMessage {
    return ClientMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ClientMessage>, I>>(object: I): ClientMessage {
    const message = createBaseClientMessage();
    message.sendOfferMessage = (object.sendOfferMessage !== undefined && object.sendOfferMessage !== null)
      ? SendOfferMessage.fromPartial(object.sendOfferMessage)
      : undefined;
    message.sendAnswerMessage = (object.sendAnswerMessage !== undefined && object.sendAnswerMessage !== null)
      ? SendAnswerMessage.fromPartial(object.sendAnswerMessage)
      : undefined;
    message.sendIceCandidateMessage =
      (object.sendIceCandidateMessage !== undefined && object.sendIceCandidateMessage !== null)
        ? SendIceCandidateMessage.fromPartial(object.sendIceCandidateMessage)
        : undefined;
    message.updatePeerMetadataMessage =
      (object.updatePeerMetadataMessage !== undefined && object.updatePeerMetadataMessage !== null)
        ? UpdatePeerMetadataMessage.fromPartial(object.updatePeerMetadataMessage)
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
